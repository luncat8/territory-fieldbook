plan: prototype
changed: plan-prototype.md — replaced fixed square investigation with a continuous radius.
changed: world.js, party.js, sites.js — seeded terrain, survey, party, sites and influence.
changed: economy.js, game.js — stocks and flows, rival, survival and declaration.
changed: index.html, style.css, ui.js, main.js — playable shell, map and controls.
changed: tests/ — deterministic simulation and browser-wiring smoke checks.
changed: AGENTS.md, README.md — ownership and local run instructions.
validation: node --check on all JS; simulation and UI smoke suites passed; end-to-end seeded victory passed.
decisions: use a compact abstract solar/biomass cycle; physical mass excludes supplies and money.
pitfalls: browser smoke uses a DOM stub; visual and interaction checks still need a real browser.
next: playtest the full loop in a browser and tune rates, visibility and rival behavior.
