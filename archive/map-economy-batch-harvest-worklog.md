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

# Half-cell sawmill cuts; farm plan
plan: `plan-map-economy.md` §3 Sawmill, Forestry supply chain, Farm: a seasonal field harvester
review: previous entry ok; its plan figures (40 logs, 34–38 s per cut) updated with the change
changed: `map-industry.js` — feature: `MAPE_SAWMILL_CUT_SHARE = 0.5`, `MAPE_SAWMILL_SEARCH_SEC` 2 → 1
changed: `hud-scenes.js`, `experiments/mape_forestry.js` — tool help and half-cut gates
changed: `plan-map-economy.md` — sawmill numbers; farm design section, gates and manual pass item
changed: `findings-pitfalls-skills.md` — household commodity demand/use pairing
validation: node --check; mape_forestry, mape_factory, dom_smoke pass; 120 s harvest 150 logs at dt 0.2 and 0.05 (was 160), half staff 80; ledger <7e-13
decision: half cuts at twice the cadence keep logs/s, halve haul bursts and never bare a cell
decision: compared draft 2fd5ecc — its whole-patch batch cut rejected for forest, reused as the farm's season harvest with a staff-weighted clock instead of its sim-time scan clock
decision: 2fd5ecc logs-as-market-item (need ×4) not taken: rebalances the measured map and drops Sites log orders while keeping use; its touch list is the farm's food checklist
decision: 2fd5ecc per-subsystem dt multipliers are the right shape for the draft settings panel; take them with the panel, adding forest/farm growth sliders
pitfalls: dropping one side of a household commodity is silent outside Sites — see findings
next: implement farm first cut (FOOD resource, household use in four engines, map-farm.js, scene tool), then the settings panel
