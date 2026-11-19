# Map-economy engine prototype plan — 4.1b

Standalone design for the map-economy engine prototype from draft 4.1a. It covers
settlements with populations, demand as a distance field, gradient goods flow,
factory placement and construction, resource and product storage, transportation
workforce, the coal–CO2–forest loop, and selectable field engines with a planned
discrete shipment engine behind the same interface. All numbers live in
the owning source file and are tuned from experiment logs.

## Time model

Simulation time runs in real-time seconds on 1× speed, with `1 s = 1 day` in
storyline. The fixed step is `0.05 s` (`SIM_STEP_SEC`); speeds are `0`, `20`,
`40`, and `80` ticks per real second (`0×`, `1×`, `2×`, `4×`). The survey and
reference scenes start at **4×**. The animation frame caps accumulated sim time
at 0.4 s so a stalled tab cannot lock the page catching up. Rates are per simulation second (`/s`, equal
to per storyline day) and every duration is in seconds, so a typical factory
build of `20 s` (`10–30 s` range) finishes in 20 real seconds on 1× (`5 s` on 4×)
and advances the storyline by 20 days. The HUD clock shows both storyline day and
elapsed seconds.

## Scope

Prototype loop: ~2% of map cells start as settlements with small random
populations; population demands goods and coal; nearby stock cools import demand.
Demand diffuses and physical stock moves up its gradient. Regional workshops
provide goods while all deposits are still locked. A staffed sawmill randomly
selects a forest cell in its local radius, creates logs on that cell, and only
cuts where log demand reaches it. Logs move toward staffed charcoal and wood
works; charcoal turns logs into coal, while wood works turn them into goods.
Stock feedback cools log demand, so surplus logs suppress additional cutting.
In the factory phase, factories appear where goods need and coal/iron surplus overlap, build
over 10–30 s while demanding iron, then consume coal and iron ore to produce
goods plus waste plus CO2; settlements consuming goods leave waste and burning
coal releases CO2; waste is disturbed land (`land.js`); CO2 feeds forest growth;
production and transport create workforce demand that attracts migration;
population grows where needs are met and declines where they are not. The player
observes the fields, inspects any cell, selects a job site to read its staffing
and performance, trades and hires at settlements, and
unlocks deposits by investigating to 100% and holding territory so mines can work
them. Factories are placed by the engine, not by the player. Two population
workforce models are available: **Fluid field** (default; a workforce pool diffuses to
jobs and recycles through settlements) and the **Residents** model (default off;
workers physically walk to jobs); see **Workforce models**.

Deferred to follow-up after 4.1a: oxygen as a population/factory need and low-O2
production throttle (closing the full CO2↔O2 constraint), multi-product recipes
beyond one, player-built factories, caravan agents, larger maps, rival
map-economy actions.

## Engine order: shared field foundation, then sites

Catchment A is the playable default for coal and goods. Queue B compares local
service against regional uptake; signed Diffusion remains the comparison for
Phases 0–3. All three share land, stock, markets, workforce, mines, atmosphere
and the renderer. Logs, iron and CO2 use the shared diffusion path in every mode.

The discrete Sites engine follows in Phase 4. It replaces goods routing and
factory placement scoring on the shared economy foundation and is selectable
only when it runs the full loop.

## Relationship to the base prototype

The base prototype (`plan-prototype.md`) provides the 64×64 terrain map, party,
skills, investigation, non-town sites, rival agents, per-faction influence
fields (`territory.js`), disturbed fraction (`land.js`), biomass and oxygen
(`economy.js`), and victory declaration. The map economy replaces the town layer:

- Settlements replace towns. Town sites, town stocks and town prices are removed
  from `sites.js` and `economy.js`. About 2% of all cells (~82 cells) seed as
  random walkable settlements with population 8…20 (at least one within 6 cells
  of party spawn). Selling resources/relics, buying supplies and hiring members
  happen at a settlement cell (`pop ≥ 3`, with at least 4 for hiring). `economy.js` keeps party inventory,
  resource tables, the field recipe, biosphere and the party conservation ledger.
- Demand and goods are flat typed arrays mutated in place with zero per-tick
  allocations. Material stock uses Float64 so larger shipments and longer runs
  don't accumulate visible ledger drift.
- Waste is not an item: mining, factory construction/production and settlement
  goods consumption call `landDisturbAround` (`land.js`), so the source keeps
  `LAND_WASTE_SOURCE_SHARE` of it and the rest lands on the walkable neighbours;
  mines also add a spoil ring around the shaft. Waste then creeps outward with
  `LAND_WASTE_SPREAD` over land only. Productivity `(1 − d)` scales population
  cap, mine rate and forest growth, so a fully wasted cell has no carrying
  capacity, while natural recovery scales with `(1 − d)`.
- Forest cover (`economy.biomass`) is a property of every non-water cell, not
  a generated terrain class. Root-zone moisture starts at the seeded climate/elevation
  baseline. Survey hydrology advances one fixed 0.05 s water-lab step per 0.2 sim-seconds:
  springs feed downhill channels, the sea and land evaporate into moving air, and
  moisture condenses over persistent flow. Surface water never replaces terrain.
  Soil is a 0–1 suitability input, not another conserved water stock. It relaxes 2.5%
  toward a local target each weather step: baseline plus bounded recharge from air,
  standing water and bank seepage. Hills retain less recharge than meadows. Flat
  reference scenes hold soil at 0.5 and do not advance weather.
  Each shared economy substep runs the forest cycle in every engine, including scenes.
  Coal burning emits CO2; forest growth removes it and dieback returns it.
  Oxygen production/use follows the signed carbon exchange.

## Core concepts

- **Cell**: one of 4096 cells (`64×64`), linear index `i = y * 64 + x`.
- **Settlement**: any non-industry walkable cell with `pop[i] ≥ 3`. Seeded at ~2%
  of all cells (~82 cells) with population 8…20; steady-state density emerges
  from growth and migration. Market funds `money[i]` scale with `pop[i]` and
  recover over time, so larger settlements carry deeper purchasing power (draft
  4.4). Mine and factory cells (`MAPE_CELL_INDUSTRY`) hold resident workers and
  count toward `totalPop` without acting as town markets. They hold no
  settlement population: in Fluid field their `pop` is pinned to zero, in
  Residents the crew standing there is workforce only — it never grows, wears no
  town marker and never trades.
- **Population `pop[i]`**: persons in cell `i`, range `0…120 × productivity[i]`.
- **Items (`R = 4`)**: `COAL (0)`, `IRON (1)`, `GOODS (2)`, `CO2 (3)`. Coal fuels
  factories and settlements, releasing CO2; iron ore feeds factory construction
  and production; goods satisfy settlements and leave disturbance; CO2 feeds
  forests. Mapped to party resources: `FUEL ↔ COAL`, `ORE ↔ IRON`, `GOODS ↔ GOODS`.
