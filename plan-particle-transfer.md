# Particle transfer model plan

Design for the particle economy engine of `draft/particle_transfer_model.md` (with `draft/town-settlement.md`,
`draft/workers-food.md`, `draft/company/`). Fields carry **prices and appeal** only; every moving or stored
good and **every person** is a particle object with an owner, a cost basis and (for workers) a wallet. The
pricing, pool, tax, land and settlement rules are the ones `prototype/price-model-b2` already runs on a cell
field; this engine swaps the transport substrate (Eulerian cell flow → Lagrangian SoA particles) under them.
All numbers live in the owning source file; numbers below are starting values.

## Scope

- Built and verified in a standalone lab `prototype/particle-transfer/` on a B2 base, then ported to the game as
  `mape.moneyEngine === 'particle'` and made the default.
- Goods particles: variable `amount` (spawn accumulator, spoilage). Worker particles: fixed headcount with a
  continuous `tired` portion, persistent identity and wallet.
- Town population = the worker objects inside it. A town is not a worker router: it never holds, releases or
  rate-limits workers. It sells rest for tax and buys goods for comfort.
- Deferred (own drafts/plans): house owners, food bag and bazaar, free workers gathering on the map, Transport
  Company staffing/depots, visible return-payment coin particles, roads/ships, town upkeep and depot wear,
  shelter mortality, construction material (wood) for new firms, several firms per cell.

## Time model

Lab tick `ECONOMY_DT = 1/60 s` (B2); game tick `SIM_STEP_SEC` (`main.js`), speeds multiply tick count, never
`dt`. Every rate is per simulation second and every update is a bounded fraction of its source
(`units-and-scales.md`): one diffusion pass per field per tick, fades as `exp(−k·dt)`. A particle moves at most
`speed · dt` per tick (< 1 cell), so rules do not depend on particle count.

## Fields (not conserved — diffused + faded)

- Buyer bids: `priceCoal`, `priceGoods` (later `priceIron`, `priceLogs`, `priceFood`). Firm wage bid: `priceLabor`.
- Home fields (B2 `workforce.js`): `priceRest` (rest quality: comfort, tier, free-space lift, land rest, crowding)
  and `priceHome` (rest per gold of actual tax: `shelter · refTax / goldTax`, no `popRoom`).
- Bids come from the B2 optimizer: output value split over inputs inside `JOINT_BUDGET_SHARE`, cooled by owed
  bills (`creditCool`), zero when input buffers are full, profit smoothed by `tanh(profit / ref)`.

## Particle pools

Fixed-capacity typed-array SoA, dense, compacted by swap-remove (loops never skip holes). No allocation,
closure or object literal per tick. Positions are continuous cell coordinates; `hx, hy` is the smoothed heading.

- **Goods:** `kind, x, y, hx, hy, amount, factoryCost, transportCost, owner`.
- **Workers:** `id, state, cell, x, y, hx, hy, amount, tired, gold, intent, since`.
  `amount = WORKER_UNIT` is fixed (lab: 1 worker; the 64×64 sizing pass may raise it to a fixed crew).
  `tired ∈ [0, amount]` is the depleted portion; fresh portion = `amount − tired`. `id` is stable across
  compaction so a worker can be watched for its whole life. `since` is the tick of the last state change.

Docked workers (pool, shift, wait, room, still) are the same objects with `cell` set; they are not drawn while
docked but always counted, carry their gold and keep their state.

## Cell view: how B2 rules are reused unchanged

B2 rules read per-cell stocks. Each tick, after workers move, one pass over workers rebuilds per-cell
aggregates (`fill(0)` then accumulate): `labor[i]` (fresh in firm pool + shift), `depleted[i]` (town wait pool),
`pop[i]` (town occupants: room + wait), `stillDep[i]`, `stillFresh[i]`, wallet sums and `intent · amount` sums.
`WorkerPolicy`, `Land`, `Settlements` and the actors read this view; their outputs (labor used, rest given, tax
due, founding) are applied back to the individual workers of that cell in proportion to their share. A rule never
writes the view.

## Goods particles

- **Spawn:** each producer cell accumulates `(spawnAmount[i], spawnCost[i])`; at `≥ SPAWN_UNIT` it emits one
  particle with proportional cost, only if the uphill price gradient clears the sell floor
  `selfPrice = (factoryCost / amount) · (1 + SELL_MARGIN)`. Idle flush: a partial batch above the dust floor is
  emitted after ~2.5 s without additions, so a closing mine never traps stock.
