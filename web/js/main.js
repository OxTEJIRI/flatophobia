import "./devwallet.js"; // inert unless ?local&devwallet on localhost
import { World } from "./scene.js";
import { CONFIG, LIVE } from "./config.js";
import { Chain, fmtWif, short, friendlyError } from "./chain.js";
import { Practice, ME } from "./practice.js";
import {
  ringOf, RING_NAMES, tiltOf, tiltDegrees, tiltMagnitude, leanLabel, preview, fallsOn, Outcome,
  MAX_PER_WALLET, MIN_FLAT_PLAYERS, payout,
} from "./rules.js";
import { placeNear } from "./places.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const nowSec = () => performance.now() / 1000;
const mmss = (s) => { s = Math.max(0, Math.ceil(s)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

let world;
const chain = LIVE ? new Chain() : null;
const S = {
  mode: LIVE ? "live" : "practice",
  selected: -1,
  busy: false,
  // live
  snap: null, clockOffset: 0, tipped: new Set(), recent: [], claim: null, bal: null, pendingReveal: null, pollTimer: 0, ready: false,
  // practice
  practice: null, pStart: 0, pEndedAt: 0, pShown: false,
};

// ------------------------------------------------------------------ helpers over both modes
function view() {
  if (S.mode === "practice") {
    const p = S.practice, r = p?.round;
    const t = r ? nowSec() - S.pStart : 0;
    return {
      id: r?.id ?? 0, start: r ? 1 : 0, t, L: p.L, W: p.W,
      outcome: r?.result ? r.result.outcome : 0,
      settlers: r ? r.settlers : [], me: ME, stake: p.stake, jackpot: p.jackpot,
      amount: (v) => `${Math.round(v).toLocaleString("en-US")}`, unit: "practice $wif",
    };
  }
  const s = S.snap;
  if (!s || !chain.stake) return null;
  const now = Date.now() / 1000 + S.clockOffset;
  return {
    id: s.id, start: s.round.start, t: s.round.start ? now - s.round.start : 0, L: chain.roundLength, W: chain.candleWindow,
    outcome: s.round.outcome, settlers: s.settlers, me: chain.account, stake: chain.stake, jackpot: s.jackpot,
    amount: (v) => fmtWif(v), unit: "$wif",
  };
}

function phase(v) {
  if (!v) return "loading";
  if (v.outcome) return "revealed";
  if (!v.start) return "waiting";
  if (v.t < v.L - v.W) return "open";
  if (v.t < v.L) return "candle";
  return "closed";
}

const isMine = (v, s) => v.me && s.owner.toLowerCase() === v.me.toLowerCase();

// ------------------------------------------------------------------ boot
async function boot() {
  try { await Promise.all([document.fonts.load('600 40px "JetBrains Mono"'), document.fonts.load('700 20px "Unbounded"')]); } catch { /* fonts are optional */ }
  const land = await fetch("data/land.json").then((r) => r.json());
  world = new World($("world"), land);
  world.labelLayer = $("labels");
  world.onPick = onPick;
  window.__flat = { world, S, view, render }; // for scripted demo recording and debugging
  bindUI();
  if (!lsGet("flat-seen-rules")) { $("howDialog").showModal(); lsSet("flat-seen-rules", "1"); }
  if (LIVE) {
    chain.onAccount = () => { refreshWallet(); render(); };
    try { await chain.init(); S.ready = true; } catch (e) { toast("can't reach robinhood chain right now", true); }
  }
  setMode(S.mode);
  setInterval(tick, 250);
}

function bindUI() {
  $("tabLive").onclick = () => setMode("live");
  $("tabPractice").onclick = () => setMode("practice");
  $("howBtn").onclick = () => $("howDialog").showModal();
  $("walletBtn").onclick = connect;
  $("dropBtn").onclick = doDrop;
  $("revealBtn").onclick = doReveal;
  $("claimBtn").onclick = doClaim;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { S.selected = -1; world.setSelected(-1); render(); }
  });
}

function setMode(mode) {
  S.mode = mode;
  $("tabLive").setAttribute("aria-selected", mode === "live");
  $("tabPractice").setAttribute("aria-selected", mode === "practice");
  S.selected = -1;
  world.setSelected(-1);
  world.clear();
  clearTimeout(S.pollTimer);
  if (mode === "practice") {
    if (!S.practice) S.practice = new Practice();
    newPracticeRound();
  } else if (LIVE) {
    S.snap = null;
    poll();
    loadRecent();
    refreshWallet();
  }
  render();
}

