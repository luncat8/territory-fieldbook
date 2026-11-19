# territory fieldbook

Open `index.html` in a browser (`file://` works), or serve it with `python3 -m http.server 8080`.
Use **amount + demand** (key **0**) for paired maps; **map display** selects looks and overlays. The amount side shows factual per-cell amounts (coal, iron, goods, co2, population, fresh and depleted workforce pools); the demand side shows movement gradients (coal, iron, goods, co2, workforce job pull, fresh and depleted pools). Both sides carry fresh and depleted chips.
Open **Test scene A** or **Test scene B** from the map header.

- `node experiments/smoke.js` — headless survey
- `node experiments/dom_smoke.js` — boot and controls
- `node experiments/mape_scenes.js` — economy scenes and rerouting
- `node experiments/mape_population.js` — settlement growth, intake and waste
- `node experiments/mape_fluid.js` — fluid workforce model, factory runtime, hamlet spawning
- `node experiments/map_views.js` — paired views, looks and overlays
