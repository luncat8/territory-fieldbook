# Particle transfer model plan

Design for the particle economy engine of `draft/particle_transfer_model.md` (with `draft/town-settlement.md`,
`draft/workers-food.md`, `draft/company/`). Fields carry **prices, appeal and wild-food reach** only; every moving
or stored good and **every person** is a particle object with an owner, a cost basis and (for workers) a wallet and
personal food bag. The pricing, pool, tax, land and settlement rules are the ones `prototype/price-model-b2`
already runs on a cell field; this engine swaps the transport substrate (Eulerian cell flow → Lagrangian SoA
particles) under them. All numbers live in the owning source file; numbers below are starting values.

## Monetary design extension (confirmed)

[Gold circulation and credit money](plan-gold-and-paper-money.md), sourced from
[draft/economy-money-bank.md](draft/economy-money-bank.md), owns the confirmed mine-only gold origin,
stable facility/owner accounts with **shared** cash and debt, worker-owner founding with no paid initiation,
bank-funded startup and debt service, wood-funded mine operation, transport/custody accounting and credit-note
issuance. It also defines output placement: current route-gated buffers are the internal-depot default,
speculative map output is a comparison, and reserved buyer-directed dispatch is **not available** — this
engine's transport substrate cannot do it. Forest-cut logs are placed at the cut cell. Reuse the traded
sawmill/wood path for mine inputs. A bank can lend existing gold with credit money disabled.
Credit notes are the only paper mechanism; gold-backed banknotes are a control. Compare ownership, storage,
funding and currency policies independently before combining them. The lab runs the first slice (G1 + O2 + D1 +
G2 + F1): scenario starting gold `START_GOLD_PER_WORKER × workers` recorded once and split between named owners,
town treasuries, worker wallets and bank equity; shared worker-owners (`owners.js`); a gold mine that needs
delivered wood; and a capital-funded gold bank (`banks.js`) with simple interest, grace-period default and
write-off. Credit notes (P1) and bankruptcy/facility resale (P3) are not in the lab yet.

## Scope

- Built and verified in a standalone lab `prototype/particle-transfer-b2/` on a B2 base, then ported to the game
  as `mape.moneyEngine === 'particle'` and made the default.
- Goods particles: variable `amount` (spawn accumulator, spoilage). Worker particles: fixed headcount with a
  continuous `tired` portion, persistent `id`, `gold` wallet and personal `food` ration.
- Town population = the worker objects inside it. A town is not a worker manager: it never spawns, despawns, teleports or
  routes workers. Workers own their movement, queues, check-in and departure. It sells rest and rations for gold and buys goods and coal for comfort.
- Worker lifecycle belongs only to `worker-life.js`: prosperous, fed workers split into two, sharing existing
  food and gold. A worker despawns only after prolonged personal food absence, never because a town is unhappy.
  Hungry workers first switch to `FORAGE`, following shoreline/forest/Monastery food reach independently of jobs.
- Deferred (own drafts/plans): house owners, a general wood market, advanced bazaar pricing, free workers
  gathering market wood, Transport Company staffing/depots, visible coin particles, roads/ships, town upkeep and
  depot wear, construction wood for new firms, several firms per cell.

## Time model

Lab tick `ECONOMY_DT = 1/60 s` (B2); game tick `SIM_STEP_SEC` (`main.js`), speeds multiply tick count, never
`dt`. Every rate is per simulation second and every update is a bounded fraction of its source
(`units-and-scales.md`): one diffusion pass per field per step, fades as `exp(−k·dt)`. A particle moves at most
`speed · dt` per tick (< 1 cell), so rules do not depend on particle count.

## Fields (not conserved — diffused + faded)

- Buyer bids: `priceCoal`, `priceGoods`, `priceFood` (later `priceIron`, `priceLogs`). Firm wage bid: `priceLabor`.
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

