3.1 — survey hydrology and forest moisture
changed: prototype/water-humidity/{terrain,simulation}.js — share drainage, springs and the solver through a terrain builder; lab scenarios remain standalone.
changed: world.js, map-scenes.js, hydrology.js, main.js, index.html — adapt seeded terrain, advance survey weather, keep benchmark scenes neutral.
changed: economy.js, map-economy.js, render*.js, hud-economy.js — forest uses soil; expose surface depth, air and soil separately and tint channels on terrain.
validation: experiments/hydrology.js — original default height, terrain and opening forest hashes match. At 120 sim-s, 144 channel cells average +0.138 soil vs +0.017 on 2967 dry cells; replay exact, water ledger error <1e-6.
validation: root survey, scene, market, migration, population, forest and UI experiments pass; 77 display checks. Standalone lab model and UI suites pass. All three forest engines conserve local carbon to 1e-6.
decision: soil is a smoothed index, not a second ledger; retain the seeded substrate and moderate-moisture forest optimum, with less recharge on hills and some seepage onto banks.
next: compare an upland spring, meadow bank and dry inland patch at 4× before tuning retention or the width of bank seepage.

3.1 — stable lake leveling
changed: prototype/water-humidity/simulation.js — fix: separate terrain and surface-head transport; cap surface conductance at 1/(8 × surfacePull) for non-oscillating four-neighbour leveling.
changed: prototype/water-humidity/simulation.test.js — fix/regression: ripple decay, mass conservation and no overshoot at three depths/timesteps; river check distinguishes moving channels from lakes and allows 240 s storage spin-up.
validation: syntax checks and all 17 model tests pass; new ripple test fails against the base solver (ripple amplified).
validation: experiments/hydrology.js passes; 91 channel cells, soil delta +0.153 vs +0.017 dry; ledger closes.
decision: donor availability prevents negative water, not lake-head overshoot; limit the surface correction rather than hide flicker in rendering or throttle terrain-driven river flow.
next: visually compare basin and coastal lakes at 1×/4×; inspect shoreline wet/dry transitions and verify slower upstream filling feels appropriate.
