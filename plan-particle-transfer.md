# Particle transfer model plan

Standalone design for the particle-based money/economy engine described in
`draft/particle_transfer_model.md` and `particle_transfer_model-LLM-thoughts.md`. It replaces the
cell-field transport of `map-money-gold.js` with Lagrangian goods and worker particles over the same
pricing, pool, rest, tax and settlement rules that `prototype/price-model-b2` already proves smooth
(51/51 tests). All numbers live in the owning source file.

## Scope

Default money economy for the map: diffused fields carry **prices and living appeal** only; all moving
goods and moving workforce are **particles** with explicit ownership, per-particle cost basis, spoilage,
transport cost and carried gold. The engine ships behind the existing `mape.moneyEngine` switch
(`mapeStepMoney` in `map-economy.js`) and becomes the default once the standalone lab passes conservation
and profit-identity tests.

**Transport-substrate swap, not a rule rewrite.** `prototype/price-model-b2` runs the full rule set on a
pure cell field. Its `workforce.js` (`WorkerPolicy`) and `settlement.js` (`Settlements`) are engine-neutral
— they read only shared fields and act per cell; `land.js` (`Land`) adds the terrain/wasteland rest factor and town
site quality on the same terms. This plan applies the same classes **per particle** and
changes only the transport substrate (Eulerian field advection → Lagrangian SoA particles). New code is the
particle pool, spawn accumulators, per-particle cost/spoilage/transport accrual, arrival split and particle
rendering.

Deferred: Transport Company staffing/depot economy, road/ship overrides, return-payment leg as a visible
coin particle (initially a direct credit).

## Time model

One sim tick = `SIM_STEP_SEC = 0.05 s` (`main.js`); speeds multiply tick count, never `dt`. Every rate is
per simulation second and every update is a bounded fraction of what it applies to (see
`units-and-scales.md`): one pass per field per tick, no multipass, `D · dt ≤ MAPE_MIX_MAX`, fade with
`exp(−k · dt)`. Particles advance a bounded displacement per tick (`speed · dt`, terrain-weighted), so the
rule is identical at any particle count and never overshoots a cell.

## Fields (not conserved — diffused + faded)

- Buyer commodity bids: `priceCoal`, `priceIron`, `priceGoods`, `priceLogs`, `priceFood`.
- Firm wage bid: `priceLabor`.
- Town living appeal: `priceHome = START_PRICE · shelter(comfort) · (START_TAX_PER_POP / goldTax)` and
  `priceRest = START_PRICE · shelter(comfort)`, both positive at towns, inverse to actual gold living tax,
  fading with distance so workers pick the cheapest and nearest supplied town. No `popRoom` multiplier:
  wait-pool crowding and near-capacity fullness act through `goldTax` (`townRestTax`) instead.

Fields are computed by the same bid optimizer as B2 (`actors.js`): output value split across inputs within a
joint budget (`JOINT_BUDGET_SHARE`), cooled by owed bills (`creditCool`), suppressed to zero when input
buffers are full, profit smoothed through `tanh(profit / ref)` to drive scale and bid shares.

## Particles (conserved mass & gold — preallocated TypedArray SoA pools)

- **Goods particles:** `{ kind, x, y, vx, vy, amount, factoryCost, transportCost, owner }`
- **Worker particles:** `{ state (FRESH | DEPLETED), x, y, vx, vy, amount, gold, homeTown, intent }` — `intent` is the
  worker's settle decision in `[0, 1]` (see settlement founding); merged particles average it by `amount`.
- **Settled town residents:** stay pooled in town cell `pop[i]` (household savings `workerPurse[i]`); they
  spawn `FRESH` particles to commute up `priceLabor` and `DEPLETED` migrant particles (carrying proportional
  `workerPurse`) when a town shrinks (`deltaPop < 0`). Resident savings never attach to idle commuting
  `FRESH` particles.

`x`, `y` are continuous cell coordinates; `vx`, `vy` are the smoothed heading. Pools are fixed-capacity
typed-array SoA with a free-list; no per-tick allocation, closure or object literal in the hot path.

## Goods particle cost, transport & depletion

- **At producer spawn (`owner`):** `factoryCost` carries the exact input book cost + labor wages spent to make
  `amount` (per-particle, not a cell average). A producer launches a particle only when the local uphill price
  gradient clears `selfPrice = (factoryCost / amount) · (1 + margin)` — the cost-basis sell floor.
- **In transit:** `transportCost += haulCostRate · amount · dt` (haul effort per unit scales as `1 / conductance`).
  Perishable kinds deplete: `amount *= exp(−spoilRate · dt)` (food fast; logs/goods slowly or zero;
  coal/iron/ore do not deplete). Spoiled mass is booked in the conservation ledger:
  `produced − consumed − spoiled = stored + spawnBuffers + inParticles`.
