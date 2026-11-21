# findings, pitfalls, skills

## loading the page in node for tests

Classic scripts in one `vm` context share top-level `const`/`let` as lexical globals, but they
are not properties of the context object: `ctx.main` is undefined. Read them with
`vm.runInContext('main.setup()', ctx)`. Deriving the script list from `index.html` keeps the
test honest about load order.

## stub DOM needs ImageData

`render.js` paints a 64×64 `ImageData` and scales it with `drawImage`. A stub canvas context
must provide `createImageData(w, h)` returning `{data: new Uint8ClampedArray(w*h*4)}`, plus
`putImageData`, `drawImage` and the path methods, or boot throws before any check runs.

## forbidden spawn heuristics

"farthest walkable cell" put a rival on a corner island with two water neighbours: it never
moved and never claimed. Score spawn cells by walkable neighbours (≥6 of 8) as well as
distance, and give movers a sidestep escape instead of a straight-line greedy step.

## per-frame allocations hide in ctx calls

`ctx.setLineDash([4, 5])` allocates a fresh array every frame. Keep dash patterns, palettes and
CSS colour strings as module constants; only cell values may vary per frame.

## territory pacing

Rival claims are cheap (arrive and claim), player claims need fully investigated cells. With a
map-wide rival search the map is exhausted by AI claims before the player can compete; giving
each rival a home region (18 cells) keeps the race territorial and winnable. Claim decay
(0.004/h) is what makes maintenance matter — tune it together with the source radius.

## hover preview versus a periodic refresh

A view switch painted from `hudRefresh` every 0.2 s must not write `radio.checked`. Rewriting
checked state from the render path erases a hover preview between pointer moves and makes the
preview flicker. Keep the checked state written only where the mode is actually applied, and let
hover check the radio (`radio.click()`) so the browser's `change` event stays the single writer.
Gate the preview on `matchMedia('(hover: hover) and (pointer: fine)')` read per event, not cached
at boot: hybrid laptops can swap pointer classes while the page is open.

## hidden radio still needs its label to look focusable

`opacity: 0` on the input keeps it focusable, but the visible `span` must carry every state —
`:checked`, `:hover`, `:focus-visible`, `:disabled` — or keyboard users see nothing. Use
`input:focus-visible + span { outline: …; outline-offset: -2px }` so the ring sits inside the
joined group instead of overlapping the neighbour.

## a radius reads as a plate, not a gradient, when the effect saturates

A sweep whose centre gain is above 1 gets clamped, so every cell inside the clamp radius renders
at 100 % and the falloff shows only in the last ring — the disk looks like a plate and the
falloff you tuned is invisible. Judge a radial effect by the mean per distance band, not by the
centre cell: a 3.5-cell reach with centre gain 1.33 recorded every meadow cell within 2.3 cells
in one press. Keep the centre gain near 1.0 so the core completes and the ring keeps a gradient.
Hours and effort multiply, so tune their product and drop the spare factor.

## dense markers and field conservation

Drawing ~82 settlements as separate `beginPath`/`fill` calls or scanning 4096 cells to find them
hurts the render path; keep a compact `settleCells` index array and emit one batched `beginPath`
with `moveTo(cx + r, cy); arc(...)` before a single `fill`, and store direct site indices on
storages instead of calling `sitesAt` per marker. In diffusion designs, diffusing signed demand
alone leaves physical `goods` stranded at mines — `goods` must also advect up the demand gradient,
and decay must be sized from `sqrt(D / decay)` (~15 cells on a 64×64 map) rather than per-tick
guesses. When stocks live in `Float32Array`, check `sum(goods)` conservation at `1e-4` and
`Float64` process counters at `1e-6`, recording `after - before` on cell writes so rounding does
not masquerade as mass creation.

## normalized gradient flow and worker recruitment on a 2D diffused field

Raw gradient flux `goods * (demand[j] - demand[i])` stalls 4–6 cells from a mine because 2D
screened diffusion (`K_0(r/L)`) flattens rapidly with distance; normalizing by
`g_k / (gSum + ref)` keeps steady haul speed across 20 cells and bends smoothly around water.
For diffused workforce, retain permanent residents only at site-job cells (`siteNeed > 0`),
give villages a slow departure rate (`MAPE_WORK_LEAVE`) paired with fast transit walking
(`MAPE_WORK_SPEED`) so diffusion lag never empties a village, and mark mine/factory cells so
arrived workers do not register as settlement markets. Round pairwise edge transfers directly
through `Float32Array` slots (avoiding `Math.fround` lookups) with a `1e-12` subnormal floor
for exact zero conservation drift; benchmark classic scripts via `vm.runInThisContext` because
`vm.createContext` intercepts cross-script globals and inflates tight numerical loops 3–5×.

