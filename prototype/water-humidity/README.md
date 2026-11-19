# Water / humidity visual lab

A standalone, `file://`-friendly prototype of a coupled water, grouping-demand and humidity cycle.
Open `index.html` directly in a browser: it loads only local scripts and CSS, with no build step or network.
It does not modify the main game.

```sh
node --test                                # model + headless page tests (19 checks)
node preview.cjs coast 160 --out /tmp/water # render all field PNGs and print the ledger
node preview.cjs valleys 160 7 --flag rainMode=off --set springRate=1
```

`preview.cjs <scenario> <seconds> [seed] [--out DIR] [--scale N] [--set name=value ...] [--flag name=value ...]`.
The `--set` keys are `WATER_PARAMS` names (`flowK`, `fillMix`, `groupEmit`, `rainRate`, `springRate`, …);
`--flag` sets model switches (`rainMode=local|uniform|off`, `grouping=false`, `wind=false`).
Use `--out` inside this folder to keep snapshots alongside the lab.

## The three fields and why they exist

| Field | Meaning | Update |
| --- | --- | --- |
| `water` | depth on each cell; `sea` cells are fixed at `SEA_DEPTH` | conservative flux, springs, rain, evaporation, soil sink |
| `group` | "water grouping demand": a fading, diffusing memory of *where fast, deep water has been* | emitted from `speed² × depth²`, diffused, decayed, clamped to 0…1, forced to 0 on sea |
| `humidity` | atmospheric moisture | diffused, advected by wind, fed by evaporation and sea, depleted by condensation and slow decay |

The intended loop:

```
springs → downhill flow → fast/deep channels emit grouping demand
       → demand diffuses (halo) and fades (memory)
       → rain condenses only where demand is high, never over the sea
       → rain feeds the channel → feedback concentrates water instead of a thin film
humidity ← evaporation (suppressed where demand is high)
         → wind carries the plume downwind → rain gate uses demand, not humidity alone
```

### Design decisions

1. **Grouping demand is a *speed AND depth* gate, not a water mask.** A quadratic gate
   `g = (speed/(speed+ref))² × (depth/(depth+ref))²` means a still lake and a thin moving
   film both emit almost nothing; only a fast, deep channel does. This is the user's
   "big when water moves in big speed and big amount" rule. `updateGroup()` enforces it directly
   (see `simulation.test.js`: still = 0, thin film < 0.15, stream > 0.2, sea = 0).
2. **Water does *not* flow down the grouping gradient by subtraction.** Making the potential
   `filled − G` turns wet channels into potential wells and stalls their noses. Instead
   `propose()` computes two independent non-negative fluxes: downhill flow along
   `filled + surfacePull·water`, plus an up-`G` flux. Donor-based caps guarantee neither
   flux can drain more than half a cell per step, so transport conserves mass exactly.
3. **Depression filling uses a priority flood.** `min(max(e_i, filled_neighbour))` gives every
   land cell a monotonically non-increasing path to the sea. The intuitive
   `max(e_i, min(neighbour))` is wrong: it leaves whole flat pits unfilled. Tested by
   walking downhill from the sea over all scenarios.
4. **Two sinks keep land from becoming a slow-moving sheet.** Grouping suppresses
   evaporation above rivers (so rain recycles into the channel), while a protected soil
   sink removes shallow, stagnant film. The sink is reduced by `max(group, speed gate)` so
   advancing river noses survive but terrace streaks vanish. Without this, either the
   whole map floods or rivers never advance.
5. **Rain never falls on the sea.** The sea is an infinite humidity *source* (fixed depth,
   `seaEvap`), but its `group` is forced to zero and `condense()` skips sea cells. The rain
   gate `((g − 0.25) / 0.75)²` also requires a real channel halo. Sea evaporation therefore
   moves humidity downwind without producing the "constant rain above sea" failure mode.
6. **Humidity is a real transport field, not a decorator.** It diffuses, advects downwind,
   decays, and every source/sink is booked in an exact mass ledger. Wind export off the east
   edge is recorded as `humidityLost`; sea discharge as `seaDrain`; soil sink as `groundDrain`.
   `waterMetrics().ledgerResidual` stays below `1e-6` across all scenarios and timesteps.
7. **Spawn/despawn coupling.** Land evaporation → humidity is reduced by `evapHold·group`;
   humidity → water (rain) is gated by group. So humidity tends to *despawn as water* over
   grouped channels and *spawn from water* over ungrouped wet ground. That inverse
   relationship is the requested `f(water, 1/grouping demand)` behaviour, with the
   additional sea-source term needed for a closed cycle.

### Visual checks

`composite` shows terrain relief + grouped rivers + rain highlights + flow vectors. `water`,
`group`, `humidity`, `rain` and `flow` isolate each field; `humidity` is drawn as deviation
from its mean so the wind plume and the dark "rain shadow" over channels are visible. The
six mini-maps are the same field rendered at different scales, and the two sparklines track
land water and rain over time. Click a cell to inspect its elevation, depth, group, humidity,
rain and speed. `preview/` holds checked-in 160 s snapshots for `coast` and `valleys` so the
headless renderer's output can be compared without running Node.

Not every river reaches the sea: on `basin`, `flat` and some `valleys`/`islands` seeds the
channels evaporate or infiltrate first, so `seaDrain` is zero without any flooding. That is
a legitimate closed catchment, not a stalled sheet — `wetFraction` stays low and the ledger
still closes. Springs start on high ground, so the short upper channels on `coast` are
west-flowing rivers that dry out before the coast; the lower branched river discharges.

### A/B switches in the page

| Switch | Expected effect |
| --- | --- |
| `grouping` off | `groupMax = 0`, local rain = 0, land water ≈ 50 vs ≈ 140 |
| `rainMode = uniform` | floods ~100% of land (the failure mode we avoid) |
| `rainMode = off` | springs only; channels persist but no rain feedback |
| `springRate = 0` | no water at all — grouping needs a seed |
| `fillMix = 0` | raw terrain instead of priority-flood drainage; island basins trap water |
| `wind` off | weaker plume transport, slightly less rain |
| `seaEvap = 0` | humidity comes only from land evaporation |

Default reference at 160 s, coast, seed 20261119: `landWater ≈ 156.2`, `wet ≈ 15.8%`,
`riverShare ≈ 0.92`, `groupedRainShare ≈ 0.99`, `rainOnSea = 0`, `ledgerResidual ≈ 0`.

### Files

| File | Owns |
| --- | --- |
| `terrain.js` | seeded scenarios, priority-flood drainage surface, spring placement |
| `simulation.js` | fields, transport, grouping, evaporation/rain, ledger, metrics |
| `palette.js` | colour LUTs and `waterPaint()` |
| `fields.js` | canvas plot + vector overlay + sparkline |
| `app.js` | boot, warm-up, controls, readouts, A/B switches |
| `index.html` / `styles.css` | standalone layout (also contains the same rationale as `<details>`) |
| `preview.cjs` | headless PNG renderer (no dependencies, own CRC/zlib writer) |
| `simulation.test.js` | 16 model invariants |
| `ui.test.cjs` | 3 stub-DOM page boot/control tests |
