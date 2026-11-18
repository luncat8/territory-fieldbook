# Current game vs A vs B · stock feedback and goods flow

## In the game

**Recommendation:** use **A · Catchment** when comparing supply streams and as a
candidate for settlement demand. Keep **Diffusion** as the default reference
until catchment use and market reserves are playtested together. Use **B · Queue**
when the question is specifically whether a settlement can take deliveries fast
enough. Rendering is separate: use the same heatmaps for all three, and add
arrows only if they make an actual transfer easier to read.

| Engine | How stock changes demand | What happens to goods |
|---|---|---|
| **Diffusion** | Every stocked land cell pushes down its signed demand. This can create negative surplus that spreads and pushes goods away even before a town receives anything. | Goods travel uphill and remain in the market or on the map. No automatic household intake in this baseline. |
| **A · Catchment** | A settlement reads all coal or goods within four walkable steps. More accessible stock keeps reducing its pull; using up the stock restores it. | Fast uphill transfers with no intake cap. A settlement can use stock from the whole catchment. |
| **B · Queue** | Stock next door does nothing until it gets into the settlement. Filling the local queue lowers pull by at most 50%; extra stock cannot lower it further. | The settlement serves existing stock before admitting new deliveries. Rejected cargo backs up outside. |

In **Economy** under the clock, pause and switch engines while viewing **Demand**
or **Supply → coal**. The selector preserves the map, clock, party, mines and
stock; only coal/goods demand is rebuilt. Hover a settlement in A or B to see
its import pull as a fraction of hungry pull. The **Stock lowers demand** toggle
isolates the feedback from intake rules. **Sites** remains disabled: the planned
distance-priced shipment engine is unrelated to B's local queue.

### Same-map stock pulse

Run `node experiments/mape_compare.js` from the repository root. One settlement
of 20 residents starts hungry on a flat map at the game's 0.2 s step. Four
adjacent cells receive two units of coal each. All rows use the same layout.
These values are game-scale signals, not the labs' 0–1 demand fields.

| Engine | Demand: hungry → 2 s → 10 s | Demand at 2 s, feedback off | Drop in donor stock, first tick | Coal used by 10 s |
|---|---:|---:|---:|---:|
| Diffusion | 0.144 → −0.017 → −0.053 | 0.152 | 0.851 | 0 |
| A · Catchment | 0.093 → 0.026 → 0.017 | 0.093 | 2.175 | 1.000 |
| B · Queue | 0.093 → 0.054 → 0.047 | 0.093 | 0.025 | 0.980 |

A's target drops to **17%** immediately when the stock is still outside town; B
stays at **100%** until arrival and bottoms out at **50%** once full. A uses coal
on the first tick, B on the next, and their 10 s usage is almost the same. The big
visual difference is where stock waits, not the eventual service rate. The
negative value in Diffusion means surplus, not a negative amount of coal.
The same seeded, unlocked-mine map took about **0.70 / 0.54 / 0.51 ms** per map
step for Diffusion / A / B in one Node run (no rendering, not an FPS benchmark).

The lab renderers also differ: A paints simple raster fields each animation
frame. B caps map paints at 30 Hz and draws demand contours and optional flow
arrows; it also paints telemetry and a relief view. Its model step being cheap
does not imply the same visible responsiveness. The game uses the shared
raster view, not B's animation or display cap.

## Standalone labs

Two standalone prototypes of the same question: how should surrounding coal lower a settlement's demand, and how fast should goods move uphill to a settlement that still has an intake queue?

The lab models have different scales and defaults:

