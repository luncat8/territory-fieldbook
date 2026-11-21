# sawmill chain worklog (plan-map-economy)

plan: plan-map-economy.md — sawmill/log-works bootstrap, victory stability deferred
changed: map-factory-scan.js — kind selection: a standing mill unlocks the region's first log works below the reserve (feature)
changed: plan-map-economy.md — §5 bootstrap exception, §6 chain gate bullet, Phase 5 victory stability moved to the Scope deferred list (design)
changed: experiments/mape_factory.js — `survey_starts_wood_chain` gate (feature)
validation: `node --check` both .js; full suite 16/16 (as baseline); seeded-survey diagnostic 600 s: sawmill planned t=5 s, charcoal works t=10 s, cut starts, logs 0→17.1, satCoal 0.000→0.013 (before: logs 0, satCoal 0, flat all run)
decisions: circular deadlock — cut is demand-gated (`MAPE_SAWMILL_MIN_PULL`), demand only from charcoal/wood works, reserve rule sited only mills while logs < 8 ⇒ chain could never start; the mill itself did spawn (3 in first 15 s), what never spawned was the downstream economy
decisions: victory stability deferred as unimportant at this dev stage; no test covers it, so nothing needed suspending
pitfalls: centroid snap box ±2 with spacing 4 lets one near-center plant block every further site in the region — plateau at 3 factories (full note in findings)
next: anchor fallback when the best region has no legal cell (industry spreads beyond the first cluster), then Phase 5 remainder (HUD `sites`, +10% influence)
