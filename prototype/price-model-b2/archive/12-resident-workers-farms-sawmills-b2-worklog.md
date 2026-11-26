# 12 Resident Workers, Sawmills & Farms B2 Worklog
plan: `draft/workers-food.md` (self-moving workers, split/starvation), `draft/company/{all,food-farm,new-construction-build}.md` (sawmills, seasonal farms), `draft/town-settlement.md` (non-teleporting founding).
changed:
- `workforce.js`/`towns.js`/`settlement.js`: replaced `stepTown` worker minting with conserved resident `fresh`/`away`/`rooms`; doorway `stepOut`, split/starvation lifecycle, non-teleporting founding, gold-backed wood/food bids.
- `farms.js` (new) + `actors.js`/`gold.js`/`harvest.js`/`land.js`/`simulation.js`: `ECONOMY_SAWMILL` patch felling (`PAY_WOOD`), `ECONOMY_FARM` plot clearing + 7s moisture-weighted harvests (`PAY_FOOD`) + outer-ring waste, mixed paid/foraged advection.
- `fields.js`/`telemetry.js`/`app.js`/`index.html`/`styles.css`/`README.md` + `farms.test.js` (7): Sawmill/Farm tools & markers, farmland overlay, worker/firm ledgers, and engine + stub-DOM regression tests.
validation:
- L0 `node --check` all `.js`; L2 `node --test` 66/66 pass; 120s run: goods 104.91, wood 9.01, food 17.00, split 3.48, goldErr 5.9e-12, workerErr 5.1e-13, maxLitter 0.085; stub-DOM smoke 8 views / 8 tools.
decisions & why:
- Track `paid` + `owner` alongside `wood`/`food` so commercial sawmill/farm stock bills `PAY_WOOD`/`PAY_FOOD` while wild forage and farm tree-clearing travel free without phantom debt.
- Stamp `land.claim` rather than `land.waste` on sawmills/farms so farms never poison their own `FARM_RADIUS = 2` plots; seasonal fertilizer waste lands on Chebyshev ring 3.
pitfalls:
- Counting `depleted` inside `evictSurplus` or decaying `away` caused 60 Hz eviction/rest purse churn; rich-town startup needed `min(rooms, popCap * RICH_OCC)` before first goods arrived.
next step suggestion:
- Spontaneous company founding (`spawn sawmill/farm/factory` where output demand + free workers + construction wood converge per `draft/company/new-construction-build.md`).