## import pull and intake capacity are different controls

A short queue reading only its own stock barely notices a spill on the tile next door.
Let nearby accessible stock cool the pull, but don't also scale queue service by that cooled
pull: supply would increase congestion, reduce service, and push demand down again. With a
fixed service window and a stock-sensitive signal, the backlog can clear and the route can
recover. Trace accepted transfers, not proposed ones: a full queue can refuse an otherwise
steep uphill route.

## a second canvas is a resource, not a selected view

Always allocate/bind both field canvases, then derive paired visibility and draw routing from
the selected mode. Testing `demandCtx` for the active layout couples the survey to scene-only
boot and silently forces paired rendering once the context exists. Keep looks separate from
engine changes: palette/overlay switches must not warm demand or mutate stocks. Reduced motion
should disable animated trace phase, not hide static evidence of accepted transfers.

## float32 population accounting is not enough for a settlement ledger

Migration flux is computed in double precision but applied to Float32 population cells.
Record the actual source-plus-destination change after each pair write in `popDelta`; the
proposed flux alone accumulates measurable residual over long runs. This was measured the
hard way: 3 000 steps of ordinary growth on the seeded map left `mapePopResidual()` at
0.032 people with every write already booked, because each cell update rounds at ~6e-5 and
150 000 of them accumulate. `mape.pop` and `mape.popNext` are now `Float64Array` and the
residual is exactly zero. Widen the field rather than loosening the tolerance — the
tolerance is what catches a real leak, and a rounded ledger cannot tell the two apart.

## satisfaction reported from stock the rule forbids you to spend

`mapeUseCatchmentStock` summed a cell's *usable* goods (`max(0, stock - reserve)` at a
settlement), but spent the *raw* stock and recorded the full request as consumed. A town sat
at exactly the reserve with `satG = 1.0` and ate 0.033/s forever: satisfaction without a
source, which then fed growth and hid the map's deficit. Any "what can I spend" rule and the
debit that follows must be the same expression — `mapeSpendUsable` now returns what it
actually took and the caller records that. When satisfaction and stock disagree, print the
reserve, the raw stock and the recorded use side by side; a town that eats without its
granary falling is a one-line diagnosis.

## one-sided accounting cannot drive migration

Every settlement exports fresh workforce on its first tick and no settlement receives
another's export, so boundary balance is structurally negative for every town. Feeding that
number into population migration drains the whole map (`1165 -> 747`, 64 towns) no matter
how small the share, and a dual-sided debit makes it worse rather than better. Migration needs
a *two-sided* signal: staffed versus vacant job slots per town conserves people by
construction and leaves famine and waste as the only ways to lose them.

## signals that gain per second need a bounded display, not a bounded field

An additive demand signal (`field += need * gain * dt`, decay per second) settles at
`gain * need / decay`, so its peak grows with the need at the source and its halo spans
orders of magnitude. A fixed linear or `sqrt` display scale then paints either a few white
pixels or a faint haze. Draw it with `v / (v + ref)` (Michaelis-Menten) so one scale shows
both the halo and the saturated source; keep a separate `sqrt` scale for factual amounts
like job slots. Never clamp the field itself to make the picture readable — the advection
kernel is gradient-normalized and only cares about direction.

## spawn scans must exclude occupied cells

A pool threshold spawn that overwrites `pop[idx]` on a cell that already has residents
silently destroys population while adding the seed to `popDelta`, and only shows up as a
large negative `pop_residual`. Any "place a new settlement" scan has to reject `pop > 0`:
concentrating a pool (advection toward rest) makes a settlement's own cell exceed the
threshold far more often than scattered diffusion did.

## a field view whose ramp starts at black paints a black map

`RENDER_POP_RAMP` begins at `(30, 26, 30)`, so every cell without population rendered as
near-black while the few settlement cells were single bright pixels — the map read as
"nothing there". Give a sparse field its own dim base (a fraction of the terrain colour, see
`RENDER_CIVIC_DIM`/`RENDER_CIVIC_GAIN`) and blend the ramp on top, so empty land still shows
coastlines and the data reads as dots. Also drop markers that cover the cell they explain:
a settlement ring is larger than the town's own colour patch.

## waste placed "around" a source must beat recovery on the ring

Distributing a source's waste to its neighbours is useless while `LAND_RECOVERY` (~`2e-4`/s)
is larger than the share each ring cell receives: the ring decays to zero every tick and only
the source cell ever looks disturbed. Check the ring cell's rate, not the source's — a
factory at `0.0006`/s gave each neighbour `1e-4`/s and left no trace. Mine spoil is emitted as
a ring-only halo so the shaft keeps the productivity its yield multiplies by.

