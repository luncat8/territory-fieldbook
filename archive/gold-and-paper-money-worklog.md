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


## G1 / O2 foundation / D1 · Gold-only ownership and adaptive quotes, 2026-11-27
- review: prior design correctly preserved worker IDs but runtime still minted on town placement and keyed debtor/payee identity by reusable cells.
- changed: particle `owners.js`, `gold.js`, `simulation.js` — stable owner/facility accounts, shared budgets/wage debt, scenario capital (default 1 g/worker), durable claims/estates; no placement grants or on-site bonuses.
- changed: `actors.js`, `towns.js`, `workforce.js`, `steering.js` — live-wallet quotes without nominal floors, cash-bounded joint bids, employer-quote wages, relative gradients; no starting-gold price peg.
- changed: `goods.js`, `farms.js`, `founding.js`, `workers.js`, `settlement.js` — durable cargo payees, relative haul/write-down costs, demand-gated depots, cut-site logs, worker proprietors and full initial food.
- changed: lab controls/diagnostics — reset gold/worker input, shared/retired account totals, owner/facility IDs and copyable allocation/debt rows.
- changed: `owners-economy.test.js` and existing fixtures — 16 new funding/identity/budget/price-scale/depot tests; fixtures explicitly capitalize sites instead of relying on placement grants.
- decisions: initial capital is half worker wallets, half starting owner/town accounts; facility-only sales retain seller cash/debts/contracts; absent proprietors retain estates. O2 loans/debt limits and T1 custody remain unimplemented.
- validation: all lab JS syntax checks; full particle suite 59/59; preview redirect plus 25 local script/style resources HTTP 200; `git diff --check` clean. Visual browser playtest remains manual.
- evidence: 90 s default run: 24 g initial, coal 17.005, goods 6.325, consumed 6.066; gold error < 2e-12. 0.001 g/worker circulates wages/taxes/deliveries; tiny-settlement tests cover down to 1e-6 g.
- pitfalls: competing wage signals are not executable employer quotes; price-scale independence also requires relative transport costs/steering (findings).
- next: finish G2/B0 (mine wood bootstrap, real-gold bank loans, debt caps/service/default), separate T1 transport/custody; paper remains deferred, then port only at the M.7 gate.


## G2 / B0 / T1 · Mine timber, gold bank, transport-custody split, 2026-11-27
- changed: particle `actors.js`, `gold.js`, `simulation.js` — gold recipe consumes `WOOD 0.05`/batch after a one-time `GOLD_TIMBER` reserve; inputs ledger, wood-outage pause and restart.
- changed: particle `banks.js` (new) + `owners.js` — charter funding transfer, fixed-rate loans with owner debt limits, interest/principal service, grace defaults; lending never mints.
- changed: `gold.js` — transport/custody/bank as separate accounts, selectable T0 drip / T1 retained rule; custody never drips; invariant sums all accounts plus bank terms.
- changed: `goods.js`, `worker-life.js`, `founding.js` — wood admitted to gold buyers with input payments recorded; dead-worker wallets move to custody.
- changed: lab controls/diagnostics — bank capital/Fund/Borrow, transport preset, bank panel rows, stall flags (loan arrears, gold mine out of timber).
- changed: `bootstrap-bank.test.js` (new, 8 tests) plus fixtures — reserve granted once, outage/restock, delivery purchase, debt caps/refusals, repayment with exact interest, equity identity, T0/T1, banked scene.
- decisions: wood rides the existing sawmill/`ITEM_WOOD` chain; labor stays the last recipe input so entry-wage accounting holds; debt service runs after owner wages and before the T0 drip.
- validation: all lab JS syntax checks; full particle suite 67/67; banked 120 s scene: interest 0.480 exact, conservation <1e-11, inputs 2.46 g; zero-start wages pay from the recorded reserve only.
- evidence: zero-start mine wood 1.5→0 at t≈60 with inputs 0 — no wood supplier is capitalized there (sawmill needs owner cash or a bank loan); diagnosed via the timber-out flag, not subsidized.
- pitfalls: labor must stay last in the recipe (`bidOut[0]` would bid wood as the wage); `near()`'s epsilon must be numeric; real-asset sink counters live on the model, not in `money.reset` (findings).
- next: paper money (P0–P1) or port — only at the M.7 end-to-end gate; by hand, Fund the bank from the mine owner then Borrow to a sawmill to exercise the zero-start wood loop.
