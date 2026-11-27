# 02 · Compare report and the two prototypes

- `compare-report.md` — renamed from `compere-report.md`; rewritten as A (global catchment field) vs B (queue-first service) with measured ranges, so no side is called "main" now that both live here.
- `a/index.html` — feature: Inspect/Mine/Settlement/Erase map tools writing to the same actor lists as generated layouts; `stepDemand`/`stepResources` split into `diffuseDemand`, `driftDemand`, `filterDemand`, `consume`; hot paths take precomputed neighbour tables and hoisted exponentials.
- `a/test.cjs` — fix: uses `catchmentStock` / the feed work list after `neighborhood` was removed; asserts unchanged.
- `b/simulation.js` — feature: optional `catchment` mode, falloff ring built once at load by `fillCatchmentCell` + `normalizeCatchmentRow`.
- `b/index.html`, `b/app.js` — feature: Catchment feedback switch and guide entry; queue model stays the default.
- `b/simulation.test.js` — 3 tests for near-stock cooling, distance weighting and recovery (17 total).
- Validation: both suites pass; stub-DOM boot + 120 frames clean on both; A tick 1.26 → 0.83 ms (main realm, 600-tick warm run); B step 0.153 ms queue-only, 0.156 ms with catchment.
- Demand over 60 s moved 0.896–0.937 → 0.873–0.920 in B catchment mode; A unchanged at 0.361–0.742.
- Decision: keep ambient demand and the intake queue in their own prototypes; only the feedback idea travelled, and only as an opt-in mode.
- Pitfall: `node --test` with no argument also loads `b/simulation.js` as a test file; it passes, but run `simulation.test.js` explicitly. Normalise catchment weights once at build, never per cell.
- Next: a shared controlled layout (one settlement, four mines) diffing consumption curves with feedback off, queue-only and catchment.
