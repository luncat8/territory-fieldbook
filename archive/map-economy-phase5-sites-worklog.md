# Map economy · Phase 5 — Sites in the HUD

plan: `plan-map-economy.md` — Phase 5 (selectable engine comparison), Sites live switch, influence boost, victory stability
changed: `map-economy.js` — `mapeEngineAvailable` admits SITES; `mape` gains `popPeak` tracked in `mapeRebuildSettlements` and reset in `mapeReset`
changed: `hud-economy.js` — Sites radio enabled (drop the disabled title); 4th `HUD_ENGINE_NOTE` for the discrete-shipment engine
changed: `map-population.js` — `mapePlayerInfluence` + `MAPE_INFLUENCE_GROWTH = 0.10`; growth rate multiplied by `1 + 0.10 · player-influence-share`
changed: `victory.js` — two stability checks: population steadiness (`popPeak` drop over 50%) and unmanaged industry above the disturbance floor; `VICTORY_CHECK_COUNT` 4 → 6
changed: `experiments/mape_compare.js` — live-switch loop includes SITES; Sites seeded-map bench logged alongside the three field engines
changed: `experiments/dom_smoke.js` — Sites radio asserted enabled and switched; engine-switch redraw now covers Diffusion/Queue/Sites
validation: `node experiments/smoke.js` → `smoke_failures=0` (16 checks); `node experiments/dom_smoke.js` → `dom_smoke_failures=0`; `node experiments/mape_compare.js` → `mape_compare_checks=pass`
validation: live switch into/out of SITES preserves the stock snapshot and ledger residual (1e-4); Sites seeded-map bench `1.175 ms/tick` vs Diffusion 1.382 / Catchment 1.195 / Queue 1.135
validation: influence boost verified at a 1.10× growth-rate ratio for full player influence share; pop-decline and unmanaged-factory checks fire and clear under the intended states
decision: Sites switches live with `mapeSitesSettle()` landing in-flight shipments into goods before the routing change — a minor in-flight loss is accepted for this early-dev switch, per the user; no lossless-rebuild machinery.
decision: influence boost scales the growth rate (not the feed), so it lifts towns already above the neutral line without touching famine; rebalancing is expected later.
decision: victory stability reads `mape.popPeak` (peak total population) and treats any factory/mine above `LAND_DISTURB_LIMIT` that the player does not control as unmanaged.
pitfall: dom_smoke asserted Sites disabled; enabling it required flipping that assertion and extending the engine-switch redraw loop to the Sites radio.
next: run the Sites engine over a few survey seeds to check shipment reach and town supply before tuning hold horizons or adding a Sites path-cost field.
