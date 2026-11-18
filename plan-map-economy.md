# Map-economy engine prototype plan — 4.1a

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
Demand diffuses and physical goods move up the gradient. Regional workshops
provide goods while all deposits are still locked. In the factory phase, factories appear where goods need and coal/iron surplus overlap, build
over 10–30 s while demanding iron, then consume coal and iron ore to produce
goods plus waste plus CO2; settlements consuming goods leave waste and burning
coal releases CO2; waste is disturbed land (`land.js`); CO2 feeds forest growth;
production and transport create workforce demand that attracts migration;
population grows where needs are met and declines where they are not. The player
observes the fields, inspects any cell, trades and hires at settlements, and
unlocks deposits by investigating to 100% and holding territory so mines can work
them. Factories are placed by the engine, not by the player.

Deferred to follow-up after 4.1a: oxygen as a population/factory need and low-O2
production throttle (closing the full CO2↔O2 constraint), multi-product recipes
beyond one, player-built factories, caravan agents, larger maps, rival
map-economy actions.

## Engine order: shared field foundation, then sites

Catchment A is the playable default for coal and goods. Queue B compares local
service against regional uptake; signed Diffusion remains the comparison for
Phases 0–3. All three share land, stock, markets, workforce, mines, atmosphere
and the renderer. Iron and CO2 use the shared diffusion path in every mode.

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
  goods consumption all call `landDisturb` (`land.js`). Productivity `(1 − d)`
  scales population cap, mine rate and forest growth, while natural recovery
  scales with `(1 − d)`.
- Biomass (`economy.js`) stays unconditional in Phase 0 and gains its CO2 growth
  gate in Phase 3: coal burning in settlements and factories adds CO2, forests
  consume CO2 to grow. Global oxygen tracking remains as in `plan-prototype.md`
  until the post-4.1a O2 throttle plan.

## Core concepts

- **Cell**: one of 4096 cells (`64×64`), linear index `i = y * 64 + x`.
- **Settlement**: any non-industry walkable cell with `pop[i] ≥ 3`. Seeded at ~2%
  of all cells (~82 cells) with population 8…20; steady-state density emerges
  from growth and migration. Market funds `money[i]` scale with `pop[i]` and
  recover over time, so larger settlements carry deeper purchasing power (draft
  4.4). Mine and factory cells (`MAPE_CELL_INDUSTRY`) hold resident workers and
  count toward `totalPop` without acting as town markets.
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
  `coal + iron → 2 × coal goods + waste + CO2`, needs workforce, disturbs its cell.
- **Mine**: bound to a coal or iron deposit from `sites.js`. Starts locked with
  zero mined stock; once unlocked, injects workforce demand (`MAPE_MINE_WORKERS`),
  draws workers across walkable cells, extracts into local storage scaled by
  worker staffing (`workers / MAPE_MINE_WORKERS`, active at `≥ 0.1` workers), and
  disturbs its cell.
- **Forest**: biomass cell demanding and consuming local CO2 to grow (Phase 3).
- **Workforce `workforce[i]`**: worker-seconds per second demanded by unlocked
  mines, factories and goods transport. Diffuses over walkable cells so unmet
  jobs pull idle residents from settlements into mines and factories.

## Data model

`map-economy.js` owns shared fields, survey seeding, markets and the ledger.
`map-industry.js` handles mine and factory registration, locked deposits and
workshop output. `map-diffusion.js` owns signed diffusion, the shared tick and
worker transport. `map-market-demand.js` owns A/B import pull and household
uptake; `map-market-flow.js` builds the reflecting land stencil, catchment
membership and B's queue transport buffers. All buffers are reused per tick.

