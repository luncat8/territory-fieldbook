# 05 Universal Actors Worklog

- Split universal actor logic into `actors.js` (`ActorOptimizer`, 334 lines) alongside `simulation.js` (396 lines) and `gold.js` (206 lines) so every module stays well below the 500-line ceiling.
- Capped `SCALE_MAX` at `1.55` (above `2.0`, one factory out-produced `POP_MAX = 24` town uptake, filling town buffers and cooling `priceGoods` below `START_PRICE` during gold-mine inflation).
- Added a profit-proportional wage floor (`0.35 * drive`) in `firmBids` so a fully staffed profitable firm keeps paying competitive wages instead of cooling `priceLabor` to zero at full shift buffer.
- Gated `GoldMoney.collectTax` `civic` rebates on `comfort > 0.4 && mult <= 1.1` and computed `adaptTownTax` `rationCost` from actual `satCoal`/`satGoods` draw so unsupplied towns do not book fake self-tax profit while supplied towns lower `taxMult < 1`.
- Fixed `.presets button[aria-pressed=true]` in `styles.css` so the active resource preset highlights visually.
- Verified: `node --check` clean on all 7 JS files; `node --test simulation.test.js` passed 28/28; full DOM/canvas smoke test clean with exact `depleted` ledger (`7.083 - 4.330 = 2.753`).
