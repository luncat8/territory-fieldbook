# balance playtest worklog

plan: plan-prototype.md — survey spread, rival pressure, victory margins
changed: victory.js — guard re-declaration when already won (feature)
changed: rivals.js — rivals stop competing after a valid declaration (feature)
changed: hud.js — declare button disables and relabels once won; victory.result in action key (feature)
changed: plan-prototype.md — victory after-declaration behaviour (design)
changed: (analysis) survey spread, rival pressure, victory margins left as shipped for early prototype
validation: survey_spread 7/7 on 4 terrains (meadow 0.92/0.78/0.58/0.20/0.02; forest core 0.63 marked-only; desert core 0.44 marked-only); multi-seed 15 seeds (rival claims 0-2, player share 0.016-0.032, victory fails 1-2, party survives); smoke 13/13; dom_smoke 22/22
decisions: survey marked-only in forest and desert accepted as terrain character — raising hours to "fix" it restores the plate (findings).
decisions: rival pressure left as shipped (home region 18, work share 0.7, scout 0.25/h); multi-seed shows rivals and player on comparable footing over ~37h, so no tuning at prototype stage.
decisions: victory margins left as shipped (territory lead strict largest + >=5%, stock floor 25%, disturbance open outside player control, oxygen balance); no minimum declaration margin added; open question stays open.
pitfalls: none new; balance numbers are early-prototype and intentionally un-tuned.
next: extend one draft topic at a time from plan open questions; remaining: declaration margin (strict largest vs minimum margin), recovery rates, then a deferred system (access/contracts/reputation or buildings).
