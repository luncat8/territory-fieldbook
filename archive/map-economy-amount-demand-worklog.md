# Map economy · amount/demand view redesign, workforce field layers, left job-site panel

plan: `plan-map-economy.md` V1 (rewritten) — eight views, per-side item pickers, job-site panel left of canvas
review: population/workforce were single-purpose views with no preset treatment; supply/demand shared one item picker so workforce pools could not be compared side by side
changed: `map-economy.js` — `MAPE_VIEW_ITEM` ids (population 4, fresh 5, workforce 6, depleted 7), per-side `MAPE_VIEW_AMOUNT_IDS`/`MAPE_VIEW_DEMAND_IDS`, `mape.viewItemDemand`, `MAPE_VIEW_POOL_MAX`
changed: `render.js` — `VIEW` renumbered (demand 5, amount 6, paired 7); population/workforce single views removed; `VIEW_NAME` reads amount / amount + demand
changed: `render-economy.js` — `renderViewItem`/`renderItemField`/`renderItemNorm` route each side to its field (pop, wfFresh, workforce pull, wfDepleted, goods/demand views); contours and flow gated to resources; `renderDemandMax(item)` per item
changed: `render-markers.js` — per-view item for mines/workshops/labels; mines unfiltered for workforce items (they are the job sites)
changed: `hud.js` — separate amount and demand item radiogroups with id-aware `hudMakeSeg`; visibility split by view (both shown on paired)
changed: `hud-display.js`, `hud-economy.js` — amount/demand display scopes gated per side; legends per item (persons/cell sqrt, job pull 0–4, pool log 0–100); flow disabled for CO2 (no flow offsets)
changed: `index.html` — `#ui-site-panel` aside left of the canvas holds the selected factory/mine readout; `hud-economy.js` toggles it with the selection
changed: `experiments/dom_smoke.js`, `experiments/map_views.js` — 8 view radios, 7+7 item chips, per-side legend checks, engine-switch sigs on the demand side
validation: full suite green — smoke, dom_smoke (0 failures), map_views (58 checks), mape_compare, mape_scenes, mape_fluid, mape_spread; all files ≤ 500 lines
decision: amount side = factual per-cell amounts (coal, iron, goods, co2, population, fresh, depleted); demand side = movement gradients (coal, iron, goods, co2, workforce job pull, fresh, depleted); both sides carry fresh+depleted chips; "Supply" renamed to "Amount" everywhere user-facing
decision: workforce amount chip omitted (job pull is a gradient, not a stock); population demand chip omitted (people are not a pull) — per locked design
pitfall: `hudMakeSeg` radio values are indices, not item ids — the ids array maps them; CO2 has no flow offsets so flow controls must disable for it even though contours still cross water
next: L2 manual pass at 4× — watch fresh gather at the mine and depleted return to settlements on both sides; then Phase 3
