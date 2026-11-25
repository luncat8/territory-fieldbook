# Particle transfer model plan

Design for the particle economy engine of `draft/particle_transfer_model.md` (with `draft/town-settlement.md`,
`draft/workers-food.md`, `draft/company/`). Fields carry **prices, appeal and wild-food reach** only; every moving
or stored good and **every person** is a particle object with an owner, a cost basis and (for workers) a wallet and
personal food bag. The pricing, pool, tax, land and settlement rules are the ones `prototype/price-model-b2`
already runs on a cell field; this engine swaps the transport substrate (Eulerian cell flow → Lagrangian SoA
particles) under them. All numbers live in the owning source file; numbers below are starting values.

## Scope

- Built and verified in a standalone lab `prototype/particle-transfer-b2/` on a B2 base, then ported to the game
  as `mape.moneyEngine === 'particle'` and made the default.
- Goods particles: variable `amount` (spawn accumulator, spoilage). Worker particles: fixed headcount with a
  continuous `tired` portion, persistent `id`, `gold` wallet and personal `food` ration.
- Town population = the worker objects inside it. A town is not a worker router: it never holds, releases or
  rate-limits workers. It sells rest and rations for gold and buys goods and coal for comfort.
- **No deaths in badly supplied towns:** an unsupplied town or an empty wallet never kills workers. Hungry workers
  switch to a dedicated `FORAGE` mode that ignores all other tasks, follow a low-resolution food gradient toward
  water shorelines, forests and **Monastery gardens** (farm-style plots that give free food), pick food until fed
  and return to normal life.
- Deferred (own drafts/plans): house owners, standalone commercial farms and bazaar pricing, free workers
  gathering market wood, Transport Company staffing/depots, visible coin particles, roads/ships, town upkeep and
  depot wear, construction wood for new firms, several firms per cell.

## Time model

Lab tick `ECONOMY_DT = 1/60 s` (B2); game tick `SIM_STEP_SEC` (`main.js`), speeds multiply tick count, never
`dt`. Every rate is per simulation second and every update is a bounded fraction of its source
(`units-and-scales.md`): one diffusion pass per field per step, fades as `exp(−k·dt)`. A particle moves at most
`speed · dt` per tick (< 1 cell), so rules do not depend on particle count.

## Fields (not conserved — diffused + faded)

- Buyer bids: `priceCoal`, `priceGoods` (later `priceIron`, `priceLogs`, `priceFood`). Firm wage bid: `priceLabor`.
- Home fields (B2 `workforce.js`): `priceRest` (rest quality: comfort, tier, free-space lift, land rest, crowding)
  and `priceHome` (rest per gold of actual tax: `shelter · refTax / goldTax`, no `popRoom`).
- **Free-food gradient (`forage.field`):** half-resolution grid (`24×14` on `48×28`, `32×32` on `64×64`) updated
  every `FORAGE_STRIDE = 4` ticks (`dt = 4 · ECONOMY_DT`). Fed by wild food on **water-edge** (shoreline) cells and
  standing **forest**, plus harvested free stock in **Monastery gardens**. Single-pass diffused and faded on the
  coarse grid; walkers sample it bilinearly with a fine-cell local-source tie-breaker so they step directly onto
  the shoreline, forest patch or garden.
- Bids come from the B2 optimizer: output value split over inputs inside `JOINT_BUDGET_SHARE`, cooled by owed
  bills (`creditCool`), zero when input buffers are full, profit smoothed by `tanh(profit / ref)`.

## Particle pools

Fixed-capacity typed-array SoA, dense, compacted by swap-remove (loops never skip holes). No allocation,
closure or object literal per tick. Positions are continuous cell coordinates; `hx, hy` is the smoothed heading.

- **Goods:** `kind, x, y, hx, hy, amount, factoryCost, transportCost, owner, waitTicks`.
- **Workers:** `id, state, cell, x, y, hx, hy, amount, tired, paidRest, gold, food, intent, since`.
  `amount = WORKER_UNIT` is fixed (lab: 1 worker; the 64×64 sizing pass may raise it to a fixed crew).
  `tired ∈ [0, amount]` is the depleted portion; fresh portion = `amount − tired`. `food ∈ [0, FOOD_BAG]` is the
  carried ration (sized for ~2–3 work/walk cycles). `id` is stable across compaction so a worker can be watched
  for its whole life. `since` is the tick of the last state change.

