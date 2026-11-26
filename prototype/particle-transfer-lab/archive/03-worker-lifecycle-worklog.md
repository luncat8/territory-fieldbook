# Worklog: persistent worker lifecycle
plan: plan-particle-transfer.md — worker cycle, pools and living tax
changed: workers.js, worker-lifecycle.js — fixed worker amount plus tired portion; work/rest callbacks, conservative walking/docking, idle recovery and resource-aware firm founding (fix/feature).
changed: actors.js, workforce.js, settlement.js — apply work/rest to persistent objects; fee only for service received; shelter floor for slow/poor workers; explicit founding remains the only resident conversion (fix).
changed: gold.js, simulation.js — personal wage credits and FIFO employer/worker-ID wage claims; repayment follows the original worker (fix).
changed: track.js, tracked.js — no ledger entries for savings backing transfers; suppress rounded-zero event spam; display unpaid wages instead of shift escrow (fix).
changed: index.html, test loaders — load worker-lifecycle.js before workers.js (move/wiring).
validation: lab node --test: 34/34 pass; syntax checks and git diff --check pass; root smoke_failures=0 and dom_smoke_failures=0.
validation: controlled worker grants 50, receives a 5-unit prepaid contract, waits untaxed for room, pays 6 for actual recovery, retains 49 and returns for the next job with the same ID/amount.
validation: default 50-gold worker remains active through repeated shifts over 90 simulated seconds; personal ledger checked each tick; mass and gold conservation retained, including 180-second actor-removal scenario.
decisions: existing prepaid-shift pricing retained; employer cash shortfalls stay unpaid claims, not invented cash. No production/tax/wage tuning constants changed.
decisions: aggregate tests now check profitable operation during the run, actual deliveries and population ordering rather than requiring a fixed endpoint profit/growth or exactly three actors despite autonomous founding.
pitfalls: repeated per-walker additions of tiny recovered amounts drift global mass totals; batch those counters once per tick (findings-pitfalls-skills.md).
next: browser playtest the watched-worker 50-gold cycle and full-town wait-pool feedback using the plan's manual checklist.
