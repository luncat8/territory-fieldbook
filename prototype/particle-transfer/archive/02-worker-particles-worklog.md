# Worklog: particle transfer — phase 2 (worker particles)

plan: plan-particle-transfer.md — phase 2, FRESH/DEPLETED walkers over docked pools
review: archive/01 worklog rewritten to the entry format (was a narrative); no code defects found in phase 1
changed: steering.js — shared conductance, gradient sampling and heading move lifted out of particles.js (move, identical 30 s fingerprint)
changed: steering.js — wallet-blended score, steepest-edge launch heading (feature)
changed: workers.js — worker SoA pool: dock release, walking, still docking, room admission, entry wage, queue, founding absorption (feature)
changed: simulation.js — cell-field labor/depleted transport removed (−140 lines), tick calls workers.step, totalItem counts walkers (feature)
changed: actors.js queue in occupancy/wage, not the cap; gold.js total + wallets; settlement.js shared nextIntent, walker absorption (feature)
changed: fields.js, telemetry.js, app.js, index.html — walker dots by wallet, walking ledgers, guide entry; workers.test.js 6 tests (feature)
validation: node --test 21/21 (mass < 1e-11, gold < 1e-12); reference 60 s goods 19.26 → 17.47, eaten 18.23 → 16.46, pop 16.70 → 16.71
validation: 4-actor map tick_ms 0.732 → 0.362; 333 walkers live, 449 peak (plan band 200–800)
decisions: walkers exist only while moving; docked stocks keep every B2 cell rule (rest, tax, shelter rest, pledges) unchanged
decisions: dock gate 0.1 · knee (the knee stranded commuters); WORKER_SPEED 12 = cell labor rate; WORKER_UNIT = one worker
pitfalls: knee stranding, saddle-cancelled launch, queue self-lock, hidden partial-admission queue — notes in findings
next: rate-limit town dock release (bursty commute waves refill firm queues every ~10 s), then phase 3 kinds/spoilage