Docked workers (pool, shift, wait, room, still) are the same objects with `cell` set; they are not drawn as dots
while docked but always counted, carry their gold and food, and keep their state.

## Cell view: how B2 rules are reused unchanged

B2 rules read per-cell stocks. Each tick, after workers move, one pass over workers rebuilds per-cell
aggregates (`fill(0)` then accumulate): `labor[i]` (fresh in firm pool + shift), `depleted[i]` (town wait pool),
`pop[i]` (town occupants: room + wait), `stillDep[i]`, `stillFresh[i]`, and wallet sums. `WorkerPolicy`, `Land`,
`Settlements` and the actors read this view; their outputs (labor used, rest given, tax due, founding) are applied
back to the individual workers of that cell. A rule never writes the view.

## Goods particles

- **Spawn:** each producer cell accumulates `(spawnAmount[i], spawnCost[i])`; at `≥ SPAWN_UNIT` it emits one
  particle with proportional cost, only if the uphill price gradient clears the sell floor
  `selfPrice = (factoryCost / amount) · (1 + SELL_MARGIN)`. Idle flush: a partial batch above the dust floor is
  emitted after ~2.5 s without additions, so a closing mine never traps stock.
- **In transit:** climbs its kind's price field. `transportCost` accrues per distance hauled
  (`haulCostRate · amount · ds / conductance`; zero while held). Spoilage `amount *= exp(−spoilRate · dt)`
  (goods slow, coal none) is booked as `spoiled`.
- **Derived price:** `item.price = (factoryCost + transportCost) / amount`, never stored. Rendered colour.
- **Arrival:** a buyer admits up to `cap − stock` (and available buyer cash), normalized across all particles
  arriving that tick; the rejected remainder counts as that buyer's queue (cools its bid, never its cap). On
  admission:
  1. buyer pays `buyerPay = amount · priceKind[buyer]` from its purse;
  2. `transportPaid = min(buyerPay, transportCost)` → single map-wide **Transport Company** vault (gentle drip
     back to active towns so the vault does not hoard);
  3. `factoryRevenue = buyerPay − transportPaid` → `owner` purse (direct credit).
  Profit identity: `profit = amount · (buyerUnitPrice − item.price)`; gold is conserved by construction.
- **Underwater** (`buyerUnitPrice < item.price`): re-steer up any gradient that still clears `item.price`; at a
  local price maximum non-perishables wait in consignment (no transport accrual), perishables spot-sell after a
  hold window before rotting and book the loss on `owner` so the over-supplier scales down.

## Worker life cycle

States: `WALK_JOB`, `FIRM_POOL`, `SHIFT`, `WALK_HOME`, `TOWN_WAIT`, `ROOM`, `STILL`, `FORAGE`.

1. **Job.** A fresh worker climbs `priceLabor`. At a firm: a free shift slot → `SHIFT`; else a free pool place →
   `FIRM_POOL` (FIFO into shifts); else keep walking. Pool + shift count toward occupancy, so the posted wage
   falls to `0` on overflow (bid only — the admission cap stays, or an emptied pool locks itself out).
2. **Wage at entry.** On joining the firm the firm prepays the shift (`priceLabor[firm] · fresh` from its purse
   into `gold`; a newly founded zero-purse firm books the unpaid remainder as `owedWage` cooled by `creditCool`
   and settles it from its first sale, so no gold is ever minted). Wage level is fixed at entry.
3. **Work.** In `SHIFT`, `tired += WORK_RATE · amount · dt`; the firm recipe consumes exactly that labor. At
   `tired = amount` the worker becomes `WALK_HOME`.
4. **Home choice.** `WALK_HOME` climbs the wallet-blended score `(1 − w) · priceHome + w · priceRest`,
   `w = walletWeight(gold, amount)`: broke workers chase rest per gold, funded workers chase rest quality (the
   pareto choice). A town takes him only if no neighbour scores higher for his `w`.
5. **Wait.** Rooms full but wait-pool place free → `TOWN_WAIT`, no tax, no rest. Wait crowding raises
   `townRestTax` (B2), steering newcomers elsewhere. Pool full → keep walking.
6. **Rest.** A free room → `ROOM`: pays `fee = townRestTax · tired` into the town purse. A worker with less
   than the fee pays all he has and buys `paidRest` in proportion; any remaining `tired` recovers at the shelter
   rate after leaving. In the room `tired` falls at the town rest rate (comfort, tier, land, free-space lift) and
   funded workers buy rations from the town's supplied `rationPool` to top up `food`.
