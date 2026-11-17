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
