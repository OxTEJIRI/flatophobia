# Flatophobia: design plan

*A shared-world strategy game for the World Is Flat hackathon on Robinhood Chain. Played with $WIF.*
*Submissions close **12 Nov 2026, 17:30 UTC**. Status at time of writing: contract + practice mode built, live mode untested, nothing deployed.*

---

## 1. One-line pitch
The world is a flat disc balanced on a pin. Everyone drops settlers on it, every settler tilts it, and when the round ends the low edge slides off. Survivors split what the fallen paid.

## 2. Goals and non-goals
**Goals**
- A game a judge understands in 10 seconds and enjoys in 2 minutes.
- $WIF is the only currency; every round burns some.
- Fully onchain rules: no server, no owner, no admin keys.
- A flywheel: rounds -> burns + jackpot -> shareable moments -> more players.

**Non-goals**
- No token launch, no NFTs, no off-chain accounts.
- No reflex or twitch skill (hard to bot, fair on phones).
- No promise of profit. $WIF is a memecoin; the UI says so.

## 3. Core loop
1. Open the page, tap a spot on the disc, drop a settler (flat stake, e.g. 1,000 $WIF).
2. Watch the disc lean as others drop; the red zone shows who would fall now.
3. Decide: add a second or third settler, or stay put. Max 3 per wallet.
4. The round ends at a hidden moment inside the final "candle" window.
5. Anyone reveals the round; the disc tips; losers slide off; winners claim.
6. Next round starts with the next drop.

## 4. Rules (exact)
| Item | Value |
|---|---|
| Board | 16 sectors x 5 rings = 80 cells, North Pole at centre |
| Ring weight | ring k pays x k and pulls the disc k times as hard |
| Stake | flat, same for everyone (set at deploy) |
| Cap | 3 settlers per wallet per round, 120 per round |
| Round length | set at deploy (planned: 10 min, candle = last 3 min) |
| Minimum players | 2 distinct wallets, else the round is **void** and everyone is refunded |
| Tilt | sum over counted settlers of (sector direction x ring) |
| Fall rule | a settler falls if `ring x (direction . tilt) > 3` ring units (the "grip") |
| Late drops | settlers dropped after the hidden end always fall |
| Flat day | tilt <= 0.5 ring units and >= 3 players: nobody falls, survivors also share half the jackpot |
| Split of what fell | 5% burned, 5% to jackpot, 90% to survivors weighted by ring |
| Everyone fell | the 90% also goes to the jackpot |

**Why a grip rule instead of "low half falls":** simulation (`tools/balance.mjs`) showed that with "everyone on the low half falls", ring 1 lost about 32% on average and ring 5 won 12%, so nobody would play the middle. With grip 3, survival ranges from about 94% (ring 1) to 49% (ring 5) and average returns sit between +11% and -10%, so every ring is a real choice.

## 5. The candle (hidden end)
- The final `candleWindow` seconds of a round hide the real end.
- When a round closes, the contract records a **seal block**. A second call, at least two blocks later, reads the hash of `sealBlock + 1`, derives the hidden end inside the window, then settles.
- If nobody settles within 256 blocks the seal is refreshed.
- **Known risk:** Robinhood's docs advise against block data as randomness. Here the value only decides a timing window worth a few settlers' stakes, and the sequencer would have to withhold or reorder a block to influence it. We document it in SECURITY.md. **Mitigation if time allows:** Chainlink VRF, if available on the chain.

## 6. Economy and flywheel
- **Burn:** 5% of every round's fallen stakes is burned via `burn()` (real supply reduction).
- **Jackpot:** 5% feeds it; anyone can add via `feedJackpot` (sponsors, partners). Half pays out on a flat day.
- **Flywheel:** rounds create burns and jackpot growth -> shareable results ("I survived on the ice wall") -> new players -> more rounds. Flat days are rare (about 3% in simulation) and make the jackpot a recurring event.
- **Fairness:** flat stakes, 3-settler cap, no whales, no owner.

## 7. Smart contract
`contracts/src/Flatophobia.sol`, Solidity 0.8.28, compiled with via-IR.
- Immutable config: `wif`, `stake`, `roundLength`, `candleWindow`. No owner, no upgrade path.
- Entry points: `drop(cell)`, `settle(id)`, `claim`/`claimMany`, `feedJackpot`.
- Views: `snapshot()` (everything the screen needs in one call), `getRound`, `getSettlers`, `payoutOf`, `historyOf`, `falls`.
- Safety: reentrancy lock, checks-effects-interactions, no admin withdraw, claims callable by anyone for anyone.
- Tests: 23 Foundry tests including a 512-run fuzz that asserts `paid + burned + remaining == staked` (remaining = jackpot + under 1 wei dust per settler).
- Planned extras: SECURITY.md (own findings, like other entries), Blockscout verification.