7. **Leave.** Once paid rest finishes (`tired = 0` on full payment) he leaves the room immediately. If tired
   remains he shelter-rests or walks; if fresh and `priceLabor` slope clears the dock gate he walks to the next
   job; otherwise he becomes `STILL` fresh — **free workforce** (counted for new firms, below).
8. **Still.** Any job/home walker whose slope falls below the dock gate becomes `STILL`. Still with `tired > 0`
   rests at the shelter floor for free (`IDLE_RATE · land.rest`) and builds settle intent. A still worker
   re-launches as soon as his gradient clears the gate.
9. **Forage (`FORAGE`).** `food` burns continuously (`idle < walk < shift`). When `food ≤ FOOD_HUNGRY` and the
   worker cannot refill at his current town (badly supplied town or worker out of money), he switches to `FORAGE`
   (undocking from any room, wait pool, firm pool or shift). While in `FORAGE` he is **not disturbed by any other
   task** — he ignores `priceLabor`, `priceHome`, `priceRest` and founding until `food ≥ FOOD_FULL`. He climbs
   `forage.field` to water shorelines, forests or a **Monastery garden**, picks food (`wildFood` slowly, or
   stocked garden food fast for `0` gold) while gently shelter-resting if tired, and returns to `WALK_JOB` /
   `WALK_HOME` / `STILL` once `food ≥ FOOD_FULL`.

Reference cycle: worker with 50 g walks to a job, is paid at entry, works until tired, walks to the best town for
his wallet, waits in its pool while rooms are full, pays tax and buys rations on check-in, rests, leaves, walks to
the next job — same `id`, same `amount` throughout.

## Wild food & Monastery gardens (`forage.js`)

- **Wild food (`wildFood[i]`):** walkable **water-edge** (shoreline) cells and **forest** cells (`forest[i]`) carry
  regenerating wild food (`wildCap[i]`, reduced by industrial wasteland, zero on water and desert). Picking draws
  down `wildFood[i]` locally so crowded spots cool and spread foragers along shores and woods.
- **Monastery garden (`ECONOMY_GARDEN`):** works mechanically like a farm (`map-farm.js`) — claims fertile
  walkable cells in `GARDEN_RADIUS`, clears/tills plots (releasing them to regrow if removed), accumulates tending
  over `GARDEN_SEASON_SEC` and harvests whole-patch food scaled by land moisture/quality into `gardenStock[i]`
  (with mild spoilage). Gives free food (`0` gold) to foraging / out-of-money workers and injects strongly into
  the coarse `forage.field` while `gardenStock[i] > 0`.

## Towns

- **Rooms** = built size (bounded by tier pop cap × land quality). **Occupants** = `ROOM` + `TOWN_WAIT` workers.
  Needs (coal, goods) are consumed per occupant-second; consumed goods also stock the town's `rationPool`;
  satisfaction gives comfort.
- **Tax and size by wealth class** (deterministic per cell, B2): **cheap** drops tax to fill vacant rooms, grows
  when the queue fills; **med** buys needs, then grows; **rich** keeps a cozy occupancy (queue ≈ 0, a few free
  rooms), raises tax rather than growing, cuts size first when needs are unmet. Cheap/med keep built size and
  shrink slowly only when long vacant or broke.
- **Births only (no deaths):** headcount changes only by births, never by starvation or low comfort. Per-town
  accumulator `births += BIRTH_RATE · occupants · max(0, comfort − BIRTH_COMFORT) · dt` while rooms are vacant;
  at `≥ WORKER_UNIT` a newborn worker (`gold = 0, tired = 0, food = FOOD_BAG`) enters town. In badly supplied
  towns births stop and hungry workers leave in `FORAGE` mode to gather food themselves.
- Gold: towns and starter firms begin with seeded purses; worker wallets are seeded at spawn; the gold mine is the
  only source.

## Settlement founding (still depleted workers)

B2 `Settlements` / `Land`, per worker:

- **Intent.** A `STILL` worker with `tired > 0` beyond town reach (`priceHome + priceRest < FOUND_REACH`) raises
  `intent` toward 1 over `INTENT_SECONDS`, otherwise lowers it. At `intent = 1` he writes `amount` into the gather
  grid around him (radius `FOUND_RADIUS`), tracking the best `gather · land.site` at write time — no map rescans.
