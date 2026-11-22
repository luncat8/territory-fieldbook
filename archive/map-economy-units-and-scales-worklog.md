plan-map-economy (Diffusion speed and stability + new units-and-scales.md)

changed: map-diffusion.js — removed mapeDiffusePasses and MAPE_MAX_STEP; one Jacobi pass per canonical tick, mapeStepDiffusion advances whole SIM_STEP_SEC ticks, warm loops at SIM_STEP_SEC, MAPE_MIX_MAX 0.15.
changed: map-market-demand.js — pull D 24→3 and 16→2 with decays 0.8→0.1 (reach 5.5/4.5 cells kept), pressure recover 0.12→0.015, market slice = one jacobi + pin + land blit; map-fluid.js one depleted pass + post-blend flow marks; map-sites.js MAPE_SITE_STEP → SIM_STEP_SEC.
changed: units-and-scales.md (new rules doc), plan-map-economy.md pass-rule passages (constants, stability section, A/B pull, speed-map stability, perf note), findings diffusion entry, AGENTS file map.
changed: experiments/mape_diffusion_speed.js rewritten (budget audit, max-rate single pass, legal-range variance/reach, water wall, market bounded); mape_spread measurement dt = 4×tick with kernel at tick and per-tick budget; mape_scenes reroute window 1→2 s.
validation: full suite 18/18 green — smoke 17/17, dom_smoke 25/25, mape_spread 15/15, scenes/compare/population/fluid/forestry/sites/hydrology pass; audit maxMix=0.15/0.15 reachA=5.48 reachB=4.47; tick budget 1.54 ms < 2.0.
decisions: stability from units, not passes — every shipped D·dt ≤ 0.15 at tick 0.05, no runtime clamp (the audit fails loudly instead); reach preserved by scaling decay with D, which slows pull transients ~8×, so reroute gates over 2 s and halo formation reads as seconds, not ticks.
decisions: no per-cell goods cap — transport is fraction-of-stock and amount-independent; fluid flow marks read the blended wavefront (the direction the old second pass used to record); pressure-mode recover scaled with the decays to keep its ~14 cell reach.
pitfalls: experiment `advance()` takes seconds, not ticks; full note in findings ("explicit diffusion breaks silently").
next step: transport speed map (plan §Transport speed map) implements under the D·max(c)·dt budget; revisit MAPE_MARKET_WARM_SEC only if a boot-time halo gate tightens.
