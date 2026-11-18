# Map-economy engine prototype plan — 4.1a

Standalone design for a prototype of the map-economy engine described in draft 4.1a.
It covers settlements with populations, demand as a distance field, factory placement
and construction, resource and product storage, transportation cost and workforce,
and the two candidate implementations (diffusion-based fields vs discrete sites)
behind one selectable interface. All numbers below are prototype starting values;
they live in the owning source file and are tuned from experiment logs.

## Scope

Prototype loop: settlements hold population, population creates demand for goods,
storage creates surplus, demand and surplus diffuse as fields, factories appear
where demand and surplus overlap, factories consume coal and iron ore and produce
goods plus waste plus CO2, waste is disturbed land, CO2 feeds forest growth,
transportation cost creates workforce demand, workforce demand pulls population,
population grows where its goods need is met and declines where it is not.
The player observes the fields, inspects any cell, and unlocks deposits by
investigating and holding territory so mines can work them. Factories are placed
by the engine, not by the player.

Deferred: multi-product recipes beyond one, player-built factories, trade prices
between settlements, caravan agents, larger maps, rival map-economy agents.

## Relationship to the current prototype

The current prototype (plan-prototype.md) has 64×64 cells, 3 towns with per-town
stocks and prices (economy.js), a site pool (sites.js), per-faction influence fields
rebuilt from sources each tick (territory.js), disturbed fraction (land.js),
biomass per cell (economy.js) and a conservation ledger. The map economy replaces
the town layer:

- Settlements replace towns. There are no town stocks or town prices in the
  prototype. The 2% settlement density is seeded as random walkable cells with
  small random populations; growth and migration move the map toward the target.
  The player's market moves to settlements: selling, buying and hiring happen at
  a settlement cell. economy.js keeps resources, recipes and the ledger; town
  stocks and prices are removed in the same plan that adds settlements.
- Influence fields already prove the pattern: per-cell Float32Array, sources inject,
  quadratic falloff, rebuilt per tick. Demand fields reuse that pattern with
  diffusion instead of source falloff.
- Disturbance, productivity (1−d) and the ledger are reused unchanged. Waste is
  not a material stock: goods production and mining add to disturbed fraction
  `d` (land.js). Productivity scales population cap, mine rate and forest growth.
- Biomass (economy.js) gains a CO2 requirement: forests grow only where CO2 is
  available. Coal burning produces CO2; forests consume it. Oxygen remains the
  global stock it is today; CO2 is the new per-cell field.

## Core concepts

- Cell: one of 4096 cells (64×64), linear index `i = y*64+x`. Every map-economy
  quantity is a per-cell Float32Array unless stated otherwise.
- Settlement: a cell with population above zero. Target density is 2% of cells
  (~82 cells) at steady state. Seed places ~82 settlements on random walkable
  cells with small random populations (8…20). Growth and migration then move
  the map toward the target; the density is an outcome, not a fixed count.
- Population `pop[i]`: persons in the cell. Prototype range 0…120 per cell.
- Item: coal, iron ore and goods. Coal is fuel and CO2 source. Iron ore is the
  material input. Goods is the product settlements need. Field arrays are sized
  for R = 4 (coal, iron, goods, CO2) from day one so adding items is data-only.
  CO2 is a field like the others but it is consumed by forests, not settlements.
- Demand `demand[r][i]`: signed field per item. Positive = unmet need, negative =
  surplus available. Units are goods-equivalent per cell. This is the distance
  field: its gradient points from surplus toward need.
- Goods `goods[r][i]`: physical stock in the cell (in storage, at a mine or
  factory). Kept alongside demand so conservation can be checked and so the
  prototype can test whether negative demand alone suffices or actual goods
  availability must gate consumption.
- Storage: a cell that holds goods. In the diffusion engine storage is a cell
  value; in the site engine storage is a discrete site with a stock. Both inject
  negative demand proportional to stock.
