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

plan: plan-particle-transfer.md — food farms and worker-owned demographics
changed: prototype/particle-transfer-b2/{farms,worker-life}.js — field construction, paid seasonal harvest, personal splits/starvation (feature)
changed: prototype/particle-transfer-b2/{simulation,goods,actors,founding,land,forage,gold}.js — food trade, farm wages/siting/claims/waste (feature)
changed: prototype/particle-transfer-b2/{towns,settlement,workers}.js — remove town births/free food and founding teleport/check-in; preserve worker identity (fix)
changed: prototype/particle-transfer-b2/{app,fields,telemetry,index.html}.js/html — Food tab, Farm tool, food/split/starvation ledgers (feature)
changed: plan-particle-transfer.md, plan-map-economy.md, AGENTS.md — authoritative worker lifecycle and farm design; distinguish cell-engine population (fix)
validation: syntax checks pass; lab suite 26/26; final food-life + DOM suites 11/11; git diff --check pass
validation: canonical 120s farm chain produces >10 food, sells >1 food; food/gold/headcount/tired balances within 1e-8
validation: 180s reference run retains 24 workers, 0 starved, gold error <2e-11; reachable wild food prevents starvation
decisions: town services never own worker creation/removal/routing; founding creates rooms without moving any worker
decisions: split shares gold/food/tired; starvation returns wallet to vault and books removed tired mass
decisions: 45s personal split cooldown plus current needs/food/wealth gates; 120s empty-bag starvation grace
next: manual farm/worker checklist in plan-particle-transfer.md, then particle game-port sizing

plan: archive/20261126-branch-comparison-report.md — finish the d198120 carryover picks (follow-up review)
changed: prototype/particle-transfer-b2/gold.js — claim table grows in place (growClaims) and settlement/release compact order-preserving (dropClaim, removeClaimsFor): no cap-silent loss, FIFO preserved (fix)
changed: prototype/particle-transfer-b2/{gold,diagnostics}.test.js — 129-hire overflow regression, FIFO-order regression, food in-flight diagnostics test (test)
changed: prototype/particle-transfer-b2/diagnostics.js — full food counterpart of coal/goods asks: field mean/max/best buyer, particles, flight, ask/book/haul, underwater flag, copy line, inspector rows (feature)
changed: prototype/particle-transfer-b2/index.html — restore 16× playback option, 1× default kept (feature)
changed: findings-pitfalls-skills.md — merge still-applicable general lessons from old d198120 (mass-weighted per-worker state, write-time founding, placement cones, neutral-land fixtures, gradient-gate/saddle/queue traps, wallet ownership, batched conservation counters)
changed: AGENTS.md, prototype/notes.md, archive/20261126-branch-comparison-report.md — ownership/test counts, remediation ledger, resolution section; tag archive/d198120-old-main preserves old main (doc)
validation: `node --test` particle-transfer-b2 41/41, price-model-b2 72/72; `node --check` on edited JS
decisions: the fixed claim cap was replaced with growth rather than a larger constant — a larger cap only postpones the silent entitlement loss
decisions: FIFO is a documented settlement contract, so removals compact in place instead of swap-removing the newest claim ahead of older ones
next: none outstanding from the branch-comparison pick list; the obsolete particle-transfer engine stays archived, not restored
