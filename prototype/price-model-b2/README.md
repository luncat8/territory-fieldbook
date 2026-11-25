# Fluxfield · Price Model B2 (carried worker money)

Open `index.html` directly in a browser. The simulation and controls are local; no install, server or build is required.

Files: `simulation.js` (fields, diffusion, cost-basis transport and proportional worker-gold advection), `actors.js` (universal firm pricing, fresh-worker pools, firm scale), `towns.js` (wait pools, living tax, paid rest and the three town wealth-class strategies), `gold.js` (conserved vaults, resident purses, worker wallets and payment streams), `workforce.js` (wallet-weighted home appeal, shelter and still-worker rest), `land.js` (terrain build ladder, water, wasteland, consumption litter/CO2, claims and site quality), `settlement.js` (forest, settle intent, young-town founding and tiers), `harvest.js` (towns as harvesters: wild food and wood, food/wood needs), `fields.js` (dual map renderer), `telemetry.js` (sparklines and ledgers) and `app.js` (UI).

Run the model tests from this directory with `node --test`. Design & worklogs: `archive/06-worker-money-b2-plan.md`, `archive/07-worker-pools-b2-plan.md`, `archive/08-workforce-settlements-b2-worklog.md`, `archive/09-town-wealth-class-b2-worklog.md`, `archive/10-land-town-spawn-b2-worklog.md`, `archive/11-land-harvest-b2-worklog.md`.

`workforce.js` and `land.js` read only shared fields (`priceHome`, `priceRest`, wallets, terrain, actors) so a particle engine can reuse them per carrier; see `draft/particle_transfer_model.md`.
