// Monte-Carlo check of game balance with the practice bots: how often rounds tip, go flat, or void,
// and how the ring you stand on changes your odds. Usage: node tools/simulate.mjs [rounds] [flatToleranceUnits]
import { Practice } from "../web/js/practice.js";
import * as rules from "../web/js/rules.js";

const N = Number(process.argv[2] || 4000);
const tol = Number(process.argv[3] || 1);
const realTol = rules.FLAT_TOLERANCE;

let tipped = 0, flat = 0, voided = 0, fallenTotal = 0, settlersTotal = 0;
const byRing = Array.from({ length: 6 }, () => ({ n: 0, survive: 0, roi: 0 }));
const p = new Practice();
for (let i = 0; i < N; i++) {
  p.jackpot = 6000;
  p.newRound(0);
  // run the bots to the end without resolving with the stock tolerance
  const r = p.round;
  for (const step of r.plan) p._push(step.owner, (await import("../web/js/practice.js")).Practice && botDrop(step, r.settlers), step.at);
  const res = rules.settle(r.settlers, r.hiddenEnd, 1000, 6000);
  // re-evaluate flatness with the candidate tolerance
  const mag = Math.hypot(...res.tilt) / rules.UNIT;
  const isFlat = res.outcome !== rules.Outcome.Void && mag <= tol && res.players >= rules.MIN_FLAT_PLAYERS;
  if (res.outcome === rules.Outcome.Void) voided++;
  else if (isFlat) flat++;
  else tipped++;
  settlersTotal += r.settlers.length;
  if (!isFlat && res.outcome !== rules.Outcome.Void) {
    r.settlers.forEach((s, j) => {
      const ring = rules.ringOf(s.cell);
      const fell = j >= res.counted || rules.fallsOn(s.cell, res.tilt);
      byRing[ring].n++;
      if (!fell) byRing[ring].survive++;
      fallenTotal += fell ? 1 : 0;
      byRing[ring].roi += (res.payouts[j] - 1000) / 1000;
    });
  }
}

function botDrop(step, settlers) {
  // same styles as practice.js
  const t = rules.tiltOf(settlers);
  const S = rules.SECTORS;
  const high = (spread) => {
    if (!t[0] && !t[1]) return Math.floor(Math.random() * S);
    let a = Math.atan2(t[1], t[0]); if (a < 0) a += Math.PI * 2;
    const low = Math.floor((a / (Math.PI * 2)) * S);
    return (((low + S / 2 + Math.round((Math.random() * 2 - 1) * spread)) % S) + S) % S;
  };
  const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  switch (step.style) {
    case "timid": return rules.cellOf(ri(1, 2), high(3));
    case "greedy": return rules.cellOf(ri(4, 5), Math.random() < 0.7 ? high(1.5) : ri(0, S - 1));
    case "mid": return rules.cellOf(3, high(3));
    case "sniper": return rules.cellOf(ri(3, 5), high(1));
    default: return rules.cellOf(ri(1, 5), ri(0, S - 1));
  }
}

const pct = (x) => `${((x / N) * 100).toFixed(1)}%`;
console.log(`rounds=${N} flatTolerance=${tol} unit(s) (contract: ${realTol / rules.UNIT})`);
console.log(`tipped ${pct(tipped)} · flat ${pct(flat)} · void ${pct(voided)} · avg settlers ${(settlersTotal / N).toFixed(1)} · fall rate in tipped rounds ${(fallenTotal / byRing.reduce((a, b) => a + b.n, 0) * 100).toFixed(1)}%`);
for (let k = 1; k <= 5; k++) {
  const b = byRing[k];
  console.log(`ring ${k}: survive ${(b.survive / b.n * 100).toFixed(1)}% · avg return ${(b.roi / b.n * 100).toFixed(1)}% (n=${b.n})`);
}
