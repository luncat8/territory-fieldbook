# units and scales

Rules for time, fields, rates and steps. Stability comes from the units: every update is a
bounded fraction of what it applies to, so 0.1 items and 1000 items behave identically and one
fixed rule per tick is always safe. Multipass splitting and simulation substeps are not
stability mechanisms and must not be reintroduced — a coefficient that needs them is scaled
wrong (see the audit in experiments/mape_diffusion_speed.js).

## time

- One sim tick = SIM_STEP_SEC = 0.05 s (main.js). Engines take a duration in seconds and advance
  whole canonical ticks; a final partial tick is never longer than the tick.
- Game speed multiplies tick count (CLOCK_RATES 0/1/2/4x), never dt.
- Every rate in the code is per sim-second: the per-tick amount is rate x dt with dt <= 0.05 s.

## fields

| field | unit | range |
| --- | --- | --- |
| goods (coal, iron, logs, goods, food) | items per cell | >= 0, bounded by the transfer budget |
| population | people per cell | 0..MAPE_POP_CAP (600) |
| market pull (A/B demand) | signal | 0..1 |
| signed demand, workforce pull, rest pull | gradient signal | sign + relative height only |
| CO2 | ppm | 0..100 |
| moisture, biomass, soil | fraction | 0..1 |

Signals never carry goods. Hauling reads them as a normalized gradient (each direction's share
is g / (gSum + ref)), so their magnitude scale is free; the market pull stays 0..1 because it is
also displayed and asserted.

## transport — a fraction of the sender's own stock

- A move takes a fraction of what the source cell holds: budget = stock x speed x dt, capped by
  MAPE_STEP_FRAC_MAX = 0.75 and by the stock that is actually there. A cell can never send more
  than it has, so the rule is identical for 0.1 or 1000 items, never goes negative, and needs no
  amount cap for stability.
- Shipped speeds (cells/s): haul 1.8, market flow 6.5, queue flow 7, workforce walk 1.8, sites
  transit 2.0 — all <= 10 cells/s, i.e. at most 0.35 of a cell crossed per tick.

## diffusion — one Jacobi pass per tick

- The update, exactly once per field per tick:

		next = cur + mix * (sum of 4 neighbours - 4 * cur),   mix = D * dt

- Explicit four-neighbour mixing is stable while mix <= 0.25 (convex weights). The design budget
  is MAPE_MIX_MAX = 0.15, and it holds by construction: dt <= 0.05 s and every shipped
  D <= 3 cells^2/s give mix <= 0.15. There is no runtime clamp and no pass count — a rate above
  the budget fails the audit instead of silently splitting into passes.
- Fades are keep = exp(-k * dt) in (0, 1) for any k >= 0: multiplicative, scale-free.
- Reach = sqrt(D / k) is an outcome of the two, never a cutoff. When D changes by a factor a,
  change k by the same factor and the reach is unchanged; only the transient slows.
- Legal coefficient range at the canonical tick: D in (0, 3] cells^2/s. Faster diffusion needs a
  smaller tick — never more passes.

### shipped rates at the canonical tick

| constant | D cells^2/s | mix | reach sqrt(D/k) |
| --- | --- | --- | --- |
| MAPE_DIFFUSE — signed demand, workforce pull | 1.8 | 0.09 | ~15 cells (k = MAPE_DECAY 0.008) |
| MAPE_CO2_DIFFUSE — CO2 stock | 0.5625 | 0.028 | pairwise, no fade |
| MAPE_CATCHMENT_DIFFUSE — A pull | 3 | 0.15 | ~5.5 cells (k = MAPE_CATCHMENT_DECAY 0.1) |
| MAPE_QUEUE_DIFFUSE — B pull | 2 | 0.10 | ~4.5 cells (k = MAPE_QUEUE_DECAY 0.1) |
| MAPE_WF_DIFFUSE — fluid depleted pool | 0.875 | 0.044 | pools, no fade |

Workforce/rest pulls reuse MAPE_DIFFUSE with their own fades (MAPE_WORK_DECAY 0.1 -> ~4 cells,
MAPE_WF_REST_DECAY 0.02 -> ~9 cells).

## gpu / cache target

- Flat Float32Arrays, structure of arrays: field[resolution * n + cell]. Neighbours come from
  precomputed link tables per land cell (mapeMarketFlow.links); terrain is a byte mask read once
  per cell.
- One pass per field per tick: read src, write dst, then swap. The JS code blits the slice back
  so buffer identities stay stable (demandView subarrays point into mape.demand); a GPU
  implementation swaps pointers instead.
- No data-dependent iteration counts, no per-field pass branching: the loop trip count is the
  grid size for every field, so a kernel is one dispatch per field.
- Exactly two update shapes exist: convex mix (diffusion) and fraction-of-stock transfer
  (advection). Both are local per-cell operations with fixed coefficients.

## capacity numbers

- MAPE_POP_CAP = 600 people per cell. MAPE_STORAGE_CAP = 96 storage sites — a site count, not a
  per-cell goods cap: goods per cell stay uncapped and safe because transport is fraction-based.
- Catchment stencil reaches 4 walkable cells (MAPE_CATCHMENT_STEPS); the ~5.5 cell pull reach
  sits just beyond it, so a town's halo reads as one soft field, not a ring.