- **Derived price, never mutated independently:** `item.price = (factoryCost + transportCost) / amount`. Both
  transport effort and spoilage shrinking `amount` raise `item.price` along the route.

## Buyer arrival, profit identity & the Transport Company

A buyer cell accepts incoming particles only up to `cap − stock`, normalized across competing requests
(mirrors B2's `receiving`/`room` admission, so a full town never over-accepts).

On arrival at a buyer with room:
1. Buyer pays `buyerPay = amount · buyerUnitPrice` from its gold purse.
2. `transportPaid = min(buyerPay, transportCost)` goes to a single map-wide **Transport Company** vault
   (carriers based across towns and facilities; a gentle dividend/wage drip back to active towns prevents
   vault hoarding until the Transport Company economy is modelled).
3. `factoryRevenue = buyerPay − transportPaid` settles to `particle.owner` (direct credit).

Exact profit identity: `profit = factoryRevenue − factoryCost = buyerPay − (factoryCost + transportCost) =
amount · (buyerUnitPrice − item.price)`. Map gold stays strictly conserved
(`−buyerPay + transportPaid + factoryRevenue = 0`).

## Underwater arrivals (`buyerUnitPrice < item.price`)

If local price drops mid-flight (a nearer supplier filled the town first):
- **Re-steer first:** if an adjacent uphill price gradient clears `item.price`, follow it toward a hungrier buyer.
- **At a buyer below `item.price`:** hold only at local price maxima (no higher neighbor); otherwise keep climbing.
  - **Non-perishables** (ore, coal, logs, durable goods) hold in consignment above their cost floor until the
    local bid recovers.
  - **Perishables (food)** sell at the current buyer spot price before rotting to zero, booking the realized
    negative profit on `owner` so the over-supplying farm/factory scales down.

## Worker cycle, pools & living tax

- **Occupancy-balanced pools smooth commute lag:** firms size an on-site fresh-worker pool from a standby shift
  base plus smoothed realized shift throughput (`workLoad[i]`, exponential blend `OCCUPANCY_RATE`); hire demand
  (`priceLabor` bid) scales as `1 − occupancy` all the way to `0` on overflow. Towns size their incoming
  `DEPLETED` wait pool from resident base plus realized returning-worker rest throughput; wait-pool crowding
  above normal turnaround (`WAIT_POOL_FREE`) and near-capacity fullness raise `townRestTax(i)` and `taxMult[i]`.
- **Cycle:** town spawns `FRESH` particles when local `priceLabor` beats the walk gate and the firm pool is below
  target; they climb `priceLabor` to firms. The firm pays real gold wages from its `purse` directly into
  `particle.gold` at the work cell — settled wages split proportionally across all on-site worker particles so
  every shift departs at full wage — and flips used particles to `DEPLETED`. `DEPLETED` particles climb
  `priceHome` to the cheapest and nearest supplied town.
- **Dominated-town release:** a town rests a worker only if no neighbor has higher home appeal
  (`!hasHigherNeighbor(priceHome)`); otherwise the worker keeps climbing instead of being trapped.
- **Paid rest & tax:** on arrival the worker pays the town's gold living/rest tax out of `particle.gold` into
  municipal `purse[town]`, banks leftover wages into `workerPurse[town]`, and rests back into town workforce.
  High-tax towns price out broke workers, pushing them toward cheaper towns.
- **Grace and shelter rest prevent stranding:** low-tax towns (`mult ≤ 1.15`) grant a small free rest share;
  towns with near-zero comfort still accept funded workers via shelter rest (banking savings, no tax). Settled
  residents pay ongoing living tax in proportion to supplied comfort and wait-pool crowding; surplus above the
  municipal reserve circulates back to residents only in healthy, uncrowded towns.
- **Town wealth class (picked from B2):** every town gets a deterministic strategy — **cheap** drops living tax
  to fill vacant slots and keeps its built size; **med** buys needs then grows; **rich** holds a cozy occupancy
  (queue ≈ 0) and cuts size first when it cannot meet resident needs.
- **Resident target shrink guards (picked from B2):** cheap/med never shed residents just for being poor (tax is
  the lever that keeps them full); they shrink slowly only when long-vacant or broke. Full housing still offers
  a rest floor; an uncrowded town rests workers better (free-space comfort lift).
- **Still-particle measure (picked from B2):** a worker's stillness derives from the local price slope (B2's
  `still` field). Still `DEPLETED` particles rest slowly for free (shelter floor) so nobody strands.

