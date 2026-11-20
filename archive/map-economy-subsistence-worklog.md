# Subsistence floor, staffing-driven migration and the factory build plan

plan: `plan-map-economy.md` population dynamics, factory build plan
changed: `map-population.js` — subsistence share `0.62*sqrt(sv)*(1-d)` and intake `own+(1-own)*imports`; growth above 0.82, famine below 0.15; `fixedResidents` scenes opt out
changed: `map-fluid.js` — migration is a transfer driven by `jobFilled`/`jobVacant`, capped by `mapeFluidCapacity` and `MAPE_SETTLE_KEEP`; hamlet spawn only at a worked deposit beyond `MAPE_WF_TOWN_REACH`
changed: `map-diffusion.js` — `mapeTabulateJobs` credits each town its staffed and vacant slots
changed: `map-market-demand.js` — `mapeSpendUsable` spends only usable stock and reports what it took
changed: `map-economy.js` — `pop`/`popNext` are Float64; `MAPE_SUBSIST_*`, `MAPE_SETTLE_DISTURB 0.0024`
changed: `map-industry.js` — `mapeForestCover` area helper
changed: `experiments/mape_fluid.js`, `experiments/mape_fluid_migration.js` — rewritten to the transfer law and job-site spawn
changed: `plan-map-economy.md` — subsistence table, migration law, coal scarcity, factory build plan
validation: 12 experiments pass. no supply 1165→1165 flat over 600 s; mines 1165→1186 with served towns +46/+43/+36; workshops 1165→1188. coal 53.9/s household vs 12.0/s all-mine. fluid pool residual 0.003, population ledger 0.000
decisions: own ground tops out at 0.62 and the neutral line sits at 0.82, so no town grows without trade and imports are the whole profit. traffic cannot drive migration — every town exports fresh effort and none receives it, so it is structurally one-sided; staffing is two-sided. drains are famine and waste, never migration
pitfall: reporting household intake from raw stock while the usable-stock rule excluded it minted goods; see `findings-pitfalls-skills.md`
pitfall: Float32 population accumulated a 0.032-person ledger error in 3 000 steps
next: build the Phase 3 placement scan and `experiments/mape_factory.js`; bind mines to the three `ORE` deposits so `GENERAL` can run