- **Spawn:** each producer cell accumulates `(spawnAmount[i], spawnCost[i])`; at `≥ SPAWN_UNIT` (`0.06`) it emits one
  particle with proportional cost, only if the uphill price gradient clears the sell floor
  `max(itemGate, (factoryCost / amount) · (1 + SELL_MARGIN))`, where derived `itemGate` scales with local labor/haulage
  cost (`4–8 · HAUL_LABOR · priceLabor`, `0.15 · priceLabor · SAWMILL_LABOR` for wood) so barns hold inventory rather
  than dumping underwater batches into full markets. Idle flush: a partial batch above the dust floor is emitted after
  ~2.5 s without additions, so a closing mine never traps stock.
- **In transit:** climbs its kind's price field. `transportCost` accrues per distance hauled from local labor/price
  (`max(HAUL_LABOR · priceLabor, HAUL_VALUE_FLOOR · priceKind) · amount · ds / conductance` in derived mode; zero while
  held). Spoilage `amount *= exp(−spoilRate · dt)` (goods slow, coal none) is booked as `spoiled`.
- **Derived price:** `item.price = (factoryCost + transportCost) / amount`, never stored. Rendered colour.
- **Arrival:** a buyer admits particles in sequential FIFO order up to `cap − stock` and live `money.cashAt(buyer)`,
  splitting only the boundary particle when remaining room or cash is smaller than its batch (preventing proportional
  crumb shaving across large queues and multi-site cash double-spends); the unaccepted remainder counts as that buyer's
  queue (cools its bid, never its cap). On admission:
  1. buyer pays `buyerPay = amount · priceKind[buyer]` from its purse;
  2. `transportPaid = min(buyerPay, transportCost)` → map-wide **transport account** (T0 drips it back to active
     towns by population; T1 retains it);
  3. `factoryRevenue = buyerPay − transportPaid` → the particle's `payee` owner (stable owner id, so revenue
     reaches the owner even after the producing facility is erased; profit attribution checks `originFacility`).
  Profit identity: `profit = amount · (buyerUnitPrice − item.price)`; gold is conserved by construction.
- **Underwater** (`buyerUnitPrice < item.price`): re-steer up any gradient that still clears `item.price`; at a
  local price maximum non-perishables wait in consignment (no transport accrual), perishables spot-sell after a
  hold window before rotting and book the loss on `owner` so the over-supplier scales down.

## Worker life cycle

States: `WALK_JOB`, `FIRM_POOL`, `SHIFT`, `WALK_HOME`, `TOWN_WAIT`, `ROOM`, `STILL`, `FORAGE`.

1. **Job.** A fresh worker climbs `priceLabor`. At a firm: a free shift slot → `SHIFT`; else a free pool place →
   `FIRM_POOL` (FIFO into shifts); else keep walking. Pool + shift count toward occupancy, so the posted wage
   falls to `0` on overflow (bid only — the admission cap stays, or an emptied pool locks itself out).
2. **Wage at entry.** On joining the firm the firm prepays the shift (`priceLabor[firm] · fresh` from its
   facility budget — a bounded share of the owner's cash — into `gold`; a short owner books the remainder as a
   wage claim on the original worker id, cooled by `creditCool` and settled FIFO from later owner cash, so no
   gold is ever minted). Wage level is fixed at entry; the shift also accrues bonus credit with that owner.
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
   funded workers buy rations from the town's purchased food stock to top up `food`.
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
  Needs (coal, goods) are consumed for comfort. Food is a separate traded resource: the bazaar buys farm
  harvests and sells rations into worker bags. Consumed goods never manufacture food.
- **Tax and size by wealth class** (deterministic per cell, B2): **cheap** drops tax to fill vacant rooms, grows
  when the queue fills; **med** buys needs, then grows; **rich** keeps a cozy occupancy (queue ≈ 0, a few free
  rooms), raises tax rather than growing, cuts size first when needs are unmet. Cheap/med keep built size and
  shrink slowly only when long vacant or broke.
- Town rules never create or remove workers, change their wallets except through explicit purchases, or
  relocate them. Empty rooms, comfort, taxes and town wealth affect services, not headcount.
- Rest fee derives in derived mode from observed worker wallet wealth (`REST_WALLET_SHARE = 0.24` of local wallet
  average) with no permanent nominal `BASE_REST_FEE` floor; excess town purse above operating reserve
  (`max(4, pop) · 1.5 · refRestFee`) rebates to resting workers so towns circulate rather than sterilize gold.
