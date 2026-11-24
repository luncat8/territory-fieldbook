# Worklog: Particle Transfer Phase 1 (Goods Particles)

- Reviewed previous task (`prototype/price-model-b2/settlement.js`): clamped `buildFromForest` `idle` by `1 - depleted[i]` to prevent transient cell overflow and zeroed `depletedFlow.intent[n]` in `foundTown`.
- Cleaned standalone `plan-particle-transfer.md` phrasing and documented stationary consignment holds and cold-start arrival trade credit.
- Built `prototype/particle-transfer/` reusing B2 `workforce.js`, `land.js`, `settlement.js` and `styles.css`, replacing cell-field Coal and Goods transport with SoA `GoodsParticles` (`particles.js`) over diffused buyer bids (`simulation.js`, `actors.js`).
- Added cell spawn accumulators (`SPAWN_UNIT = 0.08`, idle flush) gated on cost-basis `selfPrice`, harmonic-mean terrain conductance steering (`TERRAIN_SPEED = [1, 0.85, 0.55]`), `1 / conductance` haulage accrual, and symmetric buyer room admission.
- Implemented conserved `GoldMoney` (`gold.js`) with `transportVault` + household carrier drip and fixed-capacity SoA trade payables so arrivals split `buyerPay` between carrier fees and producing `owner`, realizing exact `amount * (buyerPrice - item.price)` profit.
- Added underwater re-steering, dock-center stationary consignment holds for non-perishables, and perishable spoilage + spot-sale accounting, plus zero-allocation dual-canvas particle rendering (`fields.js`), particle-aware ledgers (`telemetry.js`), `app.js`, `index.html` and `README.md`.
- Verified: `node --check` passes on all `.js` files; `node --test` passes `15/15` in `prototype/particle-transfer` (mass and gold conserved to `< 1e-12`, reference chain Mine/Factory/Town profitable) and `51/51` in `prototype/price-model-b2`.
