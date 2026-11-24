# Worklog: particle transfer — phase 1 (goods particles)

plan: plan-particle-transfer.md — phase 1, coal → goods chain on goods particles
changed: prototype/price-model-b2/settlement.js — buildFromForest idle clamped by 1 − depleted, foundTown zeroes intent (fix)
changed: plan-particle-transfer.md — stationary consignment holds, cold-start arrival trade credit (feature)
changed: prototype/particle-transfer/ — lab lifted from B2 (workforce, land, settlement, styles); particles.js goods SoA pool, simulation.js, actors.js, gold.js, fields.js, telemetry.js, app.js, index.html (feature)
validation: node --check all; node --test 15/15 lab (mass and gold < 1e-12, reference chain mine/factory/town profitable); B2 51/51
decisions: SPAWN_UNIT 0.08 with 2.5 s idle flush; TERRAIN_SPEED [1, 0.85, 0.55] harmonic-mean conductance, haul cost ∝ 1 / conductance
decisions: arrival pays Transport Company vault first, owner second; cold-start shortfall becomes SoA trade payables, so no firm seed gold
decisions: workers still moved as B2 cell fields (laborFlow/depletedFlow) — phase 2 swaps them
pitfalls: none recorded
next: phase 2 worker particles
