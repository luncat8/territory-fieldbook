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
