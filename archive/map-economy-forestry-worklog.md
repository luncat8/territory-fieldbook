# Map-economy · demand-led forestry
plan: `plan-map-economy.md` 4.1b — staffed forestry commodity chain
changed: `map-economy.js`, `map-industry.js` — logs resource, typed factory kinds, demand-gated random cuts, on-cell stock and recipes
changed: `map-diffusion.js` — converter log demand enters shared field/routing
changed: `map-scenes.js`, `hud-scenes.js` — forestry placement tools/instructions
changed: `hud-economy.js`, `render-markers.js` — typed job-site rates, sawmill key, kind colors
changed: `experiments/mape_forestry.js` — demand gates, forest depletion, routing, recipes, ledger and tool coverage
changed: `experiments/map_views.js`, `experiments/dom_smoke.js`, `experiments/smoke.js` — resource indices and UI expectations
changed: `README.md`, `AGENTS.md`, `plan-map-economy.md` — chain design and run guidance
validation: forestry, scenes, population, views (79), DOM, smoke, spread, fluid, compare, forest, migration and survey pass; forestry ledger <1e-12
decision: nearby positive log pull and stock feedback set harvest; each cut creates logs at its forest cell for ordinary gradient routing; all sites share staffed factory slots
pitfalls: new resource shifts CO2/workforce display ids; update view selectors and scene tool count in UI smoke gates
next: manually place three forestry sites in scene A/B at 4×; tune demand floor/rates from observed stock and forest recovery
