# territory fieldbook

Open `index.html` in a browser (`file://` works), or serve it with `python3 -m http.server 8080`.
Use **amount + demand** (key **0**) for paired maps; **map display** selects looks and overlays. The amount side shows factual per-cell amounts (coal, iron, goods, logs, CO2, population, fresh and depleted workforce pools); the demand side shows movement gradients (coal, iron, goods, logs, CO2, workforce job pull, fresh and depleted pools). Logs move from sawmills to charcoal works and wood works, which turn them into coal and goods.
Open **Test scene A** or **Test scene B** from the map header.

- `node experiments/smoke.js`, `node experiments/dom_smoke.js` — simulation and boot/UI gates
- `node experiments/mape_scenes.js`, `node experiments/mape_population.js` — scenes and settlement behavior
- `node experiments/mape_fluid.js`, `node experiments/mape_forestry.js` — workforce and industry chains
- `node experiments/map_views.js` — paired maps, looks and overlays
