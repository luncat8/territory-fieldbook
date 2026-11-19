# Humidity/CO2 forest cycle and waste maps

plan: `plan-map-economy.md` 3.1, `plan-prototype.md` biosphere
review: previous waste change correctly shares `land.disturbed`; reuse that field for the amount layer rather than introducing a second waste stock.
changed: `world.js`, `map-scenes.js` — fixed humidity field, no generated forest terrain, neutral scene humidity (feature)
changed: `economy.js`, `main.js`, `map-diffusion.js` — signed cover relaxation, stock-limited carbon exchange/ledgers and one shared substep owner across all engines/scenes (feature)
changed: `map-economy.js`, `render-economy.js`, `render.js`, `hud*.js` — waste/forest/humidity selectors, linear percent legends, terrain cover shading, signed growth inspector and scene amount controls (feature)
changed: `sites.js`, `investigate.js` — timber placement and visibility use forest cover instead of terrain tag (fix)
changed: `experiments/mape_forest.js`, existing simulation/UI fixtures — carbon, humidity niche, establishment/dieback, all-engine and updated display/transport isolation gates (test)
validation: L2 — syntax/diff checks; smoke, dom_smoke, map_views (75), mape_compare, mape_scenes, mape_population, mape_fluid, mape_fluid_migration, mape_spread, survey_spread, mape_forest pass. Bare hills cover 0.472 at 10 sim s; carbon error <1e-6; live tick 1.732 ms.
decisions: cover approaches a humidity/CO2 target at 0.08/s for visible dynamics, carbon cost 0.7/cover; death returns carbon, preventing permanent atmospheric loss; zero cover can establish without neighbour seeds. Waste reduces target cover.
pitfalls: transport-only fixtures must set unsuitable humidity, not merely clear biomass: bare cells can now regrow. Scene total stock includes carbon released by initial trees; coal routing assertions must measure coal only.
manual: checklist in design; browser visual pass not performed in sandbox.
next: playtest humidity niche width and 10–30 sim-second response against a staffed factory, then tune carbon storage and response without changing timestep.
