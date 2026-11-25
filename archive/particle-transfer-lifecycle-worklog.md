### particle-transfer resident lifecycle

plan id: plan-particle-transfer.md (§2 residents-as-measure, worker-owned lifecycle, pure gather)

changed: workers.js — worker SoA lifecycle: hunger/starve (purse orphan), savings-paced births, town relocate, absorb; workforce.js, track.js support.
changed: actors.js — popCap basis (housing + jobs); settlement.js — founding is pure gather (no POP_BASE); gold.js — household tax.
changed: diagnostics/fields/economy-panel relabels to lifecycle terms; particles/simulation/workers tests rebuilt around starve/births/relocate/absorb.
validation: node --test 37/37; conservation drift ~1e-13 over 60 s probes.
decisions: residents are a measure, not agents; births split only on comfort ≥ 0.7 and purse-per-person ≥ starter; starvation books mass and orphans the purse, never deports.
pitfalls: dock-list cycle on starve (unlink before removeAt); FOOD_TRIP_HUNGER 30 vs STARVE_SECONDS 60; conservation trap in starve() host-pool release.
next step: port this lifecycle to map-money-gold.js per plan-particle-transfer.md step 2.