- Bazaar food target `max(2, demandPop · 0.5)`; bids cool with stock, incoming queues and available gold.
  Rations cost `max(0.18 · restTax, delivered food cost · 1.15)` per unit in derived mode (`0.45` legacy). Sales
  remove food cost basis proportionally.
- Gold: the scenario's starting gold is the only non-mined gold; placement, founding, erase and reset mint
  nothing. Splitting shares wallets; the gold mine is the only source. Holdings: town purses, owner cash, bank
  reserve, transport account, custody (estates of the dead and of erased towns, dripped back to towns), wallets.
- Owner waterfall each tick: wage claims; a bank loan when cash is below the next-shift reserve (owners that
  extract gold self-fund); debt service from cash above the reserve; then bonuses to credited workers, only
  from earnings — never while a loan is open and never out of paid-in capital.

## Settlement founding (still depleted workers)

B2 `Settlements` / `Land`, per worker:

- **Intent.** A `STILL` worker with `tired > 0` beyond town reach (`priceHome + priceRest < FOUND_REACH`) raises
  `intent` toward 1 over `INTENT_SECONDS`, otherwise lowers it. At `intent = 1` he writes `amount` into the gather
  grid around him (radius `FOUND_RADIUS`), tracking the best `gather · land.site` at write time — no map rescans.
- **Found.** When the best score clears `FOUND_SETTLERS` (cooldown `FOUND_COOLDOWN_TICKS`), a young town is
  placed there with its cell's wealth class and town claim stamped. Workers remain at their existing positions and states, walking in and buying rest normally; no free
  check-in, teleportation, workers or gold are created. The town starts broke and lives on service sales.
- **Young town** (tier below `WOOD_TIER_CAP`): its resting/still workers fell nearby forest into its first tier;
  bought comfort lifts the tier above that. Land sets the site: water edge and forest/meadow best, desert and
  wasteland worst; other towns' claims repel.

## Firm founding (free workforce, worker-owner)

- `STILL` fresh workers write `amount` into an idle grid at write time, like the gather grid.
- Every `FIRM_SCAN_TICKS`, where the idle sum within radius 2 clears `FIRM_FOUNDERS`, the best empty nearby
  walkable cell is chosen by value: output bid minus recipe input cost at that cell, gated by resources (a mine
  needs a deposit; a factory needs coal reach; a sawmill needs a wood bid above 1.5 × its gate over forest and
  no other sawmill within its cutting reach). A random free worker from that workforce becomes the firm's
  **owner** and builds it into a working firm with an empty purse (`0` minted gold); a worker who already owns a
  firm adds the site to the same owner. Hand-placed firms get an owner the same way.
- The gold mine needs delivered wood (`GOLD_WOOD` per unit of output) besides labor; the reference scene seeds a
  small starting timber stock (`GOLD_START_WOOD`, booked as `seededWood` in the wood ledger). Felled logs are
  placed as particles on the cut cell and their unsold total throttles the mill that cut them.
- The owner is liable for the firm's debt across all facilities it owns. Startup cash comes from an explicit
  owner transfer or a bank loan (`plan-gold-and-paper-money.md` F0/F1), never from placement minting. The
  mine can pay workers from its own extracted gold; a sawmill owner borrows from the bank to pay workers.

## Commercial food farms (`farms.js`)

- Food bid clearing the labor break-even gate plus at least three idle fresh workers in a radius-two area enables
  farm founding (`FARM_SPACING = 22`). The same value scan compares food output value with mines/factories/sawmills
  (`SAWMILL_SPACING = 12`). No town initiates a worker spawn.
- A site needs at least three legal cells, mean humidity quality ≥ 0.35, and either one unit of forest in
  radius two or one unit of local wood. Wood is a bought/local construction stock traded from sawmills.
- Construction and production use the same paid shift crews. Every 0.25 worker units spent permits a random
  clearing visit in the 5×5 area (misses count). Cut all forest in that cell to zero, keep felled wood, and
  establish exclusive farmland. Construction consumes one wood; it cannot finish without a field.
