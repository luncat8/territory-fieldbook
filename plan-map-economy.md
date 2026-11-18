# Map-economy engine prototype plan — 4.1a

Standalone design for the map-economy engine prototype from draft 4.1a. It covers
settlements with populations, demand as a distance field, gradient goods flow,
factory placement and construction, resource and product storage, transportation
workforce, the coal–CO2–forest loop, and the two selectable implementations
(diffusion fields vs discrete sites) behind one interface. All numbers live in
the owning source file and are tuned from experiment logs.

## Time model

Simulation time runs in real-time seconds on 1× speed, with `1 s = 1 day` in
storyline. One fixed step is `0.2 s` (`SIM_STEP_SEC`); speeds are `0`, `5`, `10`
and `20` ticks per real second (`0×`, `1×`, `2×`, `4×`, i.e. `0`, `1`, `2`, `4`
storyline days per real second). Every rate is per simulation second (`/s`, equal
to per storyline day) and every duration is in seconds, so a typical factory
build of `20 s` (`10–30 s` range) finishes in 20 real seconds on 1× (`5 s` on 4×)
and advances the storyline by 20 days. The HUD clock shows both storyline day and
elapsed seconds.

## Scope

Prototype loop: ~2% of map cells start as settlements with small random
populations; population demands goods and coal; storage creates surplus; demand
diffuses as a signed distance field and physical goods move up the demand
gradient; factories appear where goods need and coal/iron surplus overlap, build
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

## Engine order: diffusion first, then sites

The prototype executes Phases 0–3 end-to-end with the **diffusion** engine first,
then implements the **sites** engine in Phase 4 on top of the completed model,
and compares both in Phase 5. Rationale:

1. **Lowest path to a full working loop.** One 4-connected cell pass drives all
   four items (coal, iron, goods and atmospheric CO2 to every forest cell) plus
   population migration and water routing, without supplier search, price bidding,
   in-transit shipment queues or pathfinding.
2. **Direct foundation for sites.** The typed arrays (`pop`, `demand`, `goods`,
   `workforce`, `money`), factory/mine/storage pools, settlement markets, deposit
   unlocking, construction timers, waste and CO2 accounting, ledger, render views,
   HUD inspector and scenario scripts all carry straight into Phase 4. Sites only
   replaces goods routing and factory placement scoring, while reusing atmospheric
   CO2 diffusion for forests.
3. **Exposes shared pitfalls early.** Running one full loop first surfaces the
   pitfalls common to both engines — town-to-settlement market balance, water
   isolation of islands, cold-start supply before first factory completion,
   duplicate builds during the 10–30 s construction lag, settlement waste vs
   natural land recovery, mass conservation, and tick budget — without mixing
   half-built second-engine code into every tuning pass.

## Relationship to the base prototype

The base prototype (`plan-prototype.md`) provides the 64×64 terrain map, party,
skills, investigation, non-town sites, rival agents, per-faction influence
fields (`territory.js`), disturbed fraction (`land.js`), biomass and oxygen
(`economy.js`), and victory declaration. The map economy replaces the town layer:

- Settlements replace towns. Town sites, town stocks and town prices are removed
  from `sites.js` and `economy.js`. About 2% of all cells (~82 cells) seed as
  random walkable settlements with population 8…20 (at least one within 6 cells
  of party spawn). Selling resources/relics, buying supplies and hiring members
  happen at any settlement cell (`pop ≥ 1`). `economy.js` keeps party inventory,
  resource tables, the field recipe, biosphere and the party conservation ledger.
- Demand and goods fields follow the `territory.js` pattern: flat `Float32Array`
  per cell, mutated in place with zero per-tick allocations.
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
- **Demand `demand[r * N + i]`**: signed distance field per item. Positive means
  unmet need, negative means surplus available. Its gradient points from surplus
  toward need.
- **Goods `goods[r * N + i]`**: physical stock (or CO2 concentration for `r = 3`)
  in cell `i`. Kept alongside demand for mass conservation and to test gated vs
  demand-only production.
- **Storage**: a cell registered to inject negative demand proportional to its
  `goods` stock. Mines and factories register storages at their cells.
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

`map-economy.js` owns map-economy state, pools, seeding, deposit locks, markets,
conservation ledgers and engine dispatch; `map-diffusion.js` owns the diffusion
step (demand/workforce Jacobi fields, normalized-gradient goods and worker flow,
worker-gated mine output, and the multi-size scaling kernel). All buffers are
allocated once in `mapeInit` (including cached per-item `demandView`/`goodsView`
slices) and mutated in place per tick.

