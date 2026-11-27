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

## a fading pull's reach is an outcome — tune the rates, never a distance

Demand fields here have no cutoff: a signal diffuses (`D`, cells²/s) and fades (`k`, /s), and
how far it carries is `sqrt(D / k)`. The town pull once faded at `0.025/s` (~10 cells) while
seeded towns sat 2–5 cells apart: neighbouring pulls merged into one flat sheet (town/background
contrast 1.02–1.17) and every town read the same. The fix was a faster fade (`0.8/s`, ~5 cells
at today's `D`), not a radius. Measure the contrast, not the peak: sort land cells, compare the
town median to the background median. Write reach as a measured consequence ("about five cells
at D = 24"), never as a rule — a later speed change moves it on purpose, and comments that call
it a fixed halo invite someone to clamp the field to keep it.

## explicit diffusion breaks silently when its speed is a per-pass mix

The A/B pull mixed `0.2 · dt / 0.05` per Jacobi pass and the signed kernel mixed
`0.72 · 0.25 · dt / 0.2`. Both were fine at today's numbers and both were one tuning step from
exploding: per-pass mix above `0.25` oscillates, and a 0.2 s A/B step blew the 0–1 pull to
`3e38`. Multipass splitting hid the problem — the pass count made any coefficient "safe" while
the units were wrong. The fix that stuck is scale, not passes (**units-and-scales.md**): one
Jacobi pass per canonical tick, every shipped `D · SIM_STEP_SEC ≤ MAPE_MIX_MAX = 0.15` by
construction (a rate above it fails `experiments/mape_diffusion_speed.js` instead of quietly
splitting), and a speed change rescales `decay` with `D` so `sqrt(D / decay)` — the reach —
stays put. Fade with `exp(−k · dt)` for the same reason. Trade-off to remember: reach is
preserved but transients slow with the rescale, so scene gates that watch a pull re-aim need
seconds, not one tick.

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

## a household commodity has two sides in every engine — demand and use

Adding an item the towns consume touches demand injection, use rates, local use,
catchment/queue serve, Sites hold, Sites orders, Sites metabolism and the
`used*`/`sat*` arrays. A sawmill-chain draft that made logs a market item
removed logs from Sites household holds and orders but kept Sites consumption:
towns ate logs nobody ordered, and only the Sites engine showed it. Grep every
existing site of the item (`MAPE_RES.LOGS`, `MAPE_NEED_*`) and change the
demand and use sides as a pair; a four-engine "households pull without a
producer" gate catches the missing side.

## charge labour in input units, so a yield constant stays a pure yield

The sawmill charged cut work per log produced (`logs / RATE`). Halving the
forest→log yield then left logs/s unchanged and silently doubled forest draw —
the opposite of "produce less wood". Work now costs `felled / FELL_RATE` (forest
units), and `FOREST_PER_LOG` changes output only. For any recipe, put the
workforce rate on the input it physically handles; output-side rates couple
the yield knob to depletion.

## a live multiplier must scale a rate, not a constant baked at dispatch

Tuning knobs multiply per-second rates where they are spent (`rate * tune.x * dt`), never a
value frozen into state. Site shipments store an ETA at dispatch; scaling the speed there
leaves every in-flight load at the old pace and a ×0.1 → ×1 move strands them for minutes.
Scale the countdown (`eta -= dt * tune.haul`) instead. Construction is the same trap the
other way: speeding progress alone makes builds cheaper, so the pace multiplies the log
draw and the progress together and total cost stays authored.

## a stub DOM missing one API fails the whole boot silently

`hud-economy.js` called `classList.toggle`, the dom fixture had no `classList`, and
`dom_smoke` reported a single `check_boot=fail` — every later check was skipped, not failed,
and `map_views` hid a stale duplicate check behind the same crash. When boot fails in the
fixture, grep the boot error for the missing member first and add it to `makeElement`.

## a scan that only tries the best region freezes the whole map

The placement scan picked the single neediest region and returned when that region had no legal
cell for its kind. On the seeded survey the first farm took the region centre and cleared its
forest; every later scan chose the same region, failed the cover floor at the same centroid,
and the map built one farm in ten minutes. Rank the regions and fall through to the next,
skipping anchors that describe the same towns. Let a mill search wider for forest than a works
searches for its centroid — the town centre is where cover is thinnest.

## a demand floor gates where, not how much

The sawmill cut wherever log pull cleared a tiny floor, and works keep the pull high near them,
so one crew of 32 out-cut a dozen works and the scan read the piles as surplus and kept siting
consumers to the cap. A local stock check — uncollected logs in the cutting patch hold the crew
— ties output to what haulage takes away. Count only free stock as surplus: a works' input
buffer on its own cell is spoken for.

## a weighted share denominator cancels the speed it weights

Hauling as g·c / (Σg·c + ref) saturates once Σg·c ≫ ref, so a uniform swamp sent 0.92 of
what meadow sent on a steep gradient (queue admission 0.996) — conductance only steered
routes. The speed map passed every route and detour gate anyway; only a uniform-slow test
exposes it (`uniform_slow_ground_sends_less`). Saturate on raw slopes (Σg + ref) and let c
weight the send, then express shipped rates at c = 1 so the reference ground keeps its pace.

## guard before the debit, never after it

`mapeSitesShip` took stock from the seller and only then returned on a dust shipment
(`shipped <= MAPE_EPS`), so each dropped order vanished from the ledger: a steady
−6e-9/s drift that sat just under the 1e-6 gate until an unrelated balance change
crossed it. A linear residual is a leak, not float noise — wrap each tick phase with a
ledger delta (`mapeLedgerResidual` before/after) to find it in one run.

## money as a field: a payer must never be its own sink

Payments moving up an "owed" pull get stuck on any cell that both pays and is owed: its own
pull source is a local maximum, so `mapePushUpGradient` finds no uphill neighbour. Split the
money in transit by direction (households → industry, industry → towns) so every payer injects
into a stock whose sinks exclude it. Output-as-claim (steers pull) plus payment-as-cash keeps
the ledger exact without matching buyers to sellers.

## ratio fields need a signed ramp

A price (or any ratio around 1) on a one-sided 0–1 palette puts the neutral value in bright
midtones and the whole map reads "hot". Draw log(ratio) signed through the existing negative
(teal) branch; and keep the ratio's ease term large enough (0.5) that empty, unwanted land is 1×.

## emergent display gates move with the economy

`mape_co2` band max (peak plume on 0–2) swung 0.65–0.87 when purses changed coal burning. Gates on
emergent magnitudes need slack or a scene with pinned sources; don't treat a shift as a regression.

## stream per receiver kind: payments without an owed-pull field

Extends the entry above. price-model-b gold (`prototype/price-model-b/gold.js`): goods climb the buyer's bid, gold climbs the
seller's ask. One coin stream per receiver kind (coal→mines, goods→factories, wage→towns) with
an ask injected by receivers reuses item transport and keeps every payer off its own stream.
Test helpers that clear actors must also reset money, or seeded purses stay on empty cells and
the gold ledger breaks while the model is fine.

## finite buffer cooling, transit delay and multi-buyer pass-through

Three traps surfaced together in `prototype/price-model-b/`:

- **A stock-cooled bid whose cell capacity sits near `STOCK_REF` never reaches zero.** Capping a
  buyer cell at `0.085` while cooling by `1 + stock / 0.08` froze the divisor at `2.06`, so
  towns kept bidding ~50 % of max even when flooded and pulled free (`price = 0`) stock into
  an endless ring around themselves. Cooling linearly as `max(0, 1 − stock / target)` with
  `cap[buyer] = target` drops both the bid and intake room to exact zero once finite need is met.
- **An input buffer shorter than spatial transit time pulses on and off.** A `0.6 s` labor
  buffer at a mine `12` cells from town (`~2 s` walk) filled in one burst, cut the wage bid by
  96 %, halted incoming commuters, and starved `0.6 s` later. Size `BUFFER_SECONDS` (`1.5 s`)
  comparable to neighborhood refill time so steady flow locks in without bullwhip oscillation.
- **A satisfied buyer must not clamp down a rival's steeper price.** When both towns and
  factories buy coal (or mines and factories both hire labor), relaxing a full town toward
  `bid = 0` creates a cold sink that blocks a nearby factory's coal bid. Yielding to `ambient`
  whenever `ambient > here && ambient > relaxed` passes steeper external bids across while
  leaving lonely-buyer cooling unchanged.

## cost-basis asks, joint input budgets and civic tax rebates

Four traps surfaced when unifying firms and towns in `prototype/price-model-b/actors.js`:

- **Seller ask floors must gate `planOutflow`, never inject into diffused buyer prices.**
  Writing `sell[i]` into `priceGoods` turns an expensive unsold warehouse into a local price
  peak that pulls neighboring goods *toward* the seller. Keep `price*` purely buyer-driven and
  test `price[to] > Math.max(price[i], sell[i])` at departure while carrying input `cost[i]`
  into output stock so conversion never pauses and inventory never ships at a loss.
- **Independent complement-margin bids (`priceOut − otherCost`) overbid 130 % on startup.**
  When `priceCoal = 0` and `priceLabor = 0`, two inputs bidding `0.65 · outValue` each commit
  `1.30 · outValue` before costs settle. Normalize `rawSum` against `JOINT_BUDGET_SHARE · outValue`
  when `derived` is active, and keep a profit-driven wage floor (`0.35 · drive`) on labor so
  full shift buffers do not collapse wages at profitable firms.
- **Unconditional treasury rebates manufacture fake town profit.** Paying `civic` from town
  `purse` into `workerPurse` while `comfort` is low lets an unsupplied town tax back its own
  rebate and report positive `profit[i]`. Gate `civic` on `comfort > 0.4 && taxMult <= 1.1`,
  and price `adaptTownTax` against actual consumed rations (`sat * need`), not hypothetical
  full-need rations, or partially supplied profitable towns never lower `taxMult` below `1`.

## stock-suppressed bids are only safe when the price drives its own transport

In `prototype/price-model-b`, a bid is suppressed to 0 when local stock exceeds a buffer target,
and that is safe because the price it feeds also drives the transport that drains the stock. When
porting the price model into a game whose resource transport is **separate and demand-driven**
(goods/coal move on their own diffusion/catchment tick), the same suppression is a trap: the
game's transport keeps delivering, stock stays above target, the bid stays pinned to 0, and the
price field never leaves 0 - so every derived price (goods, then labour, which reads the goods
price) is frozen and the economy is silently dead. Drive bids by marginal value plus a cash
(`cool`) term instead, and let the separate transport handle delivery. Test that every price
slot the HUD reads is non-zero after a few ticks.

## companion worker-gold fields, appeal scaling and dominated-town hold release

Three traps surfaced when giving cell-based workforce real carried money in `prototype/price-model-b2/`:

- **Never attach resident savings to idle commuting `labor` leaving a town.** Fresh `labor` fills a
  standing neighborhood buffer even when no firm pulls it; bleeding a per-tick share of
  `workerPurse` onto `laborFlow.gold` drains town savings into unpulled rings. Keep household
  savings in `workerPurse` until a town actually shrinks (`deltaPop < 0` attaches proportional
  savings to emigrating `depleted`), while firms pay wages directly into `depletedFlow.gold` at
  the work cell. Sweep subnormal (`stock <= 1e-12`) remainder gold into orphan remittance rather
  than zeroing it so machine-precision gold conservation holds.
- **Scale `priceHome` appeal to `START_PRICE` and divide by actual gold tax, never `taxMult` alone.**
  Dividing appeal by dimensionless `taxMult` while multiplying by `workerPurse` makes inflated
  high-gold-tax towns near a gold mine look more attractive than cheap towns; an unscaled `[0, 1]`
  appeal also produces per-cell slopes below `GRADIENT_KNEE` (`0.006`) that lose to `DEPLETED_SPREAD`.
  Injecting `START_PRICE · shelter · popRoom · (START_TAX_PER_POP / goldTax)` keeps slopes above
  the knee and trades off real gold tax against distance fade.
- **Buyer `holds` must release `depleted` on dominated towns (`hasHigherNeighbor`).** Giving every
  town a small `BASE_SHELTER` appeal lets lonely mining towns bring workers home, but a unconditional
  buyer hold on `ECONOMY_TOWN` would trap shed migrants on a struggling town's own cell. Hold
  `depleted` only at local `priceHome` maxima (`!hasHigherNeighbor(priceHome, i)`).

## occupancy-balanced worker pools, proportional shift settlement and town rent pressure

Three traps surfaced when adding fresh-worker and living wait pools in `prototype/price-model-b2/`:

- **A profit-proportional wage floor (`0.35 · drive`) blocks overflow wage cooling.** Keeping a
  non-zero labor floor on profitable firms keeps `priceLabor > 0` even when fresh workers fill the
  on-site pool, pulling idle commuters into surrounding cells. Size the on-site fresh-worker pool
  from a standby shift base plus smoothed realized shift throughput (`workLoad`), and emit hire
  demand strictly as `1 − occ` so overflow cools wages to `0` while active firms buffer commute lag.
- **Settling entry-billed wages into `depletedFlow.gold` alone starves later pool shifts.** When
  arriving `labor` is billed into `PAY_WAGE` on pool entry and settled after one tick's shift,
  crediting `depletedFlow.gold` whenever `depleted > 0` dumps the entire cohort's pay onto tick 1's
  tiny departing slice and leaves the remaining pool workers penniless on subsequent shifts. Split
  settled wages across `(labor, depleted)` by worker share so every shift departs at full wage.
- **Multiplying `townHomeBid` by linear `popRoom = 1 − pop / POP_MAX` inverts appeal at both ends.**
  At `pop = POP_MAX`, `popRoom = 0` zeroes home appeal and locks out a healthy town's own returning
  commuters, while shrinking unsupplied towns get a fake high-`popRoom` bonus. Route wait-pool
  crowding and near-`POP_MAX` fullness into `townRestTax` (`goldTax`) instead so full towns stay
  reachable to commuters while pricing surplus migrants toward cheaper, uncrowded towns.

## still workers, pareto home choice and hamlet founding in B2

Traps from moving the particle draft's worker rules into `prototype/price-model-b2/` (`workforce.js`, `settlement.js`):

- **Tiring still fresh labor drains towns.** Turning queued fresh labor into depleted makes it pay
  rest tax again; resident purses empty, the town raises `taxMult`, the goods bid collapses and a
  distant chain ate 1.75 instead of 9.3. Fresh labor waits for work; only depleted rests in place.
- **One home field cannot serve rich and poor.** Score each cell with w = wallet/(wallet+2·refFee)
  over a value field (rest per gold) and a quality field (rest only). Both stay linear, so one weight
  per cell or particle ranks every town. Gate town rest to the local best home, and scale shelter by
  housing (goal pop / pop), or shrinking towns keep catching migrants.
- **Settlement units and pacing.** Labor stock is not pop: convert settlers with the migrant rate
  (0.2/LABOR_PER_POP) capped at the tier pop cap, or founding pop reaches 34 and sheds workers into
  a cascade. Scan every 5 s, not every 1 s, so a new hamlet's home field spreads first; 1 s scans
  tiled the map with 8 hamlets. Count only depleted·still, and only where priceHome+priceRest is
  below a reach threshold.

## per-worker state on a cell field, write-time founding and land factors in B2

General cell-engine lessons carried over from the old particle-transfer drafts (still apply to
`prototype/price-model-b2/` `land.js`, `settlement.js`):

- **Carry per-worker state as a mass-weighted mean, not as mass.** Store `intent[i]` in `[0,1]`, move
  `intent·amount` on each edge and re-average by stock on arrival. Rest, founding and town intake then remove
  workers without touching intent; carrying `intent·amount` as mass would need a hook at every removal.
- **Let writers find the best site.** Ready workers splat their amount into a gather grid; a cell's count only
  grows within a tick, so the max of `count · site` seen at write time equals the max over final values. No
  per-candidate radius sum, no periodic scan; clear the grid only after a tick that had writes.
- **Stamp actor cones on placement, never per tick.** Wasteland and town claim change only when an actor is
  placed, removed or founded; a full refresh then costs O(actors · reach²) once.
- **Adding a land factor breaks rule tests silently.** Fixtures placed towns at (24,14), now desert, and three
  tax/appeal tests failed. Rule checks run on flattened land (`neutralLand`); land behaviour gets its own tests.
- **A still crowd thins fast.** Depleted dispersal spreads a 3×3 stranding to ~30% at its centre within the 3 s
  intent build-up, so the founding threshold reads against the settled-down count, not the stranded amount.

## gradient gates, saddles and queue admission

Traps from the particle-transfer lab that apply to any walker/labour field (cell B2 included):

- **A hard `GRADIENT_KNEE` gate strands commuters.** A wage field decays to a slope under the knee a few cells
  from the firm; with "move only above the knee" the town dock never released and the mine starved. The cell
  engine moved at `s / (s + knee)` instead. Gate docks at `0.1 · knee` (still > 0.9) and let speed scale.
- **The blended gradient cancels between two equal buyers.** A town midway between a mine and a factory launched
  walkers with heading ≈ 0 and they never left. Launch along the steepest edge; the smoothed heading then carries
  the walker off the saddle.
- **A queue must cool the bid, not the admission cap.** Counting queued walkers in `need` zeroed the bid, the
  zero bid set `cap = stock`, and an emptied pool admitted nobody: 65 walkers parked forever at a cell boundary.
  Call `firmBids(i, recipe, false)` for the cap decision.
- **Partial admission hides a queue.** Walkers admitted at a tiny normalized share each tick never "hover", so a
  queue counted only from hovering walkers stayed zero. Count the post-admission remainder too.

## persistent worker identity, wallet ownership and conservation counters

Carried over from the particle-transfer lab; these govern the persistent-worker model generally:

- Continuous labor/rest recipes must change a worker's fresh/tired portions, not clamp his physical amount to
  aggregate stocks. Clamping silently dissolves identities; flipping whole units against fractional stock targets
  can immediately flip them back. Store fixed `amount` plus `tired` and reconcile births only from unowned stock.
- A wallet's pool backing changing state is not income/expenditure. Never redistribute savings as a wage pool,
  bank a commuter during rest, or pay an employer's old wage debt to its current replacement workers.
- Accumulate walking recovery once per tick before updating global conservation counters: thousands of tiny
  per-worker additions to large totals can drift beyond the mass tolerance despite locally conservative moves.
- Tests of aggregate profit at a single timestamp or town growth can accidentally require confiscated commuter
  savings. Keep conservation strict; assert actual persistent lifecycles and real cash transactions independently.

## household harvest, build ladder and consumption litter in B2

- **Household harvest is not paid work.** Booking a resident's harvest as tiring labor queues it for
  paid rest at home: wait pools pass 4× occupancy, purses drain and the town starves. Spend the labor,
  keep its gold in the resident purse and emit no depleted.
- **Need pull fields carry no gold.** Wood/food pulls built from town need steer harvest home without a
  router or a payer; keep them separate from price fields so ledgers stay untouched.
- **Litter must heal faster than a busy town lays it.** Above ~0.05 litter per consumed unit with 0.05
  recovery, litter around towns climbs without bound; logistic healing (slower on spoiled land) at 0.08
  keeps it flat while fully spoiled land stays spoiled.
- **Edge flags need their own name.** Reusing a `dry` flag for shore/marsh edges gave every non-dry
  cell the edge bonus; test the build ladder order on the default map.

## particle transfer, multi-input pools and coarse forage fields

- **Empty multi-input firms hoarding integer workers starve upstream extractors.** With small discrete
  headcounts (`WORKER_UNIT = 1`), an unscaled standby pool at an empty factory locks 3–4 workers while
  coal mines lack miners to supply it. Scale multi-input firm labor pool targets by material readiness
  (`0.15 + 0.85 · matReady`) so empty factories hold ~1 standby worker until raw materials arrive.
- **Weak background sources in a coarse gradient must never pull down diffused halos.** Relaxing every
  `src > 0` cell toward `src` makes low-food meadow (`src = 0.08`) act as a sink on a nearby shoreline
  or Monastery garden halo while zero-source desert conducts `ambient` untouched. Update coarse forage
  cells with `target <= ambient ? ambient : max(ambient, relaxed)` so food sources only lift the field.


## worker splits and food refills

- A near-full-food requirement must be an eligibility gate after an age/cooldown, not a long continuous
  prosperity timer: bags normally fall below the near-full threshold before workers buy their next ration.
  Requiring 45 uninterrupted near-full seconds with refill at 75% silently disables reproduction.
- Worker pool compaction must copy lifecycle columns as well as motion/wallet columns. Reverse traversal
  lets splits append and deaths swap-remove without processing a survivor or newborn twice that tick.
