# 06 · Price Model B2: Companion Worker-Gold Fields, Paid Rest & Gold-Tax Appeal

## Goal

Close the worker-money and living-tax gradient gaps from `price-model-b` in a standalone `prototype/price-model-b2/` sandbox using a canonical pure-cell Eulerian formulation:

1. **Workers carry real conserved gold (`laborFlow.gold`, `depletedFlow.gold`).** Active firms pay wages and profit bonuses directly into workers' pockets at the work cell rather than into an abstract town-ask coin stream, and workforce transport advects carried gold in exact proportion to moving worker fractions.
2. **Workers pay gold to live and rest in towns.** Resting `depleted -> labor` charges the town's gold rest fee from `depletedFlow.gold` into municipal `purse[i]` and banks leftover earnings into `workerPurse[i]`. High-tax towns price out penniless workers, and shrinking towns (`deltaPop < 0`) send proportional `workerPurse` savings out with departing migrants.
3. **Diffused `priceHome` steers workers to the cheapest and nearest town.** Towns inject living appeal `START_PRICE * shelter(comfort) * popRoom * (START_TAX_PER_POP / goldTax)` using actual gold living tax `townRestTax(i)` rather than relative `taxMult`, trading off lower gold tax against distance decay without favoring inflated gold-mine towns or stranding workers in empty wilderness.

## Architecture & Files

- `prototype/price-model-b2/simulation.js` (`PriceEconomy`, `makeScratch`):
  - Add companion `gold` and `deltaGold` `Float64Array`s to `laborFlow` and `depletedFlow`, advecting `goldHere * (amount / stock)` across edges in `acceptTransfers` and sweeping subnormal (`<= 1e-12`) remainder dust into `GoldMoney.orphan` so gold conservation stays exact.
  - Allow `depleted` on dominated towns (`hasHigherNeighbor(priceHome, i)`) to flow out toward higher-appeal neighbors instead of trapping migrants on unsupplied or high-tax town cells.
- `prototype/price-model-b2/actors.js` (`ActorOptimizer`):
  - Transfer commuting `laborFlow.gold` into `depletedFlow.gold` on shift completion in `stepFirm` and bound labor draw by `1 - depleted[i]` so `workedLabor === emittedDepleted`.
  - Compute `townRestTax(i) = Math.max(START_TAX_PER_POP * taxMult[i], townTaxRate(i))` and `townHomeBid(i)` inversely proportional to `townRestTax(i)` on the `START_PRICE` scale so slope clears `GRADIENT_KNEE`.
  - Implement `restWorkers(i, comfort, workCap)` to charge gold rest tax on `depleted -> labor` conversion (without deadlocking supplied towns temporarily in negative profit) and attach proportional `workerPurse` savings when `deltaPop < 0` sheds migrants.
- `prototype/price-model-b2/gold.js` (`GoldMoney`):
  - Include `model.workerGoldAt(i)` in `held(i)`, `taxPerPop(i)`, and reserve sizing; route firm wage settlements and surplus payouts through `payWorkers(i, amount)` directly into `depletedFlow.gold[i]` / `laborFlow.gold[i]`.
- `prototype/price-model-b2/{fields.js,telemetry.js,app.js,index.html,styles.css,README.md}`:
  - Combine seller coin streams with carried worker-gold flux on the `Gold` flow overlay, display `Tax` in gold, `Carried` / `WorkerPay` wallets in cell tooltips, and report in-transit worker gold in the Field guide ledger.
- `prototype/price-model-b2/{simulation.test.js,worker-money.test.js}`:
  - 34 regression tests (28 core + 6 worker-wallet/tax-gradient tests) covering coal, goods, labor, depleted, and gold conservation plus carried worker wages, paid rest gating, distance-vs-gold-tax appeal, anti-siphon firm payouts, migrant savings, and negative-profit town recovery.

## Manual Verification Checklist

- Open `prototype/price-model-b2/index.html` and switch across `Coal`, `Goods`, `Labor`, `Depleted`, and `Gold`.
- On **Gold**, verify flow arrows run both from towns to firms (bills) and from mines/factories/gold mines back to towns along worker return paths, and hover transit cells to inspect positive `WorkerPay`.
- Place a high-tax/isolated town beside a supplied low-tax town and verify **Depleted** vectors and carried worker gold route into the cheaper supplied town while all five Field guide ledgers balance.