- **Found.** When the best score clears `FOUND_SETTLERS` (cooldown `FOUND_COOLDOWN_TICKS`), a young town is
  placed there with its cell's wealth class and town claim stamped. The gathered workers check into its rooms free
  of tax, carrying their own gold; no gold is minted, the town starts broke and lives on tax.
- **Young town** (tier below `WOOD_TIER_CAP`): its resting/still workers fell nearby forest into its first tier;
  bought comfort lifts the tier above that. Land sets the site: water edge and forest/meadow best, desert and
  wasteland worst; other towns' claims repel.

## Firm founding (free workforce)

- `STILL` fresh workers write `amount` into an idle grid at write time, like the gather grid.
- Every `FIRM_SCAN_TICKS`, where the idle sum within radius 2 clears `FIRM_FOUNDERS`, the best empty nearby
  walkable cell is chosen by value: output bid minus recipe input cost at that cell, gated by resources (a mine
  needs a deposit; a factory needs coal reach). Nearby idle founders build it into a working firm with an empty
  purse (`0` minted gold).

## Steering & movement (`steering.js`, shared by goods and workers)

- Terrain speeds: meadow `1`, desert `0.85`, forest `0.75`, water `0` (impassable). Edge conductance is the
  harmonic mean of endpoint speeds; haul effort per unit `∝ 1 / conductance`.
- Smoothed heading `STEERING_BLEND = dt / (0.18 + dt)`; launch from a dock along the steepest uphill edge.
- Speed `∝ c · s / (s + GRADIENT_KNEE)`. Job/home walkers dock as `STILL` below `DOCK_SLOPE = 0.1 · GRADIENT_KNEE`.
  Goods 6 cells/s, workers 11 cells/s at full slope.
- Arrival tests are cell-based (particle enters the buyer/firm/town/garden cell), never distance-to-centre.

## Conservation ledgers (checked every test tick)

- Goods per kind: `produced − consumed − spoiled = stored + spawnBuffers + inParticles`.
- Headcount: `Σ worker.amount = seeded + births` (no deaths; founding and foraging move workers, never change
  headcount).
- Labor: `Σ tired = seededTired + worked − rested`.
- Gold: `purses + wallets + vault = seeded + mined` to `< 1e-7`.

## Rendering

- Goods views: live particles at continuous coordinates over terrain/water; `item.price` → colour ramp,
  `amount` → brightness and radius.
- Worker views (`Labor`, `Depleted`): walkers coloured by wallet per worker (with distinct highlight for watched
  and `FORAGE` workers), brightness by fresh/tired portion; docked stocks drawn as cell intensity under them.
- `Forage` view: wild shoreline/forest food + Monastery garden plots and stock + foraging walkers on Map 01;
  the coarse diffused `forage.field` with contours on Map 02.
- Paired map: diffused price/appeal/forage field with isolines; stock log scale, price linear with 1-2-5 steps.
- Inspector: hover a cell for pools, rooms/occupants/queue, tax, wealth class, ration/garden stock, wild food,
  intent and idle sum; click a worker (or cell with workers) to watch a worker (`id`, `state`, `wallet`, `tired`,
  `food`, recent events).

## File layout

Lab `prototype/particle-transfer-b2/` (each file < 500 lines, header per `AGENTS.md`):

- `simulation.js` — grid, fields, cell view rebuild, tick order, public model API.
- `steering.js` — terrain conductance, field & coarse-forage gradient sampling, heading, bounded move.
- `goods.js` — goods SoA pool, spawn accumulators, arrival split, consignment and spoilage.
- `workers.js` — worker SoA pool, life-cycle states (`WALK_JOB..FORAGE`), admission, entry wage, watched worker.
- `forage.js` — low-res food gradient (`24×14` / `32×32`, 4-tick stride), shoreline/forest wild food, Monastery
  garden farm plots and free rations.
- `actors.js` — firm recipes, bids, pools, conversion and scale adaptation.
- `towns.js` — rooms, occupants, rations, tax, wealth class, births (no deaths).
- `workforce.js`, `land.js`, `settlement.js` — pareto home policy, water/forest/desert land & claims, young-town
  founding and forest-felling tier build.