```
MAPE_R = 4                       // coal, iron, goods, co2
MAPE_SETTLE_TARGET = 0.02        // seeded fraction of cells with pop > 0 (~82)
MAPE_SETTLE_MIN = 3              // min pop for active settlement market
MAPE_HIRE_MIN_POP = 4            // min settlement pop to recruit a party member
MAPE_POP_CAP = 120               // per-cell carrying cap at d = 0
MAPE_POP_SEED_MIN = 8            // seeded settlement persons, low
MAPE_POP_SEED_MAX = 20           // seeded settlement persons, high
MAPE_NEED_GOODS = 0.02           // goods per person per s (per day)
MAPE_NEED_COAL = 0.005           // coal per person per s (heating -> CO2)
MAPE_STOCK_SEC = 40              // local goods/coal reserve buffer in s
MAPE_SETTLE_DISTURB = 0.00015    // disturbance per unit goods consumed
MAPE_DEMAND_GAIN = 8.0           // demand signal scale for unmet need rates
MAPE_STORAGE_SIGNAL = 3.0        // negative demand per export-stored unit per s
MAPE_SURPLUS_SIGNAL = 0.25       // negative demand per unreserved stock unit per s
MAPE_DIFFUSE = 0.72              // 4-neighbour mix per pass (2 passes / 0.2 s tick)
MAPE_DIFFUSE_PASSES = 2          // Jacobi passes per tick (D = 1.8 cells²/s)
MAPE_DECAY = 0.008               // demand decay per s (reach sqrt(D/decay) = 15 cells)
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
MAPE_MINE_RATE = 0.6             // resource extracted /s per unlocked mine
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
- `demand, demandNext: Float32Array(R * N)` — double-buffered signed demand.
- `goods, goodsNext: Float32Array(R * N)` — double-buffered physical stock / CO2.
- `workforce, workforceNext: Float32Array(N)` — diffused job demand and scratch.
- `jobNeed: Float32Array(N)`, `cellExport, cellFactory: Uint8Array(N)` — per-cell
  retained site jobs, export/industry bitmask and active factory state.
- `money: Float32Array(N)` — market cash at settlement cells.
- `factories` (cap 32, SoA): `x, y, state` (building/active/idle), `progress`, `starved`.
- `mines` (cap 32, SoA): `x, y, site, res, unlocked`.
- `storages` (cap 96, SoA): `x, y, site` (registered on unlock/build; stock lives in `goods`).
- `engine`: `MAPE_ENGINE.DIFFUSION` or `MAPE_ENGINE.SITES`; `viewItem`: `0…3`.
- Ledger counters (Float64): `initialGoods, massIn, massOut, dissipated, minedTotal, transportWork, initialPop, popDelta`.

Memory: double-buffered `demand`, `goods`, `pop` and `workforce` plus `jobNeed`,
`money` and cell flags is `~368 KB` at 64×64 (`~5.9 MB` at 256×256).

## Diffusion engine (Phases 1–3)

`mapeStepDiffusion` substeps in chunks of `≤ 0.2 s` (`MAPE_MAX_STEP`) with zero
allocations; `mapeWarmDemand` relaxes initial demand over `8 s` at boot without
moving stocks or people:

1. **Demand injection.** Cells with `pop > 0` inject unmet `GOODS` and `COAL`
   rates (scaled by buffer shortfall over `MAPE_STOCK_SEC`) and negative `CO2`
   emission demand; biosphere cells inject positive `CO2` uptake demand. Building
   factories inject unmet `IRON` demand; active factories inject unmet `COAL` and
   `IRON` demand and negative `CO2` demand. Water cells stay at 0.
2. **Storage and surplus injection.** Export storages (unlocked mines, active
   factories, standalone depots) subtract `surplus * MAPE_STORAGE_SIGNAL * dt`;
   non-export cells holding stock above local reserve subtract
   `surplus * MAPE_SURPLUS_SIGNAL * dt` so flowing goods push past full villages.
3. **Demand diffusion.** `MAPE_DIFFUSE_PASSES = 2` symmetric zero-flux Jacobi
   passes per substep (`MAPE_DIFFUSE = 0.72`, `D = 1.8 cells²/s`,
   `MAPE_DECAY = 0.008/s`, reach `15 cells`, subnormal clamp `1e-12`). `COAL`,
   `IRON`, `GOODS` and `workforce` diffuse over walkable 4-neighbours only;
   `CO2` demand and pairwise `CO2` stock diffuse across all cells including water.
4. **Gradient goods and worker transport.** For `COAL`, `IRON`, `GOODS`, stock
   above local reserve flows across walkable 4-neighbours up positive demand
   gradients using Michaelis-Menten normalization `g_k / (gSum + MAPE_GRAD_REF)`,
   giving uniform haul speed across 20 cells and around coastlines. Throughput
   scales by `0.5 + 0.5 * pop / (pop + workforce + 1)` and adds
   `out * MAPE_WORKFORCE_PER_UNIT` to transport effort and `transportWork`. Every
   edge transfer rounds directly through `Float32Array` slots so `sum(goods)` and
   `sum(pop)` are conserved to `0` Float32 drift. Unmet mine/factory jobs inject
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
   Start locked; once unlocked, extract at `MAPE_MINE_RATE * productivity` into
   local `goods` and `storages` until deposit stock hits zero.

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
mapeInit(mode)      // allocate/reset and seed for DIFFUSION or SITES
mapeStep(seconds)   // advance one tick, dispatching to the active engine
mapeField(kind, r)  // return Float32Array slice for rendering and experiments
mapeSetEngine(mode) // switch engine and cleanly re-seed map-economy state
```

