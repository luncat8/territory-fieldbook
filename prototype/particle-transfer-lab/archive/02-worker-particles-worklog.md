# Worklog: particle transfer — phase 2 (worker particles)

plan: plan-particle-transfer.md — phase 2, FRESH/DEPLETED walkers over docked pools
review: archive/01 worklog rewritten to the entry format (was a narrative); no code defects found in phase 1
changed: steering.js — shared conductance, gradient sampling and heading move lifted out of particles.js (move, identical 30 s fingerprint)
changed: steering.js — wallet-blended score, steepest-edge launch heading (feature)
changed: workers.js — worker SoA pool: persistent objects, gradient launch, still docking, room admission, entry wage, queue, founding absorption (feature)
changed: simulation.js — cell-field labor/depleted transport removed (−140 lines), tick calls workers.step, totalItem counts walkers (feature)
changed: actors.js queue in occupancy/wage, not the cap; gold.js total + wallets; settlement.js shared nextIntent, walker absorption (feature)
changed: fields.js, telemetry.js, app.js, index.html — walker dots by wallet, walking ledgers, guide entry; workers.test.js 6 tests (feature)
validation: node --test 21/21 (mass < 1e-11, gold < 1e-12); reference 60 s goods 0.00 → 0.06, eaten 17.46, pop 10.00 → 16.81
validation: conservation identities hold exactly — totalItem(LABOR) == suppliedLabor − workedLabor, totalItem(DEPLETED) == emittedDepleted − restedDepleted, money == seeded + mined
validation: 4-actor map tick_ms 0.732 → 0.362; 333 walkers live, 449 peak (plan band 200–800)
decisions: workers are persistent objects — a docked worker parks (not drawn) and keeps gold/intent, leaving only by the price/home gradient; a town never holds, flushes or rate-limits a worker stock, it only rests and taxes
decisions: docked stocks keep every B2 cell rule (rest, tax, shelter rest, pledges) unchanged; no gradient means the worker counts as unemployed — the still-worker signal for settlement founding
decisions: dock gate 0.1 · knee (the knee stranded commuters); WORKER_SPEED 12 = cell labor rate; WORKER_UNIT = one worker
pitfalls: removeAt copied dockCell after unlink cleared it, stranding recompacted docked workers as uncounted walkers and breaking totalItem(LABOR) == suppliedLabor − workedLabor — fixed by capturing the dock cell first; knee stranding, saddle-cancelled launch, queue self-lock, hidden partial-admission queue — notes in findings
next: no town-release rate-limit (workers move purely by gradient); phase 3 kinds/spoilage; founding reads the still-worker unemployment signal
