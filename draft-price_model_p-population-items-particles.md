# Draft · Price Model P: Diffused Price Fields + Item & Population Particles

Diffused fields remain solely for **prices and living appeal** (steering signals). All moving goods and moving workforce become **particles** with explicit ownership, cost basis, spoilage, and carried gold. Make this engine the default once implemented.

## 1. Fields vs Particles

- **Fields (not conserved, diffused + faded with distance):**
  - Buyer commodity bids: `priceCoal`, `priceIron`, `priceGoods`, `priceLogs`, `priceFood`.
  - Firm wage bid: `priceLabor`.
  - Town living appeal: `priceHome = START_PRICE * shelter(comfort) * popRoom * (refTax / goldTax)` — positive at towns, inverse to actual gold living tax, and fading with distance so workers naturally pick the **cheapest and nearest** supplied town.
- **Particles (conserved mass & gold, preallocated TypedArray SoA pools):**
  - **Goods particles:** `{ kind, x, y, vx, vy, amount, factoryCost, transportCost, owner }`
  - **Worker particles:** `{ state (FRESH | DEPLETED), x, y, vx, vy, amount, gold, homeTown }`
  - **Settled town residents:** remain in town cell `pop[i]` (with household savings `workerPurse[i]`), spawning `FRESH` particles to commute up `priceLabor` and `DEPLETED` migrant particles (carrying proportional `workerPurse`) when a town shrinks (`deltaPop < 0`).

## 2. Goods Particle Cost, Transport & Depletion

- **At producer spawn (`owner`):**
  - `factoryCost` carries the exact input book cost + labor wages spent to make `amount`.
  - Producers only launch a particle when the local uphill price gradient clears `selfPrice = (factoryCost / amount) * (1 + margin)`.
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
- **At a buyer cell below `item.price`:**
  - **Non-perishable items** (ore, coal, logs, durable goods) hold in consignment above their cost floor until local bid recovers.
  - **Perishable items (food)** sell at current buyer spot price before rotting to zero, booking the realized negative profit on `owner` so the over-supplying farm/factory scales down.

## 5. Worker Particle Cycle & Living Tax

- Town spawns `FRESH` worker particles when local `priceLabor` beats the walk gate; they climb `priceLabor` to firms.
- Firm uses `FRESH` labor, pays real gold wages from firm `purse` directly into `particle.gold`, and flips the particle to `DEPLETED`.
- `DEPLETED` particles climb `priceHome` to the cheapest and nearest supplied town.
- On arrival, the worker pays the town's gold living/rest tax out of `particle.gold` into municipal `purse[town]`, banks leftover wages into `workerPurse[town]`, and rests back into town workforce. High-tax towns price out broke workers, pushing them toward cheaper towns.

## 6. Spawn Accumulators & Particle Sizing

- Do not spawn dust particles (`< SPAWN_UNIT`). Each producer/town cell accumulates float `(spawnAmount[i], spawnCost[i])` until `spawnAmount[i] >= SPAWN_UNIT`, then emits one combined particle carrying proportional cost `spawnCost[i] * (SPAWN_UNIT / spawnAmount[i])`.
- **Target batch size (64×64 map):** `~0.5–1.0` units per goods particle and `~1–2` workers per workforce particle (~200–800 live particles total, zero per-tick allocations in SoA typed arrays).
- **Idle flush:** if a producer stops adding to `spawnAmount[i]` for `~2–3 s` while `spawnAmount[i]` exceeds dust floor and an uphill gradient exists, flush one final partial particle so depleted mines or paused plants never trap stock permanently.

## 7. Rendering

- In item map views, render live particles in continuous canvas coordinates (above dimmed terrain + site storage):
  - **`item.price` (`totalCost / amount`) → color ramp** (cheap to dear).
  - **`amount` → light / brightness & dot radius**.
- Paired demand/price map renders the diffused price/appeal field and equal-price contours.

## 8. Open Details for Later Iteration

- **Transport Company economy:** how the single map-wide Transport Company staffs depots in towns/facilities, sets carrier wages, or scales `haulCostRate` with congestion/fuel.
- **Return payment leg:** whether `factoryRevenue` settles to `particle.owner` immediately vs traveling back as a visible gold/coin particle.