## sample locations when scarcity should cost search time

Reservoir-sampling only eligible forest cells guarantees a cut whenever any forest is nearby;
it hides the effort of finding a sparse patch. For search friction, sample one cell from the
fixed patch and let an ineligible result consume the attempt. This keeps per-tick work constant
and makes output probability track forest coverage.

## a diffusion field's halo must be shorter than the spacing of its sources

The town pull relaxed toward ambient at `0.025/s`, i.e. a ~10-cell halo, while seeded towns
sat 2–5 cells apart: the halos overlapped into one flat sheet (town/background contrast
1.02–1.17) and every town read the same pull regardless of population. Measure the contrast,
not the peak: sort land cells, compare the town median to the background median. Spacing sets
the budget — halo reach must stay well under the nearest-neighbour distance.

## never scale a physical need by the signal that decides where supply goes

Catchment A consumed `rate × demandAtCenter × dt` from its reach. Stock cooled the demand
(feedback), the cooled demand cut consumption, stock survived longer and cooled it further:
towns hoarded 2715 coal, nothing was hauled, the field decayed to ~0 and the demand map went
black. A pull field decides *where* goods go; metered use is a separate, need-driven rate.
Two coupled quantities pointing at each other always find the dead fixed point.

## a single pinned demand cell loses to a graded halo next door

A factory's coal pull was one cell at 1.0 against a pop-60 town haloing 0.3–0.5 over a 10-cell
reach: haulage moved the coal toward the town and the plant starved one cell from its own
stock. A consumer that owns a catchment needs a pull zone with falloff (an active plant now
uses a 4-cell half-width, `1 − ring/5`); compare the consumer's demand against the *sum* of
competing halo values over the cells the haul would cross.

## the demand palette must be tuned to where town pull lives

The Fieldbook need ramp put its bright half above 0.5 of a 0–1 range, which only a pinned
consumer reaches; town pull sits at 0.2–0.5, so a correct field looked uniformly dark. Spend
the midtones where the data is, and give the ramp a warm low end (the old first stop was the
same colour as water). Check the rendered pixel of a known town against the number in the
inspector before blaming the physics.

## the site engine diverges from diffusion on purpose — name the divergences

Diffusion hauls down a water gradient over shared fields; Sites matches orders
point-to-point by euclidean distance and an eta delay, so delivery timing is a
shipping schedule, not a front velocity. Transport cost is charged as workforce
but never throttles a shipment — it only prices orders, so material always moves
if a seller exists. Sellers are chosen globally by price (abundance at distance
beats scarcity next door); diffusion can only push locally. Factories site by
margin against the hungriest buyer; diffusion's scan weighted centroid toward
deposits. Transport work is split across both shipment endpoints — charging it
all at the origin paints the seller side with a work halo and pumps the buying
town's Residents toward the supplier (orders recur faster than WORK_DECAY).

## revenue that adds haulage selects the farthest buyer

Margin revenue must be `buyer price − dist · COST`: haulage is what the seller
gains by delivering, so it is a discount on the offer. Adding distance to the
revenue term pays the plant for travelling and the scan walks to the farthest
town — inverting "best nearby goods buyer" while looking like a delivery fee.
Costs already pay haulage on the input side; revenue only ever discounts it.

## in-transit stock must join the conservation ledger

A shipment debited on arrival alone lets a seller spend the same stock twice
(reserve nothing, sell everything). Debit on departure, credit on arrival, and
carry the in-flight total as `transit` in the residual — `|(goods + massOut +
transit) − (initial + massIn)|` — or a mid-flight engine switch mints goods out
of nothing when the pool is settled into a different accounting.

## goods arrays are sliced by resource — `mape.goods[cell]` writes coal

Every writer needs the offset: `mape.goods[MAPE_RES.GOODS * world.n + cell]`, or
the `mape.goodsView[res][cell]` view. A test seeding a seller with
`mape.goods[cell] = 300` lands in the r=0 (coal) slice, the follow-up coal line
overwrites it, and a growth gate fails on a map whose "goods" seller holds no
goods — with a perfectly conserved ledger, because both writes were valid coal.

## a chain whose first link is gated by the second never starts

The placement scan sited sawmills while regional logs sat below the build
reserve and log-fed works only above it — but the sawmill cuts only where log
demand reaches it, and that demand comes only from charcoal and wood works.
Default survey: three fully staffed mills planned in the first 15 s, then zero
logs, zero coal satisfaction, no consumer, forever. When a producer's output is
gated on a consumer's signal, the rule must allow one consumer as soon as the
producer stands (its own demand pulls the first cut); keep the scarcity reserve
for every later build. Diagnose by printing the gate variable the producer
waits on, not just what was placed.