- **Demand `demand[r * N + i]`**: diffused per-item routing signal. Diffusion
  uses positive need and negative surplus; A and B use nonnegative import pull
  for coal and goods. Stock moves up the gradient.
- **Goods `goods[r * N + i]`**: physical stock (or CO2 concentration for `r = 3`)
  in cell `i`. Kept alongside demand for mass conservation and to test gated vs
  demand-only production.
- **Storage**: a registered stock location. Mines and factories register
  storages at their cells; signed stock feedback reads all walkable cells.
- **Workshop**: up to eight small survey goods sources on land near but outside
  the nearest towns' catchments. They start with 3 units and make up to
  `1.8 × productivity` goods per second, stopping at 8 local units until
  exports free room. These background producers do not stand in for the coal
  and iron factory recipe.
- **Factory**: built over `MAPE_FACTORY_BUILD_SEC` (`20 s` default, `10–30 s`
  typical) while demanding iron; when active, runs
  `coal + iron → 2 × coal goods + waste + CO2`, needs workforce, and leaves
  waste on its cell and the ring around it.
- **Mine**: bound to a coal or iron deposit from `sites.js`. Starts locked with
  zero mined stock; once unlocked, injects workforce demand (`MAPE_MINE_WORKERS`),
  draws workers across walkable cells, extracts into local storage scaled by
  worker staffing (`workers / MAPE_MINE_WORKERS`, active at `≥ 0.1` workers), and
  drops a spoil ring beside the shaft.
- **Forest**: continuous cell cover responding to soil moisture, CO2 and waste (section 3.1).
- **Job slots `jobNeed[i]`**: the factual workforce a cell asks for — unlocked
  mines, building and active factories. It never diffuses and drives the
  `jobs` display layer.
- **Workforce `workforce[i]`**: job pull. Job slots raise it at their cells
  (`MAPE_WORK_SIGNAL`); only the Residents model adds goods-transport effort,
  at a quarter rate, because only there do haulers exist. It decays at
  `MAPE_WORK_DECAY` and diffuses over walkable cells so jobs pull across the
  map. Two selectable population models consume the same pull (see **Workforce
  models**): Residents moves idle residents up the pull physically; Fluid field
  generates fresh workforce at population cells, advects it up the pull, and
  recycles it through depleted workforce and settlements.
- **Rest pull `wfRestPull[i]`**: fluid model. Settlement cells advertise their
  absolute free capacity (`max(0, MAPE_POP_CAP × settleValue × productivity − pop) / MAPE_POP_CAP`); the signal decays
  at `MAPE_WF_REST_DECAY` and diffuses over walkable cells, so exhausted
  workers are drawn home. Full settlements advertise nothing.

## Data model

`map-economy.js` owns shared fields, survey seeding, markets and the ledger.
`map-industry.js` handles mine and factory registration, locked deposits and
workshop output. `map-diffusion.js` owns signed diffusion, the shared tick and
worker transport. `map-market-demand.js` owns A/B import pull and household
uptake; `map-population.js` records intake, satisfaction, population dynamics and
household waste. `map-market-flow.js` builds the reflecting land stencil,
catchment membership and B's queue transport buffers. `map-fluid.js` owns the
Fluid field workforce model (the default). `world.js` owns terrain and the
settlement location value map. All buffers are reused per tick.

