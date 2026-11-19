# Map economy · settlement dynamics

plan: `plan-map-economy.md` Phase 2
changed: `map-population.js`, `map-economy.js` — measured household intake, satisfaction, waste, CO2, Diffusion growth/decline and workforce-biased migration
changed: `map-market-demand.js`, `map-diffusion.js`, `index.html` — record engine intake and run settlement metabolism in the shared tick
changed: `experiments/mape_population.js`, `experiments/mape_spread.js` — 120 s population gates; account for intake and reset synthetic population baselines
changed: `plan-map-economy.md`, `plan-prototype.md`, `AGENTS.md`, `README.md`, `findings-pitfalls-skills.md` — ownership, current phase, parameters and float32 accounting
validation: smoke and DOM smoke pass; map views 50/50, spread 13/13, compare pass, scenes pass, survey spread pass
validation: population Diffusion supplied 20→47.7, unsupplied 20→1.3; small/dense disturbance 0.087/0.328; goods residual <3e-12; 64×64 tick 1.20 ms
validation: Catchment and Queue household intake/CO2 accounting, population cap and conservation pass; node syntax and diff checks pass
decision: Diffusion is the demographic reference; A/B record intake and waste/emissions but hold growth/satisfaction-led migration while shared job staffing remains active
pitfall: account actual Float32 migration pair deltas in `popDelta`; full note in findings
next: playtest Catchment A on the survey and reference scenes, then proceed to Phase 3 factory and atmosphere integration.
