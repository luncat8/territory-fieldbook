# 13 Resident Workers Review B2 Worklog
review of task 12 (1624c1e) against `draft/workers-food.md`, `draft/town-settlement.md`, `draft/company/{all,food-farm,new-construction-build}.md`; lost-connection attempts a0c2df6 / 767b23f re-reviewed for pickable ideas.
changed:
- `workforce.js`/`towns.js` (carried from c9eba75/e55c37c, the pick from 767b23f): `evictTown` spills erased-town residents ring by ring within `EVICT_REACH = 3` instead of falling back to a whole-map scan that teleported them from (0,0) on; dropped the unused `evictSurplus` argument.
- `farms.js` fix + `farms.test.js` (+1): `clearVisit` fells only the forest whose wood fits the cell (`min(forest, room / WOOD_PER_FOREST)`) and claims the plot only once cleared. The old code zeroed forest even when the wood cell was full, deleting up to 0.15 wood per dense cell (and the whole cell when wood pre-existed), against `draft/company/new-construction-build.md`: "any object claiming new cells do not remove it to nothing". New test pins forest + wood conservation on a full wood cell (fails on the old code) and the claim after buyers drain it.
validation:
- L0 `node --check`; full suite 67/67 after the change (one run; reference-map calibration untouched: the reference farm's patch tops out at forest 0.64 where all felled wood fits, so plot claiming there is unchanged).
review of task 12 against the drafts (verified in code, no change needed):
- Town step mints no workers: residents are conserved `fresh`/`labor`/`depleted` stock owned by `workforce.js`; split needs comfort + food + savings + free room, 25 s hunger despawn, founding builds rooms while settlers walk in, evictions carry savings. `draft/town-settlement.md` "town is not a worker manager" satisfied.
- Depleted demand scales with free housing (`capWorkers`), the wait pool smooths shift changes, still workers rest roadside, wallet pareto scoring trades home value against rest quality (the cell-engine nomad analog).
- Sawmills: random-cell fell visits gated by wood price and yard fill (draft: cut the whole selected cell, not every tick). Farms: 7 s seasonal harvests, moisture-quality plots, waste on ring 3; commercial wood/food bills `PAY_WOOD`/`PAY_FOOD` while wild forage and farm tree-clearing travel free (`paid`/`owner` tracking).
deviations kept (documented, not changed):
- Farm plots scale with food price and firm scale, not with hired workers (draft: "more workers -> more cells"); labor follows plots through hire bids — demand-driven instead.
- `townCrowdMult`/`restComfort` free-space denominators use land `popCap`, not built rooms (767b23f used rooms): half-built towns advertise space comfort; the wait pool catches real crowding and `roomTarget` closes the gap. Revisit if playtests show migrants pooling at young towns.
- `stepOut` runs twice per tick (step head + `stepLife` tail), so door pace is effectively 2x its constant; calibrated-in.
- `harvestSeason` early-returns carry `cropCost` into the next season: conservative, but the ask can spike after a long full-stock spell; consider expiring part of a missed season's cost.
- `foundTown` sizes rooms from all depleted in its 5x5, not only intent-flagged settlers: slight over-build with passersby.
- Deferred, matching task 12's next step: spontaneous company founding, construction sites, wood-to-goods factory, sawmill replanting, per-worker food-search mode (the draft dislikes deaths but also specifies despawn-after-long-hunger; household forage plus young-town sub-gate pulls are the cell-engine mitigations), nomad/house-owner types (particle engine).
attempts verdict:
- 767b23f (rooms, no minting, non-teleport founding, unconsumed household labor): already absorbed by task 12 in improved form (`away` commute tracking replaces its `workLoad` estimate, `max(pop, rooms)` replaces rooms-only rates); its bounded ring eviction is the pick applied here. Leftovers not picked: `REST_TAX_SHARE` 0.55 (kept 0.35), `WORKER_PER_POP` 0.3 (kept 0.18), `townUsePop` rooms*0.35 estimate.
- a0c2df6 (residents as a transported field plus births/deaths/emigration in `TownPolicy`): rejected — it kept the town-step labor minting (`supplied` block intact), so it does not meet the task; a parallel resident field walks alongside the labor/depleted flows and lets residents hop towns off the job market; town-owned lifecycle contradicts the draft.
pitfalls:
- The wood ledger cannot catch forest mass lost at `clearVisit`: `harvestedWood` is booked when wood is placed, so forest vanishing balances nothing. The new test pins forest + wood conservation directly.
next step suggestion:
- Spontaneous company founding per `draft/company/new-construction-build.md` (sawmill/farm/factory where output demand + free workers + construction wood converge) — task 12's own suggestion, still open.