```
MAPE_R = 5                       // coal, iron, goods, logs, co2
MAPE_SETTLE_TARGET = 0.02        // seeded fraction of cells with pop > 0 (~82)
MAPE_SETTLE_MIN = 3              // min pop for active settlement market
MAPE_HIRE_MIN_POP = 4            // min settlement pop to recruit a party member
MAPE_POP_CAP = 120               // per-cell carrying cap at d = 0 (d = 1 holds nobody)
MAPE_POP_SEED_MIN = 8            // seeded settlement persons, low
MAPE_POP_SEED_MAX = 20           // seeded settlement persons, high
MAPE_NEED_GOODS = 0.02           // signed reference goods need/person/s
MAPE_NEED_COAL = 0.005           // signed reference coal need/person/s
MAPE_MARKET_GOODS_USE = 0.024    // A/B household goods use/person/s
MAPE_MARKET_COAL_USE = 0.03      // A/B household coal use/person/s
MAPE_SETTLE_DISTURB = 0.003      // disturbance per unit goods consumed, spread around the cell
MAPE_SAT_SCALE = 4                // satisfaction response timescale in seconds
MAPE_DEMAND_GAIN = 8.0           // demand signal scale for unmet need rates
MAPE_STOCK_SIGNAL = 0.25       // negative demand per stock unit per s
MAPE_DIFFUSE = 0.72              // 4-neighbour mix per pass (2 passes / 0.2 s tick)
MAPE_DIFFUSE_PASSES = 2          // signed field Jacobi passes (D = 1.8 cells²/s)
MAPE_DECAY = 0.008               // signed demand decay per s (reach sqrt(D/decay) = 15 cells)
MAPE_CO2_DIFFUSE = 0.45          // atmospheric CO2 pairwise diffusion mix per tick
MAPE_FLOW_SPEED = 1.8            // max goods advection rate /s up normalized gradient
MAPE_GRAD_REF = 0.02             // Michaelis-Menten half-saturation for demand gradient
MAPE_WORK_SIGNAL = 3.2           // workforce demand gain per unmet worker per s
MAPE_WORK_DECAY = 0.10           // workforce field decay per s
MAPE_WORK_SPEED = 1.8            // transit worker walking rate /s up workforce gradient
MAPE_WORK_LEAVE = 0.035          // settlement departure rate /s (prevents overshoot drain)
MAPE_MINE_WORKERS = 6            // target workforce for full mine output
MAPE_MINE_MIN_WORKERS = 0.1      // min arrived workers before mine extracts
MAPE_FACTORY_WORKERS = 8         // target workforce for active factory
MAPE_FACTORY_BUILD_WORKERS = 4   // target workforce while building a factory
MAPE_GATE_ON_GOODS = true        // require physical stock, not negative demand alone
MAPE_GROWTH = 0.008              // pop growth /s at full satisfaction (0.8%/day)
MAPE_DEATH = 0.015               // pop decline /s at zero satisfaction (1.5%/day)
MAPE_MIGRATE = 0.01              // base pop diffusion /s
MAPE_MIGRATE_BIAS = 0.04         // pop flux bias toward satisfaction and jobs /s
MAPE_SCAN_SEC = 5                // factory placement scan interval (5 s)
MAPE_FACTORY_THRESHOLD = 6.0     // min placement score to build
MAPE_FACTORY_SPACING = 4         // min cells between factories
MAPE_FACTORY_WORKFORCE_MIN = 10  // min pop within 3 cells to place a factory
MAPE_FACTORY_BUILD_SEC = 20      // construction duration on 1x (10-30 s = 10-30 days)
MAPE_FACTORY_BUILD_IRON = 0.2    // iron demanded /s while building (4 iron total)
MAPE_FACTORY_IDLE_SEC = 40       // starved duration before idling (40 s)
MAPE_FACTORY_COAL = 0.5          // coal consumed /s per active factory
MAPE_FACTORY_IRON = 0.5          // iron consumed /s per active factory
MAPE_FACTORY_YIELD = 1.0         // goods produced /s per active factory (feeds 50 pop)
MAPE_FACTORY_CO2 = 0.5           // CO2 emitted /s per active factory
MAPE_FACTORY_DISTURB = 0.004     // disturbance /s while producing, spills onto neighbours
MAPE_FACTORY_BUILD_DISTURB = 0.0015 // disturbance /s while building, spills onto neighbours
MAPE_MINE_WASTE = 0.0016         // spoil /s on the ring of an active mine shaft
LAND_WASTE_SOURCE_SHARE = 0.55   // share of a source's waste kept on its own cell
LAND_WASTE_SPREAD = 0.0012       // landfill leachate mix per second over walkable land
MAPE_MINE_RATE = 2.4             // resource extracted/s at full staff and productivity
MAPE_SAWMILL_RATE = 1.1          // logs cut/s at full staff when demand is saturated
MAPE_SAWMILL_RADIUS = 6          // random forest-cell search radius
MAPE_SAWMILL_MIN_FOREST = 0.08   // minimum forest cover to cut
MAPE_SAWMILL_MIN_PULL = 0.015    // no harvest below this log-demand floor
MAPE_SAWMILL_FOREST_PER_LOG = 0.025 // forest cover consumed per log
MAPE_FORESTRY_INPUT = 0.55       // logs consumed/s per staffed charcoal/wood works
MAPE_CHARCOAL_YIELD = 0.8        // coal per log; remaining carbon returns as CO2
MAPE_WOOD_YIELD = 1.0            // goods per log
LAND_MINE_DISTURB_PER_UNIT = 0.00025 // disturbed fraction per extracted unit
MAPE_WORKFORCE_PER_UNIT = 0.4    // transport effort / workforce per unit moved (diffusion)
MAPE_WF_GEN = 0.05               // fluid model: fresh workforce per resident per second
MAPE_WF_TIRE = 0.02              // fluid model: fresh → depleted rate /s (balance subject)
MAPE_WF_DIFFUSE = 0.35           // fluid model: depleted spread mix (slower than goods)
MAPE_WF_FLOW = 1.8               // fluid model: fresh advection rate /s up the pull
MAPE_WF_GRAD_REF = 0.03          // fluid model: Michaelis-Menten half saturation for advection
MAPE_WF_SPEND = 1.0              // fluid model: fresh consumed per need per second by jobs
MAPE_WF_REST = 0.05              // fluid model: depleted absorbed per free person per second
MAPE_WF_RETURN = 1.8             // fluid model: depleted advection rate /s up the rest pull
MAPE_WF_REST_GRAD_REF = 0.005   // fluid model: rest pull gradient half saturation
MAPE_WF_REST_SIGNAL = 0.9        // fluid model: rest pull relaxation per second at settlements
MAPE_WF_REST_DECAY = 0.02        // fluid model: rest pull decay per s (uses MAPE_DIFFUSE for reach)
MAPE_WF_MIGRATION_TIME = 10      // seconds of exponential smoothing for net workforce flow
MAPE_WF_MIGRATION_SHARE = 0.1    // fraction of net flow reflected in population per second
MAPE_WF_SPAWN = 10               // fluid model: pooled depleted that spawns a settlement
MAPE_WF_SPAWN_VALUE = 0.35       // fluid model: min settlement location value to spawn
MAPE_CO2_INIT = 0.4              // ambient CO2 per land cell at start
BIO_RESPONSE = 0.08             // forest adjustment /s
BIO_CARBON_PER_COVER = 0.7       // CO2 stored per unit cover
MAPE_MONEY_PER_POP = 25          // market funds target per resident
MAPE_MONEY_REGEN = 0.04          // market funds recovery /s toward target
MAPE_SUPPLY_GOODS = 0.2          // settlement goods used per party supply unit
MAPE_TRANSPORT_COST = 0.08       // site engine: price added per cell distance
MAPE_TRANSPORT_SPEED = 2.0       // site engine: transit speed in cells/s
```

State:

- `pop, popNext: Float32Array(N)` — persons per cell and transport scratch;
  `settleCells: Uint16Array(N)` and `settleCount` index non-industry cells with
  `pop ≥ MAPE_SETTLE_MIN` for fast marker and market passes.
- `demand, demandNext: Float32Array(R * N)` — double-buffered pull (signed or bounded).
- `goods, goodsNext: Float64Array(R * N)` — double-buffered physical stock / CO2.
- `marketSignal: Float32Array(R * N)` — smoothed target per settlement and item.
- `flowX, flowY: Float32Array(8 * N)` — net accepted shipments per cell and tick;
  outflow magnitude is divided by `flowDt` for the display rate. Fresh and depleted slots record accepted advection; depleted also includes its diffusive outflow.
- `workforce, workforceNext: Float32Array(N)` — diffused job pull and scratch.
- `wfFresh, wfDepleted: Float32Array(N)` (+ `wfFreshNext, wfDepletedNext`) —
  fluid model pools: available workforce and exhausted workforce.
- `wfMigration, wfBalance: Float32Array(N)` — smoothed and current net workforce flow for population migration.
- `wfRestPull, wfRestPullNext: Float32Array(N)` — fluid model settlement rest
  pull; double-buffered so the diffusion pass ends in `wfRestPull`.
- `workforceMode`: `FLUID` (default) or `RESIDENTS`; independent of `engine`.
  Ledger counters `fluidRested, fluidTired, fluidSpent, fluidSpawned` track pool
  recycling for experiments.
- `jobNeed: Float32Array(N)`, `cellExport: Uint8Array(N)` — per-cell
  retained job slots (never mutated by walking logic), industry marker.
- `money: Float32Array(N)` — market cash at settlement cells.
- `factories` (cap 32, SoA): `x, y, state` (building/active/idle), `progress`, `starved`.
- `mines` (cap 32, SoA): `x, y, site, res, unlocked`.
- `storages` (cap 96, SoA): `x, y, site` (registered on unlock/build; stock lives in `goods`).
- `engine`: `DIFFUSION`, `CATCHMENT`, or `QUEUE`; `SITES` is reserved for the
  discrete engine. `viewItem`: `0…3`.
- Ledger counters (Float64): `initialGoods, massIn, massOut, dissipated, minedTotal, transportWork, initialPop, popDelta`.

Memory: shared physical and visual fields use about 684 KiB at 64×64. The
land stencil, catchment reach and queue scratch are built once per layout.

## Diffusion engine (Phases 1–3)

The shared tick runs at 0.05 s in the survey. The signed reference kernel can
also step in chunks of up to 0.2 s (`MAPE_MAX_STEP`) with proportionally scaled
mixing; `mapeWarmDemand` relaxes the signed fields over 8 s at boot without
moving stocks or people:

