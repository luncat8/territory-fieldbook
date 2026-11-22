# 02 · Gold as universal money

- Review of 01: `clearTowns` bypassed `setActor`; transport hard-coded cell capacity 1; test helper `clearedMap` reset twice; 01 plan's Money section (minting untouched) is superseded by 02. Fixed in place except the archived plan.
- `gold.js` (new) — feature: town gold seed, gold mine, bills/owed, three ask-steered coin streams (coal→mines, goods→factories, wage→towns), firm wages above working capital, gold ledger.
- `simulation.js` — feature: BID_MAX/PRICE_MAX removed (no price ceiling), town bid = spendable gold / (need × purse horizon), factory bid cooled by unpaid bills, gold mine actor, cell capacity per transport scratch, module.exports dropped (tests load scripts in page order via vm).
- `fields.js`, `telemetry.js`, `app.js`, `index.html`, `styles.css` — Gold view (held + payment ask, three coin flows), 1-2-5 auto-scaled legends, gold mine tool/marker, Gold supply card, gold ledger line, g/u units.
- `simulation.test.js` — 22/22 pass (14 kept, 8 new: gold conservation through edits, seed = start price, no ceiling, payments + wages, gold-mine gate, broke-town halt, credit cooling, inflation near gold).
- Reference chain 40 s: burned 22.80, eaten 22.03 (01: 22.81 / 22.04), uptake 0.68. Gold ledger |err| ≤ 2e-11 over 240 s.
- With gold mine: T1 goods price 2.84 → 6.93 g/u (20 → 240 s), T2 stays 2.55. Closed economy (no gold mine): supply 81.60 constant, prices hold 2.50 / 2.55, ~1.8 g/s settled.
- Boot smoke in a stubbed DOM VM: boots, draws all 6 layer/resource combinations; `node --check` clean.
- Decisions: gold climbs the seller's ask while goods climb the buyer's bid, so payments use the existing transport with no owed-pull field; one stream per receiver kind so a payer is never its own receiver; credit scale is relative to margin so it holds at any price level; seed sized so the start price is the only calibration of the price level.
- Pitfall: a test helper that clears actors must also reset money, or seeded purses stay on empty cells and break the ledger.
- Next: plan 03 minimal slice (one faction, notes as item, treasury peg), or deposit depletion to brake inflation before main-game integration.
