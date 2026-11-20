# Map economy · site engine

plan: `plan-map-economy.md` Phase 4
changed: `map-sites.js` — new SITES engine: one price law on counterparty stock, SoA shipment pool (eta, transport charge, split haul), holds/orders/arrivals, metabolism on delivered stock, margin-based scan siting
changed: `map-economy.js` — SITES init/dispatch, reset + settle flush, `transit` ledger counter, `mapeMarketEngine()`, `mapeStepSites` export
changed: `map-diffusion.js`, `map-factory-scan.js` — demand/warm/flow gates on `mapeMarketEngine()`; scan SITES branch with shared `mapeScanPlace`
changed: `render-economy.js`, `hud-economy.js`, `index.html` — demand/import gates on `mapeMarketEngine()`; load `map-sites.js` after `map-factory-scan.js`
changed: `experiments/mape_sites.js` — six-gate suite; `mape_population.js`, `mape_forest.js` — SITES in engine loops
changed: `plan-map-economy.md`, `AGENTS.md`, `findings-pitfalls-skills.md` — constants, Site engine + transit formula, file map, divergences + lessons
validation: L0 `node --check` ×9; L1 mape_sites all six gates; L2 full 15-experiment suite pass — price 1.887 = 144/501+1.6, eta 10.0 s/20 cells, supplied 18→26.4 vs hungry flat, margin site (14,14) d 5.7 vs 26.3, build 20.6 s, emitter CO2 1.578 far <1e-6, tick 1.27 ms, residual −7.4e-7
decision: one law `base*ref/(counterpartyStock+1)+dist*COST` — seller stock for matching, buyer stock at placement; haul is a discount on revenue (a bonus selects the farthest buyer)
decision: transport work split 50/50 across shipment endpoints — a full origin charge pumps the buying town toward its seller; `transit` in the residual keeps departures, arrivals and engine switches exact
pitfall: `mape.goods[cell] = x` writes the coal slice — goods need `MAPE_RES.GOODS*world.n+cell`; full note in findings
next: Phase 5 — HUD `sites` enable + runtime switching (`mapeEngineAvailable`, mape_compare SITES case), +10% influence, victory stability
