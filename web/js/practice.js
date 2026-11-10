// Practice: a full round against bots, played locally with pretend $wif. Same rules as the contract.
import { tiltOf, cellOf, SECTORS, settle, MAX_PER_WALLET, MAX_SETTLERS } from "./rules.js";

const BOTS = [
  ["ice_wall_ian", "greedy"], ["flat_steve", "timid"], ["edge_lord", "greedy"], ["polar_pam", "timid"],
  ["gravity_denier", "chaos"], ["rim_jim", "sniper"], ["map_maker", "mid"], ["balance_bea", "mid"],
  ["tilt_tom", "chaos"], ["no_curve_nico", "sniper"], ["horizon_hana", "mid"], ["disc_dave", "greedy"],
];

export const ME = "0x00000000000000000000000000000000000000me";

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function highSideSector(settlers, spread) {
  const t = tiltOf(settlers);
  if (!t[0] && !t[1]) return Math.floor(Math.random() * SECTORS);
  let a = Math.atan2(t[1], t[0]);
  if (a < 0) a += Math.PI * 2;
  const low = Math.floor((a / (Math.PI * 2)) * SECTORS);
  const off = Math.round(rnd(-spread, spread));
  return (((low + SECTORS / 2 + off) % SECTORS) + SECTORS) % SECTORS;
}

function botCell(style, settlers) {
  switch (style) {
    case "timid": return cellOf(1 + Math.floor(Math.random() * 2), highSideSector(settlers, 3));
    case "greedy": return cellOf(4 + Math.floor(Math.random() * 2), Math.random() < 0.7 ? highSideSector(settlers, 1.5) : Math.floor(Math.random() * SECTORS));
    case "mid": return cellOf(3, highSideSector(settlers, 3));
    case "sniper": return cellOf(3 + Math.floor(Math.random() * 3), highSideSector(settlers, 1));
    default: return cellOf(1 + Math.floor(Math.random() * 5), Math.floor(Math.random() * SECTORS));
  }
}

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function save(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode: fine */ }
}

export class Practice {
  constructor({ roundLength = 60, candle = 20, stake = 1000 } = {}) {
    this.L = roundLength;
    this.W = candle;
    this.stake = stake;
    this.balance = load("flat-practice-balance", 10_000);
    this.jackpot = load("flat-practice-jackpot", 6_000);
    this.roundId = load("flat-practice-round", 0);
    this.history = [];
    this.round = null;
  }

  newRound(now) {
    this.roundId += 1;
    save("flat-practice-round", this.roundId);
    const count = 4 + Math.floor(Math.random() * 4);
    const plan = [];
    const roster = [...BOTS].sort(() => Math.random() - 0.5).slice(0, count);
    roster.forEach(([name, style], b) => {
      const owner = `0x${(b + 1).toString(16).padStart(4, "0")}${name.replace(/[^a-z]/g, "").padEnd(36, "f").slice(0, 36)}`;
      const drops = 1 + Math.floor(Math.random() * MAX_PER_WALLET);
      for (let d = 0; d < drops; d++) {
        const at = style === "sniper" && d === 0 ? rnd(this.L - this.W, this.L - 0.5) : rnd(1.5, this.L - this.W - 1);
        plan.push({ at, owner, name, style });
      }
    });
    plan.sort((a, b) => a.at - b.at);
    this.round = { id: this.roundId, start: now, end: null, settlers: [], plan, names: new Map(roster.map(([n], b) => [plan.find((p) => p.name === n)?.owner, n])), result: null, players: new Set() };
    this.round.hiddenEnd = this.L - this.W + Math.random() * this.W;
    return this.round;
  }

  _push(owner, cell, t) {
    const r = this.round;
    if (r.settlers.length >= MAX_SETTLERS) return null;
    r.players.add(owner);
    const s = { key: `p${r.id}:${r.settlers.length}`, index: r.settlers.length, owner, cell, time: t, playersSoFar: r.players.size };
    r.settlers.push(s);
    return s;
  }

  mine() {
    return this.round ? this.round.settlers.filter((s) => s.owner === ME) : [];
  }

  /** The player drops a settler. t = seconds since the round started. */
  drop(cell, t) {
    const r = this.round;
    if (!r || r.result) return "the round is over";
    if (t >= this.L) return "the round has closed";
    if (this.mine().length >= MAX_PER_WALLET) return "you already have 3 settlers in this round";
    if (this.balance < this.stake) return "out of practice $wif: reset it below";
    this.balance -= this.stake;
    save("flat-practice-balance", this.balance);
    this._push(ME, cell, t);
    return "";
  }

  /** Advances bots; returns true when the round just ended. */
  tick(t) {
    const r = this.round;
    if (!r || r.result) return false;
    while (r.plan.length && r.plan[0].at <= Math.min(t, this.L - 0.01)) {
      const p = r.plan.shift();
      this._push(p.owner, botCell(p.style, r.settlers), p.at);
    }
    if (t < this.L) return false;
    const res = settle(r.settlers, r.hiddenEnd, this.stake, this.jackpot);
    r.result = res;
    r.end = r.hiddenEnd;
    this.jackpot = res.jackpotAfter;
    save("flat-practice-jackpot", this.jackpot);
    res.payouts.forEach((amount, i) => {
      if (r.settlers[i].owner === ME) this.balance += amount;
    });
    save("flat-practice-balance", this.balance);
    this.history.unshift({ id: r.id, outcome: res.outcome, fallen: res.fallen, tilt: res.tilt });
    this.history = this.history.slice(0, 6);
    return true;
  }

  nameOf(owner) {
    if (owner === ME) return "you";
    return this.round?.names.get(owner) || "a bot";
  }

  resetWallet() {
    this.balance = 10_000;
    save("flat-practice-balance", this.balance);
  }
}

export { pick };
