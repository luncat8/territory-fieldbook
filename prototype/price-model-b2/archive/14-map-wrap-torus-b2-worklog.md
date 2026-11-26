# 14 Map Wrap Torus B2 Worklog
changed:
- `simulation.js` (fix + feature): `MAP_WRAP` topology flag (default on) with `setMapWrap()` rebuilding the shared `NEIGHBORS` table and `wrapCell()` resolving raw coordinates for all other files; wrapped neighbours give every cell all 8 directions.
- `land.js`/`workforce.js`/`settlement.js`/`farms.js`/`harvest.js` (fix): every clamped box scan, ring spill and random patch pick now resolves through `wrapCell`, so cones, plots, founding, evictions, forage and ring waste follow the live topology; bounded mode returns the exact old cell sets.
- `index.html`/`app.js`/`styles.css` (feature): "Map edges" option — Wrap · torus (default) vs Bounded — swaps topology live, re-stamps land, and the grid badge shows `wrap`/`bounded`; field-guide note added.
- `simulation.test.js` (+4, 2 repinned), `farms.test.js` (UI smoke drives the new buttons).
validation:
- L0 `node --check` per batch; full suite 70/70 (was 67).
- New torus tests: corner keeps 8 neighbours (bounded 3 + sentinel); a corner price peak decays exactly like an interior peak (ratio 1.000 after 3 s; bounded ratio 3.68, pinned `> 3`); a rim town's bid and dropped stock cross the seam (0.8 goods at (47,14) → 0.0008 left, town eats 0.33); live wrap→bounded→wrap keeps every ledger.
- Corner-trap detector (price argmax at an empty bottom-left cell > 0.3, default map, 600 s): 0 events wrapped vs 60 bounded.
decisions and why:
- Torus default instead of fade-to-borders: fading bids near edges mints zero-price rims where firms spawn and thrive for free; wrapping keeps every cell translation-equal, which is the robust fix for the corner trap.
- The bug itself: bounded `diffuse()` is a Neumann boundary — corner cells lose 5 of 8 laplacian terms, so remnant peaks decay ~3.7× slower there; after a bidder collapses (stock suppression, wait-pool crowding) the argmax slides into the corner and stock climbs the dead gradient into it.
- Two tests pinned to bounded: `distant mine` uses `decay = false`, where a torus flattens the price field from both sides and kills gradient steering ~2× sooner (its 60 s throughput is a hard-edge transient); `mined gold inflates` snapshots a near/far gap calibrated on hard-edge distances (torus dilutes the near peak to 3.88 < START_PRICE 4 at t = 140).
pitfalls:
- `decay = false` is degenerate for gradient steering on any topology (steady state of pinned-cell diffusion is a uniform field); on a torus the degeneracy arrives twice as fast because signals wrap both ways. Keep decay on for long bounded-free runs.
- `setMapWrap` is process-global and tests share it: every pinned test must restore `true` before asserting, or later tests silently run bounded.
next step suggestion:
- Port the topology switch into `map-money-gold.js` / particle-transfer-b2 (plan-particle-transfer.md lifts these rules), and consider a seam indicator on the field renderer so the wrapped rims read as connected.
