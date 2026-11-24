# B2 — Town settlement & wealth-class worklog

Implements the revised `draft2.txt` §"Town settlement" and the two report items flagged by the
designer, on top of the carried-worker-money B2 model.

## Report items resolved

1. **"A town that wants to shrink offers less room, so it stops pulling in new workers."**
   Replaced by *keep full via tax*. `workforce.shelterAt` no longer scales room by a shrinking
   goal population; full housing still offers a rest floor and empty housing opens the door, while tax
   (crowd + class) does the crowding/repelling. Population is comfort/affordability-gated as before, but
   cheap/med towns **keep their built size** — they no longer shed residents merely because they are poor.
   They only shrink slowly when long-vacant (`vacantTicks > VACANT_SECONDS`) or broke.

2. **"Hamlet" as a separate object.**
   Kept as a **young-town flag** (`settlements.isYoungTown`) rather than a distinct actor type. It marks a
   settlement still in construction (tier below `WOOD_TIER_CAP`) that can gather resources itself — felling
   nearby forest — instead of buying them. Founding from gathered shelters still produces a `ECONOMY_TOWN`;
   only the construction/label differs. UI label changed from "Hamlet" to "Young town".

## New: town wealth class (draft "town wealth class")

Every town is assigned one of three strategies, deterministically per cell index (`wealthClassFor`,
seeded/reproducible — same variety as a random draw, identical across resets and tests):

- **Cheap** — when resident slots are vacant it drops living tax to attract workers (even if it cannot yet
  buy every resource); when the wait pool queues it holds a modest tax and lets size grow to absorb them.
- **Med** — balanced: buy resources to fit needs, then grow.
- **Rich** — keeps a cozy occupancy with a few free slots (queue ≈ 0, `RICH_OCC = 0.85`); raises tax
  without significant growth when the pool queues and cuts size first if it cannot meet resident needs.

Implemented in `actors.adaptTownTax` (class-aware tax targets) and `actors.townResidentTarget`
(class-aware occupancy + slow shrink guards). A free-space **comfort increment** (`SPACE_COMFORT`) is added
in `workforce.restComfort` so an uncrowded town rests workers better.

Deferred (per draft): upkeep cost and wearing depot items so a big near-empty town bleeds — not yet modelled.

## Files

`simulation.js` (wealthClass / vacantTicks state, `wealthClassFor`), `actors.js` (wealth constants,
`townResidentTarget`, `adaptTownTax` strategies), `workforce.js` (`restComfort`, reworked `shelterAt`),
`settlement.js` (young-town flag + founding assigns class), `fields.js`/`app.js`/`index.html` (Young town
label + wealth class readout), `README.md`. Tests: updated legacy "town shrinks by default" assertions to the
new behaviour and added cheap/rich class checks in `worker-money.test.js`.

## Tests

`node --test` — 46/46 pass. Gold/matter ledgers stay balanced.