- **In transit:** climbs its kind's price field. `transportCost` accrues per distance hauled
  (`haulCostRate · amount · ds / conductance`; zero while held). Spoilage `amount *= exp(−spoilRate · dt)`
  (food fast, logs/goods slow, coal/iron/ore none) is booked as `spoiled`.
- **Derived price:** `item.price = (factoryCost + transportCost) / amount`, never stored. Rendered colour.
- **Arrival:** a buyer admits up to `cap − stock`, normalized across all particles arriving that tick; the
  rejected remainder counts as that buyer's queue (cools its bid, never its cap). On admission:
  1. buyer pays `buyerPay = amount · priceKind[buyer]` from its purse;
  2. `transportPaid = min(buyerPay, transportCost)` → single map-wide **Transport Company** vault (gentle drip
     back to active towns so the vault does not hoard);
  3. `factoryRevenue = buyerPay − transportPaid` → `owner` purse (direct credit).
  Profit identity: `profit = amount · (buyerUnitPrice − item.price)`; gold is conserved by construction.
- **Underwater** (`buyerUnitPrice < item.price`): re-steer up any gradient that still clears `item.price`; at a
  local price maximum non-perishables wait in consignment (no transport accrual), perishables sell at spot before
  rotting and book the loss on `owner` so the over-supplier scales down.

## Worker life cycle

States: `WALK_JOB`, `FIRM_POOL`, `SHIFT`, `WALK_HOME`, `TOWN_WAIT`, `ROOM`, `STILL`.

1. **Job.** A worker with `tired = 0` climbs `priceLabor`. At a firm: a free shift slot → `SHIFT`; else a free
   pool place → `FIRM_POOL` (FIFO into shifts); else keep walking. Pool + queue count toward occupancy, so the
   posted wage falls to `0` on overflow (bid only — the admission cap stays, or an emptied pool locks itself out).
2. **Wage at entry.** On joining the pool the firm prepays the shift: `priceLabor[firm] · amount` from its
   purse into `gold`. A firm that cannot prepay admits nobody (its bid is already cooled by `creditCool`), so no
   wage debt and no minted gold exist. Wage level is fixed at entry; later overflow never cuts it.
3. **Work.** In `SHIFT`, `tired += WORK_RATE · amount · dt`; the firm recipe consumes exactly that labor. At
   `tired = amount` the worker becomes `WALK_HOME`.
4. **Home choice.** `WALK_HOME` climbs the wallet-blended score `(1 − w) · priceHome + w · priceRest`,
   `w = walletWeight(gold, amount)`: broke workers chase rest per gold, funded workers chase rest quality (the
   pareto choice). A town takes him only if no neighbour scores higher for his `w`, so he is not caught by the
   first town on the path.
5. **Wait.** Rooms full but wait-pool place free → `TOWN_WAIT`, no tax, no rest. Wait crowding raises
   `townRestTax` (B2), steering newcomers elsewhere. Pool full → keep walking.
6. **Rest.** A free room → `ROOM`: pays `fee = townRestTax · tired` into the town purse. A worker with less
   than the fee pays all he has and buys rest in proportion; the rest of his `tired` recovers at the shelter rate
   after leaving. In the room `tired` falls at the town rest rate (comfort, tier, land, free-space lift).
7. **Leave.** At `tired = 0` he leaves the room immediately (the room is free for the queue). If the
   `priceLabor` slope at his cell clears the dock gate he walks to the next job; otherwise he becomes
   `STILL` fresh — **free workforce** (counted for new firms, below).
8. **Still.** Any walker whose slope falls below the dock gate becomes `STILL`. Still with `tired > 0` rests at
   the shelter floor for free (`IDLE_RATE · land.rest`), even if not fully depleted, and builds settle intent.
   A still worker re-launches as soon as his own gradient clears the gate.

Reference cycle (the draft check, exact numbers are tuning): worker with 50 g walks to a job, is paid 5 at entry
(55), works until tired, walks to the best town for his wallet, waits in its pool while rooms are full, pays 6 on
check-in (49), rests, leaves, walks to the next job — same `id`, same `amount` throughout.

## Towns

