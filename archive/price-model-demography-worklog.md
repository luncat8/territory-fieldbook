### price-model b/b2 demography rework

plan id: plan-prototype.md price models; b2 demography is the design source for plan-particle-transfer.md.

changed: price-model-b actors.js/simulation.js — births gate (comfort ≥ 0.82 ∧ purse/pop ≥ START_TAX_PER_POP·WORKER_SECONDS), famine ≥ 30 s; suite 28/28.
changed: price-model-b2 actors.js/simulation.js/settlement.js — same demography; townWaitPool/townResidentTarget/VACANT_* removed; popCap housing-only; famine releases flow gold proportionally into workerPurse; founding pure gather.
changed: b2 tests recalibrated — town pool pins → poolTarget(town) === 0, occupancy pins → housing crowding, VACANT shedding → famine thinning, flowX midpoint → famine/pop asserts, wealth-capture pins → wages ≈ mined + wallet share.
validation: b2 node --test 51/51; b 28/28 and particle-transfer 37/37 stand; b2 settlement goldBalanced gap (1.842 vs 2.051) sealed by the births cap-clamp.
decisions: no formula shedding anywhere — a town shrinks only through its own famine clock; migration shows as settle/rest flows, never pop flux; occupancy pins are target/cap-based, never exact-stock (0.79 buffer pin).
pitfalls: bash cwd drift silently skipped &&-chained edits — grep-verify every scripted edit; mine-funded wages make town treasury-capture pins dishonest on two-cell maps.
next step: port b2 demography to map-money-gold.js (map-population.js/map-fluid.js already transfer-not-birth + famine-thin; audit clean).
