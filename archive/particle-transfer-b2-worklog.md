# particle-transfer-b2 worklog

plan: plan-particle-transfer.md — Particle Transfer B2 standalone lab with zero-death foraging and Monastery gardens
changed: plan-particle-transfer.md, AGENTS.md, findings-pitfalls-skills.md — design, lab directory rename (`prototype/particle-transfer-b2/`), coarse-field & pool notes (feature)
changed: prototype/particle-transfer-b2/{simulation,land,steering,forage,gold,goods}.js — diffused B2 fields, water/shore/forest land, conductance steering, 24×14 4-tick forage gradient + Monastery gardens, conserved gold/Transport Company vault, SoA goods particles (feature)
changed: prototype/particle-transfer-b2/{workforce,workers,actors,towns,settlement,founding}.js — pareto home policy, SoA worker lifecycle with undisturbed `WORKER_FORAGE`, `matReady`-scaled firm pools, starvation-free town rooms/rations/births, zero-gold town & firm founding (feature)
changed: prototype/particle-transfer-b2/{fields,telemetry,app,index.html,styles.css,README.md} — particle & field dual-map lab UI, `Forage` view, `Garden` tool, watched-worker inspector (feature)
changed: prototype/particle-transfer-b2/{conservation,workers,forage,founding,ui}.test.js — 16-test conservation, lifecycle, zero-death foraging, founding and DOM/canvas suite (feature)
validation: `node --check prototype/particle-transfer-b2/*.js` pass; `node --test prototype/particle-transfer-b2/*.test.js` 16/16 pass (45s chain coal 48u/goods 28u at 120s, ledgers <1e-12; 70s factory-less run 0 deaths, 24+ forage entries, garden+wild rations >10; UI 7 tabs + Garden tool finite canvas coords)
decisions: hungry/broke workers enter undisturbed `WORKER_FORAGE` (ignoring job/home/founding pulls until `food >= FOOD_FULL`) over a half-res `24×14` 4-tick food gradient fed by water shorelines, forests and seasonal Monastery gardens (`0`g charity rations)
decisions: multi-input firms scale labor pool target by `0.15 + 0.85 * matReady` so empty factories keep ~1 standby worker while mines extract coal first
pitfalls: coarse forage cells must use `target <= ambient ? ambient : max(ambient, relaxed)` so weak meadow sources never pull down garden/shore halos — full note in findings
next: playtest `prototype/particle-transfer-b2/index.html` at 64×64 scale (`32×32` forage grid), then port to `map-money-particle.js` under `mape.moneyEngine === 'particle'`
