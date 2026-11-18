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
- **Settlement**: any walkable cell with `pop[i] ≥ 1`. Seeded at ~2% of all cells
  (~82 cells) with population 8…20; steady-state density emerges from growth and
  migration. Market funds `money[i]` scale with `pop[i]` and recover over time,
  so larger settlements carry deeper purchasing power (draft 4.4).
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
- **Mine**: bound to a coal or iron deposit from `sites.js`. Produces only while
  the deposit is unlocked and has remaining stock; disturbs its cell and fills
  local storage.
- **Forest**: biomass cell consuming local CO2 to grow (Phase 3).
- **Workforce `workforce[i]`**: worker-seconds per second demanded by factories
  and goods transport. Unmet workforce throttles output and pulls migration.

## Data model

`map-economy.js` owns all map-economy state. Struct-of-arrays and flat typed
arrays, allocated once in `mapeInit`, mutated in place per tick.

```
MAPE_R = 4                       // coal, iron, goods, co2
MAPE_SETTLE_TARGET = 0.02        // seeded fraction of cells with pop > 0 (~82)
MAPE_SETTLE_MIN = 1              // min pop for active settlement and market
MAPE_POP_CAP = 120               // per-cell carrying cap at d = 0
MAPE_POP_SEED_MIN = 8            // seeded settlement persons, low
MAPE_POP_SEED_MAX = 20           // seeded settlement persons, high
MAPE_NEED_GOODS = 0.02           // goods per person per s (per day)
MAPE_NEED_COAL = 0.005           // coal per person per s (heating -> CO2)
MAPE_SETTLE_DISTURB = 0.00015    // disturbance per unit goods consumed
MAPE_STORAGE_SIGNAL = 0.5        // negative demand per stored unit per s
MAPE_DIFFUSE = 0.45              // 4-neighbour mix per pass (2 passes / 0.2 s tick)
MAPE_DIFFUSE_PASSES = 2          // Jacobi passes per tick (D ≈ 1.125 cells²/s)
MAPE_DECAY = 0.005               // demand decay per s (reach sqrt(D/decay) ≈ 15 cells)
MAPE_FLOW = 0.35                 // goods flux factor per unit demand gradient per s
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

- `pop: Float32Array(N)` — persons per cell; `settleCells: Uint16Array(N)` and
  `settleCount` index cells with `pop ≥ MAPE_SETTLE_MIN` for fast marker and
  market passes without scanning 4096 empty cells.
- `demand, demandNext: Float32Array(R * N)` — double-buffered signed demand.
- `goods, goodsNext: Float32Array(R * N)` — double-buffered physical stock / CO2.
- `workforce: Float32Array(N)` — worker-seconds/s demanded per cell.
- `money: Float32Array(N)` — market cash at settlement cells.
- `factories` (cap 32, SoA): `x, y, state` (building/active/idle), `progress`,
  `starved`.
- `mines` (cap 32, SoA): `x, y, site, res, unlocked`.
- `storages` (cap 96, SoA): `x, y` (stock lives in `goods`).
- `engine`: `MAPE_ENGINE.DIFFUSION` or `MAPE_ENGINE.SITES`; `viewItem`: `0…3`.
- Ledger counters (Float64): `initialGoods, massIn, massOut, dissipated`.

Memory: double-buffered `demand` and `goods` plus `pop`, `workforce`, `money` is
`(4*2 + 4*2 + 3) * 4096 * 4 ≈ 311 KB` at 64×64 (`~5 MB` at 256×256).

## Diffusion engine (Phases 1–3)

One step per tick (`seconds`), sequential over cells, zero allocations:

1. **Demand injection.** Cells with `pop > 0` add `pop * MAPE_NEED_GOODS * s` to
   `demand[GOODS]` and `pop * MAPE_NEED_COAL * s` to `demand[COAL]`. Building
   factories add `MAPE_FACTORY_BUILD_IRON * s` to `demand[IRON]`; active
   factories add recipe input demand. Water cells stay at 0.
2. **Storage surplus injection.** Registered storage cells subtract
   `goods[r][i] * MAPE_STORAGE_SIGNAL * s` from `demand[r][i]` for `r < CO2`.
3. **Demand diffusion.** For `COAL`, `IRON`, `GOODS`, `MAPE_DIFFUSE_PASSES` Jacobi
   passes over walkable 4-connected neighbours with decay `MAPE_DECAY * s`; water
   neither receives nor emits demand. At `D ≈ 1.125 cells²/s` and decay `0.005/s`,
   steady-state reach is `~15 cells` and a 20-cell midpoint responds within `15 s`
   on 1×. `CO2` diffuses across all cells including water so emissions cross
   rivers and lakes to reach downwind forests.
4. **Gradient goods transport.** For `COAL`, `IRON`, `GOODS`, physical `goods[r]`
   flows across walkable 4-connected edges from lower to higher `demand[r]`:
   `flux = goods[r][i] * clamp(MAPE_FLOW * (demand[r][j] - demand[r][i]) * s, 0, 0.2)`.
   Summing four neighbours moves at most 80% per tick, strictly conserving mass.
   Each edge moved adds `flux * MAPE_WORKFORCE_PER_UNIT` to `workforce[i]` and
   accumulates global `transportWork`; low nearby population throttles flux.
5. **Mines, factories and settlements.** Unlocked mines extract deposit stock into
   local `goods[res]`, decrease `demand[res]`, and disturb land. Building
   factories consume iron (when `MAPE_GATE_ON_GOODS` is on) and advance progress
   over `MAPE_FACTORY_BUILD_SEC`. Active factories consume coal and iron, emit
   goods and CO2, and disturb land. Settlements consume goods (adding
   `MAPE_SETTLE_DISTURB` waste) and coal (adding CO2). `MAPE_GATE_ON_GOODS`
   toggles whether consumption requires local `goods` stock or only negative
   `demand`, directly testing the draft's open question.
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
- **Settlement markets**: at any cell with `pop ≥ 1`, the player sells resources
  and relics against `money[i]` (prices use cell `goods` stock and `demand`),
  buys supplies (consuming `MAPE_SUPPLY_GOODS` goods per unit), and hires party
  members when `pop ≥ 2` (recruiting one resident).
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

Target: `< 2 ms` per tick at 64×64, `R = 4` (20 ticks/s at 4× = `< 40 ms/s`).
No per-tick or per-frame allocations; settlement rendering walks `settleCells`
in a single batched canvas path. Phase 1 times `R ∈ {1, 4, 8}` and map sizes
`64, 128, 256`; if `R = 8` at `256×256` exceeds `8 ms/tick`, diffusion runs every
N ticks with scaled step.

## Visualization and HUD

`render.js` extends the view switch to nine modes (keys `1`…`9`): `terrain`,
`investigation`, `influence`, `disturbance`, `biosphere`, `population`, `demand`,
`supply`, `workforce`.

- **Population**: dark land → warm ivory-gold (`sqrt` curve over `MAPE_POP_CAP`),
  water stays blue.
- **Demand**: diverging per selected item — surplus green, zero dark grey, unmet
  need red, water deep blue.
- **Supply**: dark → bright cyan-ivory by `goods` stock of selected item.
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

### Phase 1 — Demand diffusion and gradient transport (diffusion)

Deliverable: population and storage demand injection, Jacobi demand diffusion
(walkable-only for materials, full-map for CO2), mass-conserving up-gradient
goods advection, transport workforce signal, `experiments/mape_spread.js`.

Gate: midpoint across 20 walkable cells crosses zero within `15 s` on 1×, axial vs
diagonal arrival ratio within 15% (isotropic spread), water blocks material flow
without trapping CO2, goods conservation residual `< 1e-4`, tick time `< 2 ms` at
64×64 `R = 4` (scaling logged for `R = 1, 4, 8` and `64, 128, 256`).

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
- Coal and iron deposits show locked state until recorded to 100% and held, then
  flip to unlocked.
