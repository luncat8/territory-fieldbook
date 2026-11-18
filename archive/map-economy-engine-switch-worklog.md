# Map economy · live field strategies

plan: `plan-map-economy.md` — Catchment A and Queue B
changed: `map-market-flow.js`, `map-diffusion.js` — compare reachable-stock pull and proportional use against local queue admission and delayed service on the shared tick
changed: `map-economy.js`, `actions.js` — switch live; relax only coal/goods demand, keep physical state and the ledger; keep Sites disabled
changed: `hud-economy.js`, `hud.js`, `index.html`, `render.js`, `input.js` — economy controls under the clock, pull readouts, common coal/goods contrast
changed: `experiments/mape_compare.js`, `experiments/dom_smoke.js` — identical stock pulses, stock/market invariants, water barriers, admissions, seeded mine loop, and paused UI round trip
validation: baseline smoke output matches `f68d493`; same-seed field ticks ~0.70/0.54/0.51 ms (Diffusion/A/B); A pull 17% with adjacent stock while B waits for the queue (50% floor)
validation: game smoke, DOM smoke, survey spread, map spread and both standalone lab suites pass
validation: Chromium file/HTTP switches preserve stock and progress, draw correctly when paused, and fit desktop/mobile widths; first A switch ~19 ms, warm switches ~4–9 ms in the sandbox
decision: keep Diffusion default; evaluate A for household pull and use B to study congestion. Neither needs a separate renderer.
pitfall: visible update cadence and per-step CPU time are separate; B's lab throttles paints and draws extra layers even though its model step is cheap.
next: playtest A's market supply over the first 60 days before choosing a default or adding a shared optional flow overlay.
