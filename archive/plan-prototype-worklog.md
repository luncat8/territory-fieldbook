# plan-prototype worklog

plan: plan-prototype.md — minimal game covering draft2 phases 1–2
changed: index.html — map + side panel layout, element ids, script load order (feature)
changed: random.js, world.js, land.js — seeded 64×64 terrain, heightmap, disturbed land (feature)
changed: investigate.js, sites.js — progress falloff, site pool, discovery, claims, extraction (feature)
changed: party.js, territory.js, rivals.js — members, skills, influence fields, rival agents (feature)
changed: economy.js — resources, prices, one recipe, biosphere, conservation ledger (feature)
changed: victory.js, actions.js, hud.js, render.js, input.js, main.js — checks, verbs, panel, canvas, boot (feature)
changed: experiments/smoke.js, experiments/dom_smoke.js — headless sim and DOM boot checks (feature)
validation: node --check all js pass; smoke 13/13 on seed 20261117 after 39 game hours (timber 55→45.3, mass_residual 0.000000, 1 rival claim, player share 0.028, victory refused with 1 fail); dom_smoke 16/16 (120 frames, 4096 lit cells, click moved party, view/pause keys, 17 buttons, restart alive at 06:00)
decisions: player claims by fully recording a cell (investigation 1) or by working a site; rivals claim on arrival inside an 18-cell home region. Map-wide rival search exhausted every site and made victory unreachable.
decisions: mining leaves 0.006 d per unit so one restoration clears a worked deposit. Victory's balance check uses cumulative oxygen: town fuel burn made instantaneous energy balance impossible.
decisions: food converts to supplies (5→5) because supply prices alone made a 3-member party insolvent by day 4.
pitfalls: vm lexical globals, stub ImageData, island spawns, setLineDash arrays — full notes in findings.
next: browser playtest and tuning; then take one open question from the plan (recovery rates, declaration margin).

plan: plan-prototype.md — recovery scales with disturbed fraction; contracts/reputation/access marked deferred low priority needs review
changed: land.js — natural recovery rate scales with (1 − d): d = 1 never recovers naturally, light disturbance clears in hours (feature)
changed: draft2.txt — 5.3 recovery decision recorded; 3.4 deferred systems marked low priority, needs review; 8 open question closed (feature)
changed: plan-prototype.md — land condition recovery note and deferred-by-design line updated (feature)
validation: node --check land.js pass; smoke 13/13 seed 20261117 (disturbed_cell 0.000→0.050, 1 rival claim); dom_smoke 16/16; formula check: d=1 stays 1 after 1000 h, d=0.01 meadow clears in ~6 h, d=0.25 meadow ~144 h
decisions: recovery speed = terrain rate × (1 − d), so fully disturbed land needs active restoration and natural recovery cannot outrun deposit/factory disturbance
pitfalls: none
next: browser playtest and tuning; then take one open question from the plan

plan: plan-prototype.md — speed rail pause/1×/2×/4×/16×
changed: main.js — CLOCK_RATES [0,1,2,4,16], CLOCK_DEFAULT_SPEED stays 3, FRAME_MAX_ACC 0.5 → 0.8 (16× at 30 fps needs 0.53 s accumulated per frame)
changed: hud.js — HUD_SPEED_LABEL gains '16×' (button loop auto-extends); plan-prototype.md:304 and units-and-scales.md:13 document the rail
changed: experiments/dom_smoke.js — Step chip found by textContent, time_controls = 5, initial-clock control count
validation: node --check main.js hud.js dom_smoke.js; dom_smoke and smoke exit 0; full suite 18/18 exit 0
decisions: default stays 4×; frame cap 0.8 bounds stall catch-up at ~2.4 canonical ticks per frame
pitfalls: index.html static 'day 1 · 0s · 4×' label must match CLOCK_DEFAULT_SPEED
next: none — speed rail complete
