# 01 · Gradient routing and finite intake

- Review: the strongest-face indicator hid split flow, and a whole-cell destination cap still admitted large consumer piles.
- `simulation.js` — filtered steering, accepted transfer vectors, finite service time and demand-limited admission.
- `fields.js`, `telemetry.js` — cell-aligned fields, contours, sampled relief, session histories and a conservation readout.
- `app.js`, `index.html`, `styles.css`, `fonts/` — standalone controls, linked inspection, true uniform resets and local type.
- `simulation.test.js` — 14 passing tests including corner routing, zero-floor release, stock-limited uptake and competing senders.
- No consumers, 5 s: off-source stock 4.3083 units from fill 0; 4.9640 from fill 0.5. Consumption zero in both.
- Eight sources to one consumer, 15 s: maximum queue 0.1759 units; absolute ledger residual 1.78e-15 units.
- Opposite corners, 45 s: 9.933 units delivered, final intake 0.337 units/s for a 0.34 units/s source.
- Browser: HTTP and direct-file boot; pause, step, speed, resets, pressure, editing, linked readouts, guide and flow visibility. No overflow at seven viewport widths (320–1440 px), runtime errors or external requests.
- Next experiment: move a consumer mid-run and compare rerouting time with and without stock pressure.
- Report renames and cross-prototype work are logged in `archive/02-compare-report-worklog.md`.
