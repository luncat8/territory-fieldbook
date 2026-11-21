# Settlement timber demand and whole-cell harvest
plan: `plan-map-economy.md` §3 Sawmill + Forestry supply chain
review: retained the previous task's O(1) single-cell sampling and misses; corrected its square-patch comment (not a disc)
changed: `map-economy.js`, `map-population.js`, `map-diffusion.js` — household logs at 0.005/person/s and resettable per-factory harvest work
changed: `map-market-demand.js`, `map-sites.js` — local household log use in A/B; Sites forward holds, orders and use
changed: `map-industry.js` — whole-cell conversion, two productive seconds/search, harvest-size work debt; no RNG or cover scan during cooldown
changed: `hud-scenes.js`, `plan-map-economy.md` — shipped tool help, balance constants and manual pass list
changed: `experiments/mape_forestry.js` — whole-cell isolation, miss/cooldown/staffing gates, engine-step parity and household-only pull across four engines
validation: syntax checks on touched JS; all 15 runnable experiment suites pass; `git diff --check` passes
validation: 120 s yields 160 logs at dt=0.2 and dt=0.05; half staffing yields 80; forestry chain ledger residuals <6e-13
validation: manual visual pass not run; checklist is in the plan
decision: logs stay on their existing signed transport path in A/B; no new satisfaction axis or coal substitution
decision: upfront whole-cell output is paid before another visit, preserving workforce limits without partial cuts or per-frame allocations
next: playtest burst haulage and forest depletion around towns; tune household use/search cost before changing factory siting
