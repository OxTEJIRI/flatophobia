// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Flatophobia} from "../src/Flatophobia.sol";
import {MockWIF} from "./MockWIF.sol";

contract FlatophobiaTest is Test {
    MockWIF wif;
    Flatophobia game;

    uint256 constant STAKE = 1_000e18;
    uint64 constant LEN = 600;
    uint64 constant CANDLE = 180;
    uint256 constant T0 = 1_800_000_000;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address dave = makeAddr("dave");

    function setUp() public {
        vm.warp(T0);
        vm.roll(1_000);
        wif = new MockWIF();
        game = new Flatophobia(address(wif), STAKE, LEN, CANDLE);
        address[4] memory ps = [alice, bob, carol, dave];
        for (uint256 i; i < ps.length; ++i) {
            wif.mint(ps[i], 1_000_000e18);
            vm.prank(ps[i]);
            wif.approve(address(game), type(uint256).max);
        }
        wif.mint(address(this), 1_000_000e18);
        wif.approve(address(game), type(uint256).max);
    }

    // ------------------------------------------------------------------ helpers

    function _cell(uint256 ring, uint256 sector) internal pure returns (uint8) {
        return uint8((ring - 1) * 16 + sector);
    }

    function _drop(address who, uint256 ring, uint256 sector) internal returns (uint256 id, uint256 idx) {
        vm.prank(who);
        return game.drop(_cell(ring, sector));
    }

    /// Finds a block hash whose hidden end lands at or after `minEnd` (wantLate=false)
    /// or strictly before `beforeTime` (wantLate=true).
    function _hashFor(uint256 id, uint256 start, uint256 cutoff, bool wantEarly) internal view returns (bytes32 h) {
        for (uint256 i = 1; i < 5_000; ++i) {
            h = keccak256(abi.encode(i));
            uint256 rand = uint256(keccak256(abi.encode(h, id, address(game))));
            uint256 end = start + LEN - CANDLE + (rand % (uint256(CANDLE) + 1));
            if (wantEarly ? end < cutoff : end >= cutoff) return h;
        }
        revert("no hash found");
    }

    function _settleWith(uint256 id, bytes32 h) internal {
        Flatophobia.Round memory r = game.getRound(id);
        if (block.timestamp < uint256(r.start) + LEN) vm.warp(uint256(r.start) + LEN);
        if (r.sealBlock == 0) {
            assertFalse(game.settle(id), "first call seals");
            r = game.getRound(id);
        }
        vm.roll(uint256(r.sealBlock) + 2);
        vm.setBlockhash(uint256(r.sealBlock) + 1, h);
        assertTrue(game.settle(id), "second call settles");
    }

    function _settle(uint256 id) internal {
        _settleWith(id, keccak256("any"));
    }

    // ------------------------------------------------------------------ board

    function test_DirTableIsSymmetric() public view {
        for (uint256 s; s < 8; ++s) {
            (int256 x, int256 y) = game.dir(s);
            (int256 ox, int256 oy) = game.dir(s + 8);
            assertEq(x, -ox);
            assertEq(y, -oy);
            int256 len2 = x * x + y * y;
            assertApproxEqAbs(len2, 1e12, 2e6);
        }
        (int256 x0, int256 y0) = game.dir(0);
        assertEq(x0, 980785);
        assertEq(y0, 195090);
        (int256 x5, int256 y5) = game.dir(5); // 123.75 deg
        assertLt(x5, 0);
        assertGt(y5, 0);
    }

    // ------------------------------------------------------------------ drops

    function test_DropPullsStakeAndStartsRound() public {
        uint256 before = wif.balanceOf(alice);
        (uint256 id, uint256 idx) = _drop(alice, 3, 7);
        assertEq(id, 0);
        assertEq(idx, 0);
        assertEq(wif.balanceOf(alice), before - STAKE);
        assertEq(wif.balanceOf(address(game)), STAKE);
        Flatophobia.Round memory r = game.getRound(0);
        assertEq(r.start, T0);
        Flatophobia.Settler[] memory s = game.getSettlers(0);
        assertEq(s.length, 1);
        assertEq(s[0].owner, alice);
        assertEq(s[0].cell, _cell(3, 7));
        assertEq(s[0].playersSoFar, 1);
        assertEq(game.historyLength(alice), 1);
    }

    function test_WalletLimit() public {
        _drop(alice, 1, 0);
        _drop(alice, 1, 1);
        _drop(alice, 1, 2);
        vm.prank(alice);
        vm.expectRevert(Flatophobia.WalletLimit.selector);
        game.drop(_cell(1, 3));
    }

    function test_BadCell() public {
        vm.prank(alice);
        vm.expectRevert(Flatophobia.BadCell.selector);
        game.drop(80);
    }

    function test_PlayersSoFarCountsDistinctWallets() public {
        _drop(alice, 1, 0);
        _drop(alice, 2, 0);
        _drop(bob, 1, 8);
        _drop(alice, 3, 0);
        _drop(carol, 1, 4);
        Flatophobia.Settler[] memory s = game.getSettlers(0);
        assertEq(s[0].playersSoFar, 1);
        assertEq(s[1].playersSoFar, 1);
        assertEq(s[2].playersSoFar, 2);
        assertEq(s[3].playersSoFar, 2);
        assertEq(s[4].playersSoFar, 3);
    }

    function test_DropAfterCloseSealsAndOpensNextRound() public {
        _drop(alice, 1, 0);
        _drop(bob, 1, 8);
        vm.warp(T0 + LEN);
        (uint256 id, uint256 idx) = _drop(carol, 2, 3);
        assertEq(id, 1);
        assertEq(idx, 0);
        assertEq(game.currentRound(), 1);
        assertEq(game.getRound(0).sealBlock, block.number);
        assertEq(game.getRound(1).start, T0 + LEN);
        // round 0 can now settle in a later block without another seal
        vm.roll(block.number + 2);
        vm.setBlockhash(block.number - 1, keccak256("x"));
        assertTrue(game.settle(0));
    }

    // ------------------------------------------------------------------ settle

    function test_SettleRules() public {
        vm.expectRevert(Flatophobia.RoundNotClosed.selector);
        game.settle(0); // never started

        _drop(alice, 1, 0);
        vm.expectRevert(Flatophobia.RoundNotClosed.selector);
        game.settle(0);

        vm.warp(T0 + LEN);
        assertFalse(game.settle(0)); // sealed at block 1000
        assertEq(game.getRound(0).sealBlock, 1_000);
        vm.expectRevert(Flatophobia.WaitForNextBlock.selector);
        game.settle(0);
        vm.roll(1_001);
        vm.expectRevert(Flatophobia.WaitForNextBlock.selector);
        game.settle(0);
        vm.roll(1_002);
        vm.setBlockhash(1_001, keccak256("y"));
        assertTrue(game.settle(0));
        vm.expectRevert(Flatophobia.AlreadySettled.selector);
        game.settle(0);
    }

    function test_ResealsWhenSealExpired() public {
        _drop(alice, 1, 0);
        vm.warp(T0 + LEN);
        game.settle(0);
        uint256 firstSeal = game.getRound(0).sealBlock;
        vm.roll(firstSeal + 400); // hash of firstSeal + 1 is out of the 256-block window
        assertFalse(game.settle(0));
        assertEq(game.getRound(0).sealBlock, firstSeal + 400);
    }

    function test_TipPaysSurvivorAndBurns() public {
        _drop(alice, 5, 0); // far east: heavy
        _drop(bob, 1, 8); // near west
        uint256 supply = wif.totalSupply();
        _settle(0);

        Flatophobia.Round memory r = game.getRound(0);
        assertEq(uint256(r.outcome), uint256(Flatophobia.Outcome.Tipped));
        assertEq(r.counted, 2);
        assertGt(r.tiltX, 0); // tilts toward alice

        // alice fell: 1000 lost -> 50 burned, 50 jackpot, 900 prize to bob
        assertEq(wif.totalSupply(), supply - 50e18);
        assertEq(game.jackpot(), 50e18);
        assertEq(game.payoutOf(0, 0), 0);
        assertEq(game.payoutOf(0, 1), 1_900e18);

        uint256 bobBefore = wif.balanceOf(bob);
        game.claim(0, 1); // anyone can claim for bob
        assertEq(wif.balanceOf(bob), bobBefore + 1_900e18);
        assertEq(game.claim(0, 0), 0);
        assertEq(wif.balanceOf(address(game)), game.jackpot());

        vm.expectRevert(Flatophobia.AlreadyClaimed.selector);
        game.claim(0, 1);
    }

    function test_FarSurvivorsEarnMore() public {
        _drop(alice, 5, 0); // falls
        _drop(alice, 5, 1); // falls
        _drop(bob, 1, 9); // survives, weight 1
        _drop(carol, 4, 8); // survives, weight 4
        _settle(0);
        // lost 2000 -> prize 1800 split 1:4
        assertEq(game.payoutOf(0, 2), STAKE + 360e18);
        assertEq(game.payoutOf(0, 3), STAKE + 1_440e18);
    }

    function test_InnerRingHoldsOnInAGentleTilt() public {
        _drop(alice, 3, 0); // 3 units east
        _drop(bob, 1, 8); // 1 unit west
        _drop(dave, 1, 0); // 1 unit east, right on the low side but near the pole
        _settle(0);
        // tilt = 3 units east. alice: 3 * 3 = 9 > grip 3 -> falls. dave: 1 * 3 = 3, not above grip -> holds on.
        assertEq(game.payoutOf(0, 0), 0);
        assertEq(game.payoutOf(0, 1), STAKE + 450e18);
        assertEq(game.payoutOf(0, 2), STAKE + 450e18);
    }

    function test_FallsView() public view {
        int256 u = 1e6;
        // one unit of tilt straight east: only the ice wall... not even that (5 * 1 = 5 > 3 does fall)
        assertTrue(game.falls(_cell(5, 0), u, 0));
        assertTrue(game.falls(_cell(4, 0), u, 0)); // 4 * 0.98 > 3
        assertFalse(game.falls(_cell(3, 0), u, 0)); // 3 * 0.98 < 3
        assertFalse(game.falls(_cell(5, 8), u, 0)); // high side never falls
        assertFalse(game.falls(_cell(1, 0), 2 * u, 0));
        assertTrue(game.falls(_cell(1, 0), 4 * u, 0));
    }

    function test_FlatDayPaysHalfTheJackpot() public {
        game.feedJackpot(10_000e18);
        _drop(alice, 2, 0);
        _drop(bob, 2, 8); // cancels alice exactly
        _drop(carol, 3, 4);
        _drop(carol, 3, 12); // cancels itself
        _settle(0);

        Flatophobia.Round memory r = game.getRound(0);
        assertEq(uint256(r.outcome), uint256(Flatophobia.Outcome.Flat));
        assertEq(r.tiltX, 0);
        assertEq(r.tiltY, 0);
        assertEq(game.jackpot(), 5_000e18);
        // bonus 5000 split by weights 2,2,3,3
        assertEq(game.payoutOf(0, 0), STAKE + 1_000e18);
        assertEq(game.payoutOf(0, 1), STAKE + 1_000e18);
        assertEq(game.payoutOf(0, 2), STAKE + 1_500e18);
        assertEq(game.payoutOf(0, 3), STAKE + 1_500e18);
    }

    function test_LevelButTooFewPlayersIsNotFlatDay() public {
        game.feedJackpot(10_000e18);
        _drop(alice, 2, 0);
        _drop(bob, 2, 8);
        _settle(0);
        Flatophobia.Round memory r = game.getRound(0);
        assertEq(uint256(r.outcome), uint256(Flatophobia.Outcome.Tipped));
        // tilt is exactly zero, so nobody is on the low side: both keep their stake
        assertEq(game.payoutOf(0, 0), STAKE);
        assertEq(game.payoutOf(0, 1), STAKE);
        assertEq(game.jackpot(), 10_000e18);
    }

    function test_VoidWhenOnlyOnePlayer() public {
        _drop(alice, 5, 0);
        _drop(alice, 5, 3);
        _settle(0);
        assertEq(uint256(game.getRound(0).outcome), uint256(Flatophobia.Outcome.Void));
        assertEq(game.payoutOf(0, 0), STAKE);
        assertEq(game.payoutOf(0, 1), STAKE);
    }

    function test_DropAfterTheCandleFalls() public {
        _drop(alice, 1, 0);
        vm.warp(T0 + 10);
        _drop(bob, 1, 8);
        uint256 lateTime = T0 + LEN - 1;
        vm.warp(lateTime);
        _drop(carol, 1, 4);

        bytes32 h = _hashFor(0, T0, lateTime, true); // hidden end before carol landed
        _settleWith(0, h);

        Flatophobia.Round memory r = game.getRound(0);
        assertEq(r.counted, 2);
        assertLt(r.end, lateTime);
        assertEq(game.payoutOf(0, 2), 0); // carol fell
        // alice and bob cancel out: both survive and split carol's 900
        assertEq(game.payoutOf(0, 0), STAKE + 450e18);
        assertEq(game.payoutOf(0, 1), STAKE + 450e18);
    }

    function test_DropBeforeTheCandleCounts() public {
        _drop(alice, 1, 0);
        _drop(bob, 1, 8);
        uint256 lateTime = T0 + LEN - 1;
        vm.warp(lateTime);
        _drop(carol, 1, 4);

        bytes32 h = _hashFor(0, T0, lateTime, false); // hidden end at or after carol's drop
        _settleWith(0, h);
        Flatophobia.Round memory r = game.getRound(0);
        assertEq(r.counted, 3);
        assertGe(r.end, lateTime);
        assertLe(r.end, T0 + LEN);
        assertGe(r.end, T0 + LEN - CANDLE);
    }

    function test_WholeWorldFallsIntoJackpot() public {
        _drop(alice, 5, 0);
        _drop(bob, 5, 1); // both on the same side
        _settle(0);
        assertEq(game.payoutOf(0, 0), 0);
        assertEq(game.payoutOf(0, 1), 0);
        // 2000 lost: 100 burned, 1900 to the jackpot
        assertEq(game.jackpot(), 1_900e18);
        assertEq(wif.balanceOf(address(game)), 1_900e18);
    }

    function test_ClaimSettlesWhenSealed() public {
        _drop(alice, 5, 0);
        _drop(bob, 1, 8);
        vm.warp(T0 + LEN);
        game.settle(0); // seal
        vm.roll(block.number + 2);
        vm.setBlockhash(block.number - 1, keccak256("z"));
        uint256 got = game.claim(0, 1); // settles and claims in one go
        assertEq(got, 1_900e18);
    }

    function test_ClaimMany() public {
        _drop(alice, 5, 0);
        _drop(bob, 1, 8);
        _drop(bob, 1, 9);
        _settle(0);
        uint256[] memory ids = new uint256[](3);
        uint256[] memory idx = new uint256[](3);
        idx[0] = 1;
        idx[1] = 2;
        idx[2] = 1; // duplicate is skipped
        uint256 before = wif.balanceOf(bob);
        uint256 total = game.claimMany(ids, idx);
        assertEq(wif.balanceOf(bob) - before, total);
        assertEq(total, 2 * STAKE + 900e18); // 900 split 1:1 -> 450 each, no dust here
    }

    function test_HistoryPages() public {
        _drop(alice, 1, 0);
        _drop(bob, 1, 8);
        vm.warp(T0 + LEN);
        _drop(alice, 2, 2);
        uint256[] memory h = game.historyOf(alice, 0, 10);
        assertEq(h.length, 2);
        assertEq(h[0], (0 << 16) | 0);
        assertEq(h[1], (1 << 16) | 0);
        assertEq(game.historyOf(alice, 5, 10).length, 0);
    }

    function test_RejectsBadConfig() public {
        vm.expectRevert(Flatophobia.BadConfig.selector);
        new Flatophobia(address(wif), STAKE, 100, 100);
        vm.expectRevert(Flatophobia.BadConfig.selector);
        new Flatophobia(address(0), STAKE, 100, 10);
        vm.expectRevert(Flatophobia.BadConfig.selector);
        new Flatophobia(address(wif), 0, 100, 10);
    }

    // ------------------------------------------------------------------ fuzz: the books always balance

    function testFuzz_BooksBalance(uint256 seed) public {
        address[4] memory ps = [alice, bob, carol, dave];
        uint256 n = 2 + (seed % 11);
        uint256 t = T0;
        uint256 dropped;
        for (uint256 i; i < n; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            address who = ps[r % 4];
            if (game.dropsBy(0, who) >= 3) continue;
            t += (r >> 8) % 70;
            if (t >= T0 + LEN) break;
            vm.warp(t);
            vm.prank(who);
            game.drop(uint8((r >> 16) % 80));
            dropped++;
        }
        uint256 supplyBefore = wif.totalSupply();
        _settleWith(0, keccak256(abi.encode(seed, "h")));

        uint256 paid;
        for (uint256 i; i < dropped; ++i) {
            paid += game.claim(0, i);
        }
        uint256 burned = supplyBefore - wif.totalSupply();
        uint256 staked = dropped * STAKE;
        uint256 left = wif.balanceOf(address(game));
        // everything staked is either paid out, burned, or left in the contract
        assertEq(paid + burned + left, staked);
        // what is left is the jackpot plus rounding dust (< 1 wei per settler)
        assertGe(left, game.jackpot());
        assertLe(left - game.jackpot(), dropped);
    }
}
