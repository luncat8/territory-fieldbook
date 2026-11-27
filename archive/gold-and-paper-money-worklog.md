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
