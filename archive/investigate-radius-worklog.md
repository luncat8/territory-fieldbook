plan-prototype investigation radius
changed: investigate.js — float Euclidean radius, no 3×3/5×5 operator
changed: actions.js / input.js / hud.js — dropped area cycle
changed: index.html — around-list under map
changed: plan-prototype.md — float radius + under-map panel
validation: node --check investigate.js actions.js input.js hud.js; node experiments/smoke.js; node experiments/dom_smoke.js
decisions: radius is a float interpolated onto cell centres; listing is HUD, collection lives in investigate.js
next: playtest whether 3.5 / inner 1.2 reads as a survey disk