```
MAPE_R = 4                       // coal, iron, goods, co2
MAPE_SETTLE_TARGET = 0.02        // seeded fraction of cells with pop > 0 (~82)
MAPE_SETTLE_MIN = 3              // min pop for active settlement market
MAPE_HIRE_MIN_POP = 4            // min settlement pop to recruit a party member
MAPE_POP_CAP = 120               // per-cell carrying cap at d = 0
MAPE_POP_SEED_MIN = 8            // seeded settlement persons, low
MAPE_POP_SEED_MAX = 20           // seeded settlement persons, high
MAPE_NEED_GOODS = 0.02           // signed reference goods need/person/s
MAPE_NEED_COAL = 0.005           // signed reference coal need/person/s
MAPE_MARKET_GOODS_USE = 0.024    // A/B household goods use/person/s
MAPE_MARKET_COAL_USE = 0.03      // A/B household coal use/person/s
MAPE_SETTLE_DISTURB = 0.00015    // disturbance per unit goods consumed
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
MAPE_FACTORY_DISTURB = 0.0006    // disturbance /s while producing (outruns recovery)
MAPE_MINE_RATE = 2.4             // resource extracted/s at full staff and productivity
MAPE_WORKFORCE_PER_UNIT = 0.4    // worker-s per unit produced or transported
MAPE_CO2_INIT = 0.4              // ambient CO2 per land cell at start
MAPE_FOREST_CO2 = 0.004          // CO2 consumed /s per full-growth forest cell
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
- `flowX, flowY: Float32Array(R * N)` — net accepted shipments per cell and tick;
  outflow magnitude is divided by `flowDt` for the display rate.
- `workforce, workforceNext: Float32Array(N)` — diffused job demand and scratch.
- `jobNeed: Float32Array(N)`, `cellExport: Uint8Array(N)` — per-cell
  retained site jobs, industry marker.
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
   `pop ≥ MAPE_MINE_MIN_WORKERS`) into local `goods[res]` and disturb land.
   Building factories consume iron (when `MAPE_GATE_ON_GOODS` is on) and advance
   over `MAPE_FACTORY_BUILD_SEC`. Active factories consume coal and iron, emit
   goods and CO2, and disturb land. Settlements consume goods (`MAPE_SETTLE_DISTURB`
   waste) and coal (emitting CO2).
6. **Forest CO2 uptake.** Growing biomass cells scale growth by
   `clamp(goods[CO2][i] / MAPE_FOREST_CO2_SCALE, 0, 1)` and deduct consumed CO2.
7. **Population growth, migration and workforce update.**

## Population dynamics

Goods satisfaction `satG` and coal satisfaction `satC` compare consumed (or
negative-demand) supply against cell need over `MAPE_SAT_SCALE` seconds; combined
satisfaction is `sat = 0.75 * satG + 0.25 * satC` (clamped `0…1`).

Growth per tick:
`pop += pop * (MAPE_GROWTH * sat - MAPE_DEATH * (1 - sat)) * s`, capped at
`MAPE_POP_CAP * landProductivity(i)`. A supplied settlement doubles in ~90 s on
1×; a completely unsupplied settlement halves in ~46 s.

Migration per tick: positive edge flux across walkable 4-neighbours,
`MAPE_MIGRATE * (pop[i] - pop[j]) * 0.5 + MAPE_MIGRATE_BIAS * pop[i] * (attract[j] - attract[i])`,
where `attract` combines satisfaction and unmet `workforce`. Water never receives
migrants.

Workforce scaling: factory and transport throughput scales by
`localPop / (localPop + workforce[i])`, while unmet workforce pulls migrants in,
closing `factory → jobs → migration → production`.

## Factory and mine lifecycle

1. **Placement scan** every `MAPE_SCAN_SEC` (`5 s`): score each walkable cell at
   least `MAPE_FACTORY_SPACING` cells from existing factories:
   `score = demand[GOODS][i] - demand[COAL][i] - demand[IRON][i] - MAPE_DISTURB_PENALTY * disturbed[i]`.
   Best cell wins if `score > MAPE_FACTORY_THRESHOLD` and population within 3
   cells exceeds `MAPE_FACTORY_WORKFORCE_MIN`. At most one build starts per scan;
   spacing plus build-iron demand prevent simultaneous duplicate builds during
   the 20 s construction lag.
2. **Construction**: `progress` advances `0 → 1` over `MAPE_FACTORY_BUILD_SEC`
   (`20 s` on 1×), injecting iron demand and disturbing at `0.0003/s`.
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

Supply and Demand are linked side by side. Replay either scene from uniform 0
or 0.5 demand and no stock; the selected engine and playback speed are kept.
Pause and advance 0.05 s at a time. Inspect either map, or place and erase mines
and settlements to redirect shipments without clearing stock already in transit.
The readout shows stored, mined and used coal.

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

`render.js` provides ten map modes: `terrain`, `investigation`, `influence`,
`disturbance`, `biosphere`, `population`, `demand`, `supply`, `workforce`, and
`supply + demand`. Keys `1`…`9` retain the original single-map modes; `0` selects
the paired supply/demand view. Both maps share the selected item, hover and pinned
cell. The survey opens at 4× on Supply → goods. Reference scenes open on paired
coal fields and retain supply, demand and paired radios instead of hiding them.

- **Population**: dark land → warm ivory-gold (`sqrt` over `MAPE_POP_CAP`).
- **Workforce**: dark → amber-gold by `workforce[i]`.
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
with green surplus even in the alternate looks. Water blocks land items, not
atmospheric CO2. Contours omit water-crossing cells and cap their levels at the
fixed display range. Grid paths and actor label strings are built at setup;
per-frame field drawing reuses its raster and contour scratch buffers.

The view and item (`coal`, `iron`, `goods`, `co2`) radiogroups use a single-writer
`change` handler and fine-pointer hover preview. The coal-only reference scenes
hide the other layers and item picker. Look radios are click/keyboard-only so
passing the pointer cannot reset overlay choices. Inapplicable checkboxes are
disabled without losing their settings. Labels follow visible actors; visual
marker toggles never stop production or settlement consumption.

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

Deliverable: goods + coal satisfaction, growth/decline, productivity-scaled cap,
biased migration, settlement goods→waste and coal→CO2, `experiments/mape_population.js`
over `120 s`.

Gate: supplied settlements grow, unsupplied decline, no cell exceeds
`MAPE_POP_CAP * productivity`, no NaN, small village waste equilibrates below
`0.25` while dense cities exceed it, total population stays bounded.

### Phase 3 — Factories, mines and forest CO2 loop (diffusion)

Deliverable: `5 s` placement scan with spacing guard, `20 s` construction with
build-iron demand, active `coal + iron → goods + waste + CO2`, `40 s` idle rule,
unlocked mine extraction, CO2-gated forest growth, `MAPE_GATE_ON_GOODS` on vs off
comparison in `experiments/mape_factory.js` over `300 s`.

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

- Survey opens at 4× on Supply → goods; workshop stock moves toward settlements.
  1× and 2× advance 1 and 2 days per real second; pause freezes the traces and clock.
- Settlement dots read at ~2% density across walkable land, never on water; around
  list shows nearest settlement distance and population.
- Switching views `1`…`9` (click, fine-pointer hover, keys) updates the canvas;
  `0` or Supply + demand shows paired fields in the survey as well as the scenes.
  Changing an item updates both maps and legends; returning to a non-field view
  restores the single map and hides the item picker.
- Pause on paired fields and choose each look. A shows blue stock and warm pull;
  B shows amber stock, purple pull, contours, grid and labelled arrows. Engine,
  stock, demand and clock do not change. Engine switching and scene replay retain
  custom overlay settings. In both scenes, select supply/demand alone and back.
- Toggle each overlay; hidden settlement/source markers do not stop their economy.
  Turn off flow animation while running: arrows stay still while stock changes.
  Pause freezes moving traces. With reduced motion, arrows start static.
- Demand smoothing leaves supply crisp. Contours remain finite on flat, signed
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
