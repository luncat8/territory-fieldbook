# 01 · Price diffusion as demand from buyer

- Review: the shipped price law steered nothing (goods climbed pull, price was a local ratio), factory inputs were free so goods price never reached mines, and owed pull duplicated demand for money.
- `simulation.js` — one price field per resource (coal, goods), town bids cooled by stock, factory coal bid derived as 60% of the goods price at its cell, price diffusion with decay as transport cost, mine gate, fraction-of-stock uphill transport with queue caps.
- `fields.js`, `telemetry.js`, `app.js`, `index.html`, `styles.css` — stock/price maps with resource switch, price contours, flow arrows, derived/decay/suppression toggles, both ledgers.
- `simulation.test.js` — 14 passing tests: chain delivery, no demand field, depletion with distance, derived bid, margin cap, gate idle, halt without town, gradient transport, headroom, distant chain.
- Reference chain, 40 s: burned 22.81 coal, eaten 22.04 goods, uptake ~0.5/s; price at mine 0.05 vs 0.56 at factory — decay visible, chain still delivers.
- Decisions: quantity (need rate, queue) stays separate from price (steering) so a high bid cannot flood a buyer; production gate replaces zero-floor spread (no buyer, no price, no production); decay 0.08 (reach ~13.7 cells) after 0.35 starved the reference layout.
- Next: integrate into the game per `01-price-model-b-plan.md` (bid injection in map-money.js, price as transport guide, delete A/B pull signals), then calibrate BID_MAX per resource and the two-input split.