- Factory: consumes coal and iron ore, produces goods plus waste plus CO2, needs
  workforce, disturbs its cell. Recipe: `1 coal + 1 iron ore → 2 goods + waste + 1 CO2`.
- Mine: produces coal or iron ore from a finite deposit, disturbs its cell.
  A mine works only on an unlocked deposit (see player role).
- Forest: biomass cell that consumes CO2 to grow. Growth rate scales with local
  CO2 availability and productivity.
- Workforce demand: worker-hours per hour required by factories and transportation.
  Unmet workforce demand throttles production and attracts migration.

## Data model

New file `map-economy.js` owns all map-economy state. Struct-of-arrays, preallocated
once at setup, mutated in place per tick. No allocations in the step.

```
MAPE_R = 4                    // coal, iron, goods, CO2
MAPE_SETTLE_TARGET = 0.02     // fraction of cells with pop > 0 at steady state
MAPE_POP_CAP = 120            // per-cell carrying cap before crowding
MAPE_POP_SEED_MIN = 8         // persons per seeded settlement, low
MAPE_POP_SEED_MAX = 20        // persons per seeded settlement, high
MAPE_NEED_GOODS = 0.006       // goods per person per hour
MAPE_DIFFUSE = 0.18           // diffusion rate per tick (1-min tick)
MAPE_DECAY = 0.002            // demand decay per tick (leak, keeps fields bounded)
MAPE_FACTORY_THRESHOLD = 6.0  // min placement score to build
MAPE_FACTORY_BUILD_HOURS = 24 // construction duration
MAPE_FACTORY_COAL = 1.0       // coal consumed per hour per factory
MAPE_FACTORY_IRON = 1.0       // iron consumed per hour per factory
MAPE_FACTORY_YIELD = 2.0      // goods produced per hour per factory
MAPE_FACTORY_CO2 = 1.0        // CO2 produced per hour per factory
MAPE_MINE_RATE = 1.2          // resource produced per hour per mine
MAPE_WORKFORCE_PER_UNIT = 0.4 // worker-hours per unit moved or produced
MAPE_FOREST_CO2 = 0.02        // CO2 consumed per hour per growing forest cell
```

State:

- `pop: Float32Array(N)` — persons per cell.
- `demand: Float32Array(R*N)` — signed need per item, index `r*N+i`.
- `goods: Float32Array(R*N)` — physical stock per item.
- `workforce: Float32Array(N)` — unmet worker-hours per cell (demand signal).
- `factories`: struct-of-arrays pool, cap 32: x, y, state (building/active), progress.
- `mines`: struct-of-arrays pool, cap 32: x, y, stock, resource, unlocked flag.
- `storages`: struct-of-arrays pool, cap 96: x, y. Stock lives in the goods field.
- `engine: 'diffusion' | 'sites'` — selectable mode, default 'diffusion'.
- Ledger counters: `mapeMassIn, mapeMassOut` checked against goods totals.

Memory: R*N*2 floats = 4*4096*2*4 ≈ 131 KB. Trivial. At 256×256 with R=8 it is
~2 MB, still fine.

## Diffusion engine (field-based)

One step per tick, in order. All loops are sequential over cells, no allocations.

1. Population creates demand. For each cell with pop > 0:
   `demand[goods][i] += pop[i] * MAPE_NEED_GOODS * hours`. Water cells have
   pop 0 and never inject.

2. Storage creates surplus. For each storage cell, for each item r:
   `demand[r][i] -= goods[r][i] * MAPE_STORAGE_SIGNAL`. The signal coefficient
   (prototype 0.5) maps physical stock to field strength. A cell with goods but
   no storage entry injects nothing; this is the knob that keeps surplus local
   to real stock.

3. Diffusion spreads demand. For each item r, one Jacobi pass with a scratch
   buffer (double-buffered demand, swapped per tick):
   `next[i] = cur[i] + MAPE_DIFFUSE * (avg(neighbours) - cur[i]) - MAPE_DECAY*cur[i]`.
   Neighbours are 4-connected. Water cells do not diffuse into or out of; they
   hold their value (which stays 0). Two passes per tick at 1-min ticks give a
   spread of ~1 cell per 3 ticks, so a surplus crosses 20 cells in ~15 game hours.
   The rate is tuned from the spread experiment, not by feel.

