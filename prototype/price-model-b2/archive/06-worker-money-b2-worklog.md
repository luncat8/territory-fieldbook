# 06 Worker Money B2 Worklog
plan: `prototype/price-model-b2/archive/06-worker-money-b2-plan.md`, `draft/particle_transfer_model.md`
changed:
- `prototype/price-model-b2/{simulation,actors,gold,fields,telemetry,app}.js`, `{index.html,styles.css,README.md}`, `{simulation,worker-money}.test.js` — standalone B2 worker-gold lab.
- `draft/particle_transfer_model.md`, `findings-pitfalls-skills.md` — refined `particle_transfer_model` particle/Transport Company rules and logged B2 pitfalls.
validation:
- L0 `node --check prototype/price-model-b2/*.js`: pass (8/8 files, all <485 lines).
- L1 `(cd prototype/price-model-b2 && node --test)`: pass 34/34; DOM/canvas UI smoke across all 5 views: pass.
decisions and why:
- Kept resident savings in `workerPurse` during ordinary commuting (attaching savings to `depletedFlow.gold` only on `deltaPop < 0` emigration) so idle `labor` rings cannot drain town cash.
- Scaled `townHomeBid` by `START_PRICE` (`BASE_SHELTER = 0.15`) and divided by actual gold tax `townRestTax(i)` so appeal clears `GRADIENT_KNEE` without favoring inflated gold-mine towns.
pitfalls:
- Unscaled `[0, 1]` appeal stalls below `GRADIENT_KNEE`; unconditional town `holds` trap shed migrants unless released when `hasHigherNeighbor(priceHome, i)`.
next step suggestion:
- Prototype `particle_transfer_model` (SoA goods/worker particles + map-wide Transport Company) per `draft/particle_transfer_model.md`, or port B2/tax fixes into `map-money-gold.js`.
