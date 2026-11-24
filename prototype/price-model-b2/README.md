# Fluxfield · Price Model B2 (carried worker money)

Open `index.html` directly in a browser. The simulation and controls are local; no install, server or build is required.

Files: `simulation.js` (fields, diffusion, cost-basis transport and proportional worker-gold advection), `actors.js` (universal firm/town pricing, gold-tax appeal and paid worker rest), `gold.js` (conserved vaults, resident purses, worker wallets and payment streams), `workforce.js` (engine-neutral worker policy: wallet-weighted home appeal, shelter and still-worker rest), `settlement.js` (forest, settlement tiers and hamlet founding), `fields.js` (dual map renderer), `telemetry.js` (sparklines and ledgers) and `app.js` (UI).

Run the model tests from this directory with `node --test`. Design & worklogs: `archive/06-worker-money-b2-plan.md`, `archive/07-worker-pools-b2-plan.md`, `archive/08-workforce-settlements-b2-worklog.md`.

`workforce.js` and `settlement.js` read only shared fields (`priceHome`, `priceRest`, `still`, wallets) so a particle engine can reuse them unchanged; see `draft/particle_transfer_model.md`.
