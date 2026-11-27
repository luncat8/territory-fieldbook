# particle-transfer → particle-transfer-b2 port — verification inventory

Port of the `d198120` reference lab into `prototype/particle-transfer-b2`, then the
cell-lab adapter in `prototype/price-model-b2`, with a shared GUI extracted to
`prototype/shared/` and the old B1 labs archived under `prototype/archive/`.

## Stage ledger

| Stage | What | Verification |
|-------|------|--------------|
| 1 | Torus wrap across sim/steering/forage/land/settlement/founding/farms/workers/app | `wrap.test` 3/3 |
| 2 | Wage-claims (SoA `claims`) + cost relaxation `COST_RELAX=0.06` | `gold.test` 5/5 (adds claim-overflow + FIFO regression) |
| 3 | Rendering: triangle/points/large shapes + gold value-flux vectors | `render.test` 3/3 → 35/35 |
| 4 | `diagnostics.js` + `track.js`/`tracked.js` Watched Workers audit + shared `EconomyPanel` | particle suite 41/41 (adds food in-flight diagnostics) |
| 4f | Cell-lab diagnostics adapter (`price-model-b2/diagnostics.js`) + wiring | cell suite 72/72 |
| 5 | Shared GUI extraction (`lab.css`, `lab-ui.js`, `economy-panel.js`) | both suites green |
| 6 | Archive old B1 labs; docs; this L0/L1/L2 inventory | see below |

## L0 — syntax (every edit batch, `node --check`)

All shipped JS in `particle-transfer-b2/*.js`, `price-model-b2/*.js`, `shared/*.js`
pass `node --check`. (Run: `for f in $(ls prototype/*/*.js prototype/shared/*.js); do node --check "$f"; done`.)

## L1 — targeted smoke (after behavior change / code move)

- Shared CSS extracted as 154 common chunks, a **byte-exact round-trip** (166/170 chunks
  verified identical; the 4 non-matching are lab-unique rules that remain only in each
  lab's `styles.css`). No rule lost.
- Both labs load the three shared scripts (`diagnostics.js`, `lab-ui.js`, `economy-panel.js`)
  in the documented order; `lab-ui.js` precedes the others so `$(id)` / `labIcon` resolve.
- Cell-lab `diagnostics.js` fixed: no `placeName` exists in the cell lab → uses
  `cellName(i)`; harvest read switched from `m.harvest.eatenFood` to the partitioned
  `s.foodEaten` / `s.woodUsed` (from `m.harvest.usedWood` + `m.harvest.builtWood`);
  `DIAG_ACTOR_LABELS` widened to 7 entries (index 4 = `gold`).

## L2 — full suite + boot (shared/boot files touched)

- `node --test` in `particle-transfer-b2/` → **41/41** (10 files: conservation, diagnostics,
  food-life, forage, founding, gold, render, ui, workers, wrap).
- `node --test` in `price-model-b2/` → **72/72** (farms + harvest + settlement +
  simulation + worker-money + new `diagnostics.test.js`).
- Boot/UI gates run under stub DOM (particle `ui.test.js` boots all 22 script tags, head
  shows `Watched worker #1`; cell `farms.test.js` boots 14 script tags incl. the shared
  pair and exercises tools / topology switch / cell tooltip).

## Remediation — 2026-11-27 (branch-comparison follow-up)

Resolved the open picks from `archive/20261126-branch-comparison-report.md`:

- **Wage-claim overflow (P1).** `gold.js` claim table now grows in place (`growClaims`, doubling
  from `WAGE_CLAIM_CAP`) instead of silently dropping entries at the cap. No entitlement is lost while
  `owedWage` still carries the debt. Regression: 129 simultaneous zero-purse hires all settle to their
  original wallets with zero vault leakage.
- **Wage-claim FIFO (P2).** `payWageClaims`/`release` compact with order-preserving drops
  (`dropClaim`, `removeClaimsFor`) instead of swap-removal, so an older claim is never leapfrogged.
  Regression: three 1 g claims funded with 2 g pay the first two hires and defer the third.
- **Food diagnostics (P2).** `diagnostics.js` now carries the full food counterpart of coal/goods:
  `foodFieldMean/Max/BestBuyer`, `foodParticles/Stopped`, `foodFlight`, `foodAsk/BookCost/HaulCost`,
  an underwater food-ask stall flag, the copy-text price line and the inspector price rows.
- **Particle `16×` speed (P3).** `particle-transfer-b2/index.html` regains the `16×` playback option
  (`1×` stays the default); the cell B2 lab already had it.
- **Findings carryover (P2).** The still-applicable general lessons from old `d198120` were merged back
  into `findings-pitfalls-skills.md` (per-worker mass-weighted state, write-time founding, placement-time
  actor cones, `neutralLand` fixtures, gradient-gate/saddle/queue traps, wallet ownership, batched
  conservation counters). The obsolete "particles only while walking" rule and old town-minting
  prescriptions were left out.

Validation rerun: particle suite 41/41, cell suite 72/72.

## Ledger invariants preserved

- Particle: `funded + earned − spent − splitShared − wallet ≈ 0` (<1e-9) over 40 s with
  split; `townPurse + firmPurse + wallets + vault === money.total()`.
- Cell: `townPurse + firmPurse + workerPurse + carried + coins === goldTotal`;
  `fresh + labor + depleted === totalWorkers()`.

## Archive moves (preserve history via `git mv`)

- `prototype/economy-demand-product-diffusion/` → `prototype/archive/economy-demand-product-diffusion/`
- `prototype/price-model-b/` → `prototype/archive/price-model-b/`
- `prototype/water-humidity/` → `prototype/archive/water-humidity/`

The reference `d198120` was a git object only (no on-disk B1 `particle-transfer`); only the
B2 ports and `shared/` remain at the `prototype/` top level.