- One worker per field cell; in derived mode the dimensionless food-to-wage ratio sets desired crew/field count
  (`ceil(max(0, priceFood / wage − 1.5) · 4)`, bounded 1…12; `ceil(priceFood / 0.45 · 12)`, 1…25 legacy). When
  output suppression is active, full output barns (`outputHeld ≥ 1.5 · FARM_YIELD`) cool wage bids and pause
  seasonal field work until grain dispatches.
- Harvest every seven simulation seconds, all fields together. Staffed share is accumulated crew-seconds /
  season / plot count, capped at one. Each fully staffed cell yields six food times humidity quality
  `max(0, 1 − ((moisture − 0.6) / 0.3)²) · (1 − waste)`, sampled only at harvest.
- Wage bid uses food output value per worker unit, pool vacancy, barn room and owed-wage cooling. Wage cost accumulates
  into the next harvest cost basis. Food batches use the standard particle transport, spoilage and payment split.
- Each harvest sends `0.0004 · food` waste to one uniformly random in-map cell at Chebyshev distance three.
  Neighboring farmland is not exempt. Farm waste persists across land refresh; clearing claims block forest
  regrowth, other firms and garden plots. Erasing a farm releases its fields and flushes food buffers normally.

## Worker-owned lifecycle (`worker-life.js`)

- Each worker tracks comfort history (5-second smoothing), personal split cooldown and time without
  food. History samples town coal/goods comfort and is retained while away; it belongs to the worker, not town.
- A worker at least 45 seconds old (or 45 seconds since its last split) may split when needs ≥ 0.75,
  bag ≥ 0.9, wallet ≥ `0.5 · money.unitScale()` in derived mode (`16` gold legacy) and tired portion ≤ 30%. The
  cooldown measures age, not uninterrupted prosperity: otherwise ordinary eating/refill cycles prevent reproduction.
  No vacant room is required.
- Parent keeps its identity. Child receives a new ID in `STILL` at the parent's location. Gold, food and tired
  amount are divided equally, never minted. Both must qualify again. A full pool leaves the parent unchanged.
- Foraging is the first response to hunger. Only 120 continuous seconds with an empty personal food bag
  despawns a worker. Receiving food resets the grace period. Location, comfort, tax and wealth cannot kill.
- Swap-remove all worker and lifecycle columns; watched IDs remain stable. The removed wallet enters the
  custody account, preserving gold. Removed tired mass is explicitly booked for the labor ledger.

## Steering & movement (`steering.js`, shared by goods and workers)

- Terrain speeds: meadow `1`, desert `0.85`, forest `0.75`, water `0` (impassable). Edge conductance is the
  harmonic mean of endpoint speeds; haul effort per unit `∝ 1 / conductance`.
- Smoothed heading `STEERING_BLEND = dt / (0.18 + dt)`; launch from a dock along the steepest uphill edge.
- Speed `∝ c · s / (s + knee)` where `knee` and dock thresholds scale with the live field peak (`REL_KNEE · peak`,
  `2.5e-3 · peakLabor` for jobs, `REL_DOCK · peak` for goods, `DOCK_SLOPE` for dimensionless home/rest fields) and
  neighbor tie-breakers are relative (`1e-12 · |here|`), keeping trajectories invariant under redenomination.
  Goods 5 cells/s, workers 7 cells/s at full slope.
- Arrival tests are cell-based (particle enters the buyer/firm/town/garden cell), never distance-to-centre.

## Conservation ledgers (checked every test tick)

- Goods per kind: `produced − consumed − spoiled = stored + spawnBuffers + inParticles`.
  For commercial food, `consumedFood` is removal from the trade chain into personal bags at bazaar sale;
  wild/garden food and personal digestion are a separate subsystem.
