# Fluxfield · Particle Transfer Lab

> **Provenance:** imported as a new prototype from branch `d1981200cf3cd1511c93377fedc96238ebb66c3f`
> (`particle-transfer-b2` → renamed `particle-transfer`). Brought in *alongside* the current
> `prototype/particle-transfer-b2` because the two particle engines diverge architecturally
> (agent/field sim vs SoA particle physics + audit layer). See `plan-merge-d1981200.md`.

Open `index.html` directly in a browser. The simulation and controls are local; no install, server or build is required.

Run all conservation, particle-physics and economy tests from this directory:

	node --test

## Watched workers

Use the **Worker** map tool (or the *Watched workers* panel) to spawn a named worker and grant him gold.
The panel shows his purse, unpaid wages, dock, granted/earned/spent ledger and a purse-over-time chart;
the ledger check row stays `exact` while he walks, docks, works shifts and rests, so a funded worker is
auditable across towns and factories. Spawned workers count their granted gold and labor unit in the
conservation ledgers.
The first worker born after boot or reset is watched automatically; the *Why* row says what holds him.

## Economy inspector

Shows map-wide workers, gold, wages and prices. Red rows and flags mark where the chain stalls.
**Copy all stats** copies the full report, the watched workers, every actor and the 10-second history as plain text.
