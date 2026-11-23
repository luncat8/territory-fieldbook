## Recommendation: answer **option 2** — but sequence it so the main‑game bugs go first

I checked the claims against the code. Most hold, two need correcting before anyone implements them.

**Verified in the repo**

- `map-money-gold.js:46` — `const GOLD_NEIGHBORS = buildGoldNeighbors()` runs at load and is never rebuilt; it reads `world.terrain` before generation. Real defect.
- `map-money-gold.js` — no `collectTax` exists at all. Wages land in `mapeGold.workerPurse` (`:370`) and are never debited; `taxMult` is set to 1 in `mapeGoldFinishSetup` (`:194`) and never adapted. So the hoard grows forever, `mapeGoldTownTax` (`:232`) grows with it, and the town's `purse` drains to 0 through coal/goods bills. The reviewer's "taxes never collected" is correct and is the single highest-cost bug, because `gold` is the **default** engine (`map-economy.js:393`).
- `mapeGoldSyncActors` (`:207-222`) maps every factory kind to actor `2` with one hardcoded coal→goods recipe. So "port universal Model B into main game" is not a port — it's a rewrite of the money engine's actor layer plus a recipe table pulled from `map-industry.js`.
- `map-money-gold.js` is **557 lines**, already past the ~500-line defect limit in AGENTS.md. Adding universal actors there is a policy violation before it's a design question.
- `prototype/price-model-b/actors.js:99` — `townHomeBid` divides by `mult * mult` and multiplies by an `afford` term built from `workerPurse` (`:97`). Confirmed.
- `actors.js:256` — resting is gated on `m.profit[i] >= -0.03`. Confirmed.
- `experiments/mape_money.js:32` — `MAPE_MINT_POP` is undefined. Confirmed.

**Why not option 3 (full port now):** it collides with the 500-line rule, needs a recipe/actor model the main game doesn't have (sawmill, charcoal, wood, farms are four different production shapes), and it would replace the default engine before the design is validated in the prototype. The workstream in AGENTS.md is prototype-first for exactly this reason.

**Why not option 1 (skip):** the tax bug is on the default engine and makes towns starve while worker gold accumulates — that's player-visible today.

## Where the review is wrong, and what to change before coding

1. **Do not delete the `PAY_WAGE` stream.** The reviewer says wages should "replace the decoupled PAY_WAGE stream." `wage.ask` is the *labor demand signal* that diffuses as `priceLabor` and allocates workers; the coin stream is only settlement. If wages become a local gold transfer with no ask, a cash-poor firm bids for labor it can't pay and the labor market loses its price feedback. Keep `ask` as the offered price, pay it **locally** into the worker-gold field when `labor → depleted` at the firm's cell, and retire the coin stream only after that is proven.

2. **"Average wallet = gold[i] / workers[i]" is a density, not a wallet.** `actors.js:264-266` conjures `labor` from `pop` every tick without decrementing `pop` — workers are not conserved in model_b, so there is no individual to carry gold. Call it a worker-gold density field and don't promise per-capita purchasing power. The `flows[item].cost[i]` precedent (`actors.js:272-277`) is the right pattern and the reviewer's best catch.

3. **The rest fix is a replacement, not an addition.** Gating rest on `profit >= -0.03` *and* on worker gold keeps the same deadlock. Make rest cost `taxPerWorker * restedWork` paid from the worker-gold density, and drop the profit gate entirely — then town profit becomes an *output* of workers resting, not a precondition. Critically: **migration must stay free**. A broke depleted worker in a poor town who can neither rest nor leave is permanently stranded.

4. **`goldTax` must not be `workerPurse / WORKER_SEC`.** That's a cumulative hoard, so the feedback loop runs on history, not on the current wage. Base the living price on the local wage level / ration cost and keep `taxMult` as the town's policy lever. Also justify or drop `popRoom` — as written, a shrinking town gets a *higher* home bid and pulls workers into dying towns.

5. **Affordability should read the worker's gold, not the town's `workerPurse`.** The town purse is the treasury; using it in `townHomeBid` is exactly why a gold-rich town near a mine looks attractive for the wrong reason.

6. **Plan P as a new engine behind the existing switch**, not a rewrite of `map-diffusion.js`. The repo already has this shape (`mapeSetEngine` / `mapeEngineAvailable`, `moneyEngine: 'gold'`). Write `plan-price_model_p.md` as a decision doc that answers its own three open questions — I'd pick: `(amount, totalCost)` with transport cost as a reservation only (full `buyerPay` credited to `particle.owner`, ledger stays closed); owner payment as a coin particle with the *same* transport latency as goods; hold non-perishables on a price drop, spot-sell perishables, re-steer only if an uphill neighbour beats `totalCost`. Add the spoilage ledger identity and the `spawnBuf` idle-timeout flush — both are missing from the draft.

## What to actually select

**Option 2.** Inside it, three ordered steps, each its own plan/commit:

| # | Work | Validation |
|---|---|---|
| 2a | Main-game gold bugs: `collectTax` call + `taxMult` adaptation, rebuild `GOLD_NEIGHBORS` in setup, fix `mape_money.js`. ~3 independent <20-line diffs. | L1: `node experiments/mape_money.js`, `mape_money`, smoke |
| 2b | Prototype: worker-gold density co-moving with labor/depleted, paid rest replacing the profit gate, `priceHome = comfort * popRoom / goldTax`. | L1: `node prototype/price-model-b/simulation.test.js` (474 lines, already covers purses/tax at `:288`, `:347`, `:458`) |
| 2c | Refine `draft-price_model_p-*.md` into `plan-price_model_p.md` as a decision artifact. | review only |

2a is independent of 2b/2c and sits on the default engine, so it should land first. Option 2's wording already bundles the main-game fixes — just make sure they're committed separately, because they're the only part a player sees today.