- Headcount: `Σ worker.amount = seeded + splits − starved`; founding and foraging never change headcount.
- Labor: `Σ tired = seededTired + worked − rested − removedTired`.
- Gold: `towns + owner cash + bank reserve + transport + custody + wallets = initial + mined` to `< 1e-7`.

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
- `towns.js` — room services, bazaar food purchases/sales, tax and wealth class; no lifecycle.
- `worker-life.js` — personal split eligibility/history, starvation and dense-pool removal.
- `farms.js` — commercial fields, wood construction, paid crews, batch harvests and outside waste.
- `workforce.js`, `land.js`, `settlement.js` — pareto home policy, water/forest/desert land & claims, young-town
  founding and forest-felling tier build.
- `founding.js` — idle grid and firm founding from free workforce.
- `gold.js` — gold origin ledger, scenario funding, town purses, owner waterfall, wage claims, transport/custody
  accounts and town drip.
- `owners.js` — shared owners, facility ids, per-site budgets and debt limits.
- `banks.js` — F1 gold bank: loans from existing reserve, simple interest, arrears, default and write-off.
- `fields.js`, `telemetry.js`, `app.js`, `index.html`, `styles.css`, `README.md` — particle & field render,
  ledgers, watched worker readout, Garden tool and UI.
- `*.test.js` — node test suites (`conservation`, `workers`, `food-life`, `forage`, `founding`, `gold`, `banks`,
  `diagnostics`, `wrap`, `render`, `ui`).

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
3. **Towns and founding:** wealth class on room services, worker-owned splitting/starvation, commercial food farms, founding from still
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
  - **self-foraging survival:** workers with reachable food survive an unsupplied town; hungry workers enter
    `FORAGE` mode, ignore strong nearby `priceLabor` and `priceHome` pulls until fed, follow the low-res `forage`
    gradient to water shorelines, forests or a Monastery garden, gather free food and return to normal states;
  - **Monastery garden:** clears/tends surrounding plots, harvests seasonal food into `gardenStock`, emits into the
    coarse `forage` gradient, feeds out-of-money / foraging workers for `0` gold, and steps back cleanly when its
    granary is eaten empty;
  - rested worker leaves the room at once; with no job gradient he is `STILL` fresh and counted idle;
  - still depleted crowd beyond town reach founds a young town on good land (shoreline/meadow), not in desert or
    in a claim;
  - idle crowd near a deposit founds a mine; no gold minted by any founding;
  - splits and starvation keep headcount ledger exact (`seeded + splits − starved`), preserve wallets/food on
    split and worker identity across compaction; no food is manufactured by towns.
  - commercial farm siting gates, full clearing, wood construction, staff-scaled seven-second harvest,
    humidity-at-harvest yield, adjacent-farm waste and paid food delivery.
- **L2:** after game port: `smoke` + `dom_smoke` + `mape_*` comparison and the manual list.

## Manual verification checklist

- Goods views: particles stream mine → factory → town, warming in colour as transport cost adds up.
- Watch a worker: click a worker on the map; the reference cycle plays out with live `state`, `gold`, `tired`,
  `food` and event notes.
- Stop food deliveries: as `food` bags run out, workers turn to `FORAGE`, ignore job bids,
  walk to lakeshores, woods or the Monastery garden, refill `food`, and resume work/rest.
- Place a Monastery garden near broke workers: plots till around it, seasonal harvests fill its free granary, the
  `Forage` map peaks over it, and penniless workers gather rations there for `0` gold.
- Crowd a town: queue grows, tax rises, newcomers turn to a cheaper town; rooms free up as rested workers leave.
- Flood a firm: pool %, wage → 0; remove the extra demand and the pool refills.
- Remove all jobs near a town: rested workers stand still outside it; after a while a new firm appears.
- Remove all towns: tired workers shelter-rest on the spot, a young town founds on shoreline/meadow away from
  facilities and desert, fells forest into its first tier, production restarts.
- Compare a cheap and a rich town: cheap drops tax to fill rooms and grows on queue, rich keeps free rooms.

- Place a farm near food demand and fresh workers: forest clears fully, fields expand with crew, and Food view
  shows seven-second food batches reaching bazaar stocks. Erase it and check released plots and live gold ledger.
- Keep a worker fed, comfortable and prosperous: it splits without town involvement; watch the wallet/bag divide.
  Isolate a worker from all food: it first forages, then despawns only after 120 empty-bag seconds.
