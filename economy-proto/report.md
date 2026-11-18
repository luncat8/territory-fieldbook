Updated `economy-proto/index.html` with the following improvements:

- **Mass-conserving gradient advection & filtered gradient**:
  - Replaced the non-conservative semi-Lagrangian backtrace with forward bilinear mass-conserving advection (`stepResources`), so resources no longer appear/disappear due to flow divergence.
  - Replaced central differences with a 3×3 Sobel-filtered gradient (`stepDemand`) to reduce grid-axis artifacts.
  - Scaled flow speed by gradient magnitude (`mag / (mag + GRAD_HALF)`) with a deadzone (`GRAD_DEAD`), preventing flat-region noise from triggering full-speed movement.
- **Demand-proportional consumption**:
  - Consumers now sink resources at a rate proportional to `c.need * demand[i]`, so fed settlements don't act as black holes and excess resources can flow past to hungrier ones.
- **Demand range `0..1` & resource sink**:
  - Clamped `demand` strictly to `[0, 1]` and rendered it directly on a `0..1` scale (dark red → orange → yellow). When **resources sink demand** is checked, stored resources decrement `demand` (clamped at `0`), creating outward gradients from sources when ambient demand is > 0 (e.g., `0.5` fill).
- **Fixed marker overlay & added inspection controls**:
  - Fixed `drawMarkers` coordinates so source (green) and consumer (red) markers align with the `120×120` grid.
  - Added **Pause/Play**, **Step**, and a hovered-cell inspector in the HUD (`cell`, `r`, `d`, `|∇d|`).