- **Rooms** = built size (B2 tier pop cap × land site quality). **Occupants** = `ROOM` + `TOWN_WAIT` workers.
  Needs (coal, goods) are consumed per occupant-second; satisfaction gives comfort.
- **Tax and size by wealth class** (deterministic per cell, B2): **cheap** drops tax to fill vacant rooms, grows
  when the queue fills; **med** buys needs, then grows; **rich** keeps a cozy occupancy (queue ≈ 0, a few free
  rooms), raises tax rather than growing, cuts size first when needs are unmet. Cheap/med keep built size and
  shrink slowly only when long vacant or broke.
- **Births and deaths** change headcount, never mass of a worker. Per-town accumulators: births
  `+= BIRTH_RATE · occupants · max(0, comfort − BIRTH_COMFORT) · dt` while rooms are vacant; deaths
  `+= DEATH_RATE · occupants · max(0, DEATH_COMFORT − comfort) · dt`. At `≥ amount` a newborn worker object
  (gold 0, `tired = 0`) leaves the town, or the most-tired occupant is removed and his gold goes to the town purse.
- Gold: towns start with seeded purses; worker wallets are seeded at spawn; the gold mine is the only source.

## Settlement founding (still depleted workers)

B2 `Settlements` / `Land`, per worker:

- **Intent.** A `STILL` worker with `tired > 0` beyond town reach (`priceHome + priceRest < FOUND_REACH`) raises
  `intent` toward 1 over `INTENT_SECONDS`, otherwise lowers it. At `intent = 1` he writes `amount` into the gather
  grid around him (radius `FOUND_RADIUS`), tracking the best `gather · land.site` at write time — no map rescans.
- **Found.** When the best score clears `FOUND_SETTLERS` (cooldown `FOUND_COOLDOWN_TICKS`), a young town is
  placed there with its cell's wealth class and town claim stamped. The gathered workers check into its rooms free
  of tax, carrying their own gold; no gold is minted, the town starts broke and lives on tax.
- **Young town** (tier below `WOOD_TIER_CAP`): its resting occupants fell nearby forest into its first tier
  (storyline: they build their homes while recovering); bought comfort lifts the tier above that. Land sets the
  site: water edge and forest/meadow edge best, swamp worst; wasteland and other towns' claim repel.

## Firm founding (free workforce)

- `STILL` fresh workers write `amount` into an idle grid at write time, like the gather grid.
- Every `FIRM_SCAN_TICKS`, where the idle sum within radius 2 clears `FIRM_FOUNDERS`, the best empty nearby cell
  is chosen by value: output bid minus recipe input cost at that cell, gated by resources (a mine needs a
  deposit; a factory needs coal reach). It becomes a construction site that posts a labor bid; build time scales
  with workforce; on completion it is a firm with an empty purse that sells before it pays (no minted gold).
- Heavy-input firms prefer the weighted centre of their deposits (draft `company/new-construction-build.md`);
  wood for construction is deferred.

## Steering & movement (`steering.js`, shared by goods and workers)

- Gradient sampled from the 8-neighbour edges, weighted by edge conductance (harmonic mean of endpoint terrain
  speeds); haul effort per unit `∝ 1 / conductance`.
- Smoothed heading `STEERING_BLEND = dt / (0.18 + dt)`; launch from a dock along the steepest uphill edge (a
  blended heading cancels between two equal buyers and would never leave).
- Speed `∝ s / (s + GRADIENT_KNEE)` (no hard knee gate — a decayed wage field must still pull). Workers dock as
  `STILL` below `DOCK_SLOPE = 0.1 · GRADIENT_KNEE`. Goods 6 cells/s, workers 12 cells/s at full slope.
- Arrival tests are cell-based (particle enters the buyer/firm/town cell), never distance-to-centre.

## Conservation ledgers (checked every test tick)

- Goods per kind: `produced − consumed − spoiled = stored + spawnBuffers + inParticles`.
- Headcount: `Σ worker.amount = seeded + births − deaths` (founding moves workers, never changes headcount).
- Labor: `Σ tired = worked − rested` (work raises, rest lowers; accumulate recovery once per tick, not per worker,
  to keep float drift below tolerance).
- Gold: `purses + wallets + vault + firm purses = seeded + mined` to `< 1e-7`.

## Rendering

- Goods views: live particles at continuous coordinates over dimmed terrain; `item.price` → colour ramp,
  `amount` → brightness and radius.
