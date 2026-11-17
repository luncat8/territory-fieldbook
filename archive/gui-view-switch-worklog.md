plan-prototype view switch + restored investigate verb
changed: investigate.js — survey push reusing investigationSweep, cooldown state (feature)
changed: actions.js — actionsSurvey owns the condition and observation cost (feature)
changed: hud.js — segmented radio view group under the map, one change writer, fine-pointer preview (feature)
changed: input.js — `i` surveys; `1`…`5` route through hudSetView (feature)
changed: index.html — :root tokens, joined .ui-seg styles, view group moved under the map (feature)
changed: experiments/dom_smoke.js — stub closest/click/matchMedia, view group and survey checks (feature)
changed: plan-prototype.md, AGENTS.md — survey verb, under-map view switch, ownership lines
validation: node --check on all touched js; smoke 13/13 (survey press takes spawn cell 0.5→1, condition 70→68, cooldown 6 h); dom_smoke 22/22 (click selects, hover selects on fine pointer, coarse hover ignored, stray hover ignored, keys sync radios)
decisions: the missing button was the 3×3/5×5 cycle dropped with the float radius; the verb returns as "survey", not as a mode switch, because the radius is no longer a player choice. Survey reuses the existing sweep instead of a second falloff path.
decisions: hover preview checks the radio with radio.click(), so the browser's own change event remains the single writer; matchMedia is read per event so a device that switches input keeps working.
decisions: view mode list moved out of the side panel to a line under the map, next to the around-list it explains.
pitfalls: a periodic refresh that rewrites checked state erases the hover preview — full note in findings.
next: playtest whether hover-preview on views feels like a preview or an accidental switch; then tune survey cooldown against the 3.5-cell reach.