- `founding.js` — idle grid and firm founding from free workforce.
- `gold.js` — purses, wallets, Transport Company vault and town drip.
- `fields.js`, `telemetry.js`, `app.js`, `index.html`, `styles.css`, `README.md` — particle & field render,
  ledgers, watched worker readout, Garden tool and UI.
- `*.test.js` — node test suites (`conservation`, `workers`, `forage`, `founding`, `ui`).

Game port: `map-money-particle.js` (+ split owner files as needed), dispatched by `mapeStepMoney` when
`mape.moneyEngine === 'particle'`; new owners get AGENTS.md map entries.

## Phases (minimal first, each ends green)

0. **Lab base & substrate:** terrain with water/forest/desert, steering conductance, diffused price fields and
   conserved gold vault (`prototype/particle-transfer-b2/`).
1. **Goods particles:** coal → goods chain, spawn accumulators, sell floor, normalized buyer admission, arrival
   split, Transport Company vault + drip, consignment and spoilage.
2. **Worker particles & foraging:** worker SoA pool replacing cell labor/depleted flow and `pop[i]`, entry wage,
   wait pool, rooms, pareto steering, shelter rest, personal `food` bag, `FORAGE` mode over the low-res food
   gradient and Monastery gardens.
3. **Towns and founding:** wealth class on rooms/occupants, births without deaths, settlement founding from still
   depleted workers, young-town forest build, firm founding from free workforce, watched-worker UI.
4. **Game port:** 64×64 sizing (`32×32` forage grid, 200–800 live particles), port to `mape.moneyEngine ===
   'particle'` and flip the default.

## Validation

- **L0:** `node --check` on touched files.
- **L1:** `node --test` in `prototype/particle-transfer-b2/`:
  - all conservation ledgers above, every tick of a multi-second reference run;
  - profit identity per arrival; full buyer never over-accepts; underwater perishable books a loss;
  - reference cycle: one watched worker with 50 g — wallet `+wage` at entry, `−fee` at check-in, same `id` and
    `amount` through job → walk → wait → room → leave → next job;
  - pool overflow drives the wage to 0 but an emptied pool still admits; town crowding raises tax;
  - broke worker picks the value town, funded worker the rest-quality town; dominated town does not catch;
  - **no deaths in badly supplied towns:** an isolated unsupplied town loses zero headcount; hungry workers enter
    `FORAGE` mode, ignore strong nearby `priceLabor` and `priceHome` pulls until fed, follow the low-res `forage`
    gradient to water shorelines, forests or a Monastery garden, gather free food and return to normal states;
  - **Monastery garden:** clears/tends surrounding plots, harvests seasonal food into `gardenStock`, emits into the
    coarse `forage` gradient, feeds out-of-money / foraging workers for `0` gold, and steps back cleanly when its
    granary is eaten empty;
  - rested worker leaves the room at once; with no job gradient he is `STILL` fresh and counted idle;
  - still depleted crowd beyond town reach founds a young town on good land (shoreline/meadow), not in desert or
    in a claim;
  - idle crowd near a deposit founds a mine; no gold minted by any founding;
  - births keep headcount ledger exact (`seeded + births`).
- **L2:** after game port: `smoke` + `dom_smoke` + `mape_*` comparison and the manual list.

## Manual verification checklist

- Goods views: particles stream mine → factory → town, warming in colour as transport cost adds up.
- Watch a worker: click a worker on the map; the reference cycle plays out with live `state`, `gold`, `tired`,
  `food` and event notes.
- Starve a town (erase factories): zero deaths; as `food` bags run out, workers turn to `FORAGE`, ignore job bids,
  walk to lakeshores, woods or the Monastery garden, refill `food`, and resume work/rest.
- Place a Monastery garden near broke workers: plots till around it, seasonal harvests fill its free granary, the
  `Forage` map peaks over it, and penniless workers gather rations there for `0` gold.
- Crowd a town: queue grows, tax rises, newcomers turn to a cheaper town; rooms free up as rested workers leave.
- Flood a firm: pool %, wage → 0; remove the extra demand and the pool refills.
- Remove all jobs near a town: rested workers stand still outside it; after a while a new firm appears.
- Remove all towns: tired workers shelter-rest on the spot, a young town founds on shoreline/meadow away from
  facilities and desert, fells forest into its first tier, production restarts.
- Compare a cheap and a rich town: cheap drops tax to fill rooms and grows on queue, rich keeps free rooms.