## Land rest and town site quality (B2 `land.js`)

Land shapes where workers rest and where towns spawn, so spacing is emergent rather than a hard gap rule.

- **Terrain rest pace:** a per-cell terrain table scales rest — meadow `1.1` (bonus), forest `1.0`, desert `0.45`.
  Desert grows no wood. In the game port the table keys on `world.js` terrain kinds.
- **Wasteland:** every facility (mine, factory, gold mine) spoils a cone around it: `waste = 0.7 · (1 − d / 4)`;
  `rest = terrainRest · (1 − waste)`. In the game port wasteland is `land.js` disturbed fraction.
- **Town claim:** every town claims a cone `claim = 1 − d / 7`; `site = rest · (1 − claim)`, `0` on any actor cell.
- **Where rest applies:** town rest speed and home appeal (`Settlements.restFactor = tierLerp · land.rest`) and the
  free shelter rest of still workers (`WorkerPolicy.restStill`). A town on wasteland or desert rests slower and
  draws fewer workers; a still worker in the desert stays tired longer.
- **Event-stamped, never per tick:** waste and claim are recomputed only when an actor is placed, removed or
  founded (`Land.refresh`), so the per-tick cost is zero.

## Settlement founding from settle intent

Penniless still workers found a new low-tier settlement where no town home field reaches them. The founding count
is written by the workers themselves into a gather grid, so founding never rescans the map or a radius per cell.

- **Settle intent (per worker):** `DEPLETED` workers raise `intent` at `(2 · goal − 1) / 3 s` with
  `goal = still · max(0, 1 − (priceHome + priceRest) / 0.25)` and `0` on actor cells — about 3 s standing still
  beyond every town's reach decides a worker; moving or catching a home signal forgets at the same pace. Particles
  carry it as a float; the cell engine carries it as a mass-mixed companion of the depleted stock
  (`depletedFlow.intent`, moved as `intent · amount` and re-averaged on arrival), so removals need no hooks.
- **Pledge write:** a worker at `intent = 1` adds its `amount` to `gather` over radius 2 around its position. Each
  written cell's count only grows within a tick, so the best site (`gather · land.site`, empty cells only) is
  tracked at write time. The grid is cleared only after a tick that had pledges.
- **Threshold & cooldown:** found at the best site when `gather · site > 0.35`, at most once per 5 s so a new
  settlement's home field spreads and its claim lands before the next one. Desert, wasteland and other towns' land
  lower `site`, so the same settlers found on meadow away from facilities, and need far more people elsewhere.
- **Conversion:** gathered workers within radius 2 become residents via the migrant rate (`0.2 / LABOR_PER_POP`),
  capped at the tier pop cap; they bring their carried savings — no vault gold is minted, so the young town starts
  broke and lives on tax. Only `DEPLETED` counts (fresh labor queueing at a full firm is waiting for work, not
  homeless). Founding stamps the new town's claim immediately.
- **Young-town build:** a settlement under the wood tier cap builds from its own forest (idle residents fell
  nearby wood) before bought comfort lifts the tier; tier floors scale rest, tax, bids and housing. Founding
  assigns the deterministic wealth class of its cell.

## Spawn accumulators & particle sizing

- Do not spawn dust particles (`< SPAWN_UNIT`). Each producer/town cell accumulates float
  `(spawnAmount[i], spawnCost[i])` until `spawnAmount[i] ≥ SPAWN_UNIT`, then emits one combined particle carrying
  proportional cost `spawnCost[i] · (SPAWN_UNIT / spawnAmount[i])`.
- **Target batch size (64×64 map):** ~0.5–1.0 units per goods particle and ~1–2 workers per workforce particle
  (~200–800 live particles total, zero per-tick allocations).
- **Idle flush:** if a producer stops adding to `spawnAmount[i]` for ~2–3 s while it exceeds the dust floor and
  an uphill gradient exists, flush one final partial particle so depleted mines or paused plants never trap stock.
