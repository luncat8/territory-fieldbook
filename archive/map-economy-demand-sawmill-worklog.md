# Map economy · settlement pull and sawmill search effort
plan: `plan-map-economy.md` Phase 2 + forestry supply chain
review: old Diffusion coal need barely moved the signed field; reservoir selection always found a cut if any eligible forest existed, regardless of forest density
changed: `map-economy.js`, `map-market-demand.js` — stronger settlement goods/coal use; `plan-map-economy.md` — matching balance values
changed: `map-industry.js` — O(1) random sample from a centered 5×5 patch; misses do not rescan; `hud-scenes.js` — explain one-cell sampling
changed: `experiments/mape_population.js`, `experiments/mape_compare.js` — settlement pull thresholds and updated queue-stock pressure range
changed: `experiments/mape_forestry.js` — prove a miss does not find another cell and a hit cuts only its sampled tile
changed: `findings-pitfalls-skills.md` — capture sampling rule for scarcity/search friction
validation: population/demand, forestry, scenes, comparison, DOM smoke, and map views (79 checks) pass; `node --check` and `git diff --check` pass
validation: settlement demand at startup: Diffusion goods/coal `0.87/0.63`, Catchment `0.31/0.43`; population ledger residual `2.2e-11`
validation: forestry chain ledgers `1.5e-13` and `-1.2e-12`; queue outside-stock pull `0.628`; DOM failures `0`
decision: Diffusion household rates are `0.03` goods and `0.02` coal/person/s; A/B use `0.036` goods and `0.045` coal/person/s, so both views show town demand without saturating signed pull immediately
decision: one uniform sample models finding forest; an invalid sample costs the current production step and holds output to local coverage
pitfalls: one sample per simulation step changes harvest variance between engines, but dt-scaled expected output remains proportional to valid-cell coverage
next: manually compare town demand under Diffusion/A/B and try a sawmill beside sparse forest; then continue Phase 3 placement/idle rules and CO₂-gated regrowth