4. Factories and mines consume and produce (see lifecycle below). Consumption
   increases demand for the input, production decreases demand for the output
   and increases goods stock. CO2 production increases the CO2 field at the
   factory cell; forest growth decreases it. Goods stock is the physical truth;
   demand is the signal.

5. Forest growth consumes CO2 (see below).

6. Population growth and migration (see below).

7. Workforce demand updates (see below).

The key prototype question is whether step 4 can be gated by demand alone
(negative demand = available) or must also check goods stock at the factory
cell. The engine implements both gates behind a flag `MAPE_GATE_ON_GOODS`
(default true). The experiment compares gate-on vs gate-off: if gate-off
produces goods from nothing (ledger residual grows), negative demand alone
does not work and the flag stays on.

## Site engine (discrete)

Same data tables (needs, recipe, rates), different step:

- Settlements, factories, mines and storages are discrete entities in pools with
  position, stock and owner. Each settlement has a stock per item and a
  population.
- Each tick, each settlement computes need = pop * MAPE_NEED_GOODS. It buys from
  the cheapest storage within reach: price = base + transport cost (distance *
  MAPE_TRANSPORT_COST). The storage deducts stock, the settlement adds stock,
  goods arrive after a delay of distance / MAPE_TRANSPORT_SPEED ticks.
- Factories order coal and iron the same way and sell goods to the highest bidder.
  Prices are deterministic from distance and stock, not from a market.
- Forest growth and population growth use the same satisfaction formula as the
  diffusion engine, but satisfaction is computed from actual stocks, not fields.

The site engine is the control group: if diffusion produces the same factory
locations and population distribution as sites, diffusion is validated. If not,
the difference is the finding.

## Hybrid and selectable interface

Both engines are built in parallel behind one interface in map-economy.js:

```
mapeInit(mode)      // mode: 'diffusion' | 'sites'
mapeStep(minutes)   // one tick, dispatches to mapeStepDiffusion or mapeStepSites
mapeField(r, i)     // read demand or goods for rendering and HUD
mapeSetEngine(mode) // switch at runtime for experiments (re-seeds pools)
```

Hybrid is a configuration, not a third engine: sites for buildings
(settlements, factories, mines, storages as pools) plus fields for goods,
demand and population. The diffusion engine already uses pools for factories
and mines; the hybrid adds settlement and storage pools to it. The prototype
ships diffusion and sites; hybrid is diffusion with settlement pools enabled
(`MAPE_HYBRID_SETTLEMENTS = false` by default).

## Population dynamics

Satisfaction per cell: `sat = clamp(1 - demand[goods][i] / (pop[i]*MAPE_NEED_GOODS*MAPE_SAT_SCALE + 1), 0, 1)`.
If demand is negative (surplus), satisfaction is 1.

Growth per tick: `pop += pop * (MAPE_GROWTH * sat - MAPE_DEATH * (1-sat)) * hours`,
capped at `MAPE_POP_CAP * productivity[i]`. Prototype `MAPE_GROWTH = 0.02/h`,
`MAPE_DEATH = 0.05/h`. A settlement with no goods declines; with goods it grows
at 2%/h until crowding.

Migration per tick: population diffuses, biased toward higher satisfaction.
For each edge i→j, flux = `MAPE_MIGRATE * (pop[i]-pop[j]) * 0.5 + MAPE_MIGRATE_SAT * pop[i] * (sat[j]-sat[i])`.
Only the positive part moves. Water cells never receive migrants. The bias term
is what makes people move toward satisfied areas instead of spreading evenly.

Workforce: factories and transportation create `workforce[i]` demand. If local
pop covers it, production runs at full rate. If not, production scales by
`pop / (pop + workforce)` and the unmet part adds to the migration bias toward
that cell (jobs attract people). This closes the loop: factories → jobs →
migration → more workforce → more production.

