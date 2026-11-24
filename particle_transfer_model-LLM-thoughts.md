# Particle Transfer Model: Diffused Price Fields + Item & Population Particles

Diffused fields remain solely for **prices and living appeal** (steering signals). All moving goods and moving workforce become **particles** with explicit ownership, cost basis, spoilage, and carried gold. Make this engine the default once implemented.

## 1. Fields vs Particles

- **Fields (not conserved, diffused + faded with distance):**
  - Buyer commodity bids: `priceCoal`, `priceIron`, `priceGoods`, `priceLogs`, `priceFood`.
  - Firm wage bid: `priceLabor`.
  - Town living appeal: `priceHome = START_PRICE * shelter(comfort) * (START_TAX_PER_POP / goldTax)` — positive at towns, inverse to actual gold living tax, and fading with distance so workers naturally pick the **cheapest and nearest** supplied town. No `popRoom` multiplier: wait-pool crowding and near-capacity fullness act through `goldTax` (`townRestTax`) instead, so full healthy towns stay reachable to their own commuters while surplus migrants are priced toward cheaper, uncrowded towns.
- **Particles (conserved mass & gold, preallocated TypedArray SoA pools):**
  - **Goods particles:** `{ kind, x, y, vx, vy, amount, factoryCost, transportCost, owner }`
  - **Worker particles:** `{ state (FRESH | DEPLETED), x, y, vx, vy, amount, gold, homeTown }`
  - **Settled town residents:** remain in town cell `pop[i]` (with household savings `workerPurse[i]`), spawning `FRESH` particles to commute up `priceLabor` and `DEPLETED` migrant particles (carrying proportional `workerPurse`) when a town shrinks (`deltaPop < 0`). Resident savings never attach to idle commuting `FRESH` particles; they leave only with emigrating `DEPLETED` particles.

## 2. Goods Particle Cost, Transport & Depletion

- **At producer spawn (`owner`):**
  - `factoryCost` carries the exact input book cost + labor wages spent to make `amount` (per-particle, not per-cell average).
  - Producers only launch a particle when the local uphill price gradient clears `selfPrice = (factoryCost / amount) * (1 + margin)`.
  - Firm bids that inject the price fields split output value across inputs within a joint budget (`JOINT_BUDGET_SHARE`), cooled by owed bills (`creditCool`), and suppressed to zero when input buffers are full (`need = 1 - stock / target`). Profit smooths through `tanh(profit / ref)` to drive scale and bid shares without oscillation.
