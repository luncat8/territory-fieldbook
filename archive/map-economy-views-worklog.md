# Map economy · independent views and overlays

plan: `plan-map-economy.md` V1; `plan-prototype.md` UI and file ownership
review: paired routing depended on scene-only canvas creation and scenes hid all view radios; separate context lifetime from selected view
changed: `render.js`, `main.js`, `input.js` — paired mode/key 0, always-bound canvases and native-control keyboard guard
changed: `render-markers.js` — pure marker extraction, then A/B shapes and setup-cached actor labels
changed: `render-economy.js` — A/B palettes, cached grid, bounded isolines, optional static/animated arrows
changed: `hud-display.js`, `hud.js`, `hud-economy.js`, `hud-scenes.js`, `index.html` — look radios, ten overlay switches, shared legends and survey pressure control
changed: `experiments/dom_fixture.js`, `experiments/dom_smoke.js`, `experiments/map_views.js` — shared DOM fixture and 50 display regressions
validation: touched JS syntax and diff whitespace pass; survey/DOM smoke, engine comparison, scenes, map/survey spread and both standalone suites pass
validation: Chromium HTTP/file boot, 11 native-control/layout checks at 360–1360 px, no exceptions; all three looks sampled 60 fps at 4× in scene B
validation: exact simulation snapshots survive all looks/overlays; hidden actors keep producing/consuming; prototype files unchanged
decision: looks apply visual defaults only; engine selection, material stocks and demand remain independent; reduced motion retains static flow evidence
pitfall: context existence is not paired-view state; full note in findings
next: compare A/B looks on a few live survey seeds before changing supply exposure or household metabolism.