- Worker views (`Labor`, `Depleted`): walkers coloured by wallet per worker, brightness by fresh/tired portion;
  docked stocks drawn as cell intensity (pool, wait, room, still) under them.
- Paired map: the diffused price/appeal field with equal-price contours; stock log scale, price linear with
  1-2-5 nice-ceil steps.
- Inspector: hover a cell for pools, rooms/occupants/queue, tax, wealth class, intent, idle sum; click a worker to
  watch it (id, state, wallet, tired, last payments).

## File layout

Lab `prototype/particle-transfer/` (each file < 500 lines, header per `AGENTS.md`):

- `simulation.js` — grid, fields, cell view rebuild, tick order.
- `steering.js` — conductance, gradient sampling, heading, bounded move.
- `goods.js` — goods SoA pool, spawn accumulators, arrival split, consignment.
- `workers.js` — worker SoA pool, life-cycle states and transitions, admission, entry wage.
- `actors.js` — firm recipes, bids, pools (from B2); `towns.js` — rooms, tax, wealth class, births/deaths
  (split out of B2 `actors.js`, which is already over 500 lines).
- `workforce.js`, `land.js`, `settlement.js` — B2 copies, reading the cell view.
- `founding.js` — idle grid and firm founding.
- `gold.js` — purses, wallets, Transport Company vault and drip.
- `fields.js`, `telemetry.js`, `track.js`, `app.js`, `index.html`, `styles.css` — render, ledgers, watched worker, UI.
- `*.test.js` — node tests.

Game port: `map-money-particle.js` (+ split owner files as needed), dispatched by `mapeStepMoney` when
`mape.moneyEngine === 'particle'`; new owners get AGENTS.md map entries.

## Phases (minimal first, each ends green)

0. **Lab base:** pure copy of B2 into the lab (move commit), tests still green.
1. **Goods particles:** coal → goods chain (one mine, one factory, one town; workers still B2 cell flow).
   Accumulators, sell floor, admission, arrival split, Transport Company vault, consignment.
2. **Worker objects:** seeded worker particles replace cell labor/depleted flow and `pop[i]`; the full life cycle,
   entry wage, wait pool, rooms, wallet-blended steering, shelter rest, cell view feeding B2 rules.
3. **Towns and founding:** wealth class on rooms/occupants, births/deaths, settlement founding from still
   depleted workers, young-town build, firm founding from free workforce.
4. **Full engine:** more kinds and spoilage rates, Transport Company drip, watched-worker UI, 64×64 sizing
   (200–800 live particles), port to the game and flip the default to `'particle'`.

## Validation

- **L0:** `node --check` on touched files.
- **L1:** `node --test` in the lab:
  - all conservation ledgers above, every tick of a 120 s reference run;
  - profit identity per arrival; full buyer never over-accepts; underwater perishable books a loss;
  - reference cycle: one watched worker with 50 g — wallet `+wage` at entry, `−fee` at check-in, same `id` and
    `amount` through job → walk → wait → room → leave → next job;
  - pool overflow drives the wage to 0 but an emptied pool still admits; town crowding raises tax;
  - broke worker picks the value town, funded worker the rest-quality town; dominated town does not catch;
  - rested worker leaves the room at once; with no job gradient he is `STILL` fresh and counted idle;
  - still depleted crowd beyond town reach founds a young town on good land, not in desert or in a claim;
  - idle crowd near a deposit founds a mine; no gold minted by any founding;
  - births/deaths keep headcount ledger exact.
- **L2:** after port: `smoke` + `dom_smoke` + `mape_*` comparison and the manual list.

## Manual verification checklist

- Goods views: particles stream mine → factory → town, warming in colour as transport cost adds up.
- Watch a worker: the 50 g reference cycle plays out on screen; inspector wallet matches the event list.
- Crowd a town: queue grows, tax rises, newcomers turn to a cheaper town; rooms free up as rested workers leave.
- Flood a firm: pool %, wage → 0; remove the extra demand and the pool refills.
- Remove all jobs near a town: rested workers stand still outside it; after a while a new firm appears.
- Remove all towns: tired workers shelter-rest on the spot, a young town founds on meadow/water edge away from
  facilities and desert, fells forest into its first tier, production restarts.
- Compare a cheap and a rich town (e.g. 5/10, 10/10 occupants/rooms): cheap fills and grows, rich keeps free rooms.