1. **Demand injection.** Cells with `pop > 0` inject `GOODS` and `COAL`
   need rates and negative `CO2`
   emission demand; biosphere cells inject positive `CO2` uptake demand. Building
   factories inject `IRON` demand; active factories inject `COAL` and
   `IRON` demand and negative `CO2` demand. Water cells stay at 0.
2. **Stock feedback (checkbox, on by default).** Each land cell subtracts `stock * MAPE_STOCK_SIGNAL * dt` from its item’s demand field at that cell (stock is the cell total). Switching off removes only this source. Existing signals continue to diffuse and decay.
3. **Demand diffusion.** `MAPE_DIFFUSE_PASSES = 2` symmetric zero-flux Jacobi
   passes per substep (`MAPE_DIFFUSE = 0.72`, `D = 1.8 cells²/s`,
   `MAPE_DECAY = 0.008/s`, reach `15 cells`, subnormal clamp `1e-12`). `COAL`,
   `IRON`, `GOODS` and `workforce` diffuse over walkable 4-neighbours only;
   `CO2` demand and pairwise `CO2` stock diffuse across all cells including water.
4. **Gradient goods and worker transport.** For `COAL`, `IRON`, `GOODS`, stock
   flows across walkable 4-neighbours up positive demand
   gradients using Michaelis-Menten normalization `g_k / (gSum + MAPE_GRAD_REF)`,
   giving uniform haul speed across 20 cells and around coastlines. Throughput
   scales by `0.5 + 0.5 * pop / (pop + workforce + 1)` and adds
   `out * MAPE_WORKFORCE_PER_UNIT` to transport effort and `transportWork`. Every
   edge transfer debits the amount that actually reached its destination, so
   `sum(goods)` and `sum(pop)` remain conserved to storage precision. Unmet mine/factory jobs inject
   `workforce` and retain arrived site workers (`jobNeed`), while idle residents
   depart settlements gradually (`MAPE_WORK_LEAVE`) and walk quickly in transit
   (`MAPE_WORK_SPEED`) up the `workforce` gradient.
5. **Mines, factories and settlements.** Unlocked mines extract via `sitesExtract`
   at `MAPE_MINE_RATE * min(1, pop / MAPE_MINE_WORKERS) * productivity` (once
   `pop ≥ MAPE_MINE_MIN_WORKERS`) into local `goods[res]` and leave waste on the
   shaft and its ring. Building factories consume iron (when `MAPE_GATE_ON_GOODS`
   is on) and advance over `MAPE_FACTORY_BUILD_SEC`. Active factories consume coal
   and iron, emit goods and CO2, and leave waste around them. Settlements consume
   goods (`MAPE_SETTLE_DISTURB` waste, spread around the cell) and coal (emitting
   CO2). Wasted capacity then feeds back through step 7.
6. **Forest carbon cycle (3.1).** For local stock `c`, soil moisture `h`, cover `b`
   and waste `d`, width `w = 0.055 + 0.38c/(c+0.25)` and target cover
   `max(0, 1−abs(h−0.5)/w) × c/(c+0.025) × (1−d)`.
   Signed growth is `0.08 × (target−b)` per sim-second. Positive growth is
   bounded by available local CO2; cover stays in 0–1. A unit of cover stores
   0.7 CO2; dieback releases exactly that carbon locally. Map mass ledgers record
   both directions. Bare cells can establish trees without an existing seed cell.
   Initial cover is 65% of the target at CO2=0.4. Thus change is visible within
   10–30 sim-seconds; high CO2 expands the humidity niche, low CO2 narrows it.
   Amount selectors include waste, forest and soil moisture with fixed linear 0–100%
   legends; these layers have no transport flow. Inspectors show cover and signed
   growth in percentage points/s. Terrain shading follows live cover.
7. **Population growth, migration and workforce update.**

## Population dynamics

Goods satisfaction `satG` and coal satisfaction `satC` compare consumed (or
negative-demand) supply against cell need over `MAPE_SAT_SCALE` seconds; combined
satisfaction is `sat = 0.75 * satG + 0.25 * satC` (clamped `0…1`).

Growth per tick:
`pop += pop * (MAPE_GROWTH * sat - MAPE_DEATH * (1 - sat)) * s`, capped at
`MAPE_POP_CAP * landProductivity(i)` in Residents mode; in Fluid field,
settlement growth additionally respects landscape capacity without abruptly
clamping an existing over-cap town. Landfill waste therefore caps a settlement:
every clamp pass pulls `pop` down to the wasted carrying capacity, and `d = 1`
empties the cell. A dense supplied town outproduces natural recovery, so its own
landfill keeps shrinking its capacity until its population settles at the lower
cap; a village stays below `d = 0.25` and keeps growing. A supplied settlement doubles in ~90 s on
1×; a completely unsupplied settlement halves in ~46 s.

Residents-model migration per tick: positive edge flux across walkable 4-neighbours,
`MAPE_MIGRATE * (pop[i] - pop[j]) * 0.5 + MAPE_MIGRATE_BIAS * pop[i] * (attract[j] - attract[i])`,
where `attract` combines satisfaction and unmet `workforce`. Water never receives
migrants.

Workforce scaling: factory and transport throughput scales by
`localPop / (localPop + workforce[i])`, while unmet workforce pulls migrants in,
closing `factory → jobs → migration → production`. Diffusion is the reference
population lifecycle: it applies growth, decline and attraction-biased migration.
Catchment A and Queue B record household intake and apply its waste/emissions, but
hold demographic growth and satisfaction-led migration for stable routing comparisons;
shared job staffing remains active. In Fluid field mode, smoothed net workforce
movement drives settlement population in all engines, including test scenes; it
replaces the separate edge-migration rule. Diffusion growth and decline still apply.

## Workforce models

`mape.workforceMode` selects how jobs are staffed. Everything else — the
`workforce` pull field, goods routing, satisfaction, metabolism and
waste — is shared. Migration differs by model. An HUD **workforce** segment switches the model at any time
without touching stocks, population or clock; the pull field keeps diffusing in
both models.

### Residents

Idle residents leave settlements gradually (`MAPE_WORK_LEAVE`) and walk up the
`workforce` pull quickly (`MAPE_WORK_SPEED`); jobs check `pop` at their cell.
Their hauling adds transport effort to the pull at a quarter rate — the only
model where goods are carried by people, and the only one that needs a pull
toward transport lanes. Pools and the rest pull stay idle. See **Population
dynamics**.

### Fluid field (default, `map-fluid.js`)

Per-cell pools `wfFresh` and `wfDepleted`; no residents ever walk to work:

1. Each walkable population cell generates `wfFresh += pop * MAPE_WF_GEN * dt`
   every tick.
2. Fresh workforce advects up the `workforce` pull over walkable cells
   (`MAPE_WF_FLOW`, `MAPE_WF_GRAD_REF`, same Michaelis-Menten normalization as
   goods) — the pull is the job-demand gradient, so factories and mines draw
   it exactly like a goods consumer.
