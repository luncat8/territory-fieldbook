# tuning panel worklog

plan: playtest tuning — live multipliers for renewable, mine, fab, settlement, survey-site and transport rates
changed: tuning.js — knob table, group × kind products, summary/encode/decode (feature, new file)
changed: hud-tune.js — left panel sliders, copy to clipboard, apply pasted `tune:` line, localStorage (feature, new file)
changed: index.html, hud.js — panel markup/CSS, header toggle, load order, hudTuneInit (feature)
changed: economy.js, map-farm.js, map-industry.js, map-factory-scan.js, map-population.js, map-fluid.js, map-diffusion.js, map-market-flow.js, map-sites.js, sites.js, hud-economy.js — read `tune.*` at the rate sites (feature)
changed: experiments/dom_fixture.js — classList stub (fix: boot failed before any check); map_views.js — drop duplicate out-of-range check (fix); dom_smoke.js — tune_panel check
validation: dom_smoke 0 failures (incl. tune_panel); smoke 0 failures; map_views 78/0; mape_farm/forestry/factory/population/fluid/scenes/compare exit 0; mape_sites fails identically before and after (residual -1.30e-6, pre-existing)
validation: survey 120 s, mines unlocked: default mined=896.7 · mines ×3 mined=3261.2 · siting ×4 fabs 3→4; ledger residual ≤1.1e-9 in every run
decisions: slider stops are a round-number ladder 0.1…10 (no 0) — pasted values read cleanly and 0 would freeze ETAs and scans.
decisions: kind = own × group, both stored; summary lists only moved knobs plus a machine `tune:` line that Apply text reads back.
decisions: fab speed scales input and output together (recipe ratio fixed); construction scales log draw with progress (total cost fixed).
decisions: no fishery exists yet, so renewables cover forest and farms only; settlement consumption left out (it spans every engine's demand and use sides — findings).
pitfalls: dispatch-time ETAs ignore live speed knobs; scale countdowns (findings).
next: playtest with the panel, paste the `tune:` line back, then fold accepted values into the constants and reset the knobs.
