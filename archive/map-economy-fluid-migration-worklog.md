# Fluid workforce migration and landscape capacity

plan: `plan-map-economy.md` workforce models and population dynamics
changed: `map-fluid.js`, `map-economy.js` — landscape free-space rest pull and smoothed net boundary-crossing population feedback
changed: `map-population.js` — fluid migration replaces edge migration; fluid growth respects settlement capacity without abrupt eviction
changed: `map-scenes.js`, `hud-economy.js`, `hud-scenes.js` — fluid scenes start with room; inspection shows capacity and migration signal
changed: `experiments/mape_fluid_migration.js`, `experiments/mape_fluid.js`, `experiments/mape_population.js` — landscape, migration, engine and ledger regressions
changed: `plan-map-economy.md`, `AGENTS.md` — standing design and experiment index
validation: migration checks pass for all engines; shore/meadow/swamp capacity 120/72/18; fluid pool residual 0.016, population ledger zero; population, scenes, map views, DOM and smoke pass
review: local rest recycling is not arrival; count actual movement across settlement boundaries. Previous rest pull used fraction free and productivity only, so equal occupancy gave equal demand regardless of landscape; workforce rest was disconnected from population
decision: 10 s exponential average and 10% conversion are balance parameters, not exact population/workforce conservation; existing over-cap settlements lose room but are not instantly erased
next: manually tune migration and hamlet cadence; 300 s survey run grew fresh/depleted pools to 12,590/2,239, so workforce generation and recycling still need balance
