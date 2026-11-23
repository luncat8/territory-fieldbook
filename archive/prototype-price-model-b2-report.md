### 1. Audit of `prototype/price-model-b` (and Main Game)

- **Did workers actually have money in `price-model-b`? Only on town cells — not in transit.**
  - Moving `labor` and `depleted` fields carried **0 gold**. Resident savings (`workerPurse[i]`) stayed pinned to town cells while firms paid wages into a separate `PAY_WAGE` coin stream climbing a diffused town `ask` field. A bystander town could siphon wages without workers physically returning there, and migrating `depleted` workers left with empty pockets.
- **Did `price-model-b` have real living-tax / distance trade-offs?**
  - Partially, with two bugs: `townHomeBid(i)` divided by dimensionless `taxMult^2` and multiplied by local `workerPurse` affordability (`afford`), making **inflated high-gold-tax towns** near a gold mine look more attractive than genuinely cheap towns; and `stepTown` skipped resting whenever `profit[i] < -0.03`, creating a catch-22 where a town needing taxpayers couldn't rest returning workers to tax them.
- **What already held in `price-model-b` (and is preserved in `B2`):**
  - **Finite demand even at price `0`:** town coal and goods uptake is capped by `popScale * NEED * dt`, and buffer suppression cools bids smoothly down to `0`.
  - **Never selling stocked output at a loss:** factory conversion carries input book cost + labor wages into `cost[i]`, enforcing `sellPrice(i) = (cost[i] / stock) * (1 + FIRM_MARGIN)` before output departs.
  - **Profit-driven scale & price adaptation:** mines, factories, gold mines, and towns all adapt scale, wages/buy bids, and living taxes from realized `profit[i]`.
- **Main-game note (left untouched per scope):** `map-money-gold.js` currently has `mapeGold.taxes === 0` forever (no `collectTax`), initializes `GOLD_NEIGHBORS` before `main.setup()`, and `experiments/mape_money.js` throws `ReferenceError: MAPE_MINT_POP is not defined`; sawmills/wood/farms also share generic `actor = 2`.

---

### 2. Built Standalone `prototype/price-model-b2/` (Live Preview Running)

`prototype/price-model-b/` is untouched (`28/28` tests passing). The new `prototype/price-model-b2/` (`34/34` tests passing across `simulation.test.js` and `worker-money.test.js`) implements worker-carried gold in the pure cell-field model:

- **Companion worker-gold fields (`simulation.js`, `gold.js`):**
  - `laborFlow.gold` and `depletedFlow.gold` advect proportionally with `labor` and `depleted` on every accepted cell-to-cell transfer (`goldMoved = gold[from] * (amount / stock)`), with subnormal remainder dust (`stock <= 1e-12`) swept via `money.orphan` so `money.total() === seeded + mined` holds to `< 1e-7`.
  - Firms pay settled wages and profit bonuses directly into on-site workers' wallets (`depletedFlow.gold[i]` / `laborFlow.gold[i]`) via `payWorkers`, eliminating bystander-town `PAY_WAGE` siphoning.
- **Paid town rest & migrant savings (`actors.js`):**
  - `restWorkers(i, comfort, workCap)` charges the town's gold rest fee (`townRestTax(i) * REST_TAX_SHARE`) out of `depletedFlow.gold[i]` into municipal `purse[i]` and deposits leftover earnings into `workerPurse[i]`. High-tax towns (`taxMult > 1.15`) price out penniless `depleted` workers, while supplied towns temporarily in negative profit still accept funded workers and recover via tax revenue.
  - Resident savings stay in `workerPurse[i]` during ordinary commuting (avoiding cash bleed into idle `labor` rings) and attach proportionally to departing `depletedFlow.gold[i]` when a town shrinks (`deltaPop < 0`).
- **Cheapest + nearest town gradient (`actors.js`, `simulation.js`):**
  - `townHomeBid(i) = START_PRICE * shelter * popRoom * (START_TAX_PER_POP / townRestTax(i))` scales appeal to `START_PRICE` (clearing `GRADIENT_KNEE`) and divides by **actual gold tax** rather than relative `taxMult`, fading with distance (`PRICE_DECAY`) so workers migrate to the cheapest and nearest supplied town. Dominated towns release `depleted` holds when `hasHigherNeighbor(priceHome, i)` is true.
- **UI & telemetry (`fields.js`, `telemetry.js`, `app.js`, `index.html`):**
  - **Gold** flow vectors combine seller payment streams with carried worker-wallet flux; cell tooltips display `Tax` in gold plus `Carried` / `WorkerPay`, and the Field guide ledger tracks in-transit worker gold (`worker-carried`).

---

### 3. Refined `draft-price_model_p-population-items-particles.md`

Updated `draft-price_model_p-population-items-particles.md` (opened in the viewer) with the agreed particle-engine rules:
- **Diffused fields strictly for prices & appeal**; preallocated TypedArray SoA pools for **goods particles** `(kind, x, y, vx, vy, amount, factoryCost, transportCost, owner)` and **worker particles** `(state, x, y, vx, vy, amount, gold, homeTown)`, keeping settled residents pooled in town `pop[i]` (`workerPurse[i]`).
- **Derived unit price with transport & spoilage:** `transportCost` accrues with distance/effort while perishable `amount` decays (`spoiled` tracked in ledger), giving `item.price = (factoryCost + transportCost) / amount`.
- **Closed gold split via a single map-wide Transport Company:** on arrival, buyer pays `buyerPay = amount * buyerUnitPrice`; the **Transport Company** receives `min(buyerPay, transportCost)` and `particle.owner` receives the remainder, yielding exact factory profit `buyerPay - (factoryCost + transportCost) = amount * (buyerUnitPrice - item.price)` with zero gold leak.
- **Underwater arrivals & spawn accumulators:** re-steer first if a better neighbor bid clears `item.price`; otherwise hold non-perishables above cost floor in consignment and spot-sell spoiling food (booking the loss on `owner`). Cell `(spawnAmount, spawnCost)` accumulators batch spawns to `SPAWN_UNIT` with an idle-timeout flush.