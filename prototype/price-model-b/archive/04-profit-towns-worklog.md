# 04 · Optimizing firms and towns: labor, wages, population and taxes

- Review of 02: buyer `cap=0.085` froze `1+stock/0.08` at `2.06` and purse-dump `townBid` demanded unlimited stock; single `owed` broke multi-input buyers; `FieldRelief.draw` clipped uncapped prices; `module.exports` unguarded. All fixed in place.
- `simulation.js` — feature: conserved `labor` + diffused `priceLabor` (wage), town `pop` (`2…24`), finite coal+goods town rations, shared `optimalBid` for mines/factories/gold mines/towns, multi-buyer `stepBid` pass-through, guarded `module.exports`.
- `gold.js` — feature: `workerPurse` separate from town `purse`, per-stream `owed` pro-rata settlement, comfort-gated resident taxes, population-weighted wage ask, firm/municipal surplus recycling above working reserves.
- `fields.js`, `telemetry.js`, `app.js`, `index.html` — Labor/Wage map tab and vectors, rescaled 3D price relief, Pop/Wage/Profit/Workers tooltip, Labor ledger line, 16 s warmup.
- `03-faction-money-plan.md` — improved legal-tender demand: member towns collect resident taxes in notes (`workerPurse` demand) without forcing outside firms to use notes.
- Validation: `node --check` clean; `node --test simulation.test.js` **25/25 pass**; DOM VM boot smoke passes all 4 resource tabs; 45 s closed run: `wages > 20`, `taxes > 20`, positive mine/factory/town profits, `pop` 10 → 15.4, all 4 ledgers `< 1e-7`.
- Decisions: one `optimalBid` (`INPUT_SHARE=0.65`, `1−stock/target`) optimizes every buyer and hits exact 0 at finite buffer even when coal is price 0; `COAL_COMFORT+GOODS_COMFORT=1` bounds town ration spend below tax revenue at every price level; `BUFFER_SECONDS=1.5` damps commute bullwhip.
- Pitfalls: `cap ≈ STOCK_REF` prevents zero cooling; buffers shorter than transit pulse; satisfied buyers must pass steeper ambient bids through (see `findings-pitfalls-skills.md`).
- Next: factory siting scan or deposit depletion on this optimizing three-market loop, or the minimal plan-03 note-tax slice.
