# 11 Land Ladder & Harvest B2 Worklog
plan: `draft/town-settlement.md` (build ladder, spawn on shore, young town harvests), `draft/workers-food.md` (minimal food), `draft2.txt` (consumption → CO2/litter)
changed:
- `towns.js`: pure move of town services out of `actors.js` (+ `wealthClassFor` from `simulation.js`); growth costs wood, pop capped by housing, hungry towns aim smaller.
- `land.js`: water/hills/swamp + shore/glade/marsh edges, build ease and housing, water blocks flow, consumption splits into CO2 and logistic-healing litter.
- `harvest.js` (new): idle residents harvest random cells within 3 for wild food and wood; harvest walks home on need-based pull fields; food upkeep, wood upkeep/growth/build.
- `settlement.js`: forest felling replaced by harvested wood; founding takes only gathered tired settlers. `simulation.js`/`actors.js`: hooks; dead `townBid`/`factoryBid` aliases removed (500 lines).
- UI: Wood/Food views, water overlay, terrain/litter/food tooltips, wood/food/waste ledgers, field-guide paragraph. Tests: `harvest.test.js` (8).
validation:
- L0 all files; L2 `node --test` 59/59; 120 s bench: goods 114.5 (HEAD 114.6), gold_err 7e-12, towns fed (satFood 1), litter flat (max 0.07); stub-DOM smoke all 8 views/6 tools.
decisions and why:
- Harvest is household work: labor spent, gold stays in the purse, no depleted, so it never floods paid rest.
- Pull fields carry no gold; towns stay rest+tax providers and never route workers.
pitfalls:
- Harvest counted as tiring work starved towns via home rest queues; litter above ~0.05/unit kept rising near busy towns.
next step suggestion:
- Replace `stepTown` minting labor from `pop` with resident particles (draft: towns do not spawn/despawn workers); then farms/sawmills as firms selling into the same food/wood fields.
