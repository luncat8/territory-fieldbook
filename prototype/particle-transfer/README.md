# Fluxfield · Particle Transfer Lab

Open `index.html` directly in a browser. The simulation and controls are local; no install, server or build is required.

Run all conservation, particle-physics and economy tests from this directory:

	node --test

## Watched workers

Use the **Worker** map tool (or the *Watched workers* panel) to spawn a named worker and grant him gold.
The panel shows his purse, shift escrow, dock, granted/earned/spent ledger and a purse-over-time chart;
the ledger check row stays `exact` while he walks, docks, works shifts and rests, so a funded worker is
auditable across towns and factories. Spawned workers count their granted gold and labor unit in the
conservation ledgers.
