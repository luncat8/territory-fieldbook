# Economy, owners and banks — design alternatives

Human requirements: [draft/economy-money-bank.md](draft/economy-money-bank.md).
Detailed design, gates and tests: [plan-gold-and-paper-money.md](plan-gold-and-paper-money.md).
This is an LLM proposal, not a second human draft or an approved implementation specification.

## Recommended global design

Use one accounting kernel with independent policy presets. Separate an **owner** (cash, debt, financing),
a **facility** (location, inventory, production), a **bank** (lending and possibly issuance), and a **currency**
(issuer and denomination). A bank can lend gold without paper enabled, or lend another issuer's notes
without printing its own. Faction control does not change monetary conservation.

Gold extraction is the only new-gold source. Mining credits the mine owner's account; wages and actual
input purchases release it into wider circulation. Subsequent debt repayment and productive reinvestment
move existing money, not new gold. New firms receive no automatic gold: they need committed owner capital
or a bank loan that can actually be funded. Upgrades and physical currency couriers remain deferred.

## Approaches to implement and compare

| Axis | Small control | Alternative | Main evidence |
|------|---------------|-------------|---------------|
| Ownership | O1: new owner per firm | O2: several facilities share one owner purse and debt | Financing new sites vs cross-subsidy/contagion; never duplicate spending power. |
| Funding | F0: existing owner capital | F1: existing bank gold; F2: existing foreign notes; F3: own credit notes | Startup reach, repayment, default, bank profit; no placement grants. |
| Paper issuance | A: fully backed notes | B: productive credit notes; C: town/faction service/tax notes | Reuse/redemption vs liquidity expansion vs public demand; voluntary acceptance is not automatic. |
| Unsold output | D1: bounded local depot, dispatch when a payable route exists | D0: speculative map particles; later D2: reserved buyer-directed dispatch | Availability, delivery latency, idle cargo, saturation and loss. |
| Bank policy | Fixed rate, maturity and executable quotes | Bounded adaptive rates, then adaptive gold quotes | Service demand, profit, defaults and volatility; old contracts unchanged. |
| Transport revenue | Explicit existing redistribution or retained company cash | Later payments for actual haul services | Liquidity concentration vs real recirculation. |

Do not change all axes together or implement every combination. Match seeds, total initial gold, real stocks,
actors and shocks; compare at the same simulation time. More notes or nominal revenue alone is not success.

## First complete small loop

1. Remove placement minting and record historical gold separately from extraction.
2. Add stable owner/facility IDs with one owner per firm first; preserve worker claims and cargo payees.
3. Expose the existing output buffers as bounded depots; add reachable/unreserved availability queries.
4. Extend the **existing** traded wood/sawmill chain to gold-mine construction/operation.
5. Finance one mine from an existing-capital gold bank; observe wages, wood deliveries and actual loan repayment.
6. Compare shared ownership and map/depot output independently, then add backed/credit note experiments.

Inspection correction: wood is already traded in the particle lab, although the gold recipe is still labor-only.
Route-gated internal output buffers also already exist. Extend these owners rather than add parallel systems.
The earlier review in `archive/20261127-gold-review.md` is historical evidence, not the current feature inventory.

## Decisions to confirm

- Allow historical mined gold in named starting bank/owner accounts, plus a separate strict zero-start scene?
  An empty gold bank cannot finance the first extraction without real founder work/materials.
- For shared owners, use one true shared purse and owner-level debt? Recommended: yes, with cash budgets
  reserved per facility; defer personal owner consumption/dividends and limited-liability subsidiaries.
- Use internal depots for ordinary factory output, while keeping forest-cut logs at the cut cell as described
  in `draft/company/all.md`? A global stock count alone cannot establish reachable construction supply.
- Allow credit notes with defaults/redemption risk? Fully backed notes are a useful control, not an automatic
  solution to insufficient gold. Test fixed bank policy before adaptive pricing.
- Save checkbox/settings first rather than full running-world snapshots? Keep remote monetary settlement
  for now, with physical currency transport by roads/straight lines explicitly deferred.

Plan first; no runtime rules are changed by these recommendations.