## Factory lifecycle

1. Placement scan (once per game hour, not per tick): score every walkable,
   non-water cell:
   `score = demand[goods][i] - demand[coal][i] - demand[iron][i] - MAPE_DISTURB_PENALTY*disturbed[i]`.
   `demand[goods]` positive means need nearby; `-demand[coal]` and `-demand[iron]`
   positive mean surplus nearby. The best cell wins if score >
   MAPE_FACTORY_THRESHOLD and workforce nearby (pop within 3 cells) >
   MAPE_FACTORY_WORKFORCE_MIN (10). At most one factory starts building per scan.

2. Construction: state building, progress 0…1 over MAPE_FACTORY_BUILD_HOURS.
   The construction site injects build-material demand (iron) at its cell each
   tick. It disturbs the cell at 0.002/h.

3. Active: consumes coal and iron at the recipe rates, produces goods and CO2,
   gated by goods availability (flag above) and workforce. Disturbs at 0.004/h
   (waste). If input demand stays above MAPE_FACTORY_IDLE (8) for 48 h with no
   goods arriving, the factory idles (no consumption, no disturbance) but remains
   on the map.

4. Mines: seeded near resource deposits (reuse sites.js deposit positions in
   the prototype). A mine works only when its deposit is unlocked (see player
   role). Produce at MAPE_MINE_RATE until stock is exhausted, then become done.
   Each unit produced adds to goods stock at the mine cell and decreases demand
   for that resource there.

## Forest and CO2 loop

Forests are biomass cells (economy.js). In the prototype, forest growth requires
CO2: `growth *= clamp(CO2[i] / MAPE_FOREST_CO2_SCALE, 0, 1)`. Each growing forest
cell consumes CO2 at MAPE_FOREST_CO2 per hour, decreasing the CO2 field there.
Coal burning (factories, and town fuel use while towns still exist) increases
the CO2 field at the burning cell. CO2 diffuses like the other items, so a
factory upwind of a forest feeds it. If CO2 is zero, forests do not grow but
existing biomass remains. The loop is closed: coal → CO2 → forest growth →
oxygen (existing biosphere) → factory oxygen input.

## Player role: unlock deposits

The player does not build factories. The player's lever is unlocking deposits:

- Deposits start locked. A locked deposit shows as a site but cannot be mined.
- Investigating a deposit cell to 100% and holding territory influence there
  unlocks it. The unlock rule reuses sitesClaim and territoryContest: the player
  must hold at least equal influence in the deposit cell.
- Unlocked deposits can host mines. Mines on locked deposits produce nothing.
- Settlements are the player's market: selling, buying supplies and hiring
  happen at a settlement cell, replacing the town actions. Prices at a
  settlement use the same formula as town prices, with the settlement's goods
  stock as the stock term.

This keeps the existing investigation → claim → work loop and gives the player
a reason to expand territory: more unlocked deposits, more mines, more supply.

## Transportation cost

In the diffusion engine transportation is implicit: diffusion rate and distance
are the cost. Workforce for transport is computed from total flux:
`transportWork = sum(|flux|) * MAPE_WORKFORCE_PER_UNIT`. This is a global
number shown in the HUD; locally it is attributed to the surplus cell.

In the site engine transportation is explicit: cost = distance * MAPE_TRANSPORT_COST,
delay = distance / MAPE_TRANSPORT_SPEED. The prototype compares the two:
if diffusion with a single rate produces wildly different factory locations
than explicit transport, the rate is wrong or diffusion is insufficient.

## Conservation ledger

Every production and consumption updates `mapeMassIn` and `mapeMassOut`.
Mines: in = stock removed, out = goods added + disturbed mass. Factories:
in = coal + iron + oxygen, out = goods + waste (disturbed mass) + CO2.
Forests: in = CO2, out = biomass + oxygen (existing biosphere accounting).
Diffusion itself conserves sum(demand) except for the explicit decay term,
which is counted as dissipated. The smoke check requires
`|mapeMassIn - mapeMassOut - dissipated| < 1e-6` after 1000 ticks. If the
residual grows, goods are being created from negative demand alone and the
goods gate must stay on.

