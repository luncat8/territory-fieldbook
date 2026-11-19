3.1 — survey hydrology and forest moisture
changed: prototype/water-humidity/{terrain,simulation}.js — share drainage, springs and the solver through a terrain builder; lab scenarios remain standalone.
changed: world.js, map-scenes.js, hydrology.js, main.js, index.html — adapt seeded terrain, advance survey weather, keep benchmark scenes neutral.
changed: economy.js, map-economy.js, render*.js, hud-economy.js — forest uses soil; expose surface depth, air and soil separately and tint channels on terrain.
validation: experiments/hydrology.js — original default height, terrain and opening forest hashes match. At 120 sim-s, 144 channel cells average +0.138 soil vs +0.017 on 2967 dry cells; replay exact, water ledger error <1e-6.
validation: root survey, scene, market, migration, population, forest and UI experiments pass; 77 display checks. Standalone lab model and UI suites pass. All three forest engines conserve local carbon to 1e-6.
decision: soil is a smoothed index, not a second ledger; retain the seeded substrate and moderate-moisture forest optimum, with less recharge on hills and some seepage onto banks.
next: compare an upland spring, meadow bank and dry inland patch at 4× before tuning retention or the width of bank seepage.
