# CO2 dynamics, flow overlay and kernel cleanup worklog (plan-map-economy)

plan: plan-map-economy — CO2 dynamics (physical sources, demand signals, visible flows) + null-conductance cleanup + suite repairs
changed: map-diffusion.js — MAPE_CO2_DIFFUSE 0.5625 → 0.9 (mix 0.045/tick); mapeEmitWasteCo2 dumps land.disturbed × MAPE_WASTE_CO2 into goods+massIn; waste and live-charcoal terms in mapeInjectDemand; CO2 diffuse passes record pairwise fluxes
changed: map-economy.js — MAPE_WASTE_CO2 = 0.05; MAPE_FACTORY_CO2 0.5 → 1.5 (stock add paired with massIn, ledger-safe); map-kernels.js — mapeCo2Pass optionally records accepted fluxes; map-sites.js runs the same dump + flow args
changed: render-economy.js, hud-economy.js — renderHasFlowItem(CO2): amount-view flux trails + inspector net flow; RENDER_CO2_MAX = 2 with sqrt norm; item-aware legend
changed: map-kernels/map-diffusion/map-fluid + experiments mape_transport, mape_diffusion_speed, mape_fluid, mape_fluid_migration, mape_farm — conductance required everywhere (null branches dropped; tests pass an all-1 table)
changed: experiments/mape_co2.js (new) — waste unit emit + demand delta, 600 s sources/band/demand/flow/ledger, 60 s point-plume reach; experiments/mape_spread.js — coal chain pins its two blank-map towns (Residents migration bleeds isolated towns into empty land before delivery closes; popDelta tracked), factory release <2, residuals logged
changed: experiments/map_views.js — atmosphere check now asserts CO2 flux arrows; units-and-scales.md, plan-map-economy.md, README.md, AGENTS.md docs updated
validation: node --check all touched files; full suite 18/18 exit 0 (smoke, dom_smoke, map_views 82 checks, mape_co2 8/8); ledger residual −6.5e-8
evidence: 600 s survey band 0.31–0.78 over 0.4 ambient; sources pop 580 / factory 103 / waste 354, forest fix 688/325; flow_max 0.0113 (soft band); plume 65 units beyond r=8 in 60 s; charcoal kilns untouched (mass-locked 0.8/0.2)
decisions: physical roles only — fabs/people/waste emit, forest absorbs; no population breathing, no CO2 vent/decay; fish deferred ("fish will be next"); display scale 2/cell so plumes read on the amount map
pitfalls: mape_farm verifyFoodTransport needed the cond argument; blankMap towns die to migration/walking, not famine — pin demographics in logistics tests; forest identity probes count sawmill felling as CO2 release
next: playtest supply-driven plumes (coal-fed towns should brighten), then a waste-drawdown demo scene
