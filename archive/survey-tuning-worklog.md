# survey tuning worklog

plan: plan-prototype.md investigation — survey spread
changed: investigate.js — survey is a plain 2.5 h pass, survey-only 3× effort dropped (tuning)
changed: plan-prototype.md — survey numbers and its core/ring behaviour (tuning)
changed: experiments/survey_spread.js — real-path press, band means, pass/fail checks (experiment)
changed: findings-pitfalls-skills.md — saturation hides the falloff (note)
validation: node --check investigate.js pass; survey_spread 7/7 on 4 terrains — meadow bands 0.92/0.78/0.58/0.20/0.02, cells at 1.0 17→6, marked cells 28→24, second press blocked; smoke 13/13 unchanged; dom_smoke 22/22 unchanged
decisions: 2 h × 3× effort (6 player-hours) recorded every meadow and hill cell within ~2.3 cells in one press, so the survey path never showed the falloff it shares with the standing sweep; 2.5 h completes the readable core and leaves the ring partial.
decisions: hours and effort only ever multiplied, so the survey-only multiplier is gone — one number to tune, and a press is now exactly 2.5 h of standing still.
decisions: cooldown stays 6 h. The press no longer completes fresh outer cells, so it is not the pacing limiter; the limiter is standing time again.
decisions: hover preview on the view switch stays as shipped — the visual pass showed no accidental switch, so the one-line removal was not needed.
pitfalls: forest and desert surveys stay marked-only (core 0.63 and 0.44) because those terrain rates are low. That is terrain character, not a defect; raising hours to "fix" it restores the plate. Full note in findings.
next: playtest whether a marked-only survey in forest and desert reads as weak or as terrain character; then rival pressure and victory margins.