Hybrid operation (settlement pool + field diffusion) is a flag on the diffusion
engine rather than a third engine; not enabled by default.

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

All material flows update Float64 counters `massIn`, `massOut` and `dissipated`.
Mines move deposit stock (`massIn`) into cell `goods` plus disturbed residue;
factories convert `coal + iron` into `goods + CO2` plus waste disturbance;
settlements convert `goods` into waste (`massOut`) and `coal` into `CO2`; forests
convert `CO2` into biomass/oxygen (`massOut`); player trades record exact mass
entering (`massIn`) or leaving (`massOut`) map `goods`. Gradient transport
conserves `sum(goods)` exactly; demand decay is recorded in `dissipated`.
Process balance requires `|massIn - massOut - (goodsTotal - initialGoods)| < 1e-4`
(Float32 cell storage) and exact Float64 flow balance `< 1e-6`.

## Performance budget

Target: `< 2 ms` per tick at 64×64, `R = 4` (`~0.6 ms` measured in
`experiments/mape_spread.js`, or `~12 ms/s` at 4×). No per-tick or per-frame
allocations; settlement rendering walks `settleCells` in a single batched canvas
path, and `mapeField` returns cached typed-array views. Measured kernel scaling
(`ms/step`): `64×64` `R = 1/4/8 → 0.28 / 0.81 / 1.68`; `128×128 → 1.37 / 3.77 / 7.67`;
`256×256 → 4.69 / 13.50 / 25.87`. At `256×256, R = 8`, diffusion runs every
`N = 4` ticks with scaled step (`~6.5 ms/tick`, within the `8 ms/tick` ceiling).

## Visualization and HUD

`render.js` extends the view switch to nine modes (keys `1`…`9`): `terrain`,
`investigation`, `influence`, `disturbance`, `biosphere`, `population`, `demand`,
`supply`, `workforce`.

- **Population**: dark land → warm ivory-gold (`sqrt` curve over `MAPE_POP_CAP`),
  water stays blue.
- **Demand**: diverging per selected item (`sqrt` curve) — surplus green, zero
  dark grey, unmet need red; water is deep blue for land items and blue-tinted
  atmosphere for `CO2`.
- **Supply**: dark → bright cyan-ivory by `goods` stock of selected item
  (rendered over water for `CO2` with a faint shoreline tint).
- **Workforce**: dark → amber-gold by `workforce[i]`.

An item radiogroup (`coal`, `iron`, `goods`, `co2`) appears next to the view
switch when `demand` or `supply` is active, using the same single-writer `change`
handler and fine-pointer hover preview. Map markers show settlements (batched
cream dots sized by pop), storages (small teal squares), mines (triangles, muted
lock tint while locked), and factories (squares: amber building, bright active,
grey idle). The HUD `economy` block shows the engine radiogroup (`diffusion` /
`sites`), settlement summary, hovered/selected cell's coordinates, terrain, `pop`,
`workforce`, per-item `demand` and `goods`, and deposit lock state. The `around`
block reports nearest settlement distance and population.

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
markers, HUD cell inspector and engine switch (`diffusion` active, `sites`
disabled pending Phase 4).

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

Deliverable: enable HUD `sites` switch with clean runtime re-seed, `+10%` player
influence boost on growth, victory stability checks (total population not
declining over last `60 s`, no unmanaged factory/mine cell with `d ≥ 0.25`),
`experiments/mape_compare.js` comparing both engines on identical seeds.

Gate: runtime switch re-seeds cleanly both ways, both engines pass `smoke` and
`dom_smoke`, comparison metrics logged.

## Manual pass list

- Clock ticks 1 day per real second on 1× (`2/s` on 2×, `4/s` on 4×); pause halts it.
- Settlement dots read at ~2% density across walkable land, never on water; around
  list shows nearest settlement distance and population.
- Switching views `1`…`9` (click, fine-pointer hover, keys) updates the canvas
  cleanly; `demand` and `supply` reveal the `coal / iron / goods / co2` switch and
  show green surplus vs red need and item stocks.
- Moving pointer over the map updates the HUD cell inspector (`pop`, `work`, and
  per-item `d`/`s`) without flickering radios or action buttons.
- Jumping to a settlement shows market funds and prices; selling moves funds and
  stock, buying supplies deducts goods, hiring recruits a resident.
- The around list gives the nearby marked coal trace coordinates; recording the
  deposit to 100% and holding it unlocks the mine. Iron deposits and manual mining
  stay absent until factory demand makes them useful.
