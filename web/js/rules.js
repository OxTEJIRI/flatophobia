// Game rules, mirrored 1:1 from contracts/src/Flatophobia.sol (same integer math),
// so the screen can preview exactly what the contract will decide.

export const SECTORS = 16;
export const RINGS = 5;
export const CELLS = SECTORS * RINGS;
export const MAX_PER_WALLET = 3;
export const MAX_SETTLERS = 120;
export const MIN_PLAYERS = 2;
export const MIN_FLAT_PLAYERS = 3;
export const BURN_BPS = 500;
export const JACKPOT_BPS = 500;
export const UNIT = 1_000_000;
export const FLAT_TOLERANCE = UNIT / 2;
export const GRIP_UNITS = 3; // a settler falls when ring * (dir . tilt) > 3 ring units
const GRIP = GRIP_UNITS * UNIT * UNIT;

export const Outcome = { Open: 0, Tipped: 1, Flat: 2, Void: 3 };

// cos((j + 0.5) * 22.5deg) * 1e6, identical to COS_PACKED in the contract
const COS = [980785, 831470, 555570, 195090];

export function dir(sector) {
  const j = sector % 4;
  const c = COS[j];
  const sn = COS[3 - j];
  switch ((sector / 4) | 0) {
    case 0: return [c, sn];
    case 1: return [-sn, c];
    case 2: return [-c, -sn];
    default: return [sn, -c];
  }
}

export const ringOf = (cell) => ((cell / SECTORS) | 0) + 1; // 1..5, also the payout weight
export const sectorOf = (cell) => cell % SECTORS;
export const cellOf = (ring, sector) => (ring - 1) * SECTORS + sector;

export const RING_NAMES = ["", "the north", "the tropics", "the equator", "the south seas", "the ice wall"];

// Visual layout on the unit disc: ring k is centred at k * 0.18, bands are 0.18 wide.
export const RING_STEP = 0.18;
export const ringInner = (ring) => ring * RING_STEP - RING_STEP / 2;
export const ringOuter = (ring) => ring * RING_STEP + RING_STEP / 2;
export const ringCenter = (ring) => ring * RING_STEP;
export const sectorAngle = (sector) => ((sector + 0.5) * Math.PI * 2) / SECTORS; // radians, ccw from east

/** Cell under a point on the unit disc (x right, y up). Returns -1 outside the board. */
export function cellAt(x, y) {
  const r = Math.hypot(x, y);
  const ring = Math.round(r / RING_STEP);
  if (ring < 1 || ring > RINGS || r < ringInner(ring) || r > ringOuter(ring)) return -1;
  let a = Math.atan2(y, x);
  if (a < 0) a += Math.PI * 2;
  const sector = Math.min(SECTORS - 1, Math.floor((a / (Math.PI * 2)) * SECTORS));
  return cellOf(ring, sector);
}

/** Unit-disc position of a cell centre. */
export function cellCenter(cell) {
  const a = sectorAngle(sectorOf(cell));
  const r = ringCenter(ringOf(cell));
  return [Math.cos(a) * r, Math.sin(a) * r];
}

/** Sum of ring-weighted directions. settlers: [{cell}] */
export function tiltOf(settlers) {
  let x = 0, y = 0;
  for (const s of settlers) {
    const [dx, dy] = dir(sectorOf(s.cell));
    const w = ringOf(s.cell);
    x += dx * w;
    y += dy * w;
  }
  return [x, y];
}

export const tiltMagnitude = ([x, y]) => Math.hypot(x, y) / UNIT; // in ring-1 settler units

/** Visual tilt in degrees for a torque, gently saturating. */
export const tiltDegrees = (t) => 22 * Math.tanh(tiltMagnitude(t) / 9);

/** The slide rule: the low side's edge goes first; the steeper the tip, the further in it reaches. */
export function fallsOn(cell, [tx, ty]) {
  const [dx, dy] = dir(sectorOf(cell));
  return ringOf(cell) * (dx * tx + dy * ty) > GRIP;
}

