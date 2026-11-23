# Universal Profit-Adapting Actors and Workforce Migration Plan

## Goal

Replace factory spot-price pausing with a universal profit-adapting mechanism across mines, factories, gold mines, and towns in `prototype/price-model-b/`. Actors adapt both buy and sell prices to stay in profit, never sell stocked output at a loss, expand workforce demand or lower town living tax when profitable, and cut worker pay or raise town living tax when losing money or undersupplied so depleted workforces migrate elsewhere.

## Architecture & Touched Files

- `prototype/price-model-b/simulation.js` (`PriceEconomy`, `makeScratch`, `clearScratch`, `PriceEconomy.prototype.{updatePrices,transport,planOutflow,acceptTransfers,unitCostAt,sellPrice}`):
  - Own conserved stock fields (`coal`, `goods`, `labor`, `depleted`), diffused steering fields (`priceCoal`, `priceGoods`, `priceLabor`, `priceHome`), and per-cell `scale` and `taxMult`.
  - Track book cost `scratch.cost[i]` on arrival (`bought * price[i]`) and deduct proportional cost of goods sold in `acceptTransfers`, booking realized profit `(revenue - cogs) / ECONOMY_DT` only when stock actually ships above `scratch.sell[i]`.
  - Keep `scratch.sell[i]` out of `updatePrices` so seller cost floors gate `planOutflow` (`price[to] > Math.max(price[i], scratch.sell[i])`) without creating false uphill demand peaks.
- `prototype/price-model-b/actors.js` (`ActorOptimizer`, `optimalBid`):
  - Express `ECONOMY_MINE`, `ECONOMY_FACTORY`, and `ECONOMY_GOLD` through one recipe table (`this.recipes`) and `firmBids`, normalizing multi-input bids within `JOINT_BUDGET_SHARE` (`0.78`) and holding a profit-driven wage floor (`0.35 * drive`) so staffed profitable firms sustain worker pay.
  - Remove the spot-margin pause in `stepFirm`: always convert owned inputs, carry consumed `cost[i]` into output `cost[i]`, and set `sell[i] = unitCost * (1 + SELL_MARGIN)`.
  - Adapt firm `scale[i]` (`SCALE_MIN = 0.35` to `SCALE_MAX = 1.55`) in `adaptFirmScale` and town `taxMult[i]` (`TAX_MIN = 0.55` to `TAX_MAX = 2.2`) in `adaptTownTax` against actual consumed ration cost.
  - Emit conserved `depleted` workforce when labor works in `stepFirm` or when a shrinking town loses population in `stepTown`; transport `depleted` with light dispersion (`DEPLETED_SPREAD`) plus uphill advection on `priceHome` (`townHomeBid`), resting arrivals back into `labor` at supplied towns.
- `prototype/price-model-b/gold.js` (`GoldMoney.prototype.{taxPerPop,collectTax,payFirmSurplus,updateAsks}`):
  - Scale town tax rate by `taxMult[i]`, gate `civic` treasury rebates on `comfort > 0.4 && mult <= 1.1` so high-tax unsupplied towns cannot self-recycle worker purses into fake profit, scale firm surplus reserves with `scale[i]`, and weight `PAY_WAGE` town asks by `1 / taxMult[i]`.
- `prototype/price-model-b/{fields.js,telemetry.js,app.js,index.html,styles.css,README.md}`:
  - Load `actors.js`, add the `Depleted` view (`depleted` stock/vectors + `priceHome` appeal), show `Scale`, `Ask`, `Tax`, and `Depl` in cell tooltips and ledger, and style `.presets button[aria-pressed=true]`.
- `prototype/price-model-b/simulation.test.js`:
  - Enforce `depleted` conservation (`sum(depleted) === emittedDepleted - restedDepleted`) in `checkLedger` and add regression tests for non-paused conversion + cost-basis sell floor, profit/loss wage and scale adaptation, and town tax adaptation + `depleted` migration.

## Verification

1. Syntax check all scripts with `node --check`.
2. Run `node --test prototype/price-model-b/simulation.test.js` (all 28 tests passing, exact coal, goods, labor, depleted, and gold conservation).
3. Run a full DOM/canvas script-order smoke test loading `simulation.js`, `actors.js`, `gold.js`, `fields.js`, `telemetry.js`, and `app.js` and switching all five resource views.
