// Tunes the slide rule: a settler falls when ring * (dir . T) > GRIP (ring units), instead of "anyone on the low half".
// Usage: node tools/balance.mjs [rounds]
import * as rules from "../web/js/rules.js";

const N = Number(process.argv[2] || 3000);
const S = rules.SECTORS;
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const STYLES = ["greedy", "timid", "greedy", "timid", "chaos", "sniper", "mid", "mid", "chaos", "sniper", "mid", "greedy"];

function highSector(t, spread) {
  if (!t[0] && !t[1]) return ri(0, S - 1);
  let a = Math.atan2(t[1], t[0]); if (a < 0) a += Math.PI * 2;
  const low = Math.floor((a / (Math.PI * 2)) * S);
  return (((low + S / 2 + Math.round((Math.random() * 2 - 1) * spread)) % S) + S) % S;
}
function botCell(style, settlers) {
  const t = rules.tiltOf(settlers);
  switch (style) {
    case "timid": return rules.cellOf(ri(1, 2), Math.random() < 0.6 ? highSector(t, 3) : ri(0, S - 1));
    case "greedy": return rules.cellOf(ri(4, 5), Math.random() < 0.7 ? highSector(t, 1.5) : ri(0, S - 1));
    case "mid": return rules.cellOf(3, highSector(t, 3));
    case "sniper": return rules.cellOf(ri(3, 5), highSector(t, 1));
    default: return rules.cellOf(ri(1, 5), ri(0, S - 1));
  }
}

function run(grip, flatTol, weightFn, players) {
  let flat = 0, fell = 0, total = 0, noFall = 0;
  const ring = Array.from({ length: 6 }, () => ({ n: 0, s: 0, roi: 0 }));
  for (let i = 0; i < N; i++) {
    const np = players || ri(3, 9);
    const settlers = [];
    for (let p = 0; p < np; p++) {
      const style = STYLES[(p + i) % STYLES.length];
      const drops = ri(1, 3);
      for (let d = 0; d < drops; d++) settlers.push({ cell: botCell(style, settlers) });
    }
    const T = rules.tiltOf(settlers);
    const mag = Math.hypot(...T) / rules.UNIT;
    if (mag <= flatTol) { flat++; continue; }
    const falls = settlers.map((s) => {
      const [dx, dy] = rules.dir(rules.sectorOf(s.cell));
      const depth = (rules.ringOf(s.cell) * (dx * T[0] + dy * T[1])) / (rules.UNIT * rules.UNIT);
      return grip === 0 ? depth > 0 : depth > grip;
    });
    const lost = falls.filter(Boolean).length * 1000;
    if (!lost) noFall++;
    const prize = lost * 0.9;
    const W = settlers.reduce((a, s, j) => a + (falls[j] ? 0 : weightFn(rules.ringOf(s.cell))), 0);
    settlers.forEach((s, j) => {
      const k = rules.ringOf(s.cell);
      ring[k].n++;
      total++;
      if (falls[j]) { fell++; ring[k].roi -= 1; }
      else { ring[k].s++; ring[k].roi += W ? (prize * weightFn(k)) / W / 1000 : 0; }
    });
  }
  const line = [1, 2, 3, 4, 5].map((k) => `r${k} ${(ring[k].s / ring[k].n * 100).toFixed(0)}%/${(ring[k].roi / ring[k].n * 100).toFixed(0).padStart(3)}%`).join("  ");
  return `grip ${String(grip).padEnd(3)} flat ${(flat / N * 100).toFixed(1).padStart(4)}%  no-fall ${(noFall / N * 100).toFixed(0).padStart(2)}%  fall ${(fell / total * 100).toFixed(0)}%  |  survive/return  ${line}`;
}

const lin = (k) => k;
for (const grip of [0, 2, 3, 4, 5, 6, 8]) console.log(run(grip, 0.5, lin));
console.log("--- weight = ring^2");
for (const grip of [3, 4, 5]) console.log(run(grip, 0.5, (k) => k * k));
console.log("--- small rounds (3 players) vs big (9)");
for (const np of [3, 9]) console.log(np, run(4, 0.5, lin, np));
