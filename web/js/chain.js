// Talking to Robinhood Chain: reads over the public RPC, writes through the player's wallet.
import { ethers } from "../vendor/ethers.min.js";
import { CONFIG } from "./config.js";

const ROUND = "tuple(uint64 start,uint64 sealBlock,uint64 end,uint16 counted,uint16 players,uint8 outcome,int64 tiltX,int64 tiltY,uint128 prizePool,uint128 winWeight)";
const SETTLER = "tuple(address owner,uint8 cell,uint64 time,uint16 playersSoFar,bool claimed)";

const GAME_ABI = [
  "function drop(uint8 cell) returns (uint256 id, uint256 index)",
  "function settle(uint256 id) returns (bool)",
  "function claimMany(uint256[] ids, uint256[] indexes) returns (uint256 total)",
  "function feedJackpot(uint256 amount)",
  "function stake() view returns (uint256)",
  "function roundLength() view returns (uint64)",
  "function candleWindow() view returns (uint64)",
  "function currentRound() view returns (uint256)",
  "function jackpot() view returns (uint256)",
  "function dropsBy(uint256, address) view returns (uint256)",
  `function getRound(uint256 id) view returns (${ROUND})`,
  `function getSettlers(uint256 id) view returns (${SETTLER}[])`,
  "function payoutOf(uint256 id, uint256 index) view returns (uint256)",
  "function historyLength(address who) view returns (uint256)",
  "function historyOf(address who, uint256 offset, uint256 limit) view returns (uint256[])",
  `function snapshot() view returns (uint256 id, ${ROUND} round, ${SETTLER}[] settlers, uint256 jackpot_, uint256 now_, uint256 blockNumber)`,
  "error BadCell()", "error WalletLimit()", "error RoundFull()", "error RoundNotClosed()", "error AlreadySettled()",
  "error WaitForNextBlock()", "error NotSettled()", "error AlreadyClaimed()", "error TransferFailed()", "error BadConfig()", "error Reentrancy()",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const FRIENDLY = {
  WalletLimit: "you already have 3 settlers in this round",
  RoundFull: "this round is full (120 settlers)",
  RoundNotClosed: "the round hasn't closed yet",
  AlreadySettled: "this round is already settled",
  WaitForNextBlock: "the candle is still smoking: wait a few seconds",
  NotSettled: "the round hasn't been revealed yet",
  AlreadyClaimed: "already claimed",
  BadCell: "that spot isn't on the board",
};

export function friendlyError(e) {
  const name = e?.revert?.name || e?.info?.error?.data?.message;
  if (name && FRIENDLY[name]) return FRIENDLY[name];
  if (e?.code === "ACTION_REJECTED" || e?.info?.error?.code === 4001) return "you rejected the request in your wallet";
  if (/insufficient funds/i.test(e?.message || "")) return "not enough ETH for gas on robinhood chain";
  if (/balance/i.test(e?.shortMessage || e?.message || "")) return "not enough $wif";
  return e?.shortMessage || e?.message || String(e);
}

const num = (v) => Number(v);
function normRound(r) {
  return {
    start: num(r.start), sealBlock: num(r.sealBlock), end: num(r.end), counted: num(r.counted), players: num(r.players),
    outcome: num(r.outcome), tilt: [num(r.tiltX), num(r.tiltY)], prizePool: BigInt(r.prizePool), winWeight: num(r.winWeight),
  };
}
const normSettlers = (list, id) =>
  list.map((s, i) => ({ key: `${id}:${i}`, index: i, owner: s.owner, cell: num(s.cell), time: num(s.time), playersSoFar: num(s.playersSoFar), claimed: s.claimed }));

export class Chain {
  constructor() {
    this.read = new ethers.JsonRpcProvider(CONFIG.rpc, CONFIG.chainId, { staticNetwork: true, batchMaxCount: 1 });
    this.game = new ethers.Contract(CONFIG.game, GAME_ABI, this.read);
    this.wif = new ethers.Contract(CONFIG.wif, ERC20_ABI, this.read);
    this.account = "";
    this.signer = null;
    this.eth = null;
    this.onAccount = null;
    this.providers = [];
    window.addEventListener("eip6963:announceProvider", (e) => this.providers.push(e.detail));
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  }

  async init() {
    const [stake, roundLength, candleWindow] = await Promise.all([this.game.stake(), this.game.roundLength(), this.game.candleWindow()]);
    this.stake = stake;
    this.roundLength = num(roundLength);
    this.candleWindow = num(candleWindow);
  }

  async snapshot() {
    const s = await this.game.snapshot();
    const id = num(s.id);
    return { id, round: normRound(s.round), settlers: normSettlers(s.settlers, id), jackpot: BigInt(s.jackpot_), chainNow: num(s.now_), blockNumber: num(s.blockNumber) };
  }

  async roundInfo(id) {
    const [r, list] = await Promise.all([this.game.getRound(id), this.game.getSettlers(id)]);
    return { id, round: normRound(r), settlers: normSettlers(list, id) };
  }

  // ---------------------------------------------------------------- wallet
  hasWallet() {
    return !!(window.ethereum || this.providers.length);
  }

  async connect() {
    this.eth = window.ethereum || this.providers[0]?.provider;
    if (!this.eth) throw new Error("no wallet found");
    const accounts = await this.eth.request({ method: "eth_requestAccounts" });
    await this.ensureChain();
    this._setAccount(accounts[0]);
    this.eth.on?.("accountsChanged", (a) => this._setAccount(a[0] || ""));
    this.eth.on?.("chainChanged", () => this._setAccount(this.account));
    return this.account;
  }

  async _setAccount(a) {
    this.account = a ? ethers.getAddress(a) : "";
    this.signer = a ? await new ethers.BrowserProvider(this.eth).getSigner() : null;
    this.onAccount?.(this.account);
  }

  async ensureChain() {
    const current = await this.eth.request({ method: "eth_chainId" });
    if (parseInt(current, 16) === CONFIG.chainId) return;
    try {
      await this.eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CONFIG.chainHex }] });
    } catch (e) {
      if (e.code !== 4902 && e?.data?.originalError?.code !== 4902) throw e;
      await this.eth.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CONFIG.chainHex, chainName: "Robinhood Chain", rpcUrls: [CONFIG.rpc],
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          blockExplorerUrls: CONFIG.explorer ? [CONFIG.explorer] : [],
        }],
      });
    }
  }

  async balances() {
    if (!this.account) return null;
    const [wif, allowance, eth] = await Promise.all([
      this.wif.balanceOf(this.account), this.wif.allowance(this.account, CONFIG.game), this.read.getBalance(this.account),
    ]);
    return { wif, allowance, eth };
  }

  // ---------------------------------------------------------------- writes
  async drop(cell, status) {
    await this.ensureChain();
    const wif = this.wif.connect(this.signer);
    const allowance = await this.wif.allowance(this.account, CONFIG.game);
    if (allowance < this.stake) {
      status("approve $wif for 10 drops in your wallet…");
      const tx = await wif.approve(CONFIG.game, this.stake * 10n);
      status("approving…");
      await tx.wait();
    }
    status("confirm the drop in your wallet…");
    const tx = await this.game.connect(this.signer).drop(cell);
    status("your settler is falling…");
    const rc = await tx.wait();
    return rc;
  }

  /** Runs the two-step reveal: seal, wait for the next blocks, settle. */
  async settle(id, status) {
    await this.ensureChain();
    const g = this.game.connect(this.signer);
    let r = normRound(await this.game.getRound(id));
    if (r.outcome !== 0) return true;
    if (!r.sealBlock) {
      status("lighting the candle (1/2)…");
      await (await g.settle(id)).wait();
      r = normRound(await this.game.getRound(id));
      if (r.outcome !== 0) return true;
    }
    status("waiting for the chain to roll the dice…");
    for (let i = 0; i < 90; i++) {
      const snap = await this.game.snapshot();
      if (num(snap.blockNumber) > r.sealBlock + 1) break;
      await new Promise((res) => setTimeout(res, 2000));
    }
    status("revealing the round (2/2)…");
    await (await g.settle(id)).wait();
    return true;
  }

  /** Everything the connected wallet can claim, scanning its latest drops. */
  async claimable() {
    if (!this.account) return { items: [], total: 0n, waiting: [] };
    const len = num(await this.game.historyLength(this.account));
    const from = Math.max(0, len - 60);
    const packed = len ? await this.game.historyOf(this.account, from, 60) : [];
    const entries = packed.map((p) => ({ id: num(BigInt(p) >> 16n), index: num(BigInt(p) & 0xffffn) }));
    const ids = [...new Set(entries.map((e) => e.id))];
    const rounds = new Map(await Promise.all(ids.map(async (id) => [id, normRound(await this.game.getRound(id))])));
    const items = [];
    const waiting = new Set();
    let total = 0n;
    await Promise.all(entries.map(async (e) => {
      const r = rounds.get(e.id);
      if (r.outcome === 0) { waiting.add(e.id); return; }
      const amount = await this.game.payoutOf(e.id, e.index);
      if (amount > 0n) { items.push({ ...e, amount }); total += amount; }
    }));
    return { items, total, waiting: [...waiting] };
  }

  async claimAll(items, status) {
    await this.ensureChain();
    status("confirm the claim in your wallet…");
    const tx = await this.game.connect(this.signer).claimMany(items.map((i) => i.id), items.map((i) => i.index));
    status("collecting your $wif…");
    return tx.wait();
  }
}

export const fmtWif = (wei, digits = 0) => {
  const n = Number(ethers.formatUnits(wei, 18));
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
};
export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
