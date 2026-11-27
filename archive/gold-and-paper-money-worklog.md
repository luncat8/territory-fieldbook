# Gold and paper money — design evidence

## M.0–M.9 · Proposed design, 2026-11-27
- changed: `draft/gold-and-paper-money.md` — design brief, separated proposals and five approval questions.
- changed: `plan-gold-and-paper-money.md` — inspected baseline, gold/transport rules, three monetary models, gates and comparison tests.
- changed: `plan-particle-transfer.md` — proposed monetary-extension cross-reference; runtime baseline unchanged.
- review: prior wage-claim remediation preserves stable-worker FIFO ownership; carry that invariant into mine/credit design.
- evidence: both labs credit gold directly via `money.dig`; particle town placement seeds gold; haul fees/custody share a town-dripped vault.
- evidence: particle wood is local farm stock, not a traded resource; neither lab app/model provides save/load persistence.
- decisions: backed notes are a control, credit notes test liquidity expansion, public notes test tax/service demand; no automatic universal acceptance.
- validation: local Markdown targets and baseline code paths reviewed; `git diff --check`; no runtime changes or simulation reruns.
- next: confirm source-draft choices, then implement G1/G2 in the particle lab before banking.


## M.1a/M.1b/M.4/M.7–M.9 · Ownership, funding and depot design, 2026-11-27
- changed: `plan-gold-and-paper-money.md` — owner/facility identities, shared budgets, gold lending, debt/rate policy, depot alternatives and comparison gates.
- changed: `gold-and-paper-money-LLM-suggestion.md` — concise alternatives and open decisions; identifies human draft rather than impersonating it.
- changed: `plan-particle-transfer.md` — corrected source link and proposed owner/depot/bank boundaries; runtime baseline unchanged.
- review: previous plan linked a nonexistent human draft and missed the now-traded wood/sawmill chain; corrected active documents, preserved historical review.
- evidence: particle `actors.js` gold recipe is labor-only; `goods.js` trades wood and retains route-gated output; money/cargo ownership remains cell-indexed.
- decisions: one owner registry supports isolated/shared purses; gold lending precedes note issuance; existing output buffers are the depot control.
- decisions: compare ownership, inventory, funding and issuer policy independently; defer currency couriers, upgrades and site negotiations.
- validation: local Markdown targets and referenced code paths reviewed; `git diff --check` passed; documentation only, no simulation reruns.
- next: confirm historical starting gold, shared-owner recourse, depot/log exception and paper/save scope, then implement one mine–wood–gold-loan loop.

## M.0–M.9 · Confirmed decisions from human answers, 2026-11-27
- changed: `plan-gold-and-paper-money.md` — status to confirmed design; starting gold = 1 g/worker scenario amount; shared owners default; internal depot + demand-gated transport; D2 removed; credit notes primary, backed notes control; debt limit, bankruptcy and bank takeover; worker-owner founding; first end-to-end scenario.
- changed: `gold-and-paper-money-LLM-suggestion.md` — resolution table of accepted/revised/rejected proposals.
- changed: `plan-particle-transfer.md` — monetary extension and firm-founding sections updated to confirmed shared-owner, credit-note and worker-owner rules; runtime baseline unchanged.
- decisions: fully backed one-for-one banknotes rejected as a game feature (substitution, not expansion); credit notes are the only paper mechanism.
- decisions: no reserved buyer-directed dispatch — cell and particle transport engines cannot support it by design.
- decisions: price/demand fields always emitted and faded; item transport skipped only when there is no demand gradient.
- decisions: forest-cut logs placed at the cut cell; food-in-depot deferred to a later comparison.
- evidence: human answers recorded in `draft/economy-money-bank.md` (answers section), source of the decisions above.
- validation: documentation-only change; `git diff --check` on touched Markdown; no runtime changes or simulation reruns.
- next: implement G1/O2/D1 + G2/B0 in the particle lab — the gold-site, forest-sawmill, bank-loan first scenario.

## M.1/M.10 · Starting food and prototype-to-game boundary, 2026-11-27
- changed: `plan-gold-and-paper-money.md` — workers start with full food in the particle engine (real-asset grant, not gold); added M.10 prototype-to-game boundary and end-of-prototype gate.
- decisions: workers begin with a full `food` bag so the opening transient is not a starvation cycle; funding the bag is a scenario real-asset grant, not money.
- decisions: the particle lab is a rules lab, not a second game. Build in it only what tests a monetary rule; transport staffing, science and other gameplay features build straight in the game.
- decisions: prototype ends at the M.7 end-to-end gate (G1+O2+D1+G2+B0/P1); then port the kernel to `map-money-particle.js`, flip the default, archive the lab.
- validation: documentation-only change; `git diff --check` on touched Markdown; no runtime changes or simulation reruns.
- next: run the money prototype to the M.7 gate, then port the kernel to the game.