| | **A** — global catchment field | **B** — queue-first service |
|---|---|---|
| Entry | `a/index.html`, one file, inline script | `b/index.html`, `simulation.js` + `fields.js` + `telemetry.js` + `app.js` |
| Grid, step | 120 × 120, 0.05 s | 48 × 28, 1/60 s |
| A settlement reads | **all** coal in a radius-4 catchment, unbounded | coal in its own cell, then only what fits a 0.25 s queue |
| Consumption | proportional removal from the whole catchment | service from the cell queue, capped at `0.95 × demand` per second |
| Stock → demand | `1 / (1 + stock / 18)`, relaxed over 0.5 s | queue occupancy cools need by at most half; optional catchment mode divides by `1 + 3 ×` weighted mean in the ring |
| Transport | donor-cell uphill transfer on a 3×3 filtered field, all faces split by slope | 8-neighbour faces, 0.18 s smoothed steering, headroom-resolved requests |
| Test suite | `node test.cjs`, inline script in a `vm` | `node --test simulation.test.js`, 17 tests |

### Measured difference

Settlement demand over the first 60 s, resource pressure on, default generated layout:

| | A | B |
|---|---|---|
| Demand range | **0.361 – 0.742** | **0.896 – 0.937** (queue-only), **0.873 – 0.920** (catchment mode) |
| Coal per cell | unbounded, colour saturates at 10 | capped at 1 by the queue |

B barely moves in normal operation because it looks at one cell. Coal parked one step outside a settlement is invisible to its demand signal, and the intake queue never holds more than `0.95 × 0.25 ≈ 0.24` units, so its pressure term saturates long before demand falls. A reads the whole catchment, so surplus coal keeps pushing the signal down — and A's stock has no cap: the queue in B refuses surplus, while A keeps it all in the field.

The same controlled layout (one settlement, four adjacent mines, feedback on, zero ambient sink) separates them further:

| Settlement demand at 0 / 10 / 20 / 30 / 40 / 50 s | A | B, queue-only | B, catchment |
|---|---|---|---|
| | 0.535 → 0.389 → 0.302 → 0.235 → 0.183 → 0.142 | 0.500 → 0.667 → 0.667 → 0.667 → 0.667 → 0.667 | 0.500 → 0.570 → 0.532 → 0.485 → 0.449 → 0.403 |

A keeps falling because its catchment stock reaches 155 units and never empties. Queue-only B plateaus the moment the queue stops filling; catchment B keeps falling because its ring keeps holding stock. That plateau is the design difference, not a tuning error.

### Shared lab options

**A ← B.** Map editing: A had no way to place or remove actors because the layout was generated. It now has Inspect / Mine / Settlement / Erase tools on both maps; placed sites join the same actor lists as a generated layout, and reset restores the generated ones. Its field guide now says that catchment coal lowers demand.

**B ← A.** Catchment feedback as an **optional mode**, off by default, next to the shipped queue model: a consumer's need is divided by `1 + 3 ×` the falloff-weighted mean stock within four cells. The same four-adjacent-mines layout gives 0.403 after 50 s in catchment mode against a 0.667 plateau queue-only, and demand climbs back once the sources are removed. Three tests cover it: near stock cools, the weighting falls with distance, and removal recovers.

### Separate model rules

- **No ambient demand baseline in B.** A's `AMBIENT` recovery to 0.3 is a second feedback loop that lets mines move coal with zero demand. Copying it would change every B test and erase the zero-floor spreading behaviour that B already covers with `pressure`.
- **No queue in A.** B's intake queue gives a visible arrival and service delay; A's proportional catchment removal is what makes its ledger exact and its signal smooth. Both are experiments with different gameplay.
- **No flow arrows or contours in A**, and no catchment field in B's stock map: A is a field-first sandbox, B is a service-first sandbox.

### Comparison caveats

- A regenerates its 12 sites with an LCG and needs the same seed to compare runs; it has Reproducible replay buttons instead of B's fixed reference layout.
- B's catchment mode is a response coefficient on a mean, not a reservoir: it cannot show the arrival delay that the queue exists for.

### Next lab comparison

Run the same controlled layout (one settlement, four mines, pressure on) with fixed demand first, then with each feedback model, and diff consumption curves. Today B's catchment mode sits *on top of* its queue term; the open question is whether it should replace it, and whether a settlement's demand should ever be able to fall as far as A's 0.142 while its queue is still full.