// ------------------------------------------------------------------ live
async function poll() {
  if (S.mode !== "live" || !LIVE) return;
  try {
    if (!S.ready) { await chain.init(); S.ready = true; }
    const snap = await chain.snapshot();
    const off = snap.chainNow - Date.now() / 1000;
    S.clockOffset = Math.abs(off) < 45 ? off : 0;
    applySnapshot(snap);
  } catch (e) {
    console.warn(e);
    $("timerSub").textContent = "can't reach robinhood chain, retrying…";
  } finally {
    S.pollTimer = setTimeout(poll, 2500);
  }
}

function applySnapshot(snap) {
  const prev = S.snap;
  S.snap = snap;
  if (prev && prev.id !== snap.id) {
    world.clear();
    S.selected = -1;
    world.setSelected(-1);
    loadRecent();
  }
  if (prev && prev.id === snap.id && snap.settlers.length > prev.settlers.length) {
    const s = snap.settlers[snap.settlers.length - 1];
    if (!(chain.account && s.owner.toLowerCase() === chain.account.toLowerCase())) {
      toast(`${short(s.owner)} dropped on ${RING_NAMES[ringOf(s.cell)]}, near ${placeNear(s.cell)}`);
    }
  }
  if (snap.round.outcome === 0 || !S.tipped.has(snap.id)) world.setSettlers(snap.settlers, chain.account);
  if (snap.round.outcome !== 0 && !S.tipped.has(snap.id)) {
    S.tipped.add(snap.id);
    playTip({ id: snap.id, round: snap.round, settlers: snap.settlers, stake: chain.stake, me: chain.account, amount: fmtWif, unit: "$wif" });
    setTimeout(() => { refreshClaim(); loadRecent(); }, 1500);
  }
  render();
}

async function loadRecent() {
  if (!LIVE || !S.snap) return;
  const ids = [];
  for (let i = S.snap.id - 1; i >= 0 && ids.length < 5; i--) ids.push(i);
  try {
    const infos = await Promise.all(ids.map((id) => chain.roundInfo(id)));
    S.recent = infos.map((x) => ({ id: x.id, outcome: x.round.outcome, fallen: countFallen(x), tilt: x.round.tilt, start: x.round.start }));
    const waiting = infos.find((x) => x.round.outcome === 0 && x.round.start);
    S.pendingReveal = waiting ? waiting.id : null;
  } catch (e) { console.warn(e); }
  render();
}

function countFallen(x) {
  if (x.round.outcome === Outcome.Void || x.round.outcome === 0) return 0;
  return x.settlers.filter((s, i) => i >= x.round.counted || (x.round.outcome === Outcome.Tipped && fallsOn(s.cell, x.round.tilt))).length;
}

async function refreshWallet() {
  if (!LIVE || !chain.account) { S.bal = null; render(); return; }
  try { S.bal = await chain.balances(); } catch (e) { console.warn(e); }
  refreshClaim();
  render();
}

async function refreshClaim() {
  if (!LIVE || !chain.account) return;
  try { S.claim = await chain.claimable(); } catch (e) { console.warn(e); }
  render();
}

async function connect() {
  if (S.mode === "practice") { setMode("live"); }
  if (!LIVE) { toast("the live arena isn't open yet: practice is the same game"); return; }
  if (chain.account) { window.open(`${CONFIG.explorer}/address/${chain.account}`, "_blank", "noopener"); return; }
  if (!chain.hasWallet()) {
    const link = `https://metamask.app.link/dapp/${location.host}${location.pathname}`;
    toast(`no wallet found. on a phone, open this page in your wallet's browser (<a href="${link}">metamask</a>).`, true, true);
    return;
  }
  try { await chain.connect(); toast("connected to robinhood chain"); } catch (e) { toast(friendlyError(e), true); }
}

async function doDrop() {
  const v = view();
  if (S.busy || !v || S.selected < 0) return;
  if (S.mode === "practice") {
    const err = S.practice.drop(S.selected, v.t);
    if (err) { status(err, true); return; }
    world.setSettlers(S.practice.round.settlers, ME);
    status(`landed near ${placeNear(S.selected)}. good luck.`);
    S.selected = -1;
    world.setSelected(-1);
    render();
    return;
  }
  if (!chain.account) { await connect(); return; }
  S.busy = true;
  render();
  try {
    await chain.drop(S.selected, (m) => status(m));
    status(`landed near ${placeNear(S.selected)}. good luck.`);
    S.selected = -1;
    world.setSelected(-1);
    clearTimeout(S.pollTimer);
    poll();
    refreshWallet();
  } catch (e) {
    status(friendlyError(e), true);
  } finally {
    S.busy = false;
    render();
  }
}