## G1/O2/D1/G2/F1 · First money slice in the particle lab, 2026-11-27
- changed: `prototype/particle-transfer-b2/` — new `owners.js` (shared owners, facility ids, budgets, debt limit) and `banks.js` (F1 loans, interest, grace default, write-off); `gold.js` rewritten (origin ledger, scenario funding, owner waterfall, transport/custody); goods payee/origin particles; gold mine needs wood; logs placed at the cut cell; worker-owner founding incl. sawmills; diagnostics/tooltips/ledger UI.
- decisions: starting gold `1 g × workers` split bank 25 / owners 35 / towns 20 / wallets 20 %, recorded once; empty buckets fold into bank equity.
- decisions: bonuses only from earnings (no open loan, never below paid-in capital); extracting owners self-fund; claims stay owner debts after facility erase.
- decisions: D1 is the existing spawn gate — output waits in the depot until a demand gradient clears its floor.
- evidence: 180 s default run — mined 104 g, 0 starved, 1 loan cleared (reference sawmill, t≈98 s), 3 defaults (new founders' farm/mine/factory), coal 19 vs 62 legacy.
- evidence: start-gold knob 0.5/1/2/14 → coal 17/19/22/38, goods eaten 2/3/6/11; nominal constants are calibrated to the old money level.
- validation: `node --test` in the lab → 49/49 (L1); new `banks.test.js` covers loan repay, default, limits, portfolios, wood-gated gold and the M.7 scenario.
- next: scale nominal price constants with the scenario money level (or a price-level knob), then add credit notes (P1).

## Independent seed / adaptive nominal prices
- changed: `map-money-gold.js` — independent 1 g/population-proxy scenario seed; optional setup amount; horizon split preserved, target-price calibration removed.
- changed: `prototype/price-model-b2/gold.js`, `towns.js` — independent scenario amount; adaptive rest fee no longer has a permanent starting-tax floor.
- changed: cell regressions — historical throughput/billing fixtures explicitly retain 5.165384615384615 g/proxy unit; default low-gold circulation tested separately; extraction inflation uses a same-gold no-extraction control; crowd fee checks isolate crowding from changed resident wealth.
- changed: both money plans — preset prices are transient guards, not equilibrium targets; monetary-scale acceptance and zero-start/redenomination distinctions.
- validation: syntax checks pass; main seed/price/full-tick tests 4/4; new cell funding/circulation tests 2/2 (0.5/1/2 g, 30 s without extraction); cell existing tests 72/72 across scoped runs (42 + 2 revised, 27 + 1 revised).
- decisions: no starting-money → preset-price coupling. Main/cell allocation still uses their existing population proxy; particle scenario funding already uses actual headcount.
- pitfalls: decoupled seeding is not full scale invariance. Particle taxes/fee floors and nominal transport/affordability constants remain to audit; low-gold cell throughput differs from the historical fixture.
- next: remove persistent nominal anchors using current-budget/earning signals; compare normalized real throughput across gold amounts, including the particle lab, without raising scenario funding to mask stalls.

## Particle-transfer B2 · Arbitrary-scale invariance & flow stabilization, 2026-11-27
- changed: `prototype/particle-transfer-b2/{simulation,steering,gold,owners,banks,towns,workforce,settlement,goods,actors,farms,founding,workers,worker-life,fields,track,diagnostics}.js` — audited and replaced all `[g^1]` nominal floors/knees/epsilons, labor-relative haulage (`HAUL_LABOR`), town reserve rebates, sequential FIFO `admitKind`, barn-full farm throttling, `SNaN` sawmill tag, and adaptive field ramps.
- changed: `prototype/particle-transfer-b2/{gold-seeding.test,ui.test}.js`, `plan-particle-transfer.md`, `plan-gold-and-paper-money.md`, `findings-pitfalls-skills.md` — 12-decade closed-economy invariance, zero-gold, 1 g/worker open-economy health, and canvas `fillText` NaN tests.
- decisions: haulage, item gates, gradient knees/dock slopes, rest/ration fees, unpaid-claim caps and split thresholds derive from live prices/wallets/`unitScale()`; `admitKind` admits whole FIFO particles against live `cashAt` instead of proportional crumb shaving.
- evidence: closed-economy 35 s / 55 s runs at `goldPerWorker ∈ {1e-6, 0.5, 1, 2, 14, 1e6}` match to 15 digits across coal, goods, wood, food, labor, `wages/gpw` and `taxes/gpw`; default 1 g/worker 5201-tick & 7200-tick runs sustain all 4 chains, births = 4, defaults = 0, gold error `< 5e-12`.
- validation: `node --check prototype/particle-transfer-b2/*.js` and all 12 `*.test.js` suites (`52/52` subtests) pass with zero edits to existing test assertions.
- next: proceed to credit notes (P1) or port validated particle money kernel to `map-money-particle.js` per M.10.