## Performance and scalability

Budget: one tick under 2 ms at 64×64 with R=4 on a laptop. Diffusion is
R*N*passes ≈ 4*4096*2 ≈ 33k cell updates per tick, each a few flops. At
24 ticks/sec that is ~0.8M updates/sec, well within Canvas 2D frame budget.
The experiment measures tick time vs R (1, 4, 8) and vs map size (64, 128, 256)
by running the step headless and timing it. The decision rule: if R=8 at
256×256 exceeds 8 ms/tick, fields must be updated at a lower rate (every
4 ticks) or items must be capped. No per-tick allocations; scratch buffers are
allocated once at init.

## Visualization

New view modes in render.js, reusing the ImageData paint path:

- Population: dark → bright by pop, water stays blue.
- Demand (per selected item): diverging palette, surplus (negative) in green,
  need (positive) in red, zero in dark grey. The selected item is chosen in the
  HUD (coal / iron / goods / CO2).
- Supply (goods): brightness by goods stock per selected item.
- Workforce: brightness by unmet workforce demand.

Markers always show settlements (dots sized by pop), factories (squares),
mines (triangles), storages (small squares). Locked deposits show a lock tint.
The HUD shows the hovered/clicked cell's pop, demand and goods per item, the
engine mode with a switch, and the unlock state of the deposit under the party.

## Prototype phases

Both engines are built in parallel behind the shared interface. Each phase ends
with a decision gate. A phase that fails its gate stops the next phase; the
finding goes to findings-pitfalls-skills.md.

### Phase 0 — Field infrastructure and visualization (1–2 days)

Deliverable: map-economy.js with fields, init, stub step, render views, HUD
inspector, engine flag. No dynamics; fields are seeded with test patterns.
Settlements replace towns in the same phase: town placement removed, settlement
seeding added, market actions moved to settlements.

Gate: fields render correctly, settlements seed at ~2% with small random pops,
no frame regression (fps within 5% of baseline), smoke still passes (updated
for settlements).

### Phase 1 — Demand and diffusion only (2–3 days)

Deliverable: population → demand injection, storage → negative demand,
diffusion, water handling. No factories, no growth. Experiment
`experiments/mape_spread.js` seeds one settlement and one storage 20 cells
apart and logs demand at the midpoint over time. Both engines implement the
same injection; diffusion spreads by field, sites by explicit trade.

Gate: midpoint demand crosses zero within 24 game hours and the spread is
roughly circular (not axis-aligned). If water blocks diffusion entirely and
creates dead zones, water handling must change before Phase 2.

### Phase 2 — Population dynamics (2–3 days)

Deliverable: satisfaction, growth, migration, workforce stub. Experiment
`experiments/mape_population.js` seeds settlements with and without goods
supply and logs pop over 200 game hours.

Gate: supplied settlements grow, unsupplied decline, no cell exceeds cap,
no NaN, total pop is bounded. If migration oscillates, the bias term is tuned
or migration is rate-limited.

### Phase 3 — Factories, mines, forest loop (3–5 days)

Deliverable: placement scan, construction, production/consumption, disturbance,
CO2 production and forest consumption, ledger, deposit unlocking. Experiment
`experiments/mape_factory.js` seeds demand and surplus and logs factory
placement, forest growth and ledger residual over 500 game hours.

Gate: factories place between need and surplus (not in water, not on heavily
disturbed cells), forests grow only where CO2 is present, ledger residual
< 1e-6, disturbance appears at factories. If gate-off (demand-only) creates
goods from nothing, the goods gate stays on and that is the answer to the open
question.

### Phase 4 — Site engine parity (3–4 days)