async function doReveal() {
  if (S.mode !== "live" || S.busy) return;
  if (!chain.account) { await connect(); if (!chain.account) return; }
  const v = view();
  const id = phase(v) === "closed" ? v.id : S.pendingReveal;
  if (id === null || id === undefined) return;
  S.busy = true;
  render();
  try {
    await chain.settle(id, (m) => status(m));
    status("revealed.");
    clearTimeout(S.pollTimer);
    poll();
    loadRecent();
  } catch (e) {
    status(friendlyError(e), true);
  } finally {
    S.busy = false;
    render();
  }
}

async function doClaim() {
  if (!S.claim?.items.length || S.busy) return;
  S.busy = true;
  render();
  try {
    await chain.claimAll(S.claim.items, (m) => status(m));
    toast(`claimed ${fmtWif(S.claim.total)} $wif`);
    status("");
    S.claim = null;
    refreshWallet();
  } catch (e) {
    status(friendlyError(e), true);
  } finally {
    S.busy = false;
    render();
  }
}

// ------------------------------------------------------------------ practice
function newPracticeRound() {
  S.practice.newRound(nowSec());
  S.pStart = nowSec();
  S.pEndedAt = 0;
  S.pShown = false;
  world.clear();
}

function tick() {
  if (S.mode === "practice" && S.practice?.round) {
    const r = S.practice.round;
    const before = r.settlers.length;
    const ended = S.practice.tick(nowSec() - S.pStart);
    if (r.settlers.length !== before && !r.result) world.setSettlers(r.settlers, ME);
    if (ended) {
      world.setSettlers(r.settlers, ME);
      S.pEndedAt = nowSec();
      playTip({
        id: r.id, practice: true,
        round: { outcome: r.result.outcome, tilt: r.result.tilt, counted: r.result.counted, prizePool: r.result.prizePool, winWeight: r.result.winWeight, end: r.end },
        settlers: r.settlers, stake: S.practice.stake, me: ME, amount: (n) => Math.round(Number(n)).toLocaleString("en-US"), unit: "practice $wif",
        burned: r.result.burned,
      });
    }
    if (r.result && S.pEndedAt && nowSec() - S.pEndedAt > 11 && !$("resultDialog").open) newPracticeRound();
  }
  render();
}

// ------------------------------------------------------------------ the tip
function playTip(x) {
  const { round, settlers, stake } = x;
  const fallenKeys = new Set();
  const labels = new Map();
  let myIn = 0n, myOut = 0n, mine = [];
  const big = typeof stake === "bigint";
  settlers.forEach((s, i) => {
    const pay = payout(round, s, i, stake);
    const fell = round.outcome !== Outcome.Void && (big ? pay === 0n : pay === 0);
    if (fell) fallenKeys.add(s.key);
    const own = x.me && s.owner.toLowerCase() === x.me.toLowerCase();
    if (own) {
      myIn += BigInt(stake);
      myOut += BigInt(pay);
      mine.push({ s, i, pay, fell });
    }
    if (fell) labels.set(s.key, { text: own ? "you fell" : "fell", cls: `bad${own ? " me" : ""}` });
    else if (round.outcome !== Outcome.Void) {
      const profit = big ? pay - stake : pay - stake;
      labels.set(s.key, { text: `+${x.amount(profit)}`, cls: own ? "me" : "" });
    }
  });
  world.tip({ outcome: round.outcome, tilt: round.tilt, fallenKeys, labels });
  if (mine.length) setTimeout(() => showResult(x, mine, myIn, myOut, fallenKeys.size), 2800);
}

