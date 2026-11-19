# Map economy · workforce models, job-site inspection, hamlet spawning

plan: `plan-map-economy.md` 4.1a — workforce models section (new standing topic)
changed: `map-fluid.js` (new) — optional Fluid field: fresh/depleted pools, job spend, settlement rest, hamlet spawn gated on `world.settleValue`
changed: `map-economy.js`, `map-diffusion.js` — `workforceMode` (Residents default / Fluid), pools, ledger counters, job injection, per-tick `mapeFluidStep`
changed: `map-industry.js` — factory runtime (build/produce, staffing = min(1, present/need)), mines via `mapeWorkPresent`, `mapeJobSummary` Jobs totals
changed: `world.js`, `map-scenes.js` — `settleValue` per cell; Factory scene tool
changed: `input.js`, `render.js`, `hud.js`, `hud-economy.js`, `hud-scenes.js`, `actions.js`, `index.html` — click-select job sites (teal ring, Esc clears), workforce HUD segment + Jobs row + per-site block
changed: `experiments/mape_fluid.js` (new), `experiments/dom_smoke.js`
validation: mape_fluid fluid_failures=0 (pool conservation −0.016, ledger residuals 0, hamlet spawn, swamp rejection); all suites PASS; residents mode unchanged; no manual/L2 pass yet
decision: fluid is optional, residents default; spawn prefers deepest pool on cells with settleValue ≥ 0.35 and debits 10 pooled depleted; MAPE_WF_TIRE is the declared balance subject; scene-A peak ≈ 4.4 depleted/cell (natural spawn not yet observed)
decision: factory = staffing-scaled coal/iron draw, 20 s iron build, zero staff zeroes counters; 0.80 treeline class effectively rare (swamp band separates meadow/forest) — kept per draft intent
pitfall: workforceMode persists across setup() like the engine — experiments set it explicitly; assert ledger totals, not cell-local stock; border cells get no waterfront credit
next: manual pass at 4× scene A (HUD rates, spawn cadence); factories still need placement scan and idle transition before Phase 3 closes
