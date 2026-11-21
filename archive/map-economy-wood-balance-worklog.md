# Map economy · settlement wood demand, patch-cut sawmill, balance speeds

plan: plan-map-economy.md — wood demand, sawmill area scan, balance speed panel
changed: map-economy.js, map-market-demand.js, map-diffusion.js, map-population.js — settlement wood (LOGS) need, consumption and market routing; speed multiplier state
changed: map-industry.js — sawmill scans the whole 5×5 disc on a cooldown and fells every eligible cell; per-subsystem dt scaling
changed: map-sites.js — site speed, wood in site metabolism
changed: hud-balance.js, index.html, hud.js — balance speed sliders + copy-settings (new file + map entry)
changed: experiments/mape_forestry.js, experiments/dom_smoke.js — patch-cut and balance-panel gates
validation: node --check on all touched files; forestry, smoke, dom_smoke, compare, factory, population, fluid, sites, scenes, fluid_migration, forest, views, spread, survey pass (smoke 17/17, dom 35/35)
validation: wood demand diagnostic: Diffusion town pull 0.99, Catchment 0.37, Queue 0.52; sawmill produces 1.18 logs/s against settlement demand in all three engines; ledgers stay <1e-6
decision: wood is a full market commodity (LOGS joins COAL/GOODS as a market item) so A/B route and consume it like any other; Diffusion keeps it a signed field
decision: sawmill fells every eligible cell in one scan (even split of the rate budget) on MAPE_SAWMILL_SCAN_SEC cooldown, replacing one random sample per tick — area model, less scanning
decision: balance speeds scale each subsystem's own dt (factories/settlements/mines/sites/workshops), 1 = live rate; sliders persist across resets
pitfalls: factoryScanAcc is indexed by factory id, not cell id — tests must set mape.factoryScanAcc[factoryIndex]
next: manually playtest a wood-demanding town next to a sawmill at 4× and tune MAPE_NEED_WOOD / MAPE_SAWMILL_SCAN_SEC from observed forest draw