function showResult(x, mine, myIn, myOut, fallenCount) {
  const { round } = x;
  const net = myOut - myIn;
  const flat = round.outcome === Outcome.Flat, voided = round.outcome === Outcome.Void;
  const survived = mine.filter((m) => !m.fell).length;
  const title = voided ? "not enough players: everyone gets their stake back"
    : flat ? "flat day! the world stayed level"
    : survived === mine.length ? "you held on" : survived ? "you lost some, kept some" : "you fell off the edge of the world";
  const amt = (v) => x.amount(v < 0n ? -v : v);
  const bigLine = voided ? `±0 ${x.unit}` : `${net >= 0n ? "+" : "−"}${amt(net)} ${x.unit}`;
  const lean = leanLabel(round.tilt);
  const rows = mine.map((m) => `<tr><td>${esc(RING_NAMES[ringOf(m.s.cell)])} · near ${esc(placeNear(m.s.cell))} (×${ringOf(m.s.cell)})</td><td>${m.fell ? '<span class="chip bad">fell</span>' : voided ? '<span class="chip ice">refunded</span>' : `<span class="chip">+${esc(x.amount(m.pay - x.stake))}</span>`}</td></tr>`).join("");
  const facts = voided ? "fewer than 2 players were counted, so the round was void."
    : flat ? `nobody fell. survivors shared half the flat jackpot.`
    : `the world tipped toward ${esc(lean)}. ${fallenCount} settler${fallenCount === 1 ? "" : "s"} fell.`;
  const url = location.origin + location.pathname;
  const best = mine.filter((m) => !m.fell).sort((a, b) => ringOf(b.s.cell) - ringOf(a.s.cell))[0];
  const shareText = voided ? `I played Flatophobia: the world is flat, don't fall off.`
    : best ? `I survived ${x.practice ? "a practice round" : `round #${x.id}`} of Flatophobia standing on ${RING_NAMES[ringOf(best.s.cell)]} (×${ringOf(best.s.cell)}) near ${placeNear(best.s.cell)} while the world tipped toward ${lean}. ${bigLine.replace(" practice $wif", " (practice)")}`
    : `I fell off the edge of the world in Flatophobia. the world tipped toward ${lean}. never again.`;
  const share = `https://x.com/intent/post?text=${encodeURIComponent(`${shareText}\n\nthe world is flat. don't fall off. $WIF\n${url}`)}`;
  $("resultBody").innerHTML = `
    <span class="k">${x.practice ? "practice round" : `round #${x.id}`}</span>
    <h2>${esc(title)}</h2>
    <div class="big ${net > 0n ? "win" : net < 0n ? "lose" : ""}">${esc(bigLine)}</div>
    <p>${facts}</p>
    <table>${rows}</table>
    <div class="row-actions">
      <a class="btn" href="${share}" target="_blank" rel="noopener">share on x</a>
      <form method="dialog"><button class="ghost">${x.practice ? "next round" : "close"}</button></form>
    </div>`;
  $("resultDialog").showModal();
  $("resultDialog").onclose = () => { if (x.practice && S.mode === "practice" && S.practice.round?.result) newPracticeRound(); };
}

// ------------------------------------------------------------------ input
function onPick(cell) {
  const v = view();
  if (!v || phase(v) === "revealed" && S.mode === "practice") return;
  S.selected = cell === S.selected ? -1 : cell;
  world.setSelected(S.selected);
  status("");
  render();
}

// ------------------------------------------------------------------ render
function render() {
  const v = view();
  renderTimer(v);
  renderWorld(v);
  renderDrop(v);
}

function renderTimer(v) {
  const el = $("timer"), title = $("timerTitle"), sub = $("timerSub"), wax = el.querySelector(".wax");
  const p = phase(v);
  el.classList.toggle("candle-lit", p === "candle");
  el.classList.toggle("closed", p === "closed");
  const reveal = $("revealBtn");
  reveal.classList.add("hidden");
  if (S.mode === "live" && !LIVE) {
    title.textContent = "the live arena opens soon";
    sub.textContent = "practice is the same game, with pretend $wif";
    return;
  }
  if (!v) { title.textContent = "loading the world…"; sub.textContent = ""; return; }
  const name = S.mode === "practice" ? "practice round" : `round #${v.id}`;
  if (p === "waiting") {
    title.textContent = `${name} · waiting for the first settler`;
    sub.textContent = `your drop starts a ${Math.round(v.L / 60)}-minute round`;
  } else if (p === "open") {
    title.textContent = `${name} · candle lights in ${mmss(v.L - v.W - v.t)}`;
    sub.textContent = "after that the round can end at any second";
  } else if (p === "candle") {
    title.textContent = `${name} · the candle is lit`;
    sub.textContent = `it goes out any second, at the latest in ${mmss(v.L - v.t)}`;
  } else if (p === "closed") {
    title.textContent = `${name} · closed`;
    sub.textContent = S.mode === "live" ? "reveal it to tip the world (two quick transactions)" : "tipping…";
    if (S.mode === "live") { reveal.classList.remove("hidden"); reveal.textContent = S.busy ? "revealing…" : "reveal"; reveal.disabled = S.busy; }
  } else if (p === "revealed") {
    const o = v.outcome;
    title.textContent = `${name} · ${o === Outcome.Flat ? "flat day!" : o === Outcome.Void ? "void, stakes returned" : `tipped toward ${leanLabel(S.mode === "live" ? S.snap.round.tilt : S.practice.round.result.tilt)}`}`;
    sub.textContent = S.mode === "live" ? "drop a settler to start the next round" : `next round in ${mmss(11 - (nowSec() - S.pEndedAt))}`;
  }
  if (S.mode === "live" && S.pendingReveal !== null && p !== "closed") {
    sub.textContent = `round #${S.pendingReveal} is still waiting to be revealed`;
    reveal.classList.remove("hidden");
    reveal.textContent = S.busy ? "revealing…" : `reveal #${S.pendingReveal}`;
    reveal.disabled = S.busy;
  }
  const left = p === "open" || p === "candle" ? Math.max(0.12, 1 - v.t / v.L) : p === "waiting" ? 1 : 0.1;
  wax.style.height = `${Math.round(6 + 16 * left)}px`;
}

