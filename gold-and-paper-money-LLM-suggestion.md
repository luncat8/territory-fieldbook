# Economy, owners and banks — LLM proposal

Human requirements: [draft/economy-money-bank.md](draft/economy-money-bank.md).
Confirmed design, gates and tests: [plan-gold-and-paper-money.md](plan-gold-and-paper-money.md).
This is an LLM proposal, not a second human draft or an approved implementation specification. The
resolution below records which proposals were kept, revised or rejected; the plan is the source of truth.

## Resolution of the proposed design

| Proposal | Resolution |
|----------|------------|
| One accounting kernel with independent policy presets; owner/facility/bank/currency separate | **Accepted.** Confirmed global design; see plan M.0. |
| Gold extraction is the only new-gold source; wages/inputs release it into circulation | **Accepted.** Confirmed; no placement minting, no gold cargo item. |
| Ownership O1 new owner per firm vs O2 shared purse and debt | **Revised.** Shared ownership is the confirmed default (O2). O1 is a comparison control only. |
| Funding F0 owner capital → F1 existing-gold bank loans → F2 foreign notes → F3 own credit notes | **Accepted, sequenced.** F0 → F1 → credit notes (F3/B). F2 later. |
| Paper issuance A fully backed notes / B credit notes / C town notes | **Revised.** Credit notes (B) are the only paper mechanism worth building. Fully backed notes (A) are a control showing substitution, not expansion; town notes (C) are a later alternative. |
| Output D0 speculative map / D1 internal depot / D2 reserved buyer-directed dispatch | **Revised.** D1 internal depot is the default; D0 is a comparison. D2 is **rejected** — the cell and particle transport engines do not support directed dispatch by design. |
| Bank policy fixed vs adaptive rates/quotes | **Accepted.** Fixed first, adaptive as a comparison axis. |
| Transport revenue redistribution vs retained company cash vs real service payouts | **Accepted as open.** T0/T1/T2 remain comparison axes. |

## LLM recommendations that were not adopted

- **Emit paper money from the same gold amount (fully backed notes).** Rejected as a game feature: it is a
  misconception of the real economy. If gold exists, pay with gold; credit money beyond gold is emitted only
  when someone accepts it for real goods. Fully backed notes are kept solely as a control.
- **Reserved buyer-directed dispatch.** Rejected: the cell and particle transport engines do not support it.

## Open forks still worth comparing (not undecided scope)

- Starting-gold amount per worker (0.5 / 1 / 2 g) against startup transients.
- Debt limit per firm: fixed cap vs value/collateral-based cap.
- Shared-owner cash allocation: bounded per-facility budgets vs fully pooled.
- Bankruptcy recovery: bank takeover and resale vs worker buyback.
- Transport revenue treatment: T0 redistribution / T1 retained / T2 real payouts.
- Credit-note acceptance: pre-consenting suppliers vs adaptive acceptance.

## Recommended global design

Use one accounting kernel with independent policy presets. Separate an **owner** (shared cash and debt),
a **facility** (location, inventory, production), a **bank** (lending and credit issuance) and a **currency**
(issuer and denomination). A bank can lend gold without paper enabled, or lend another issuer's notes
without printing its own. Faction control does not change monetary conservation.

Gold extraction is the only new-gold source. Mining credits the mine owner's account; wages and actual
input purchases release it into wider circulation. Subsequent debt repayment and productive reinvestment
move existing money, not new gold. New firms receive no automatic gold: they are founded by a worker from
the free workforce, or need committed owner capital / a bank loan that can actually be funded. Upgrades and
physical currency couriers remain deferred.

## First complete small loop

1. Scenario starting gold (1 g per worker) allocated to named owners and the bank; no placement minting.
2. Stable owner/facility IDs with shared cash and debt; worker-owner founding with no paid initiation.
3. Expose the existing output buffers as bounded depots; demand-gate transport, demand fields always live.
4. Extend the **existing** traded wood/sawmill chain to gold-mine construction/operation; forest → logs at
   the cut cell.
5. Finance one mine from an existing-capital gold bank; observe wages, wood deliveries and actual loan
   repayment.
6. Compare shared ownership and map/depot output independently, then add credit-note experiments and the
   bankruptcy path.

Inspection correction: wood is already traded in the particle lab, although the gold recipe is still
labor-only. Route-gated internal output buffers also already exist. Extend these owners rather than add
parallel systems. The earlier review in `archive/20261127-gold-review.md` is historical evidence, not the
current feature inventory.

Plan first; no runtime rules are changed by these recommendations.