## 8. Frontend
`web/`, static, no build step. three.js and ethers are vendored (no third-party scripts at runtime).
- `scene.js`: 3D disc, flat-earth texture drawn from Natural Earth data, pin, lighting, settlers, spring-based tilt, danger zone + slide line, tip animation.
- `rules.js`: exact JS mirror of the contract maths, used for previews and practice.
- `practice.js`: bots with 4 play styles, pretend wallet, rounds of 60 s.
- `chain.js` / `config.js`: reads over the public RPC, writes through the player's wallet, adds the chain if missing, friendly error messages.
- `main.js`: UI controller for live and practice modes.

### UI layout
- **Header:** brand, `live arena | practice` switch, how-to-play, connect wallet.
- **Candle bar (top centre):** round number, time to candle, "candle is lit", reveal button when closed.
- **Left panel:** jackpot, settlers/players/at stake, lean direction and degrees, "if it ended now: N fall, M stand", last rounds.
- **Right panel:** your move (ring, multiplier, nearest place name, whether your drop would fall), drop button, your settlers with safe/low-side chips, claim box, wallet line.
- **Phones:** panels collapse to a top strip and a bottom sheet; pinch zoom and drag rotate.
- **Style:** World Is Flat palette (near-black `#0E0E0B`, cream `#EDE4CF`, lime `#CFEF5B`, danger `#FF5A36`), chamfered frames, Unbounded + JetBrains Mono.

### Engagement features
- A place name for every cell, so each drop has a story.
- Live red zone and slide line, so the risk is visible and your own settlers pulse when in danger.
- Tip animation with floating +amounts; result card with a share-to-X button.
- Practice mode for instant play without a wallet.

## 9. Delivery plan (deadline 12 Nov 17:30 UTC)
| When | Work | Done? |
|---|---|---|
| Built | Contract, 23 tests, 3D scene, practice mode, balance check | yes |
| Next | Test live mode on local anvil (bots + two wallets), fix bugs | no |
| Next | Mobile pass and a short sound/haptic polish (optional) | no |
| Deploy | Deploy to Robinhood Chain mainnet (chain 4663), verify on Blockscout, set address in `config.js` | needs wallet + a little ETH |
| Live proof | Run real rounds with friends; keep it live until 16 Nov | needs $WIF |
| Submit | Demo video, SECURITY.md, one-liner, repo link, hosted URL, post on hackathon feed | no |

## 10. Submission checklist (from the hackathon rules)
- [ ] Uses $WIF onchain on Robinhood Chain
- [ ] Flywheel explained (section 6)
- [ ] Repo the judges can see (or private + invite GitHub user `wifonrh`)
- [ ] Demo video
- [ ] Real transactions on mainnet
- [ ] Stays live until the final closes (16 Nov)
- [ ] No "Robinhood" name or logo in the project name, logo or handle
- [ ] Team lead's payout wallet ready; all members 18+

## 11. Risks and open questions
| Risk | Plan |
|---|---|
| Not enough live players, so rounds void | Seed with friends, community invite, announce round times; practice mode covers judges |
| Block-hash randomness criticised | Document it; consider VRF |
| Multi-wallet "fake flat day" | 3-settler cap, hidden end; document |
| Live mode untested | Local anvil test next |
| Time (about 2 days) | Cut polish, not safety; skip anything not in section 9 |
| Crowded games category | Lean on "only shared-world strategy game", onchain proof, burn counter |

## 12. Folder map
```
flatophobia/
  DESIGN.md              this file
  contracts/             Foundry project (src, test, script)
  web/                   the game (index.html, css, js, vendor, data, assets)
  tools/                 land-map generator, balance + simulation scripts, local bot script
```

## 13. Local commands
```bash
# tests
cd contracts && ~/.foundry/bin/forge.exe test
# play practice mode: preview "flatophobia" (port 5181)
# local chain: preview "flatophobia-anvil" (port 8545), then
cd contracts && ~/.foundry/bin/forge.exe script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```