function renderWorld(v) {
  if (!v) return;
  const settlers = v.settlers;
  $("jackpot").innerHTML = `${esc(v.amount(v.jackpot))} <small>${esc(v.unit)}</small>`;
  const players = new Set(settlers.map((s) => s.owner)).size;
  $("statSettlers").textContent = settlers.length;
  $("statPlayers").textContent = players;
  $("statPot").textContent = v.amount(typeof v.stake === "bigint" ? v.stake * BigInt(settlers.length) : v.stake * settlers.length);
  const t = tiltOf(settlers);
  const mag = tiltMagnitude(t);
  const flat = settlers.length && mag <= 1;
  $("leanText").innerHTML = !settlers.length ? "nowhere yet" : flat ? `<span style="color:var(--lime)">perfectly flat</span>` : `${tiltDegrees(t).toFixed(1)}° toward ${esc(leanLabel(t))}`;
  $("leanBar").style.left = `${Math.min(98, (mag / 20) * 100)}%`;
  const pv = preview(settlers);
  let line = "nobody on the board yet";
  if (settlers.length) {
    const myFalls = settlers.filter((s, i) => isMine(v, s) && pv.falling[i]).length;
    const mine = settlers.filter((s) => isMine(v, s)).length;
    line = flat && players >= MIN_FLAT_PLAYERS ? `if it ended now: <b style="color:var(--lime)">flat day</b>, nobody falls`
      : `if it ended now: <b class="bad">${pv.fallCount} fall</b> · <b>${settlers.length - pv.fallCount} stand</b>`;
    if (mine) line += myFalls ? ` · <span class="bad">${myFalls === mine ? "you'd fall" : `${myFalls} of yours would fall`}</span>` : ` · <b style="color:var(--lime)">you'd survive</b>`;
  }
  $("ifNow").innerHTML = phase(v) === "revealed" ? "the round is over" : line;

  const recent = S.mode === "practice" ? S.practice.history.map((h) => ({ ...h, label: "practice" })) : S.recent;
  $("recent").innerHTML = recent.length ? recent.slice(0, 5).map((h) => {
    const what = h.outcome === Outcome.Flat ? '<b class="flat">flat day</b>' : h.outcome === Outcome.Void ? "<b>void</b>" : h.outcome === Outcome.Tipped ? `<b>${h.fallen} fell</b> · ${esc(leanLabel(h.tilt))}` : "<b>not revealed</b>";
    return `<li><span>#${h.id}</span><span>${what}</span></li>`;
  }).join("") : '<li><span>no rounds yet</span></li>';
}