Deliverable: discrete settlements, factories, mines, storages with price-based
trade and explicit transport, forest CO2 consumption from actual stocks.
Same scenarios as Phases 1–3.

Gate: site engine produces the same qualitative outcomes (factories between
need and surplus, supplied settlements grow, forests grow near CO2 sources).
If it does not, the diffusion result is suspect and must be re-examined.

### Phase 5 — Selectable engine and integration (2–3 days)

Deliverable: runtime engine switch, tick order integration, territory influence
boost (higher influence raises growth by 10%), victory stability check
(population not declining, no unmanaged factory disturbance). Both engines pass
smoke and dom_smoke.

Gate: switching engines at runtime re-seeds cleanly, both pass the full suite,
and the comparison harness (`experiments/mape_compare.js`) reports factory
locations and pop distribution for both engines on the same seed.

## Experiments

All experiments are node scripts under experiments/, machine format (fixed keys,
one line per metric), derived from index.html load order like smoke.js.

- `mape_spread.js` — diffusion spread vs distance, water blocking, tick time vs R.
- `mape_population.js` — growth/decline curves, migration bias, cap behaviour.
- `mape_factory.js` — placement score distribution, ledger residual, gate-on vs gate-off, forest CO2 growth.
- `mape_compare.js` — diffusion vs sites on identical seeds: factory positions,
  total production, pop distribution, tick time.

Keep only runs that produced a decision. Prune the rest when the plan closes.

## Integration

- Tick order in main.js: `party → investigation → sites → rivals → territory →
  land → economy → map-economy → events`. Map-economy runs after economy so
  settlement stocks and map goods are both current when factories consume.
- Territory influence: `growth *= 1 + 0.1 * influence[player][i]`. Influence is
  the player's lever on the map economy in the prototype, together with deposit
  unlocking.
- Land: factories and mines call landDisturb; productivity scales pop cap, mine
  rate and forest growth.
- Victory: economy-stable check gains two items — total population not declining
  over the last 100 game hours, and no cell with disturbed ≥ 0.25 outside
  player-controlled cells that hosts a factory or mine.
- File map additions: map-economy.js (fields, diffusion, population, factories,
  forest CO2), experiments/mape_*.js. render.js gains view modes, hud.js gains
  the inspector, item selector and engine switch, main.js gains the tick and
  the engine flag. economy.js loses town stocks and prices; sites.js loses town
  placement and gains settlement seeding.

## Risks

- Negative demand creates goods from nothing. Mitigation: goods gate flag,
  ledger check, gate-on vs gate-off experiment.
- Diffusion washes out gradients. Mitigation: decay term, storage signal
  coefficient, spread experiment before any dynamics.
- Population collapse or explosion. Mitigation: caps, death rate above growth
  rate when unsatisfied, bounded total pop check.
- Factory oscillation (build, idle, abandon, rebuild). Mitigation: idle
  threshold, one build per scan, construction cost.
- Water creates dead zones. Mitigation: water handling tested in Phase 1.
- Performance blowup with many items. Mitigation: R sized for 4, timing
  experiment, lower update rate if needed.
- CO2 loop stalls (no coal, no forest growth, no oxygen). Mitigation: seed
  initial CO2, forest growth also allowed at low rate without CO2 in Phase 0,
  tightened in Phase 3.
- Settlement seeding replaces towns and breaks balance. Mitigation: Phase 0
  updates smoke expectations in the same edit; balance is re-tuned from the
  population experiment, not by feel.

## Open questions

- What are realistic population numbers? Prototype uses 0…120 per cell;
  the population experiment checks whether that range produces readable maps.
- Does the player need more than unlocking deposits? Prototype is unlocking
  plus influence; building is deferred.
- Is 2% settlement density a target or a seed? Prototype treats it as both:
  seeded at ~2% with small pops, then growth and migration maintain it.
- Should CO2 diffuse or stay global? Prototype diffuses it per cell so factory
  placement relative to forests matters; if the spread experiment shows CO2
  washing out, it becomes a global stock with a local bonus.
