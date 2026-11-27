# ui text redraw and ⧉ copy worklog

plan: AGENTS.md `## ui text (game and prototypes)` — no text redraw on pause, text at 2..5 fps, ⧉ copy on logs/info/inspector
changed: index.html — archived water-humidity script paths (fix: boot ENOENT); ⧉ buttons, `.ui-block-head`/`.ui-copy` CSS, events section, hud-copy.js load (feature)
changed: main.js — paused frames return before sim, render and HUD (feature); input.js — hover repaints while paused (feature)
changed: hud.js — `hudClockText()` split from `hudUpdateClock` (refactor for copy header); hud-copy.js — ⧉ buttons on inspector, site, workforce, party, around, events (feature, new file)
changed: render-markers.js — actor labels cached in a per-side layer, rebuilt ≤4×/s running or on key change (feature)
changed: prototype/shared/lab-ui.js — `labCopyHtml`/`labBindCopy` (feature); economy-panel.js — ⧉ replaces "Copy all stats", footer dropped; lab.css — `.copy-button`, `.tracked-top`
changed: prototype/*/app.js — `texts()` at 4 Hz only while running, handlers call it when paused, ⧉ cell reading; */fields.js — marker labels cached in a layer; particle tracked.js — ⧉ watched worker
validation: dom_smoke 0 failures (new: labels_cached_layer builds=2 per 0.5 s, paused_frames_idle, paused_hover_repaints, copy_buttons); smoke 0; map_views 84/0; mape_scenes/population/fluid/forestry/co2/transport exit 0
validation: particle node --test 42/42 (new paused/copy test fails when the running gate is removed); price-model 72/72
validation: mape_money fails before and after: `MAPE_MINT_POP` undefined — script still targets the archived minted engine (pre-existing)
decisions: paused = return early in the frame loop, not per-panel guards; every input path already repaints, hover was the one gap.
decisions: log ⧉ copies all kept events oldest first plus status, not the 8 visible lines; every copy starts with `# panel · clock`.
pitfalls: frozen-clock label staleness on paused edits; async ✓ flash (findings).
next: port mape_money.js to the gold engine, or archive it with the legacy engine.
