# Workforce return and flow display

plan: `plan-map-economy.md` workforce models and field displays
changed: `map-fluid.js`, `map-economy.js` — extend rest pull reach and record accepted workforce advection and depleted diffusion
changed: `render-economy.js`, `hud-display.js`, `hud-economy.js` — enable animated workforce flow in fluid mode
changed: `experiments/mape_fluid.js`, `experiments/map_views.js` — return, rest, flow and control regressions
changed: `plan-map-economy.md` — update standing design and constants
validation: syntax checks; mape_fluid passes, 9.991 of 10 rested from 8 cells in 100 s; map_views 66 checks pass; scene A 150 s rested 6982 and spawned 24; goods/population ledgers zero
review: prior compact rest pull and high gradient threshold left distant depleted pools weakly guided; full settlements intentionally do not rest workers
next: manually play scene A at 4× and tune settlement spawning and return against the intended pacing