/** Distance (in ring units, along the tilt) beyond which settlers slide off. Infinity when flat. */
export const slideLine = (t) => {
  const m = tiltMagnitude(t);
  return m > 0 ? GRIP_UNITS / m : Infinity;
};

/**
 * Full settlement, same as the contract. stake/jackpot are BigInt (wei) or Number.
 * settlers: [{owner, cell, time, playersSoFar}] in drop order. end: hidden end timestamp.
 */
export function settle(settlers, end, stake, jackpot) {
  const big = typeof stake === "bigint";
  const N = (v) => (big ? BigInt(v) : v);
  const div = (a, b) => (big ? a / b : Math.floor(a / b));
  let k = 0;
  while (k < settlers.length && settlers[k].time <= end) k++;
  const counted = settlers.slice(0, k);
  const tilt = tiltOf(counted);
  const players = k === 0 ? 0 : settlers[k - 1].playersSoFar;
  const res = { counted: k, players, tilt, outcome: Outcome.Void, prizePool: N(0), winWeight: 0, burned: N(0), jackpotAfter: jackpot, fallen: 0 };
  if (players < MIN_PLAYERS) return finish(res, settlers, stake);

  const [tx, ty] = tilt;
  const flat = tx * tx + ty * ty <= FLAT_TOLERANCE * FLAT_TOLERANCE && players >= MIN_FLAT_PLAYERS;
  let fallen = settlers.length - k;
  let winWeight = 0;
  for (const s of counted) {
    if (!flat && fallsOn(s.cell, tilt)) fallen++;
    else winWeight += ringOf(s.cell);
  }
  const lost = N(fallen) * stake;
  const burned = div(lost * N(BURN_BPS), N(10000));
  const toJackpot = div(lost * N(JACKPOT_BPS), N(10000));
  let prize = lost - burned - toJackpot;
  let pot = jackpot + toJackpot;
  if (winWeight === 0) { pot += prize; prize = N(0); }
  else if (flat) { const bonus = div(pot, N(2)); pot -= bonus; prize += bonus; }
  Object.assign(res, { outcome: flat ? Outcome.Flat : Outcome.Tipped, prizePool: prize, winWeight, burned, jackpotAfter: pot, fallen });
  return finish(res, settlers, stake);
}

function finish(res, settlers, stake) {
  res.payouts = settlers.map((s, i) => payout(res, s, i, stake));
  return res;
}

/** What one settler receives from a settled round (mirrors _payout). */
export function payout(round, s, index, stake) {
  const big = typeof stake === "bigint";
  if (round.outcome === Outcome.Void) return stake;
  if (index >= round.counted) return big ? 0n : 0;
  if (round.outcome === Outcome.Tipped && fallsOn(s.cell, round.tilt)) return big ? 0n : 0;
  const w = ringOf(s.cell);
  if (big) return stake + (BigInt(round.prizePool) * BigInt(w)) / BigInt(round.winWeight);
  return stake + Math.floor((round.prizePool * w) / round.winWeight);
}

/** Who would fall if the round ended right now with everyone counted. */
export function preview(settlers) {
  const tilt = tiltOf(settlers);
  const falling = settlers.map((s) => fallsOn(s.cell, tilt));
  return { tilt, falling, fallCount: falling.filter(Boolean).length };
}

/** Longitude (deg east) that a board direction points along. The map has Greenwich at the bottom. */
export const lonOf = ([x, y]) => (Math.atan2(x, -y) * 180) / Math.PI;

/** Where the world is leaning, in map words. */
export function leanLabel(t) {
  if (t[0] === 0 && t[1] === 0) return "nowhere";
  const lon = lonOf(t);
  if (lon < -140 || lon >= 150) return "the pacific";
  if (lon < -30) return "the americas";
  if (lon < 60) return "europe & africa";
  if (lon < 100) return "india";
  return "asia";
}
