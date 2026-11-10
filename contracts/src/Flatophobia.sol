// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The subset of the $WIF token (OpenZeppelin ERC20 + ERC20Burnable) this game uses.
interface IWIF {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function burn(uint256 amount) external;
}

/// @title  Flatophobia
/// @notice A shared flat world balanced on a pin. Players drop settlers on a 16 x 5 polar board,
///         every settler pays the same flat stake in $WIF, and every settler tilts the world toward
///         itself. When a round closes the world tips: the low side's edge slides off first, and the
///         steeper the tip, the further in the slide reaches. The survivors split what fell,
///         weighted by how far out they dared to stand.
///
///         The real end of each round is hidden inside a "candle" window, so waiting for the last
///         second is a gamble: a settler dropped after the candle went out falls too.
///
///         If a round ends almost perfectly level ("flat day"), nobody falls and the survivors
///         also share half of the jackpot.
///
///         No owner, no admin, no upgrade path. Every function can be called by anyone.
contract Flatophobia {
    // ------------------------------------------------------------------ board
    uint256 public constant SECTORS = 16;
    uint256 public constant RINGS = 5;
    uint256 public constant CELLS = SECTORS * RINGS;
    /// cos((j + 0.5) * 22.5 deg) * 1e6 for j = 0..3, packed 20 bits each.
    uint256 private constant COS_PACKED = 0x2fa1287a32cafeeef731;
    int256 private constant UNIT = 1e6;

    // ------------------------------------------------------------------ rules
    uint256 public constant MAX_PER_WALLET = 3;
    uint256 public constant MAX_SETTLERS = 120;
    uint256 public constant MIN_PLAYERS = 2;
    uint256 public constant MIN_FLAT_PLAYERS = 3;
    uint256 public constant BURN_BPS = 500; // 5% of everything that falls is burned
    uint256 public constant JACKPOT_BPS = 500; // 5% of everything that falls feeds the jackpot
    /// A round is "flat" when the tilt is at most half a ring-1 settler out of balance.
    int256 public constant FLAT_TOLERANCE = UNIT / 2;
    /// The slide rule: a settler falls when ring * (its direction . tilt) exceeds GRIP.
    /// The edge of the low side goes first; the steeper the tip, the further in it reaches.
    /// 3 ring units, scaled by 1e6 * 1e6 (direction and tilt are both scaled by 1e6).
    int256 public constant GRIP = 3 * UNIT * UNIT;

    IWIF public immutable wif;
    uint256 public immutable stake;
    uint64 public immutable roundLength;
    uint64 public immutable candleWindow;

    // ------------------------------------------------------------------ state
    enum Outcome {
        Open,
        Tipped,
        Flat,
        Void
    }

    struct Round {
        uint64 start; // timestamp of the first drop, 0 = not started
        uint64 sealBlock; // block recorded once the round closed; its successor's hash picks the hidden end
        uint64 end; // hidden end, revealed at settlement
        uint16 counted; // settlers [0, counted) landed before the hidden end
        uint16 players; // distinct wallets among counted settlers
        Outcome outcome;
        int64 tiltX; // final tilt of the counted settlers (ring units * 1e6)
        int64 tiltY;
        uint128 prizePool; // split among survivors by ring weight
        uint128 winWeight; // total ring weight of survivors
    }

    struct Settler {
        address owner;
        uint8 cell; // ring * SECTORS + sector
        uint64 time;
        uint16 playersSoFar; // distinct wallets in this round up to and including this drop
        bool claimed;
    }

    uint256 public currentRound;
    uint256 public jackpot;
    mapping(uint256 => Round) internal _rounds;
    mapping(uint256 => Settler[]) internal _settlers;
    mapping(uint256 => mapping(address => uint256)) public dropsBy;
    /// every drop a wallet ever made, packed as (round << 16) | index
    mapping(address => uint256[]) internal _history;

    uint256 private _lock = 1;

    // ------------------------------------------------------------------ events
    event RoundStarted(uint256 indexed round, uint256 start);
    event Dropped(uint256 indexed round, uint256 index, address indexed owner, uint8 cell);
    event Sealed(uint256 indexed round, uint256 sealBlock);
    event Settled(
        uint256 indexed round,
        Outcome outcome,
        uint256 end,
        uint256 counted,
        int256 tiltX,
        int256 tiltY,
        uint256 fallen,
        uint256 prizePool,
        uint256 burned,
        uint256 jackpotAfter
    );
    event Claimed(uint256 indexed round, uint256 index, address indexed owner, uint256 amount);
    event JackpotFed(address indexed from, uint256 amount);

    // ------------------------------------------------------------------ errors
    error BadCell();
    error WalletLimit();
    error RoundFull();
    error RoundNotClosed();
    error AlreadySettled();
    error WaitForNextBlock();
    error NotSettled();
    error AlreadyClaimed();
    error TransferFailed();
    error BadConfig();
    error Reentrancy();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address wif_, uint256 stake_, uint64 roundLength_, uint64 candleWindow_) {
        if (wif_ == address(0) || stake_ == 0 || candleWindow_ == 0 || candleWindow_ >= roundLength_) {
            revert BadConfig();
        }
        wif = IWIF(wif_);
        stake = stake_;
        roundLength = roundLength_;
        candleWindow = candleWindow_;
    }

    // ================================================================== play

    /// @notice Drop one settler on `cell`. Pulls `stake` $WIF (approve first).
    ///         If the current round has already closed, this seals it and your settler
    ///         becomes the first of the next round.
    function drop(uint8 cell) external nonReentrant returns (uint256 id, uint256 index) {
        if (cell >= CELLS) revert BadCell();

        id = currentRound;
        Round storage r = _rounds[id];
        if (r.start != 0 && block.timestamp >= uint256(r.start) + roundLength) {
            if (r.sealBlock == 0) {
                r.sealBlock = uint64(block.number);
                emit Sealed(id, block.number);
            }
            id = ++currentRound;
            r = _rounds[id];
        }
        if (r.start == 0) {
            r.start = uint64(block.timestamp);
            emit RoundStarted(id, block.timestamp);
        }

        uint256 mine = dropsBy[id][msg.sender];
        if (mine >= MAX_PER_WALLET) revert WalletLimit();
        Settler[] storage list = _settlers[id];
        index = list.length;
        if (index >= MAX_SETTLERS) revert RoundFull();

        uint16 players = index == 0 ? 0 : list[index - 1].playersSoFar;
        if (mine == 0) players += 1;
        dropsBy[id][msg.sender] = mine + 1;
        list.push(Settler(msg.sender, cell, uint64(block.timestamp), players, false));
        _history[msg.sender].push((id << 16) | index);

        if (!wif.transferFrom(msg.sender, address(this), stake)) revert TransferFailed();
        emit Dropped(id, index, msg.sender, cell);
    }

    /// @notice Anyone can add $WIF to the jackpot (sponsors, the team, generous players).
    function feedJackpot(uint256 amount) external nonReentrant {
        jackpot += amount;
        if (!wif.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        emit JackpotFed(msg.sender, amount);
    }

    // ================================================================== settle

    /// @notice Two calls finish a closed round: the first records a seal block, the second
    ///         (at least two blocks later) reads that block's successor hash to reveal the
    ///         hidden end, then tips the world. Anyone can call it. Returns true once settled.
    function settle(uint256 id) public nonReentrant returns (bool) {
        return _settle(id);
    }

    function _settle(uint256 id) internal returns (bool) {
        Round storage r = _rounds[id];
        if (r.outcome != Outcome.Open) revert AlreadySettled();
        if (r.start == 0 || block.timestamp < uint256(r.start) + roundLength) revert RoundNotClosed();

        if (r.sealBlock == 0) {
            r.sealBlock = uint64(block.number);
            emit Sealed(id, block.number);
            return false;
        }
        if (block.number <= uint256(r.sealBlock) + 1) revert WaitForNextBlock();
        bytes32 h = blockhash(uint256(r.sealBlock) + 1);
        if (h == bytes32(0)) {
            // the seal is older than 256 blocks: nobody settled in time, seal again
            r.sealBlock = uint64(block.number);
            emit Sealed(id, block.number);
            return false;
        }

        uint256 rand = uint256(keccak256(abi.encode(h, id, address(this))));
        uint256 end = uint256(r.start) + roundLength - candleWindow + (rand % (uint256(candleWindow) + 1));
        r.end = uint64(end);

        Settler[] storage list = _settlers[id];
        uint256 n = list.length;

        // counted settlers are the prefix that landed on or before the hidden end
        uint256 k;
        int256 tx_;
        int256 ty;
        while (k < n) {
            Settler storage s = list[k];
            if (s.time > end) break;
            (int256 dx, int256 dy) = _dir(s.cell % SECTORS);
            int256 radius = int256(uint256(s.cell / SECTORS + 1));
            tx_ += dx * radius;
            ty += dy * radius;
            unchecked {
                ++k;
            }
        }
        r.counted = uint16(k);
        uint256 players = k == 0 ? 0 : list[k - 1].playersSoFar;
        r.players = uint16(players);
        r.tiltX = int64(tx_);
        r.tiltY = int64(ty);

        if (players < MIN_PLAYERS) {
            r.outcome = Outcome.Void; // not enough people showed up: everyone gets their stake back
            emit Settled(id, Outcome.Void, end, k, tx_, ty, 0, 0, 0, jackpot);
            return true;
        }

        bool flat = tx_ * tx_ + ty * ty <= FLAT_TOLERANCE * FLAT_TOLERANCE && players >= MIN_FLAT_PLAYERS;

        uint256 fallen = n - k; // late settlers always fall
        uint256 winWeight;
        for (uint256 i; i < k;) {
            Settler storage s = list[i];
            if (!flat && _falls(s.cell, tx_, ty)) fallen += 1;
            else winWeight += s.cell / SECTORS + 1;
            unchecked {
                ++i;
            }
        }

        uint256 lost = fallen * stake;
        uint256 burned = (lost * BURN_BPS) / 10_000;
        uint256 toJackpot = (lost * JACKPOT_BPS) / 10_000;
        uint256 prize = lost - burned - toJackpot;
        uint256 pot = jackpot + toJackpot;

        if (winWeight == 0) {
            // the whole world fell: the prize share sinks into the jackpot too
            pot += prize;
            prize = 0;
        } else if (flat) {
            uint256 bonus = pot / 2;
            pot -= bonus;
            prize += bonus;
        }

        jackpot = pot;
        r.prizePool = uint128(prize);
        r.winWeight = uint128(winWeight);
        r.outcome = flat ? Outcome.Flat : Outcome.Tipped;

        if (burned > 0) wif.burn(burned);
        emit Settled(id, r.outcome, end, k, tx_, ty, fallen, prize, burned, pot);
        return true;
    }

    // ================================================================== claim

    /// @notice Pays a settler's result to its owner. Anyone may call it on anyone's behalf.
    ///         Settles the round first if that is the only thing missing.
    function claim(uint256 id, uint256 index) external nonReentrant returns (uint256) {
        return _claim(id, index);
    }

    /// @notice Claims many settlers in one transaction. Skips ones already claimed.
    function claimMany(uint256[] calldata ids, uint256[] calldata indexes) external nonReentrant returns (uint256 total) {
        uint256 len = ids.length;
        if (len != indexes.length) revert BadConfig();
        for (uint256 i; i < len;) {
            if (!_settlers[ids[i]][indexes[i]].claimed) total += _claim(ids[i], indexes[i]);
            unchecked {
                ++i;
            }
        }
    }

    function _claim(uint256 id, uint256 index) internal returns (uint256 amount) {
        Round storage r = _rounds[id];
        if (r.outcome == Outcome.Open) {
            if (!_settle(id)) revert NotSettled();
        }
        Settler storage s = _settlers[id][index];
        if (s.claimed) revert AlreadyClaimed();
        s.claimed = true;
        amount = _payout(r, s, index);
        if (amount > 0 && !wif.transfer(s.owner, amount)) revert TransferFailed();
        emit Claimed(id, index, s.owner, amount);
    }

    function _payout(Round storage r, Settler storage s, uint256 index) internal view returns (uint256) {
        if (r.outcome == Outcome.Void) return stake;
        if (index >= r.counted) return 0; // dropped after the candle went out
        if (r.outcome == Outcome.Tipped && _falls(s.cell, r.tiltX, r.tiltY)) return 0; // slid off the edge
        uint256 weight = s.cell / SECTORS + 1;
        return stake + (uint256(r.prizePool) * weight) / uint256(r.winWeight);
    }

    // ================================================================== views

    /// @notice Unit direction of a sector's centre, scaled by 1e6. Sector s points at (s + 0.5) * 22.5 degrees.
    function dir(uint256 sector) external pure returns (int256 x, int256 y) {
        if (sector >= SECTORS) revert BadCell();
        return _dir(sector);
    }

    /// @notice Would a settler on `cell` slide off a world tilted by (tiltX, tiltY)?
    function falls(uint8 cell, int256 tiltX, int256 tiltY) external pure returns (bool) {
        if (cell >= CELLS) revert BadCell();
        return _falls(cell, tiltX, tiltY);
    }

    function _falls(uint256 cell, int256 tx_, int256 ty) internal pure returns (bool) {
        (int256 dx, int256 dy) = _dir(cell % SECTORS);
        return int256(cell / SECTORS + 1) * (dx * tx_ + dy * ty) > GRIP;
    }

    function _dir(uint256 s) internal pure returns (int256 x, int256 y) {
        uint256 j = s % 4;
        int256 c = int256((COS_PACKED >> (j * 20)) & 0xFFFFF);
        int256 sn = int256((COS_PACKED >> ((3 - j) * 20)) & 0xFFFFF);
        uint256 q = s / 4;
        if (q == 0) return (c, sn);
        if (q == 1) return (-sn, c);
        if (q == 2) return (-c, -sn);
        return (sn, -c);
    }

    function getRound(uint256 id) external view returns (Round memory) {
        return _rounds[id];
    }

    function getSettlers(uint256 id) external view returns (Settler[] memory) {
        return _settlers[id];
    }

    /// @notice What a settler is owed (0 if it fell or is already claimed). Reverts while the round is open.
    function payoutOf(uint256 id, uint256 index) external view returns (uint256) {
        Round storage r = _rounds[id];
        if (r.outcome == Outcome.Open) revert NotSettled();
        Settler storage s = _settlers[id][index];
        if (s.claimed) return 0;
        return _payout(r, s, index);
    }

    function historyLength(address who) external view returns (uint256) {
        return _history[who].length;
    }

    /// @notice A page of a wallet's drops, newest last, packed as (round << 16) | index.
    function historyOf(address who, uint256 offset, uint256 limit) external view returns (uint256[] memory out) {
        uint256[] storage h = _history[who];
        if (offset >= h.length) return out;
        uint256 end = offset + limit > h.length ? h.length : offset + limit;
        out = new uint256[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            out[i - offset] = h[i];
        }
    }

    /// @notice Everything the game screen needs in one call.
    function snapshot()
        external
        view
        returns (
            uint256 id,
            Round memory round,
            Settler[] memory settlers,
            uint256 jackpot_,
            uint256 now_,
            uint256 blockNumber
        )
    {
        id = currentRound;
        return (id, _rounds[id], _settlers[id], jackpot, block.timestamp, block.number);
    }
}
