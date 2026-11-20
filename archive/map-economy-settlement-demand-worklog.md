# Settlement demand halos, household uptake and factory yards

plan: `plan-map-economy.md` Catchment A and Queue B, factory runtime
changed: `map-market-demand.js` — catchment/queue halo decay, population-scaled hungry target, fixed household need, factory pull yard (feature)
changed: `map-industry.js` — documented `MAPE_FACTORY_IDLE_SEC` starvation rule (feature)
changed: `render-economy.js` — Fieldbook need ramp: midtones over 0.08–0.60 and a warmer low end (fix)
changed: `experiments/mape_fluid.js`, `experiments/map_views.js`, `experiments/mape_population.js` — factory burn rate, palette endpoint, market pull floors
changed: `plan-map-economy.md`, `findings-pitfalls-skills.md` — constants, halo reach and the uptake rule
validation: smoke, dom_smoke, map_views (79), mape_compare, mape_population, mape_scenes, mape_fluid (0), mape_fluid_migration, mape_spread, survey_spread, mape_forest, mape_forestry pass; ledger residual ≤2e-8
validation: town/background coal contrast on the seeded survey 1.02→3.57 (A) and 1.71→6.02 (B); with mines open the map consumes 4058 coal/400 s instead of hoarding 2715
review: the halo was 0.025/s, i.e. ~10 cells, while seeded towns sit 2–5 cells apart, so the halos tiled the map and every town read the same pull whatever its population
decision: a town advertises pop/(pop+8), so a crowded town outranks a hamlet; the halo is held to ~4 cells by 0.8/s drift
decision: household need is a fixed rate × dt from the catchment. Scaling it by the demand signal made stock cool the pull and then stop its own uptake, so towns hoarded coal, nothing else was hauled and the field decayed to near zero
decision: a plant advertises a graded coal pull over a 4-cell half-width. A single pinned cell lost its coal to a pop-60 town halo 4 cells away in scene A
pitfall: a factory test that asserts the planted tank empties now measures the burn rate; a working plant is resupplied from the map
next: household rate is ~4% of the supply the unlocked mines can make, so towns empty whatever is hauled; decide the intended balance (fewer mines, dearer coal, or slower consumption) before tuning the field further
