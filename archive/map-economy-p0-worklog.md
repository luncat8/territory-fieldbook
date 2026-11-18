# map-economy P0 worklog

plan: plan-map-economy.md — 4.1a review, 1 s = 1 day clock, diffusion-first order, Phase 0
changed: plan-map-economy.md, plan-prototype.md, AGENTS.md — 1s=1d units (20s build), diffusion-first P0–P3 then sites P4, added goods advection + settlement waste/coal→CO2, deferred O2 throttle (design); prior land.js comment trimmed
changed: main.js, events.js, land.js, economy.js, sites.js, investigate.js, party.js, territory.js, rivals.js — unified 0.2s tick (5/10/20 Hz = 1/2/4 d/s), removed towns and town stocks/prices (feature)
changed: map-economy.js — fields, pools, ~2% settlements (pop 8–20), settlement markets/hiring, locked coal/iron mines, static P0 preview gradients, ledger (feature)
changed: render.js, input.js, hud.js, actions.js, index.html — 9 views, item and engine radiogroups, batched settlement/mine/storage/factory markers, hover cell inspector (feature)
changed: experiments/smoke.js, experiments/dom_smoke.js, experiments/survey_spread.js — updated for seconds, settlements, 9 views, 4 items, inspector, deposit unlock (test)
validation: node --check all pass; smoke 17/17 (82 settlements = 2.00%, 6 mines 0→1 unlocked, mape_residual 0.000000); dom_smoke 25/25 (9 distinct views, 4 distinct items, clock 1s=1d); survey_spread 7/7 unchanged; 20-seed check 0 defects; step 0.064 ms, render 0.041 ms (-2.2% CPU/s vs baseline)
decisions: unified all modules on sim-seconds (1s = 1 day on 1×, 0.2s tick, rates ×0.1) so zero hour/minute leftovers exist while preserving exact real-time prototype pacing and 10–30s factory builds.
decisions: diffusion runs first through P0–P3 before sites in P4 — one 4-neighbour cell pass handles coal/iron/goods, CO2-to-forest, migration and water routing without shipment queues or pathfinding, while building all shared arrays, pools, markets, views, ledger and scenario tests for sites.
decisions: plan review added missing up-gradient physical goods flow (otherwise gated factories starve away from mines), settlement goods→waste and coal→CO2, spacing guard against duplicate builds during 20s construction lag, and CO2 diffusion across water.
pitfalls: per-storage sitesAt in render cost more than batched settlements; direct storageSite slot + one batched path beat baseline render time. Float32 cell deltas recorded as after-before keep ledger residual at 0 (findings).
next: implement Phase 1 (diffusion engine) — population/storage demand injection, Jacobi diffusion with water blocking (full-map for CO2), mass-conserving gradient goods transport, transport workforce, and experiments/mape_spread.js.