3. Fresh workforce degrades over time: `wfFresh → wfDepleted` at
   `MAPE_WF_TIRE` per second. The tire rate is the main balance subject —
   raise it and jobs starve far from habitation; lower it and pools linger.
4. Jobs consume fresh workforce (`MAPE_WF_SPEND` per unit of need per
   second) at their cell and hand the same amount back as `wfDepleted` —
   workers leave tired. Output staffing reads pooled fresh workforce at the
   site, so production ramps as workers arrive instead of on demand alone.
5. Settlement cells relax `wfRestPull` toward their free capacity
   (`max(0, MAPE_POP_CAP × world.settleValue × landProductivity − pop) / MAPE_POP_CAP`, `MAPE_WF_REST_SIGNAL`) and
   the signal diffuses over walkable cells with `MAPE_WF_REST_DECAY`, so each
   town advertises a longer-range gradient. Depleted advects up this pull at
   `MAPE_WF_RETURN`, with a rest gradient reference of 0.005, so tired workers can walk home from distant jobs.
6. Settlements absorb `wfDepleted` at `MAPE_WF_REST` per free person
   (`max(0, MAPE_POP_CAP × world.settleValue × landProductivity − pop)`) and return it as `wfFresh` —
   workers rest at home. A settlement at its cap absorbs nothing and
   advertises no rest pull, so nothing drains into it. Depleted also spreads
   between cells at `MAPE_WF_DIFFUSE`, slower than goods, so tired workers
   linger at the job that spent them until the rest pull wins.
7. Each settlement exponentially averages its net workforce rate (depleted
   incoming minus outgoing fresh and depleted workforce crossing its cell boundary) over `MAPE_WF_MIGRATION_TIME`. Population changes
   by `MAPE_WF_MIGRATION_SHARE` of that average per second: a persistent net
   outward movement gradually shrinks a town and reduces subsequent generation; a net
   inward movement grows it up to its landscape capacity. This is an approximate flow
   signal, not a one-person-per-unit conservation rule. Local generation, tiring and rest do not count as crossings. Existing towns above
   capacity are not abruptly deleted or allowed to grow further; settlement
   counts and the population ledger update after each change. Model switches
   clear the average. The test scenes start fluid towns at 60 residents on
   meadow so they have room, while Residents scenes retain 100.
8. If no settlement drains a cell, depleted pooling crosses `MAPE_WF_SPAWN`:
   the cell becomes a new settlement (pop `MAPE_POP_SEED_MIN`, market funds and
   starter stock as if seeded), the pool is debited by `MAPE_WF_SPAWN`, and the
   spawn event is logged. Spawn requires empty land (`pop = 0`),
   `world.settleValue[i] ≥ MAPE_WF_SPAWN_VALUE` and no industry cell. At most
   one settlement spawns per tick, at the highest pooled cell; skipping
   populated cells keeps the population ledger exact when a settlement pools
   its own returning workers.

`workforceMode` is orthogonal to the goods routing engine and applies in the
test scenes too, where it is the fastest way to watch mines fill and hamlets
found themselves.

## Settlement location values

`world.settleValue[i]` (0…1) ranks how much room a cell offers a settlement.
Computed from terrain and the four neighbours once per world generation or
scene setup, shown in the inspector (`settle 0.80`) and used for fluid
settlement capacity, rest pull and the spawn gate (`MAPE_WF_SPAWN_VALUE`):

| value | cells |
|---|---|
| 1.00 | non-swamp cell adjacent to water |
| 0.80 | forest ↔ meadow edge |
| 0.60 | meadow |
| 0.45 | hills |
| 0.35 | forest |
| 0.15 | swamp edge (any swamp cell touching non-swamp, water included) |
| 0.10 | desert (absent from draft 4.1a; treated as hostile) |
| 0.00 | swamp interior |

With the current moisture bands (desert ≤ 0.38 < meadow ≤ 0.52 < swamp ≤ 0.62
< forest) meadow and forest are normally separated by swamp, so the 0.80
class is rare — adjacent-cell noise can still produce it. It encodes the
draft's design intent (a tree line is the best non-waterfront site); the
spawn gate works without it. Map-border cells do not inherit water credit;
adjacency requires an actual water cell.

Initial ~2% settlement seeding is unchanged. In Fluid field mode these values
set settlement room and govern spawning; placement remains a later subject.

## Job-site inspection

Clicking a factory or mine cell selects it (the party does not move; `Esc` or
clicking any other cell clears). The **workforce** block then shows:

- per site: kind and id, state, cell, productivity and disturbance, workers
  present / needed and staffing percent; factories add build progress (or
  live input/output rates — coal and iron in, goods and CO2 out — once
  active) plus cumulative starved seconds; mines add extract rate and deposit
  remaining;
- global, always: `Jobs staffed/slots · open`, counted over unlocked mines
  (`MAPE_MINE_WORKERS`) and non-GONE factories (`MAPE_FACTORY_BUILD_WORKERS`
  while building, `MAPE_FACTORY_WORKERS` otherwise); fluid mode adds pool
  totals (`fresh · depleted · rested · spawned`).

Test scenes place an active factory with the **Factory** tool (after Erase);
the scene keeps coal-only stock, so iron-starved construction and production
read directly in the panel. Factory placement scan, the idle rule and the CO2
forest gate remain Phase 3.

## Factory and mine lifecycle

1. **Placement scan** every `MAPE_SCAN_SEC` (`5 s`): score each walkable cell at
   least `MAPE_FACTORY_SPACING` cells from existing factories:
   `score = demand[GOODS][i] - demand[COAL][i] - demand[IRON][i] - MAPE_DISTURB_PENALTY * disturbed[i]`.
   Best cell wins if `score > MAPE_FACTORY_THRESHOLD` and population within 3
   cells exceeds `MAPE_FACTORY_WORKFORCE_MIN`. At most one build starts per scan;
   spacing plus build-iron demand prevent simultaneous duplicate builds during
   the 20 s construction lag.
2. **Construction**: `progress` advances `0 → 1` over `MAPE_FACTORY_BUILD_SEC`
   (`20 s` on 1×) at the site's staffing fraction, injecting and drawing
   `MAPE_FACTORY_BUILD_IRON` iron; construction stalls while iron is missing
   and disturbs at `0.0003/s`.
3. **Active**: consumes `0.5 coal + 0.5 iron/s`, produces `1.0 goods + 0.5 CO2/s`,
   disturbs at `0.0006/s` (above natural recovery so active industry requires
   restoration or management). Idles after `MAPE_FACTORY_IDLE_SEC` (`40 s`) of
   starvation (`demand > 8` with no arriving inputs) and wakes when supply returns.
4. **Mines**: bound at setup to every coal (`FUEL`) and iron (`ORE`) deposit.
   Each holds 1,400 units and starts locked. Once unlocked and staffed, a mine
   extracts `2.4 × staffFraction × (1 − d)` units/s into local stock. Mineral
   extraction adds `0.00025 × units` disturbance so productivity declines over
   the life of the deposit instead of collapsing soon after opening.

