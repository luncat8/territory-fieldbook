plan: plan-map-economy — Farm, food transport, Transport speed map
changed: map-farm.js, map-diffusion.js, map-market-flow.js — double farm yield and quarter food stock haul speed in all field engines (feature).
changed: experiments/mape_farm.js — harvest, waste and food-specific transfer/cap/conservation gates for Diffusion/A/B.
changed: plan-map-economy.md, units-and-scales.md — shipped rates, A catchment exception, and corrected planned conductance normalization; fixed stale farm manual check.
validation: node --check touched JS; 17 experiment scripts passed including farm, compare, scenes, diffusion speed, smoke and dom_smoke; spread tick 1.535 ms.
decisions: slow physical stock rather than demand diffusion; A still draws consumption from its catchment, and the disabled Sites engine retains its separate shipment model.
review: planned weighted-gradient denominator would cancel a uniform slow conductance; use the unweighted gradient sum to actually slow stock.
next step: playtest food flow and town pull re-aiming at 1×, then implement the transport speed map under the single-pass mix budget.