- **Particle death sweep:** when a particle's `amount` falls below the dust floor (`≤ 1e-12`), sweep its carried
  gold to the owning purse (`workerPurse` at towns, seller coin stream elsewhere) rather than zeroing it, so
  machine-precision gold conservation holds (mirrors B2's `money.orphan`).

## Steering & movement

- Particles steer by a smoothed price-gradient heading (`STEERING_BLEND = dt / (0.18 + dt)` exponential blend of
  `headX/headY`), not the raw per-tick gradient, to avoid jitter.
- Movement gates on `GRADIENT_KNEE`: slopes below the knee do not move, so flat fields hold particles in place.
- Speed is terrain-weighted (edge conductance, harmonic mean of endpoint speeds); haul effort per unit scales as
  `1 / conductance`. Direction shares use the unweighted gradient sum `g·c / (Σg + ref)` so uniformly slow ground
  keeps its pace.
- Buyer holds apply only at local price maxima; otherwise particles keep climbing toward higher bids.

## Rendering

- In item map views, render live particles in continuous canvas coordinates above dimmed terrain + site storage:
  - `item.price` (`totalCost / amount`) → color ramp (cheap to dear).
  - `amount` → light/brightness and dot radius.
- `Land` view: land rest (terrain less wasteland) beside town site quality, with settler flow arrows.
- Paired demand/price map renders the diffused price/appeal field and equal-price contours. Stock intensity uses
  a log scale; price uses a linear scale with 1-2-5 nice-ceil steps so legends stay stable while uncapped prices
  drift.

## File layout

- **Lab:** `prototype/particle-transfer/` — standalone lab mirroring the `price-model-b2` structure so the engine
  is verified before porting: `simulation.js` (fields, diffusion, particle pool, transport), `particles.js`
  (SoA pools, spawn accumulators, steering), `actors.js` (bids, pools, tax — lifted from B2), `workforce.js`
  (`WorkerPolicy`, reused from B2), `land.js` (`Land`, reused from B2), `settlement.js` (`Settlements`, reused
  from B2), `gold.js` (conserved gold,
  Transport Company vault), `fields.js`/`telemetry.js`/`app.js`/`index.html`/`styles.css` (render + UI), and
  `*.test.js`.
- **Port target:** `map-money-gold.js` (default money economy), dispatched by `mapeStepMoney` when
  `mape.moneyEngine === 'particle'`. New code gets its own owner file + header + map entry per `AGENTS.md`; no
  junk drawers.

## Phased implementation (minimal first)

0. **Land and town spawning (in B2, before any particle work):** terrain rest table, wasteland and town-claim
   cones, carried settle intent, pledge-written gather grid and site-weighted founding. Lives in the
   engine-neutral `land.js`/`settlement.js`, so every later phase inherits clean town spawning unchanged.
1. **Goods particles only:** coal → goods chain (one mine, one factory, one town). Price diffusion, spawn
   accumulators, cost-basis sell gate, buyer room admission, arrival split with Transport Company vault. Verify
   mass and gold conservation to machine precision.
2. **Worker particles:** `FRESH`/`DEPLETED` cycle with carried gold, proportional wage settlement, rest tax,
   occupancy-balanced pools, gold-tax appeal, dominated-town release, grace/shelter rest — reusing B2's
   `WorkerPolicy`/`Settlements`/`Land` per particle — plus wealth-class tax and founding from per-particle intent
   (each particle with `intent = 1` pledges its `amount` into the same gather grid).
3. **Full engine:** multiple kinds, spoilage rates per kind, Transport Company dividend drip, particle rendering,
   64×64 sizing pass, then flip `mape.moneyEngine` default to `'particle'`.

## Validation

- **L0:** `node --check` on touched files.
- **L1:** `node --test` in the lab — conservation identities (`sum(stock) == produced − consumed − spoiled`,
  `money.total() == seeded + mined` to `< 1e-7`), profit identity (`profit == amount · (buyerUnitPrice −
  item.price)`), pool-occupancy wage cooling to zero on overflow, gold-tax appeal ordering (cheaper + nearer
  wins, inflated towns lose), dominated-town release, grace rest for penniless workers, settlement founding from
  pledged intent: same settlers found on meadow but not in desert, settlers beside a mine found on the far side,
  town claim stamped and released with the actor, intent conserved as `intent · amount` through transport.
- **L2:** full suite + manual pass list on port to the game. Run `smoke` + `dom_smoke` after touching
  `main.js`, `index.html` or load order.

## Manual verification checklist

- Open the lab and switch across `Coal`, `Goods`, `Labor`, `Depleted`, `Gold`.
- On **Gold**, verify flow runs from towns to firms (bills) and from mines/factories back to towns along worker
  return paths, and hover transit cells to inspect positive carried gold.
- Place a high-tax/isolated town beside a supplied low-tax town and verify `Depleted` particles route into the
  cheaper supplied town while all ledgers balance.
- Flood a firm with fresh workers and verify `Pool %` rises and `Wage` drops to `0` on overflow; crowd a town and
  verify `Wait %` and `Tax` rise together.
- Clear towns and verify a young town founds from gathered settlers on meadow away from mines, factories and the
  desert, builds its first tier from forest, and restarts production.
- On **Land**, hover a still crowd beyond town reach and watch `Settle intent` climb to 1 and `Gathered` appear.
