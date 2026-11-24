# 07 Worker Pools B2 Worklog
plan: `prototype/price-model-b2/archive/07-worker-pools-b2-plan.md`
changed:
- `prototype/price-model-b2/{actors,simulation}.js` — occupancy-balanced firm fresh-worker pools, wait-pool living taxes, and `popRoom` removal.
- `prototype/price-model-b2/gold.js` — proportional `(labor + depleted)` wage settlement fix + wait-crowded living tax collection.
- `prototype/price-model-b2/{fields.js,index.html,README.md,worker-money.test.js}` — `Pool`/`Wait%` tooltips, guide copy, and 5 pool/wage tests.
- `findings-pitfalls-skills.md` — logged pool wage-floor, proportional shift-pay, and `popRoom` pitfalls.
validation:
- L0 `node --check prototype/price-model-b2/*.js`: pass (8/8 files, all <=482 lines).
- L1 `(cd prototype/price-model-b2 && node --test)`: pass 39/39; UI/DOM smoke across all 5 resource views: pass.
decisions and why:
- Sized firm labor pools and town wait pools from smoothed real shift/rest throughput (`workLoad`) so active routes bridge commute lag while idle sites stay lean; removed the `0.35 * drive` wage floor and `popRoom` factor so pool overflow drops wages to `0` and town crowding acts through gold living tax.
pitfalls:
- Settling `PAY_WAGE` into `depletedFlow.gold` alone front-loads cohort pay onto tick-1 departures and starves later pool shifts; linear `popRoom` locks commuters out at `POP_MAX`.
next step suggestion: port B2 tax collection, `GOLD_NEIGHBORS` rebuild, and occupancy-balanced pools into `map-money-gold.js` (splitting under 500 lines), or prototype `price_model_p`.