## Catchment A and Queue B

Both modes use a bounded 0–1 import field for coal and goods, reflecting at
water and the map edge. A/B use rates of `0.03` coal and `0.024` goods per
resident per simulated second. A settlement's hungry target grows with its
population. Household use debits the shared stock ledger, and the last 1.5
units of settlement goods are reserved for player supply purchases. Iron, CO2
and workforce keep the shared field rules.

- **A · Catchment:** relax the town's signal toward hungry pull times
  `1 / (1 + stock / max(1, 9 × rate))` at `0.9/s`. Stock is the total reachable
  in four cardinal steps. Apply that signal over the same reach with falloff,
  then spread it with six Jacobi passes per 0.05 s (`D ≈ 24 cells²/s`). The
  3×3 filtered demand steers uncapped, conservative uphill hauling at up to
  `6.5 cells/s`. After hauling, the town consumes up to
  `rate × demandAtCenter × dt` proportionally from reachable stock.
- **B · Queue:** the target senses falloff-weighted stock within four steps
  and cools further as the settlement fills its short intake buffer. The
  center relaxes at `1.6/s` and holds its value through four Jacobi passes
  (`D ≈ 16 cells²/s`). Eight-neighbor uphill transfer can use diagonal routes
  without cutting water corners. Intake room is `0.25 × rate`; service uses
  `min(rate × dt, stock × (1 − exp(−dt / 0.1)))` before arrivals. Service
  doesn't slow merely because import pull is cool. Competing shipments use
  the same headroom in proportion to their requests; existing stock above
  the buffer stays on the map and is used normally.
- **Stock lowers demand** disables A/B's pull feedback without changing physical
  intake. In signed Diffusion it disables the stock sink. Reference scenes
  can also turn on **Stock cools tiles** for A/B: stock locally suppresses
  pull while the field recovers toward the ambient level (at least 0.3), so
  stock can disperse without a settlement.

## Economy test scenes

The survey links to `?scene=a` and `?scene=b` in separate tabs so tests don't
replace the survey. A is the seed-1337 lab layout (five mines and seven towns)
projected onto 64×64. B centers its three mines and three towns
at the original spacing. Both use the survey engine and renderer, with
staffed mines, fixed populations, no party/rivals, and only coal production.
The standalone `prototype/economy-demand-product-diffusion/` pages serve as
independent references.

Amount and Demand are linked side by side. Replay either scene from uniform 0
or 0.5 demand and no stock; the selected engine and playback speed are kept.
Pause and advance 0.05 s at a time. Inspect either map, place and erase mines,
settlements and factories, or select one of them to redirect shipments without
clearing stock already in transit. With the Inspect tool active, clicking a
mine or factory selects it in the panel left of the canvas. The readout shows stored,
mined and used coal.

## Site engine (Phase 4)

Implemented after Phases 0–3 validate rates, balance and conservation on
diffusion. Shares the same arrays, pools, recipes, time constants, ledger, views,
HUD and atmospheric CO2 diffusion, replacing goods routing and placement scoring:

- Settlements, factories, mines and storages trade discrete quantities from
  `goods[r * N + i]`. Deterministic delivered price is
  `base * ref / (stock + 1) + dist * MAPE_TRANSPORT_COST`.
- Shipments sit in a fixed-size SoA transit pool and arrive after
  `dist / MAPE_TRANSPORT_SPEED` seconds (`~10 s` across 20 cells on 1×), charging
  `qty * dist * MAPE_WORKFORCE_PER_UNIT` transport workforce.
- Factory placement scores candidate cells by margin between best nearby goods
  buyer price and delivered coal + iron cost, using the same spacing, workforce
  and `MAPE_FACTORY_BUILD_SEC` rules.
- Population satisfaction and growth read delivered settlement stocks directly.

## Selectable interface

```
mapeInit(mode, fixedResidents) // allocate/reset fields and build topology for the world
mapeFinishSetup(fill, warm)    // establish initial ledgers and field values after seeding
mapeStep(seconds)              // advance the physical state
mapeField(kind, r)             // return cached typed-array slice
mapeSetEngine(mode)            // change the routing strategy on the live map
```

Switching field strategies resets the coal and goods traces and rebuilds their
demand from current stock and settlements (two simulated seconds of signal
warmup, no clock advance).
Inventory, market funds, residents, worker demand, mines, deposit stock, party
progress and atmosphere do not reset. Tests start from identical layouts when
comparing curves; live switches preserve the consequences of earlier ticks.

## Player role

- **Unlock deposits**: coal and iron deposits start locked for automated mining.
  Recording a deposit cell to 100% and claiming it while holding non-contested
  influence (`territoryContest ≥ 1`) unlocks its mine. Losing influence pauses
  automated mining until control is restored.
- **Settlement markets**: at any non-industry cell with `pop ≥ 3`, the player sells
  resources and relics against `money[i]` (prices use cell `goods` stock and
  `demand`), buys supplies (consuming `MAPE_SUPPLY_GOODS` goods per unit), and
  hires party members when `pop ≥ 4` (recruiting one resident).
- **Territory and land**: player influence boosts local population growth by
  `+10%` (Phase 5), and active restoration counters settlement, mine and factory
  disturbance.

## Conservation ledger

Material sources and sinks update Float64 counters `massIn` and `massOut`.
Mines move deposit stock into map stock and workshops add goods (`massIn`).
Household intake records what left the map (`massOut`), and player trades record
actual additions or removals. Factory recipes and the atmospheric uptake cycle
can extend those same counters. Gradient transport conserves stock; signed
demand decay recorded in `dissipated` is not material loss. Process balance
requires `|massIn - massOut - (goodsTotal - initialGoods)| < 1e-6`.

## Performance budget

Target: `< 2 ms` for one 64×64, `R = 4` field tick (up to ~160 ms of
simulation CPU time per real second at 4×). The raster and batched trace paths
paint on animation frames, independently of simulation and HUD cadence. The
0.2 s signed reference kernel also has a scaling gate in
`experiments/mape_spread.js`; larger maps can stagger the solve rather than
increasing per-frame work proportionally.

## Visualization and HUD

### V1 · Independent map presentation

`render.js` provides eight map modes: `terrain`, `investigation`, `influence`,
`disturbance`, `biosphere`, `demand`, `amount`, and `amount + demand`. Keys
`1`…`8` select the single-map modes; `0` selects the paired amount/demand view.
Each side has its own item picker. The amount side shows factual per-cell
amounts (`coal`, `iron`, `goods`, `co2`, `population`, `fresh`, `depleted`).
The demand side shows movement: `coal`, `iron`, `goods`, `co2`, `jobs`, plus
the two workforce pulls — `fresh` (drawn to job slots) and `depleted` (drawn
home to free settlement capacity). A worker item's legend and canvas caption
carry the `workforce ·` prefix (`Amount · workforce · depleted`), so the word
never has to be guessed from the colour. The survey opens at 4× on Amount →
goods. Reference scenes open on paired coal fields and retain amount, demand
and paired radios instead of hiding them.

