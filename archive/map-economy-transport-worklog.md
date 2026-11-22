# transport speed map worklog (plan-map-economy)

plan: plan-map-economy — Transport speed map, Phase 6 · review of the core speed-map stage
review: that stage left no worklog; this file indexes it from here on. Its haul share used a weighted denominator g·c / (Σg·c + ref), against the plan and the food-flow review decision, so uniform swamp sent 0.92 of meadow (queue 0.996)
changed: map-diffusion.js, map-market-flow.js — unweighted share g·c / (Σg + ref); queue saturates on raw slopes and weights by c (fix)
changed: map-diffusion.js, map-market-flow.js, map-fluid.js — haul, market, queue, walk, leave and fluid rates doubled: shipped rates are rates at c = 1 (balance)
changed: map-sites.js — dust shipments rejected before the seller debit (fix: ledger leak)
changed: map-kernels.js (new) ← map-diffusion.js; map-seed.js, map-trade.js (new) ← map-economy.js; index.html load order; AGENTS.md map (move)
changed: experiments/mape_transport.js — uniform_slow_ground_sends_less (fails on the old kernel: 0.920 / 0.996)
validation: full suite 15/15 exit 0; pure-move diff check (every removed line re-added); git diff --check clean
evidence: 300 s survey satGoods D/A/B .128/.108/.086 → .095/.137/.087, satFood .88/.49/.37 → .75/.47/.35, active plants unchanged ±1; Sites live residual −1.1e-6 → −5.3e-10
decisions: user rule — 1 is the maximum (roads), everything scaled under it, meadow 0.5. Speeds stay absolute; doubling the nominal rates keeps meadow at its old pace instead of halving all overland haul. Diffusion D is not doubled: D·max(c)·dt would leave the mix budget on roads
pitfalls: weighted share denominator cancels c; guard before the debit (findings)
next: travel-time budgets for catchment and scan (below)

plan: plan-map-economy — Transport speed map, catchment and scan distances
changed: map-transport.js — transportTravel: bounded Dijkstra, edge cost 0.5 / c in meadow steps, preallocated heap and stamps (feature)
changed: map-market-flow.js — catchment = cells within 4 meadow steps, weight 1 − t/5, stencil sized for road reach (145); mapeCatchmentCells accessor (feature)
changed: map-factory-scan.js — deposit fields are travel times (feature); map-economy.js — speed map built before catchments (fix: init order)
changed: tuning.js — terrain tuning rebuilds catchments; hud-economy.js — inspector `intake N cells` on settlements (feature)
changed: experiments/mape_transport.js — meadow diamond + falloff, forest 5 / swamp 1, tuning 13 / 145, Dijkstra = brute force, causeway scan time
validation: full suite 15/15 exit 0; rebuild 3.7 ms (7.8 ms fast tuning); scan run 2 ms; live tick 1.35–1.49 ms vs base 1.43–1.50 (noise)
evidence: survey town catchment mean 16.8 cells; satGoods A/B .137/.087 → .090/.086, satFood A/B .47/.35 → .56/.43; Diffusion unchanged (no deposit-fed plants on the seed)
decisions: meadow-step units keep every meadow result identical and the 4-step constant readable; a hill or swamp town fetches only from its own cell — haulage still delivers there, so the catchment narrows intake, not supply
next: Sites path field (shipment eta and haul cost from transportTravel, replacing Euclidean), then roads as a speed-map input; separately, drop the null-conductance branches in the kernels (tests can pass an all-1 table)
