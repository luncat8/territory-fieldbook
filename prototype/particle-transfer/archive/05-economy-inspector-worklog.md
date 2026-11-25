# Worklog: economy inspector, watched-from-start worker, copy-all-stats
plan: user request — inspect why coal prices climb and workers stop; no balance change
changed: diagnostics.js — snapshot (exact gold partition, worker states, wages, bid vs ask), stall flags, worker "why", 10 s history, copy text (feature)
changed: economy-panel.js, index.html, styles.css, app.js — inspector panel, Copy all stats button, pulse/copy icons, refreshPanels wiring (feature)
changed: track.js — watchFirst adopts the first worker after boot/reset; tracked.js — Why row from diagnostics (feature)
changed: diagnostics.test.js — gold/worker partitions, from-start ledger exact over 40 s, copy text sections (feature)
validation: node --test diagnostics.test.js 3/3; workers.test.js + render.test.js 18/18; jsdom boot of index.html: Aldo watched, 29 rows, copy 36 lines
validation: reference run t=600 s — workers 2048/2048, 1906 walking all stopped, 1810 queued at firms, wallets 99% of 51.65 g, coal ask 1.017 vs best bid 0.077 (haul 96%), ledger drift 1e-16
decisions: history is sampled from the tick hook every 10 s; buffer halves at 32 rows, same as the telemetry sparklines; snapshot runs only at 4 Hz UI refresh
decisions: flags reuse the engine's own bounds (WORKER_DOCK_SLOPE, the town rest work cap) so the text matches the rule that blocks
pitfalls: collapse chain recorded in findings ("reference-chain collapse after ~4 min")
next: give workers a sink (retire into town pop when docked at home with no job pull, or stop town supply while unemployed walkers exist), then re-check with the inspector
next: app.js syncActors runs only on town founding; firms founded by maybeFoundFirm skip the actor-count label and plot marker refresh