- **Population**: empty cells keep a dim terrain tint (`RENDER_CIVIC_DIM`,
  `RENDER_CIVIC_GAIN`) with water in navy, so a warm ivory-gold dot (`sqrt` over
  `MAPE_VIEW_POP_MAX` = 40) reads as a settlement on a legible map instead of
  disappearing into the black end of the population palette. This layer draws no
  settlement rings or town labels — a ring would cover the very colour it
  explains — and the legend drops its town key.
- **Job slots**: dark → amber-gold by `jobNeed[i]` (`sqrt` over
  `MAPE_VIEW_JOB_MAX` = 8); mines show 6, active factories 8, buildings 4.
- **Workforce pulls**: fresh and rest pull are drawn as demand with
  `v / (v + MAPE_VIEW_PULL_REF)` (0.25), so both a faint halo and a saturated
  job cell stay readable on one fixed scale.
- **Workforce pools**: dark → amber-gold by `log1p` over `MAPE_VIEW_POOL_MAX`
  (20), water blocked like other land fields. The spawn threshold of 10 sits
  halfway up the scale, so pooled exhaustion that is about to found a hamlet
  reads bright.
- **Fieldbook look**: navy/cyan-white stock, warm demand and moving flow traces.
- **Prototype A look**: crisp logarithmic blue-white stock (0–10/cell),
  red/orange/yellow demand, green sources and white settlement rings.
- **Prototype B look**: exposed logarithmic amber stock (0–8/cell), smooth purple
  demand, isolines, cell grid, labelled sources/consumers and accepted-flow arrows.

Look radios apply display defaults only, never switch engines, warm fields,
advance the clock or change stocks. Scene A defaults to A's look and scene B to
B's look. Every look supports independent checkboxes for flow, flow animation,
arrowheads, demand contours, grid, demand smoothing, settlements, sources,
actor labels, and party/survey markers. Display choices survive engine switches
and scene replay. Reduced-motion preference disables flow animation at startup
and when applying a look, but leaves static direction arrows available.

Demand scales remain fixed: 0–1 for bounded market items, ±6 for signed fields,
soft-normalized worker pulls, with green surplus even in the alternate looks. Water blocks land items, not
atmospheric CO2. Contours omit water-crossing cells and cap their levels at the
fixed display range. Grid paths and actor label strings are built at setup;
per-frame field drawing reuses its raster and contour scratch buffers.

The view radiogroup and the two item radiogroups (amount: `coal`, `iron`,
`goods`, `co2`, `population`, `fresh`, `depleted`; demand: `coal`, `iron`,
`goods`, `co2`, `jobs`, `fresh`, `depleted`) use a single-writer `change`
handler and fine-pointer hover preview. The coal-only reference scenes hide the
other layers and item pickers. Look radios are click/keyboard-only so passing
the pointer cannot reset overlay choices. Inapplicable checkboxes are disabled
without losing their settings. Labels follow visible actors; visual marker
toggles never stop production or settlement consumption. The selected job site
(factory or mine) is inspected in a separate panel to the left of the canvas,
not in the right aside.

`render-economy.js` owns palettes, grid, isolines and flow; `render-markers.js`
owns settlement/industry markers and cached actor labels. `hud-display.js` owns
look and overlay controls and paired layout. `hud-economy.js` owns both field
legends, simulation feedback switches and the inspector. Stock feedback and local
stock pressure remain separate from display settings; local pressure is available
in survey and scenes and disabled in Diffusion, where signed feedback owns it.

The inspector shows cell coordinates, terrain, population, workforce, per-item
demand and stock, and deposit lock; A/B show settlement import pull as a percent
of hungry pull. The `around` block reports nearest settlement distance and pop.

## Prototype phases

Each phase ends with a quantitative gate; a failed gate blocks the next phase and
records the lesson in `findings-pitfalls-skills.md`.

### Phase 0 — Infrastructure, time base, settlements and views

Deliverable: simulation clock unified on real-time seconds (`1 s = 1 day` at 1×);
`map-economy.js` with preallocated fields, pools, engine interface, settlement
seeding (~2% of map, pop 8…20), locked mine indexing, settlement market actions
(replacing towns across `economy.js`, `sites.js`, `actions.js`, `hud.js`), static
preview gradients on `demand`/`goods`/`workforce`, stub `mapeStep` (lock sync +
market fund recovery, no field dynamics), four new render views + item selector +
markers, HUD cell inspector and engine switch (`Sites` disabled pending Phase 4).

Gate: all nine views and four items render non-empty readable fields, settlements
seed at ~2% of map (~82 cells, pop 8…20, none on water), deposit unlock triggers
on full investigation + player claim, ledger residual `< 1e-4` across trades,
frame time regression ≤ 5% vs baseline, `smoke`, `dom_smoke` and `survey_spread`
pass.

### Phase 1 — Demand diffusion, workforce migration and mine loop (diffusion)

Deliverable: `map-diffusion.js` owning population/factory/biosphere/storage
demand injection, 2-pass Jacobi diffusion (walkable-only for coal/goods and
workforce, full-map for CO2 demand and stock), mass-conserving normalized-gradient
goods and worker advection, transport workforce accumulation, and worker-gated
unlocked coal extraction (closing `discover deposit → workforce demand → worker
diffusion → mine output → settlement/factory supply`). Seed one marked coal trace
inside the starting party's around-list range so the loop is playable immediately.
Defer iron deposits and player-operated coal/iron extraction until factories
consume iron; keep the alternate sites engine disabled until Phase 4. Includes
`experiments/mape_spread.js`.

Gate: midpoint across 20 walkable cells crosses zero within `15 s` on 1×, axial vs
diagonal arrival ratio within 15% (isotropic spread), water blocks material and
worker flow without trapping CO2, unlocked coal mine draws workers then mines and
delivers coal to settlements and factories, goods and population conservation
residuals `< 1e-4`, tick time `< 2 ms` at 64×64 `R = 4` (scaling logged for
`R = 1, 4, 8` and `64, 128, 256`).

### Phase 2 — Population dynamics and settlement metabolism (diffusion)

Deliverable: measured goods + coal satisfaction, Diffusion-engine growth/decline,
productivity-scaled cap, satisfaction/workforce-biased migration, settlement
goods→waste and coal→CO2, and `experiments/mape_population.js` over `120 s`.
Catchment A and Queue B record intake and emissions while holding demographic
growth and satisfaction-led migration; fluid workforce-boundary migration and shared job staffing remain active.

Gate: supplied Diffusion settlements grow, unsupplied decline, no cell exceeds
`MAPE_POP_CAP * productivity`, no NaN, small-village disturbance stays below
`0.25` while dense-city disturbance exceeds it and spills onto its neighbours,
a fully wasted cell holds no population, goods/population ledgers balance, and
total population stays bounded.

