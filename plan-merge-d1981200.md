# Plan: merge-review of `d1981200` into the current branch

**Branch reviewed:** `d1981200cf3cd1511c93377fedc96238ebb66c3f` (tip of `main`)
**Current branch:** `arena/11bda434-territory-fieldbook` (tip `4e67047e…`)
**Relationship:** the two commits share **no merge base** in this clone — they are two divergent
single snapshots. This is therefore a **snapshot-vs-snapshot** review, not a linear diff.

---

## 1. What was compared

| Area | Current branch (`4e67047`) | `d1981200` (`main`) |
|------|----------------------------|----------------------|
| Particle engine | `prototype/particle-transfer-b2/` — agent/field sim (actors, workers, towns, farms, forage, founding, goods) | `prototype/particle-transfer/` — **newly restructured**; SoA `GoodsParticles` + audit/observability layer |
| `price-model-b2` | has `MAP_WRAP` torus topology, farms, harvest, towns, food, full ref chain | leaner: **dropped torus, farms, harvest, towns**; actor/workforce/settlement refactors |
| `particle-transfer-b2` in `main`? | — | **deleted** (renamed to `particle-transfer`) |

The "wrap xy / torus" work the current branch did lives in **`price-model-b2`** (`MAP_WRAP`,
`wrapCell`, `setMapWrap`, worklog `14-map-wrap-torus-b2-worklog.md`). It is **absent from `main`**
(the worklog was deleted and no wrap code remains in `main`'s `price-model-b2`).

---

## 2. Divergence map (particle engine)

| Dimension | Current (`particle-transfer-b2`) | Main draft (`particle-transfer`) |
|-----------|----------------------------------|----------------------------------|
| Core model | Agent/field simulation: `PriceEconomy` grid + `actors`/`workers`/`towns`/`farms`/`forage`/`founding`/`goods` | SoA **particle physics**: preallocated typed-array `GoodsParticles` (spawn accumulators, haul-cost accrual, spoilage, buyer-arrival split) + `workers` particles |
| Observability | none | **full audit layer**: `track.js` (per-worker purse ledger, rest stops, event feed, wallet history), `tracked.js` (panel), `diagnostics.js` (economy inspector, conservation buckets, stall flags, copy-text), `worker-lifecycle.js`, `economy-panel.js` |
| Diffusion | per-item field diffusion in `simulation.js` | adds `makeScratch`/`clearScratch`/`hasBetterNeighbor`/`blendedScore` scratch helpers |
| Economy richness | `ECONOMY_GARDEN`/`FARM`, `ITEM_FOOD`, full ref chain (3 mines / 2 factories / 2 towns / 1 gold / 1 garden) | "phase-1" minimal chain (1 mine / 1 factory / 1 town, no gardens/farms/food) |
| Tunables | `MINE/FACTORY/GOLD_LABOR = 1.1`, `PROFIT_RATE = 1.4`, `BUFFER_SECONDS = 1.8` | `LABOR = 0.25`, `RESIDENT_AVG_SECONDS = 6`, `LABOR_PER_POP = 0.06`, `PROFIT_RATE = 1.5`, `BUFFER_SECONDS = 1.5` |
| Torus wrap | present (in `price-model-b2`) | absent |
| Tests | 26/26 pass | 38/38 pass (imported & re-validated) |

**Verdict:** the two particle engines are **architecturally divergent** (different paradigms:
agent/field vs SoA-particle). This matches the user's heuristic → **keep `main`'s as a new prototype**,
don't try to reconcile them into one file.

---

## 3. Decisions (per the stated heuristic)

1. **Big divergence → new prototype.** `main`'s `particle-transfer` is imported **as-is** into the
   current branch at **`prototype/particle-transfer-lab/`** (renamed to avoid clobbering
   `particle-transfer-b2`). It is additive and non-destructive. Validated: **38/38 tests pass.**
2. **Not a blind merge of `price-model-b2`.** `main` *removed* the torus/farms/food features that the
   current branch uniquely has. Treat the current `price-model-b2` as the richer line; mine `main`'s
   actor/workforce/settlement *refactors* for ideas only (see Job 6).

---

## 4. Cherry-pick candidates (good ideas → implement in current branch)

Ordered by value/risk. All land in `prototype/particle-transfer-b2/` unless noted.

- **P1 — Observability / audit layer (high value, medium effort).** Port `track.js` + `tracked.js` +
  `diagnostics.js` + `economy-panel.js` from the lab, adapted to `b2`'s worker/actor API. Gives exact
  per-worker purse ledgers (the "ledger check stays `exact`" property) and an economy inspector with
  stall flags — hugely useful for debugging the conservation invariants `b2` already tests for.
- **P2 — Diffusion scratch helpers (medium value, low risk).** Adopt `makeScratch` / `clearScratch` /
  `hasBetterNeighbor` / `blendedScore` into `b2/simulation.js` for a cleaner capacity/flow scratch model.
- **P3 — Tunable presets (low risk).** Add the lab's leaner numbers (`LABOR=0.25`, `RESIDENT_AVG_SECONDS`,
  `LABOR_PER_POP`, `PROFIT_RATE=1.5`, `BUFFER_SECONDS=1.5`) as an **A/B preset**, not an overwrite, so the
  richer `b2` economy can be compared against the leaner phase-1 tuning.
- **P4 — SoA `GoodsParticles` pattern (high effort, optional).** The preallocated typed-array particle
  approach is a v3 architectural move; defer unless P1/P2 prove the current agent model is the bottleneck.
- **P5 — Outbound (re-offer to `main`).** The `MAP_WRAP` torus topology was *dropped* in `main`; consider
  re-surfacing it (and the lab's observability) back to `main` as a later PR.

---

## 5. Job list

- [x] **J1 — Import `d1981200:prototype/particle-transfer` → `prototype/particle-transfer-lab/`.**
  Validated: `node --test` → **38/38 pass**.
- [x] **J2 — Provenance note** in `particle-transfer-lab/README.md` (source commit + why it's a sibling,
  not a merge).
- [ ] **J3 — Port the audit/observability layer into `particle-transfer-b2` (P1).** Sub-tasks:
  - [ ] map lab `workers.byWid` / `STATE_FRESH` / `STATE_DEPLETED` onto `b2`'s worker model;
  - [ ] add `track.js` + `tracked.js` (watched-worker purse ledger + chart);
  - [ ] add `diagnostics.js` (economy inspector + stall flags + copy-text);
  - [ ] wire `economy-panel.js` / `tracked-panel` into `b2/index.html` + `b2/app.js`;
  - [ ] add `node --test` coverage for the ledger `exact` invariant.
- [ ] **J4 — Adopt diffusion scratch helpers (P2)** into `b2/simulation.js`; keep `b2`'s per-item fields.
- [ ] **J5 — Add A/B tuning preset (P3)** from lab constants; document in `b2/README.md`.
- [ ] **J6 — Mine `main`'s `price-model-b2` refactors (actors/workforce/settlement)** for ideas worth
  pulling into current `price-model-b2`; do **not** pull the torus/farm removal.
- [ ] **J7 — Verify after each cherry-pick:** `cd prototype/particle-transfer-b2 && node --test`
  must stay at 26/26; `particle-transfer-lab` must stay 38/38.

---

## 6. Open question for you

Before I start J3–J7, confirm scope:

- **J3 (observability layer into `b2`)** is the highest-value pick but the largest effort — want me to
  do it now, or keep the two prototypes separate for now?
- For **P3**, prefer an A/B preset toggle (recommended) or just overwrite `b2`'s constants?
- Anything from `main`'s `price-model-b2` (J6) you specifically want me to look at first?