- **In transit (moving up the item's `price` gradient at terrain-weighted speed):**
  - `transportCost` accrues with travel distance/effort (`transportCost += haulCostRate * amount * dt`).
  - Perishable items deplete with time (`amount *= exp(-spoilRate * dt)`: food depletes faster; logs/goods slowly or zero; coal/iron/ore do not deplete). Spoiled mass is recorded in the conservation ledger (`produced - consumed - spoiled = stored + spawnBuffers + inParticles`).
  - Instantaneous unit price is derived, never mutated independently:
    `item.price = (factoryCost + transportCost) / amount`
    Both transport effort and spoilage shrinking `amount` raise `item.price` along the route.

## 3. Buyer Arrival, Factory Profit & the Map-Wide Transport Company

Because diffused buyer bids fade with distance from buyer to producer, a viable route's buyer price `buyerUnitPrice` sits above the producer's doorstep price by the spatial fade spread.

When a particle arrives at a buyer with storage room:
- Buyer pays `buyerPay = amount * buyerUnitPrice` from its gold purse.
- **Conserved gold split:**
  1. `transportPaid = min(buyerPay, transportCost)` goes to a **single map-wide Transport Company** vault (representing carriers based across towns and facilities; later iteration will let the Transport Company hire/pay workers in towns and facilities or fund roads, and until then a gentle dividend/wage drip back to active towns prevents vault hoarding).
  2. `factoryRevenue = buyerPay - transportPaid` settles back to `particle.owner` (direct credit or return coin particle).
- **Exact factory profit identity:**
  `profit = factoryRevenue - factoryCost = buyerPay - (factoryCost + transportCost) = amount * (buyerUnitPrice - item.price)`
  The difference between `buyerUnitPrice` and delivered `item.price` is the exact realized profit (or loss) driving `owner`'s scale and input-bid adaptation, while total map gold stays strictly conserved (`-buyerPay + transportPaid + factoryRevenue = 0`).

## 4. Underwater Arrivals (`buyerUnitPrice < item.price`)

If local market price drops while a particle is mid-flight (e.g. a nearer supplier filled the town first):
- **Re-steer first:** if an adjacent uphill price gradient clears `item.price`, follow it toward a hungrier buyer.
- **At a buyer cell below `item.price`:** hold only at local price maxima (no higher neighbor). Otherwise keep climbing.
  - **Non-perishable items** (ore, coal, logs, durable goods) hold in consignment above their cost floor until local bid recovers.
  - **Perishable items (food)** sell at current buyer spot price before rotting to zero, booking the realized negative profit on `owner` so the over-supplying farm/factory scales down.

## 5. Worker Particle Cycle, Pools & Living Tax

- **Occupancy-balanced pools smooth commute lag:**
  - Firms maintain an on-site fresh-worker pool sized from a standby shift base plus smoothed realized shift throughput (`workLoad[i]`, exponential blend `OCCUPANCY_RATE`). Hire demand (`priceLabor` bid) scales as `1 - occupancy` all the way to `0` on overflow, lowering wages when fresh workers flood a site while sustaining unbroken shifts across commute round-trips.
  - Towns size their incoming `DEPLETED` wait pool from resident base plus realized returning-worker rest throughput. Wait-pool crowding above normal turnaround (`WAIT_POOL_FREE`) and near-capacity fullness raise `townRestTax(i)` and `taxMult[i]`, steering excess migrants toward cheaper, uncrowded towns.
- **Cycle:**
  - Town spawns `FRESH` worker particles when local `priceLabor` beats the walk gate and the firm pool is below target; they climb `priceLabor` to firms.
  - Firm uses `FRESH` labor, pays real gold wages from firm `purse` directly into `particle.gold` at the work cell — settled wages split proportionally across all on-site worker particles (`FRESH` pool + shift workers) so every shift departs at full wage — and flips used particles to `DEPLETED`.
  - `DEPLETED` particles climb `priceHome` to the cheapest and nearest supplied town. At a town cell they rest only if no higher `priceHome` neighbor exists (dominated towns release workers toward higher appeal instead of trapping them).
  - On arrival, the worker pays the town's gold living/rest tax out of `particle.gold` into municipal `purse[town]`, banks leftover wages into `workerPurse[town]`, and rests back into town workforce. High-tax towns price out broke workers, pushing them toward cheaper towns.
  - **Grace and shelter rest prevent stranding:** low-tax towns (`mult <= 1.15`) grant a small free rest share; towns with near-zero comfort still accept funded workers via shelter rest (banking savings, no tax) so penniless workers are never locked out of all towns. Settled residents pay ongoing living tax in proportion to supplied comfort and wait-pool crowding; surplus above the municipal reserve circulates back to residents only in healthy, uncrowded towns.
  - Town tax adapts from profit drive, comfort, ration cost, wait-pool excess and population fullness, so profitable supplied towns lower living tax while struggling towns raise it and shed migrants.

## 6. Spawn Accumulators & Particle Sizing

- Do not spawn dust particles (`< SPAWN_UNIT`). Each producer/town cell accumulates float `(spawnAmount[i], spawnCost[i])` until `spawnAmount[i] >= SPAWN_UNIT`, then emits one combined particle carrying proportional cost `spawnCost[i] * (SPAWN_UNIT / spawnAmount[i])`.
- **Target batch size (64×64 map):** `~0.5–1.0` units per goods particle and `~1–2` workers per workforce particle (~200–800 live particles total, zero per-tick allocations in SoA typed arrays).
- **Idle flush:** if a producer stops adding to `spawnAmount[i]` for `~2–3 s` while `spawnAmount[i]` exceeds dust floor and an uphill gradient exists, flush one final partial particle so depleted mines or paused plants never trap stock permanently.
- **Particle death sweep:** when a particle's `amount` falls below dust floor (or `<= 1e-12`), sweep its carried gold to the owning purse (`workerPurse` at towns, seller coin stream elsewhere) rather than zeroing it, so machine-precision gold conservation holds.

## 7. Steering & Movement

- Particles steer by smoothed price-gradient heading (`STEERING_BLEND = dt / (0.18 + dt)` exponential blend of `headX/headY`), not raw per-tick gradient, to avoid jitter.
- Movement gates on `GRADIENT_KNEE`: slopes below the knee do not move, so flat fields hold particles in place.
- Speed is terrain-weighted (edge conductance, harmonic mean of endpoint speeds); haul effort per unit scales as `1 / conductance`.
- Buyer holds apply only at local price maxima; otherwise particles keep climbing toward higher bids.

## 8. Rendering

- In item map views, render live particles in continuous canvas coordinates (above dimmed terrain + site storage):
  - **`item.price` (`totalCost / amount`) → color ramp** (cheap to dear, `PRICE_COLORS` palette).
  - **`amount` → light / brightness & dot radius**.
- Paired demand/price map renders the diffused price/appeal field and equal-price contours. Stock intensity uses log scale; price uses linear scale with 1-2-5 nice-ceil steps so legends stay stable while uncapped prices drift.

## 9. File Layout

- `prototype/particle-transfer/` — standalone lab (fields, particles, actors, gold, renderer, tests), mirroring the price-model lab structure so the engine can be verified before porting.
- Port target: `map-money-gold.js` (default money economy) once the lab passes conservation and profit-identity tests. New code gets its own owner file + header + map entry per `AGENTS.md`; no junk drawers.

## 10. Phased Implementation

Minimal first, one resource cycle at a time:

1. **Goods particles only:** coal → goods chain (one mine, one factory, one town). Price diffusion, spawn accumulators, cost-basis sell gate, arrival split with Transport Company vault. Verify mass and gold conservation to machine precision.
2. **Worker particles:** `FRESH`/`DEPLETED` cycle with carried gold, proportional wage settlement, rest tax, occupancy-balanced pools, gold-tax appeal, dominated-town release, grace/shelter rest.
3. **Full engine:** multiple kinds, spoilage rates per kind, Transport Company dividend drip, particle rendering, 64×64 sizing pass.

## 11. Validation

- **L0:** `node --check` on touched files.
- **L1:** `node --test` in the lab — conservation identities (`sum(stock) == produced - consumed - spoiled`, `money.total() == seeded + mined` to `< 1e-7`), profit identity (`profit == amount * (buyerUnitPrice - item.price)`), pool-occupancy wage cooling to zero on overflow, gold-tax appeal ordering (cheaper + nearer wins, inflated towns lose), dominated-town release, grace rest for penniless workers.
- **L2:** full suite + manual pass list on port to the game.

## 12. Manual Verification Checklist

- Open the lab and switch across `Coal`, `Goods`, `Labor`, `Depleted`, `Gold`.
- On **Gold**, verify flow runs from towns to firms (bills) and from mines/factories back to towns along worker return paths, and hover transit cells to inspect positive carried gold.
- Place a high-tax/isolated town beside a supplied low-tax town and verify `Depleted` particles route into the cheaper supplied town while all ledgers balance.
- Flood a firm with fresh workers and verify `Pool %` rises and `Wage` drops to `0` on overflow; crowd a town and verify `Wait %` and `Tax` rise together.

## 13. Open Details for Later Iteration

- **Transport Company economy:** how the single map-wide Transport Company staffs depots in towns/facilities, sets carrier wages, or scales `haulCostRate` with congestion/fuel.
- **Return payment leg:** whether `factoryRevenue` settles to `particle.owner` immediately vs traveling back as a visible gold/coin particle.
- **Terrain conductance:** edge speed map (meadow/desert/forest/hills/swamp/water) and road/ship overrides.
- **64×64 sizing:** `SPAWN_UNIT` per kind tuned to keep live particles in the 200–800 band at full map scale.
