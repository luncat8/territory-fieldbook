# Map economy · visible flows and reference scenes

plan: `plan-map-economy.md` — Catchment A and Queue B, Economy test scenes
changed: `map-market-demand.js`, `map-market-flow.js`, `map-diffusion.js` — bounded regional pull, fast filtered A haul, headroom-resolved B intake and accepted vectors
changed: `map-industry.js`, `map-economy.js`, `sites.js`, `land.js` — separate industry owner, deeper finite reserves, gentler disturbance and background workshop goods
changed: `map-scenes.js`, `main.js`, `actions.js`, `input.js` — fixed-step 4× startup, isolated A/B reference maps, replay, step and editing
changed: `render-economy.js`, `render.js`, `hud-scenes.js`, `hud-economy.js`, `hud.js`, `index.html` — paired heatmaps, moving flow traces and focused controls
validation: game/DOM smoke, survey/map spread, engine comparison, scene regressions and both standalone suites pass; no prototype files changed
validation: A/B delivered within 6 sim s; A reversed the actual route within 1 sim s of relocating the buyer; both retained 79.9% of a staffed deposit after 120 sim s
validation: Chromium HTTP/file boot, scene isolation, pause, step, edits, switching and 360–1360 px layout; game and both scenes sampled near 60 fps at 4×
decision: A is the survey default; B compares queue service without suppressing uptake when stock cools import pull
pitfall: animate accepted shipments rather than demand gradients; rejected B shipments should not appear to move
next: compare how long flows stay legible on a few survey seeds before tuning consumption or adding factory production.