### Forestry supply chain

Sawmills, charcoal works, and wood works are active staffed job sites sharing the
same factory pool, demand field, storage, and workforce models. A sawmill makes
one reservoir-random cut choice from forest cells within six cells; candidates
must be walkable, have forest cover, and have positive log pull. Harvest rate
scales with staffing, local productivity, and demand pull, and pauses below the
pull floor. Logs are stocked at the cut cell, then transported by the existing
log demand gradient. Charcoal works consume logs for coal plus CO2; wood works
consume logs for goods. Per-cell log stock cools the signed demand field, so a
supply pile decreases the sawmill's incentive to cut. The amount and demand maps
include logs, and the factory inspector reports staffing and recipe rates.

### Phase 3 — Factories, mines and forest CO2 loop (diffusion)

Deliverable: `5 s` placement scan with spacing guard, `20 s` construction with
build-iron demand, active `coal + iron → goods + waste + CO2`, `40 s` idle rule,
unlocked mine extraction, CO2-gated forest growth, `MAPE_GATE_ON_GOODS` on vs off
comparison in `experiments/mape_factory.js` over `300 s`. The construction and
production runtime (iron draw, recipe, CO2, disturbance, worker-staffed output
under both workforce models, scene Factory tool) is implemented; the placement
scan, idle rule and the factory experiment remain. Humidity/CO2 forest response
is validated across engines by `experiments/mape_forest.js`.

Gate: factories site between goods need and coal/iron surplus (never on water or
high disturbance, no duplicate stack during construction), builds finish in
`10–30 s` on 1×, forests grow only with CO2, disturbance rises at active factories
and mines, gated ledger residual `< 1e-4` (Float64 flow `< 1e-6`), gate-on vs
gate-off outcome recorded in `findings-pitfalls-skills.md`.

### Phase 4 — Site engine on the shared foundation

Deliverable: `mapeStepSites` with distance-priced orders, SoA shipment delay pool,
stock-based satisfaction and margin-based factory placement, reusing settlements,
mines, factories, CO2 atmosphere, ledger, views and Phases 1–3 experiment cases.

Gate: site engine matches diffusion qualitatively (supplied settlements grow,
factories build in `10–30 s` between demand and mines, forests grow near CO2
emitters, exact conservation `< 1e-6`). Divergences recorded in findings.

### Phase 5 — Selectable engine comparison and victory integration

Deliverable: enable HUD `sites` once shipments can switch without loss, `+10%`
player influence boost on growth, victory stability checks (total population not
declining over last `60 s`, no unmanaged factory/mine cell with `d ≥ 0.25`), and
extend `experiments/mape_compare.js` to compare sites on identical seeds.

Gate: runtime switches preserve the stock ledger, all engines pass `smoke` and
`dom_smoke`, comparison metrics are logged.

## Manual pass list

- Survey opens at 4× on Amount → goods; workshop stock moves toward settlements.
  1× and 2× advance 1 and 2 days per real second; pause freezes the traces and clock.
- Pause, open a scene and pick the Factory tool; click a cell to place a factory.
  Click it (Inspect tool) — the workforce block shows state, staffing and rates;
  the global row shows staffed/open slots. Esc clears the selection.
- In a scene, place a sawmill near forest plus charcoal and wood works down-gradient.
  Logs should appear on harvested cells, move to the converters, and accumulate
  into coal/goods; without converter demand the sawmill should stop cutting.
- The workforce segment opens on **Fluid field**: fresh workforce gathers at the
  mine, depleted pool returns to settlements, and a hamlet founds itself
  where depleted piles on high-value land (meadow or water-adjacent, never swamp).
  Switching to Residents replays the walking-workers model on the same seed.
- Settlement dots read at ~2% density across walkable land, never on water; the
  population layer replaces town rings with their colour; around
  list shows nearest settlement distance and population. In Diffusion, stocked
  settlements grow and isolated ones shrink; A/B hold demographic growth and Residents migration, while Fluid settlement migration follows workforce flow.
- Switching views `1`…`8` (click, fine-pointer hover, keys) updates the canvas;
  `0` or Amount + demand shows paired fields in the survey as well as the scenes.
  Each side has its own item picker; changing an item updates that side's map and
  legend. Returning to a non-field view restores the single map and hides the
  item pickers. On the amount side, population shows persons per cell over a dim
  terrain tint, without settlement icons, and
  fresh/depleted show the workforce pools; on the demand side, jobs shows the
  slots that seed the pull, fresh shows the pull toward those slots, and
  depleted shows the rest pull toward settlements with room.
- Pause on paired fields and choose each look. A shows blue stock and warm pull;
  B shows amber stock, purple pull, contours, grid and labelled arrows. Engine,
  stock, demand and clock do not change. Engine switching and scene replay retain
  custom overlay settings. In both scenes, select amount/demand alone and back.
- Toggle each overlay; hidden settlement/source markers do not stop their economy.
  Turn off flow animation while running: arrows stay still while stock changes.
  Pause freezes moving traces. With reduced motion, arrows start static.
- Demand smoothing leaves amount crisp. Contours remain finite on flat, signed
  and saturated fields and do not cross water for land items. At narrow widths
  paired maps stack without horizontal scrolling; all controls stay reachable.
- Pause on Demand → Coal and pick Diffusion, A and B. The demand map and help
  change while the clock, supply and party stay put. Hover a settlement to see
  its A/B pull; uncheck feedback and resume to restore the full pull.
- Moving pointer over the map updates the HUD cell inspector (`pop`, `work`, and
  per-item `d`/`s`) without flickering radios or action buttons.
- Jumping to a settlement shows market funds and prices; selling moves funds and
  stock, buying supplies deducts goods, hiring recruits a resident.
- The around list gives the nearby marked coal trace coordinates; recording the
  deposit to 100% and holding it unlocks the mine. Iron deposits and manual mining
  stay absent until factory demand makes them useful.
- Open a test scene without replacing the survey. Pause and replay at 0 and 0.5;
  both maps share a pinned cell and Fill zeros the coal ledger. Step once and
  verify a 0.05 s advance; place a town closer to a mine and watch the real route
  bend. Erase a source and confirm the coal already shipped remains. Repeat in B
  under queue service and change engines without erasing the scene.

### 3.1 Manual forest/waste pass

- On Amount, select waste: towns and factories leave visible patches; water stays empty.
- Pair forest amount with CO2 demand, then compare forest with soil moisture: cover
  should change within a few real seconds at 4× and favour intermediate moisture.
- Switch between surface water, air humidity and soil moisture. Compare a channel
  bank with a hilltop; wet ground should not change the coastline or block travel.
- Hover cells: signed forest growth should include both positive and negative rates.
- Pause: forest, CO2 and flow stop together; resume and switch engines without reset.
- In scenes A/B, select forest or waste from the amount controls; replay resets cover.
