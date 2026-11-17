# declaration margin worklog

plan: plan-prototype.md victory — declaration margin
changed: victory.js — VICTORY_MARGIN constant (0) and margin-aware territory-lead check (feature)
changed: plan-prototype.md — victory condition 1 notes the margin (design)
changed: draft2.txt — removed resolved open questions (declaration margin, after declaration)
validation: node --check victory.js pass; smoke 13/13; dom_smoke 22/22
decisions: no minimum declaration margin for the prototype (VICTORY_MARGIN = 0): strict largest territory share is enough; the constant keeps the knob available if playtesting wants a buffer.
decisions: after-declaration behaviour from the previous pass stands (rivals stop, button disables).
pitfalls: none new.
next: recovery rates — whether disturbed area slows natural recovery (land.js), then a deferred system (access/contracts/reputation or buildings).
