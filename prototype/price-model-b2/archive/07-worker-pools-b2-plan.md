# 07 · Price Model B2: Occupancy-Balanced Worker & Living Wait Pools

## Goal

Give universal firms and towns in `prototype/price-model-b2/` occupancy-balanced workforce pools that smooth commuter transit lag and price overflow directly through wages and living taxes:

1. **Firm fresh-worker pool (`firmLaborPool`).** Mines, factories, and gold mines maintain an on-site fresh-worker pool above immediate shift capacity, sized from a standby shift base plus smoothed realized shift throughput (`workLoad[i]`). Workforce hire demand (`priceLabor` bid) scales inversely with pool occupancy (`1 - occ`) all the way to `0` on overflow, lowering workforce pay when fresh workers flood a site while sustaining unbroken shifts across commute round-trips.
2. **Proportional on-site wage settlement (`payWorkers`).** Settled `PAY_WAGE` bills and surplus payouts split proportionally across `(labor[i], depleted[i])` on site so workers waiting in the fresh pool carry their earned wage share into `depletedFlow.gold` as each shift completes.
3. **Town living wait pool (`townWaitPool`) & rent pressure.** Towns size their incoming `depleted` wait pool to resident base plus realized returning-worker rest throughput (`workLoad[i]`), scaling rest service with town population. Wait-pool crowding above normal commuter turnaround (`WAIT_POOL_FREE`) and near-`POP_MAX` fullness raise `townRestTax(i)` and `taxMult[i]` directly, replacing the `1 - pop / POP_MAX` `popRoom` multiplier on `townHomeBid(i)` so full healthy towns still welcome their own commuters home while steering excess migrants toward cheaper, uncrowded towns.

## Architecture & Files

- `prototype/price-model-b2/simulation.js` (`PriceEconomy`):
  - Own `workLoad` (`Float64Array(ECONOMY_SIZE)`) and expose `poolTarget`, `poolOccupancy`, `firmLaborPool`, and `townWaitPool`.
- `prototype/price-model-b2/actors.js` (`ActorOptimizer`):
  - Smooth realized shift draw (`usedLabor / dt`) and town rest throughput (`restedWork / dt`) into `workLoad[i]` (`OCCUPANCY_RATE = 0.35`).
  - Size `firmLaborPool(i, recipe)` from `WORK_POOL_BASE` (`1.8 s`, modulated by `drive`) plus `WORK_POOL_TRANSIT * occRatio` (`2.2 s`), removing the `0.35 * drive` wage floor so `bidOut` cools to `0` at `occ >= 1`.
  - Size `townWaitPool(i)` from `pop * LABOR_PER_POP * TOWN_POOL_BASE + workLoad[i] * TOWN_POOL_TRANSIT` with `WAIT_POOL_OVERFLOW` (`1.6×`) admission headroom; raise `townRestTax`, `townEffectiveMult`, and `adaptTownTax` with wait-pool excess and `pop > 0.8 * POP_MAX` fullness; drop `popRoom` from `townHomeBid`.
- `prototype/price-model-b2/gold.js` (`GoldMoney`):
  - Split `payWorkers(i, amount)` proportionally across `labor[i] + depleted[i]` and apply `townEffectiveMult(i)` in `collectTax`.
- `prototype/price-model-b2/{fields.js,index.html,README.md}`:
  - Display `Pool XX%` on firms and `Wait XX%` on towns in cell tooltips and document pool pricing in the Field guide.
- `prototype/price-model-b2/worker-money.test.js`:
  - Add 5 regression tests covering monotonic pool-occupancy wage cooling & live labor overflow, wait-pool living tax surges, real-occupancy pool sizing & zero-stall shift continuity, full-vs-dying town appeal (`popRoom` fix), and multi-shift proportional wage settlement.

## Manual Verification Checklist

- Open `prototype/price-model-b2/index.html`, select **Labor**, and hover active vs surrounded mines/factories: verify `Pool %` rises and `Wage` drops when multiple towns surround one firm, reaching `0` on overflow.
- Select **Depleted**, place or crowd a town with returning workers, and verify `Wait %` and `Tax` rise together while excess depleted workers steer toward cheaper uncrowded towns and all five Field guide ledgers balance.
