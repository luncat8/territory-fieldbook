# Particle transfer model plan

Standalone design for the particle-based money/economy engine described in
`draft/particle_transfer_model.md` and `particle_transfer_model-LLM-thoughts.md`. It replaces the
cell-field transport of `map-money-gold.js` with Lagrangian goods and worker particles over the shared
pricing, pool, rest, tax and settlement rules of `prototype/price-model-b2`. All numbers live in the
owning source file.

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
  fading with distance so workers pick the cheapest and nearest supplied town. Full **housing** raises the
  living tax (`townCrowdMult` on occupancy); towns hold no wait pool, so a pile of waiting workers never
  taxes the residents.

Fields are computed by the same bid optimizer as B2 (`actors.js`): output value split across inputs within a
joint budget (`JOINT_BUDGET_SHARE`), cooled by owed bills (`creditCool`), suppressed to zero when input
buffers are full, profit smoothed through `tanh(profit / ref)` to drive scale and bid shares.

## Particles (conserved mass & gold — preallocated TypedArray SoA pools)

- **Goods particles:** `{ kind, x, y, vx, vy, amount, factoryCost, transportCost, owner }`
- **Worker particles:** `{ state (FRESH | DEPLETED), x, y, vx, vy, amount, tired, gold, intent }` — `amount` is fixed for a worker; `tired` is its depleted portion in `[0, amount]`. `intent` is the
  worker's settle decision in `[0, 1]` (see settlement founding); docking and arrival average it by `amount`.
- **Docked worker stocks:** `labor[i]` / `depleted[i]` with their cell gold and intent are the worker pools and
  the worker spawn accumulators: a firm's fresh pool and still workers resting where they stand. Towns hold no
  pool of their own. Worker particles are **persistent objects**: a docked worker is parked at its cell (not drawn)
  and keeps its `gold` and `intent` until it leaves by gradient. A worker never vanishes when docked.
- **Town residents are a measure, not a roster:** `pop[i]` is a derived resident count — town cells only, blended
  toward `(labor + depleted) / LABOR_PER_POP` — rounded only for display. Nobody spawns, despawns, grows or sheds
  from it. Setup seeds the reference town's residents; a placed town opens empty and fills by workers moving in.
  Resident savings live in `workerPurse[i]` and never attach to idle commuting `FRESH` particles.
- **Where new workers come from:** only worker particles multiply — a fed, comfortable, solvent worker splits in
  two at his home town (below). The worker tool mints one for inspection; tests `emitFrom` stocks; founding
  gathers existing workers. Nothing else creates or destroys people.

`x`, `y` are continuous cell coordinates; `vx`, `vy` are the smoothed heading. Pools are fixed-capacity
typed-array SoA compacted by swap-remove; no per-tick allocation, closure or object literal in the hot path.

## Goods particle cost, transport & depletion

- **At producer spawn (`owner`):** `factoryCost` carries the exact input book cost + labor wages spent to make
  `amount` (per-particle, not a cell average). A producer launches a particle only when the local uphill price
  gradient clears `selfPrice = (factoryCost / amount) · (1 + margin)` — the cost-basis sell floor.
- **In transit:** `transportCost` accrues with distance hauled (`(haulCostRate / speed) · (ds / conductance) · amount`,
  equivalent to `haulCostRate · amount · dt` at full pace and `0` while held stationary in consignment).
  Perishable kinds deplete: `amount *= exp(−spoilRate · dt)` (food fast; logs/goods slowly or zero;
  coal/iron/ore do not deplete). Spoiled mass is booked in the conservation ledger:
  `produced − consumed − spoiled = stored + spawnBuffers + inParticles`.
- **Derived price, never mutated independently:** `item.price = (factoryCost + transportCost) / amount`. Both
  transport effort and spoilage shrinking `amount` raise `item.price` along the route.

## Buyer arrival, profit identity & the Transport Company

