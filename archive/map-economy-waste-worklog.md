# Landfill waste and a readable population layer

plan: `plan-map-economy.md` metabolism/waste and V1 population layer
changed: `land.js` — waste on the source plus its walkable ring (`landDisturbAround`, `landDisturbRing`) and outward creep (`landSpread`); water holds none (feature)
changed: `map-population.js`, `map-economy.js` — household waste spread, waste-scaled capacity (`mapePopCapacity`, `mapePopIndustryCap`), industry cells hold no residents in Fluid field, spare/active waste rates raised (feature/fix)
changed: `map-industry.js`, `sites.js` — mine spoil ring beside the shaft, extraction waste spread around the cell (feature)
changed: `render-economy.js`, `render.js`, `render-markers.js`, `hud-economy.js` — population layer over a dim terrain base, no settlement rings/labels/key (fix)
changed: experiments `mape_population`, `mape_fluid`, `map_views`, `mape_spread` — ring, empty-waste cell, industry residents, population layer, gas/water parity
changed: `plan-map-economy.md`, `plan-prototype.md`, `AGENTS.md`, `findings-pitfalls-skills.md` — constants and rules
validation: L2 — node --check all edits; mape_population dense_d 0.291 ring_d 0.061 waste_checks pass ledger 4e-11; mape_spread 14/14 gas ratio 1.0000; map_views 69/69; mape_fluid, smoke, dom_smoke, mape_compare, mape_scenes, mape_fluid_migration, survey_spread 0 failures
decisions: waste stays `land.disturbed` — one field for landfill, productivity and restoration; the source keeps 55% so "place waste around it" is spatial, and spreading is slower than every source so patches grow instead of diluting; ring waste had to beat `LAND_RECOVERY` (~2e-4/s), hence raised factory rates and a ring-only mine halo that leaves the shaft's yield productivity alone; Residents keeps its crew on industry cells because zeroing it would unstaff every mine.
pitfall: a palette whose zero stop is near-black voids a sparse field — full note in findings.
next: 600 s playtest — is a dense town's landfill patch and capacity loss legible; tune `MAPE_SETTLE_DISTURB` and `LAND_WASTE_SPREAD` from that log.
