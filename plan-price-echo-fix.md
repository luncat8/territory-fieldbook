# Plan: price-echo root-cause fix (replace the lift-only band-aid)

## Status
- **Lift-only band-aid is KEPT for now** in both engines, per decision. Build is green (prototype `node --test` → 26/26).
  - Prototype: `stepBid` (`prototype/particle-transfer-b2/simulation.js`) and the parallel clamp in `forage.js:208`.
  - Main game: `goldStepBid` (`map-money-gold.js:320-323`).
- This plan defines the **principled replacement**. The band-aid is removed only after the fix passes the regression set below.

## Root cause
The lift-only (`Math.max(relaxed, ambient)` / `ambient > here && ambient > relaxed ? ambient : relaxed`) is a **result clamp**: a cell's relaxed price may not fall below the diffused ambient. It exists because of the **falling-bid halo drain**:

- Bids are a steep, near-instantaneous function of *discrete need*. One harvest batch refills a store in a single tick (food need `0.96 → 0.20`, bid `2.99 → 0.61` in < 2 s; goods `3.0 → 0.86` in 3 s).
- `stepBid` relaxes the cell toward that cliff at `NEED_RESPONSE`. Because diffusion is slow (decay length ≈ 13 cells), the cell's neighborhood keeps a stale high plateau and the gradient points *away* from the buyer, so stock walks off and strands at the edge.
- **On a torus the reflecting-edge echo is muted, but the interior halo drain still happens.** This is proven empirically: removing the clamp in the prototype dropped the suite from 26/26 to 19/26 (7 failures). So this is **not only a hard-border artifact** — it is load-bearing for interior price dynamics. That is why a blind removal is rejected.

## Why the naive smoothing failed before
Toggle c (low-pass the bid) was attempted in `price-model-b2` and reverted: smoothing the bid kept the town paying *above* its raw need, draining the resident purse and dropping the gold-mine goods-price regression below `START_PRICE`. Root issue: the smoothed bid was applied to **both** field steering **and** seller payment.

## Principled fix candidates (clamp the signal, not the result)
1. **Split steering bid from payment bid (preferred).** Field relaxation uses a smoothed / rate-limited bid; seller payment uses the instantaneous raw-need bid. This is the toggle-c idea *minus* the purse drain. Most promising.
2. **Rate-limit the bid delta.** Cap `|Δbid|/s` so the field never chases a cliff faster than diffusion can follow. Signal-side fix, zero purse impact.
3. **Rate-limit need itself.** Let need ramp continuously (~2 s) after a refill instead of snapping, removing the cliff at the source.
4. *(Edge-only, informational)* absorbing edge / `PRICE_DECAY` tuning — relevant only when hard borders return; moot under the current wrap-XY default.

## Acceptance
- Remove the lift-only clamp in `stepBid` (prototype) **and** `goldStepBid` (main game); the 7 previously-broken tests pass **without** it.
- No purse drain: resident-gold / gold-mine goods-price regression stays `≥ START_PRICE`.
- Torus default stays clean; when hard borders are re-enabled later, re-check edge echo using the signal fix **alone** (no result clamp).

## Affected regression tests (prototype, currently protected by the clamp)
1. `reference chain sustains particle throughput and conserves mass, people, tired and gold`
2. `the canonical tick sustains a paid farm-to-bazaar chain with exact food and gold ledgers`
3. `hungry workers survive unsupplied towns by self-foraging and return to work`
4. `clearing towns causes tired workers to gather, found a young town and build tier without minting gold`
5. `idle fresh workers found and complete a sweat-equity coal mine on a coal deposit without minting gold`
6. `watched worker completes work-rest-eat cycle and logs typed events without allocations`
7. `firm prepays shift wage at entry and erasing firm mid-shift conserves gold and evicts worker cleanly`

## Main-game gold lift-only
`map-money-gold.js: goldStepBid` carries the **identical** band-aid (`ambient > here && ambient > relaxed ? ambient : relaxed`) for the gold `priceCoal` / `priceGoods` / `priceLabor` fields. Same root cause (gold goods/labor bids cliff on need drops). Apply the **same chosen signal-side fix** here once it is validated on the prototype. Track separately: it is a different, established engine with its own regression (gold-mine goods price), so validate its ledgers independently.

## Steps
1. Implement the preferred candidate (split steering vs payment bid) in prototype `simulation.js` `stepBid` and `forage.js`.
2. Remove the lift-only clamp; run `node --test` (target 26/26) + a price probe confirming no echo + the resident-gold regression check.
3. Port the same fix to `map-money-gold.js goldStepBid`; validate main-game gold ledgers/regressions.
4. Only after both are green: delete the "artificial limit" clamp and its comments; note in the draft that the rule was replaced by a signal-side fix.
