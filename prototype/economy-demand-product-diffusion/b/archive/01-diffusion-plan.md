# 01 · Standalone diffusion experiment

One resource, two bounded fields, a 48 × 28 grid and a fixed 1/60 s step. An initial fill is also the ambient demand to which an unforced field slowly returns. The same three sources and three consumers make resets comparable.

- `simulation.js`: Jacobi demand diffusion, a relaxing consumer peak, optional local stock suppression and closed boundaries. A source deposits up to 0.34 units/s when its cell has room. An optional catchment mode divides a consumer's need by `1 + 3 ×` the falloff-weighted mean stock in its four-cell ring, so coal parked outside the intake still cools demand; admission and service are unchanged.
- Transport: compute positive eight-neighbor slopes per unit distance. Low-pass their resultant direction over 0.18 s. Split a bounded outflow over currently uphill faces, normalizing speed by `slope / (slope + 0.0001)` so weak distant signals still move goods. Resolve competing requests together against pre-transfer headroom. Record the vector of accepted transfers, not the strongest proposal.
- Pressure at the floor: a uniform zero field cannot have an uphill demand gradient. Blend in conservative stock equalization below demand 0.001, only toward emptier, non-downhill neighbors. No signed field or ambient consumption is required.
- Intake: service existing stock before admitting arrivals. Per tick, consumption is `demand × min(stock × (1 − exp(−dt / 0.1)), 0.95 × dt)`. Admit at most the free room in `0.25 × 0.95 × demand` units of staging capacity. A full consumer refuses surplus; rejected quantities never leave their senders.
- `fields.js`: cell colors, linear-demand isolines, accepted-flow arrows, coordinate inspection and a sampled demand relief. `telemetry.js`: actual rates, ledger and bounded session histories. `app.js`: editing, controls, fixed-step clock and boot. `index.html` and `styles.css` provide the local entry point and layout.

## Comparison with the A experiment

The sibling `a/` prototype measures coal over a settlement's whole catchment and is the reference for stock feedback; this one keeps a visible arrival queue. `compare-report.md` holds the measured difference and which ideas moved in which direction.

## Manual checks

Pause and reset each fill: stock, flow and ledger should be zero and every demand sample identical. Clear consumers before resuming to compare pressure on/off. Inspect the same cell on both maps; add, erase and re-add actors while paused. Move one tick, then change speed: rates stay in units per simulated second. Verify the guide, small-screen controls and direct `file://` launch.
