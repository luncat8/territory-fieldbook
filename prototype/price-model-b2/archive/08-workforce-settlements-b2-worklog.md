# 08 Workforce & Settlements B2 Worklog
source: `draft/particle_transfer_model.md` (general parts: worker movement, pareto home choice, wage at pool entry, penniless settlements).
changed:
- `workforce.js` (new) — engine-neutral `WorkerPolicy`: wallet weight w = wallet/(wallet+2·refFee) mixes value (`priceHome`) and rest-quality (`priceRest`) fields; housing-scaled shelter; slow free rest for still workers.
- `settlement.js` (new) — forest field, tiers, hamlet founding from gathered still depleted workers beyond town reach (savings only, no minted gold), forest-felling build to tier 0.5, comfort growth above.
- `simulation.js` — scored transport with per-cell mix/alt field, `still` measure, town rest gated to the local best home, wage paid into the wallet on pool entry; `actors.js` tier hooks (rest/tax/bid/pop cap), `townGoalPop`; `gold.js` `payOnEntry`.
- `fields.js`, `app.js`, `index.html`, `README.md` — Tier/Home/Forest/Still readouts, hamlet label and count, guide copy; `settlement.test.js` (5 tests).
validation:
- L0 `node --check` all B2 files: pass, all ≤482 lines. L1/L2 `node --test`: 44/44; stub-DOM boot/run/view/clear smoke and tooltip render: pass.
- bench (default map, 120 s) unchanged within noise: goods 115.68/114.52, tax 435.6, wages 326.6, gold_err −6.7e−12. Distant-chain test eats 9.14 (HEAD 9.33). After Clear towns one hamlet founds at ~32 s, reaches tier 0.94 and restarts production.
decisions and why:
- Dropped "tire still fresh labor": queued fresh labor became depleted and paid rest again, draining resident purses and pushing town tax up (distant chain ate 1.75). Fresh labor waits; only depleted rests in place.
- Founding pop uses the migrant conversion (0.2/LABOR_PER_POP) capped at the hamlet pop cap; scan every 5 s so a new hamlet's home field spreads before the next scan (1 s scans founded 8 hamlets).
next: particle engine reuses `WorkerPolicy`/`Settlements` per carrier; consider letting a hamlet with no residents dissolve.