function renderDrop(v) {
  const btn = $("dropBtn");
  const info = $("pickInfo");
  if (!v) { btn.disabled = true; return; }
  const p = phase(v);
  const settlers = v.settlers;
  const mineList = settlers.filter((s) => isMine(v, s));
  const cell = S.selected;
  if (cell >= 0) {
    const ring = ringOf(cell);
    const after = tiltOf([...settlers, { cell }]);
    const wouldFall = fallsOn(cell, after);
    info.innerHTML = `<span class="k">your move</span>
      <b>${esc(RING_NAMES[ring])} <span class="mult">×${ring}</span></b>
      <span class="place">near ${esc(placeNear(cell))}</span>
      <p class="effect ${wouldFall ? "bad" : ""}">your drop leans the world ${tiltDegrees(after).toFixed(1)}° toward ${esc(leanLabel(after))}. right after it lands, this spot would <b>${wouldFall ? "fall" : "stand"}</b>.</p>`;
  } else {
    info.innerHTML = `<span class="k">your move</span><b>tap a spot on the world</b>
      <p class="hint">further out pays more (×1 to ×5), but pulls the world harder toward you. when the round ends, the red zone slides off the edge.</p>`;
  }

  // the drop button
  let label = "pick a spot", disabled = cell < 0 || S.busy;
  const stakeTxt = `${v.amount(v.stake)} ${v.unit}`;
  if (S.mode === "live" && !LIVE) { label = "live arena opens soon"; disabled = true; }
  else if (S.busy) label = "working…";
  else if (S.mode === "live" && !chain.account) { label = "connect wallet to play"; disabled = false; }
  else if (S.mode === "practice" && (p === "revealed" || p === "closed")) { label = "next round is coming"; disabled = true; }
  else if (mineList.length >= MAX_PER_WALLET && p !== "closed" && p !== "revealed") { label = "you have 3 settlers this round"; disabled = true; }
  else if (S.mode === "live" && S.bal && S.bal.wif < v.stake) { label = `you need ${stakeTxt}`; disabled = true; }
  else if (cell >= 0) label = p === "closed" || p === "revealed" ? `drop · start round #${v.id + 1} · ${stakeTxt}` : `drop a settler · ${stakeTxt}`;
  btn.textContent = label;
  btn.disabled = disabled;

  // your settlers
  const pv = preview(settlers);
  const res = S.mode === "practice" ? S.practice.round?.result : null;
  $("mine").innerHTML = mineList.length ? mineList.map((s) => {
    const i = settlers.indexOf(s);
    let chip = pv.falling[i] ? '<span class="chip bad">on the low side</span>' : '<span class="chip">safe for now</span>';
    if (res) chip = res.payouts[i] === 0 ? '<span class="chip bad">fell</span>' : `<span class="chip">+${v.amount(res.payouts[i] - v.stake)}</span>`;
    return `<li><span>${esc(RING_NAMES[ringOf(s.cell)])} ×${ringOf(s.cell)} · ${esc(placeNear(s.cell))}</span>${chip}</li>`;
  }).join("") : `<li class="empty">none yet (max ${MAX_PER_WALLET})</li>`;

  // claim
  const claim = S.mode === "live" && S.claim && S.claim.total > 0n;
  $("claimBox").classList.toggle("hidden", !claim);
  if (claim) { $("claimAmount").textContent = `${fmtWif(S.claim.total)} $wif`; $("claimBtn").disabled = S.busy; }

  // wallet line
  if (S.mode === "practice") {
    $("walletLine").innerHTML = `practice wallet: ${Math.round(S.practice.balance).toLocaleString("en-US")} pretend $wif · <a href="#" id="resetP">reset</a>`;
    const r = $("resetP");
    if (r) r.onclick = (e) => { e.preventDefault(); S.practice.resetWallet(); render(); };
  } else if (LIVE && chain.account) {
    const b = S.bal;
    $("walletLine").innerHTML = `${esc(short(chain.account))}${b ? ` · ${fmtWif(b.wif)} $wif · ${Number(b.eth) / 1e18 < 0.0001 ? "<span style='color:var(--danger)'>no eth for gas</span>" : `${(Number(b.eth) / 1e18).toFixed(4)} eth`}` : ""}${CONFIG.buyWif ? ` · <a href="${CONFIG.buyWif}" target="_blank" rel="noopener">get $wif</a>` : ""}`;
  } else {
    $("walletLine").innerHTML = LIVE ? `each drop costs ${stakeTxt}. you need a little eth on robinhood chain for gas.` : "";
  }
  $("walletBtn").textContent = LIVE && chain.account ? short(chain.account) : "connect wallet";
}

let toastTimer = 0;
function toast(msg, err = false, html = false) {
  const el = $("toast");
  if (html) el.innerHTML = msg; else el.textContent = msg;
  el.classList.toggle("err", err);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4200);
}

function status(msg, err = false) {
  const el = $("dropStatus");
  el.textContent = msg;
  el.classList.toggle("err", err);
}

boot();