A buyer cell accepts incoming particles only up to `cap − stock`, normalized across competing requests
(mirrors B2's `receiving`/`room` admission, so a full town never over-accepts).

On arrival at a buyer with room:
1. Buyer owes `buyerPay = amount · buyerUnitPrice`, paying immediate cash `min(purse[buyer], buyerPay)` from its
   gold purse and booking any cold-start firm shortfall into trade-credit `owed` (cooled by `creditCool`,
   settled automatically when sales revenue arrives, so no firm seed gold is minted and `purse ≥ 0` holds).
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

- **Occupancy-balanced firm pools smooth commute lag:** firms size an on-site fresh-worker pool from a standby
  shift base plus smoothed realized shift throughput (`workLoad[i]`, exponential blend `OCCUPANCY_RATE`); hire
  demand (`priceLabor` bid) scales as `1 − occupancy` all the way to `0` on overflow. Towns size **no** pool:
  their storage targets, service rate and fresh capacity key on the housing cap (`popCap`), not on whoever is
  home — residents cycle between home and work, so present-pop sizing would collapse buffers exactly while
  everyone commutes. Consumption still follows who is present.
- **Cycle:** a docked worker leaves purely by gradient — once its uphill slope clears
  `WORKER_DOCK_SLOPE = 0.1 · GRADIENT_KNEE` it launches as a walker. A town never holds or releases a worker
  stock and is not a worker router, breeder or workforce manager: a town cannot spawn, despawn or dispose of a
  worker. It provides rest, food and tax — nothing else. `FRESH` workers climb `priceLabor` and join a firm pool
  on entering its cell while it has room; the entry wage (`amount · priceLabor[firm]`) prepays the contracted
  labor unit from the firm `purse` into that worker's wallet. Any shortfall is a claim keyed by worker ID and
  employer, paid oldest-first to the original worker even after departure. Firm surplus is credited to the
  workers doing the current work, never redistributed from savings. Recipes increase `tired` by actual labor
  used; exhaustion changes travel state to `DEPLETED`, not identity or amount. A hungry worker breaks off a
  shift for a food trip home at `FOOD_TRIP_HUNGER`, well before the starvation budget runs out — food is bought
  at the town bazaar, not delivered to work. Docked and walking workers each contribute `amount − tired` fresh
  units and `tired` depleted units to conservation. Docked gold mirrors the wallet in its travel-state pool;
  moving its backing between pools is neither income nor spending. `DEPLETED` walkers climb the wallet-weighted
  home score `priceHome + w · (priceRest − priceHome)` (`w` = `walletWeight(gold, amount)`: broke walkers chase
  rest per gold, funded walkers chase rest quality) toward the best rest the gradient reaches. Where no
  workforce gradient is significant a worker stays docked and counts as unemployed — the signal to construct a
  useful firm.
- **Queues:** a walker waits at a buyer only while that buyer is locally its best option, and the waiting pile
  registers as that buyer's queue, cooling its posted wage without touching any admission cap — a genuine full
  cell still bars entry, and once another buyer outbids the field the walker leaves instead of being held on a
  room sliver no shift-end opens. Queues never lock themselves out of an emptied pool.
- **Still walkers dock:** a walker whose slope falls below `WORKER_DOCK_SLOPE` joins the docked stock of its cell
  (mass, gold and `intent · amount`), so shelter rest, settle pledges and founding act on docked still workers; a
  cell already holding a full worker cell keeps the walker hovering instead.
- **Recovery lives where shelter lives:** only towns rest their guests. Nothing recovers on the road or at a
  firm — the tired worker must reach a town, which closes the home cycle and makes hunger a real clock.
  Recovery is bounded by the town's housing-cap service rate and free fresh-stock capacity; only the worker
  actually recovering pays the per-unit fee from his own wallet to `purse[town]`. Waiting is not taxed. Recovery
  decreases `tired`; on completion he is `FRESH` and independently follows the job gradient. Savings never bank
  into `workerPurse[town]` during ordinary rest.
- **Worker-owned life cycle:** a worker docked at a town whose comfort clears `FED_COMFORT` is fed — his hunger
  clock resets. Otherwise hunger accumulates wherever he is, and at `STARVE_SECONDS` unfed he starves: his
  portions book as starved on both mass sides and leave the host stock with him, his purse orphans where he fell
  (towns inherit it through the household purse), and the object leaves the world. That is the only
  non-founding disappearance, and no town performs it — it is his own empty stomach.
  A fed worker splits in two when most needs are met: docked at a home town with `comfortAt ≥ BIRTH_COMFORT`,
  hunger zero, savings at or above `BIRTH_PURSE` scaled by his amount, past `BIRTH_COOLDOWN_TICKS` since his
  last birth, and room in both home pools under the worker cap. The child is a new person: broke (savings are
  never split), same amount and tired, docked home; his portions join the home stock and book as granted
  supply. Births pace on the cooldown and the home cell's room, with no town action at all.
- **Unemployment and founding:** a docked worker with no significant job gradient counts as unemployed. At most
  once per 300 ticks, four worker units within radius 2 can trigger a firm on an empty nearby cell. Selection
  maximizes output value minus recipe input costs: mines need fresh labor; factories also require local coal or
  a nearby supplied mine. Construction does not mint gold.
- **Town wealth class:** every town gets a deterministic tax strategy — **cheap** drops the living tax to fill
  vacant housing; **med** buys needs then grows its tax; **rich** holds a cozy occupancy and raises tax first
  when it cannot meet resident needs. Wealth class shapes only the tax multiplier; it never grows, shrinks,
  spawns or sheds anyone.
- **Still-field measure:** the local price slope supplies fresh/depleted `still` fields used by steering and
  settle intent. Partial fatigue is recoverable without replacing a particle; the shelter rate is linear in
  worker amount so recovery completes.

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
- **Pledge write:** a docked still worker at `intent = 1` adds its `amount` to `gather` over radius 2 around its
  cell (walkers dock once still, carrying their intent). Each
  written cell's count only grows within a tick, so the best site (`gather · land.site`, empty cells only) is
  tracked at write time. The grid is cleared only after a tick that had pledges.
- **Threshold & cooldown:** found at the best site when `gather · site > 0.35`, at most once per 5 s so a new
  settlement's home field spreads and its claim lands before the next one. Desert, wasteland and other towns' land
  lower `site`, so the same settlers found on meadow away from facilities, and need far more people elsewhere.
- **Founding is a pure gather, never a birth:** docked workers relocate with their wallets, stock and shift-claim
  backing, bare tired stock moves proportionally, and `DEPLETED` walkers within radius 2 are absorbed as the young
  town's first resting residents, banking their carried savings into the household purse. Workers the cell cannot
  hold stay where they are — docked ones stay parked at their old cell, walkers keep walking with their wallets
  and forget the pledge once a home field reaches them. No vault gold is minted, no resident count is written and
  nobody is dissolved: founding gathers people, it does not create or destroy them. The young town starts broke
  and lives on tax, keeping the founding cell's wealth class. Founding stamps the new town's claim immediately.
- **Young-town build:** a settlement under the wood tier cap builds from its own forest (idle residents fell
  nearby wood) before bought comfort lifts the tier; tier floors scale rest, tax, bids and housing. Founding
  assigns the deterministic wealth class of its cell.

## Spawn accumulators & particle sizing

- Do not spawn dust particles (`< SPAWN_UNIT`). Each producer cell accumulates float
  `(spawnAmount[i], spawnCost[i])` until `spawnAmount[i] ≥ SPAWN_UNIT`, then emits one combined particle carrying
  proportional cost `spawnCost[i] · (SPAWN_UNIT / spawnAmount[i])`. Towns produce nothing and hold no
  accumulator.
- **Aged inventory relaxes its book cost:** when no road pays a batch's cost-basis sell floor, the accumulator
  marks its cost down toward the best price the road can see (`COST_RELAX` per second) — accounting only, no gold
  moves. Inventory that outran its buyers cannot wedge a producer's sell room (and hiring) shut forever.
- **Target batch size (64×64 map):** ~0.5–1.0 units per goods particle and ~1–2 workers per workforce particle
  (~200–800 live particles total, zero per-tick allocations).
- **Idle flush:** if a producer stops adding to `spawnAmount[i]` for ~2–3 s while it exceeds the dust floor and
  an uphill gradient exists, flush one final partial particle so depleted mines or paused plants never trap stock.
- **Particle death sweep:** when a particle's `amount` falls below the dust floor (`≤ 1e-12`), sweep its carried
  gold to the owning purse (`workerPurse` at towns, seller coin stream elsewhere) rather than zeroing it, so
  machine-precision gold conservation holds (mirrors B2's `money.orphan`).

## Steering & movement

- Particles steer by a smoothed price-gradient heading (`STEERING_BLEND = dt / (0.18 + dt)` exponential blend of
  `vx/vy`), not the raw per-tick gradient, to avoid jitter. Goods and workers share one steering owner
  (`steering.js`); a worker's score blends two fields by its own wallet weight.
- Walkers launch along the steepest uphill edge, not the blended gradient: between two equal buyers the blended
  heading cancels to zero and would park the walker on the dock forever.
- Speed scales with the gradient share `g / (Σg + GRADIENT_KNEE)`, so flat fields barely move goods; workers dock
  below `WORKER_DOCK_SLOPE`. Goods walk at 6 cells/s, workers at 12 cells/s (the cell engine's labor flow rate).
- Speed is terrain-weighted (edge conductance, harmonic mean of endpoint speeds); haul effort per unit scales as
  `1 / conductance`. Direction shares use the unweighted gradient sum `g·c / (Σg + ref)` so uniformly slow ground
  keeps its pace.
- Buyer holds apply only at local price maxima; otherwise particles keep climbing toward higher bids.

## Rendering

- In item map views, render live particles in continuous canvas coordinates above dimmed terrain + site storage:
  - `item.price` (`totalCost / amount`) → color ramp (cheap to dear).
  - `amount` → light/brightness and dot radius.
- In `Labor` / `Depleted` views, worker walkers render the same way over docked pools: carried wallet per worker
  (`gold / amount`) → color ramp, `amount / WORKER_UNIT` → light and radius. Gold arrows add walker wallets.
- `Land` view: land rest (terrain less wasteland) beside town site quality, with settler flow arrows.
- Paired demand/price map renders the diffused price/appeal field and equal-price contours. Stock intensity uses
  a log scale; price uses a linear scale with 1-2-5 nice-ceil steps so legends stay stable while uncapped prices
  drift.

## File layout

- **Lab:** `prototype/particle-transfer/` — standalone lab mirroring the `price-model-b2` structure so the engine
  is verified before porting: `simulation.js` (fields, diffusion, docked stocks, tick order), `steering.js`
  (terrain conductance, blended-score gradients, bounded moves), `particles.js` (goods SoA pool, spawn
  accumulators, arrival split), `workers.js` (worker SoA pool, dock release, admission, entry wages), `actors.js` (bids, pools, tax — lifted from B2), `workforce.js`
  (`WorkerPolicy`, reused from B2), `land.js` (`Land`, reused from B2), `settlement.js` (`Settlements`, reused
  from B2), `gold.js` (conserved gold,
  Transport Company vault), `fields.js`/`telemetry.js`/`app.js`/`index.html`/`styles.css` (render + UI), and
  `*.test.js`.
- **Port target:** `map-money-gold.js` (default money economy), dispatched by `mapeStepMoney` when
  `mape.moneyEngine === 'particle'`. New code gets its own owner file + header + map entry per `AGENTS.md`; no
  junk drawers.

## Phased implementation (minimal first)

0. **Land and town spawning (`land.js`, `settlement.js`):** terrain rest table, wasteland and town-claim
   cones, carried settle intent, pledge-written gather grid and site-weighted founding. Lives in the
   engine-neutral `land.js`/`settlement.js`, so every phase shares the same town spawning rules.
1. **Goods particles only:** coal → goods chain (one mine, one factory, one town). Price diffusion, spawn
   accumulators, cost-basis sell gate, buyer room admission, arrival split with Transport Company vault. Verify
   mass and gold conservation to machine precision.
2. **Worker particles:** `FRESH`/`DEPLETED` walkers with carried gold over docked pools, entry wages,
   proportional wage settlement, rest tax, occupancy-balanced firm pools with walker queues, wallet-weighted home
   steering, recovery only at towns — reusing B2's `WorkerPolicy`/`Settlements`/`Land` on docked stocks — plus
   wealth-class tax, the worker-owned life cycle (split on well-being, starve on prolonged hunger) and founding
   that gathers docked and walking settlers.
3. **Full engine:** multiple kinds, spoilage rates per kind, Transport Company dividend drip, particle rendering,
   64×64 sizing pass, then flip `mape.moneyEngine` default to `'particle'`.

## Validation

- **L0:** `node --check` on touched files.
- **L1:** `node --test` in the lab — conservation identities (`sum(stock) == produced − consumed − spoiled`,
  labor/depleted ledgers net of starved portions, `money.total() == seeded + mined` to machine precision), profit
  identity (`profit == amount · (buyerUnitPrice − item.price)`), pool-occupancy wage cooling to zero on overflow,
  gold-tax appeal ordering (cheaper + nearer wins, inflated towns lose), rest only at towns (the road recovers
  nothing), hunger starvation leaving purse and mass exactly, worker split booking a broke child as granted
  supply, settlement founding from pledged intent: same settlers found on meadow but not in desert, settlers
  beside a mine found on the far side, town claim stamped and released with the actor, intent conserved as
  `intent · amount` through transport; worker walkers: entry wage on joining a firm pool, wallet ordering
  (broke → value, funded → rest quality), queue cooling the wage without locking the pool, still docking,
  founding absorption with wallets.
- **L2:** full suite + manual pass list on port to the game. Run `smoke` + `dom_smoke` after touching
  `main.js`, `index.html` or load order.

## Manual verification checklist

- Open the lab and switch across `Coal`, `Goods`, `Labor`, `Depleted`, `Gold`; on `Labor` and `Depleted` walkers
  stream between docks, turning brighter/violet as wallets fill on the way home.
- On **Gold**, verify flow runs from towns to firms (bills) and from mines/factories back to towns along worker
  return paths, and hover transit cells to inspect positive carried gold.
- Place a high-tax/isolated town beside a supplied low-tax town and verify `Depleted` particles route into the
  cheaper supplied town while all ledgers balance.
- Flood a firm with fresh workers and verify `Pool %` rises and `Wage` drops to `0` on overflow; starve a town of
  coal and goods and verify hunger drives workers home before the starvation budget expires, with `Births ·
  starved` counting only real split/starve events.
- Clear towns and verify a young town founds from gathered settlers on meadow away from mines, factories and the
  desert, builds its first tier from forest, and restarts production — the founders become its first resting
  residents, never despawning into it.
- On **Land**, hover a still crowd beyond town reach and watch `Settle intent` climb to 1 and `Gathered` appear.

- Spawn a watched worker with 50 gold: verify the same name/ID survives job → exhausted walk → town wait/rest →
  fresh departure → another job. Purse equals Granted + Earned − Spent each tick; ordinary rest never says “settled”.
- Check **Unpaid wages** separately from cash: a broke employer cannot invent gold, and later repayment reaches
  the original worker rather than a replacement hire. The event feed must not spam rounded `+0.00 g` pool transfers.
