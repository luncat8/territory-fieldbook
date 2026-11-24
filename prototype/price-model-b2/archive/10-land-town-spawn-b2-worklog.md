# 10 Land & town spawn B2 worklog
plan: `plan-particle-transfer.md` Phase 0 (land rest, town site quality, founding from settle intent); draft §"spawn town".
changed:
- `land.js` (new, feature) — terrain table (meadow 1.1 / forest 1 / desert 0.45), facility wasteland and town-claim cones, `rest`/`site`, owns the woodland wave.
- `settlement.js` (feature) — carried settle intent, pledge-written gather grid, best site at write time, 5 s cooldown; dropped `still` blend, `townNear` and the 5 s radius scan. `restFactor` × land rest.
- `simulation.js` (feature) — `depletedFlow.intent` mass-mixed companion in transport; `workforce.js` — shelter rest × land rest.
- `fields.js`/`app.js`/`index.html`/`README.md` — Land view, terrain/site/intent/gather readouts, guide copy. Tests: `neutralLand` fixture + 5 land tests.
validation:
- L0 `node --check` all B2 js. L1 `node --test`: 51/51. Stub-DOM boot + Land view draw/tooltip: pass.
- bench 120 s default map: goods eaten 114.60 (HEAD 114.68), gold_err −5.9e−12. Clear towns +180 s: 1 young town at (0,20) meadow, 7.6 cells from the gold mine (HEAD: 2 towns, (2,14) next to the gold mine and (2,25) now desert), gold_err −2.9e−11.
decisions and why:
- Spacing is a site-quality cone, not a hard gap: towns avoid facilities and towns by needing more settlers there, so a big enough crowd still founds anywhere.
- Intent is a mean, not a mass, so every existing depleted removal path stays untouched; a particle simply carries the float.
- Cones are stamped on actor change only — zero per-tick cost; the cooldown (not a scan cadence) lets the new home field spread.
pitfalls: rule tests broke on desert under fixture towns — flatten land in rule fixtures (findings).
next: Phase 1 particle-transfer lab (goods particles), reusing `land.js`/`settlement.js`; terrain conductance for movement speed can key on the same terrain table.
