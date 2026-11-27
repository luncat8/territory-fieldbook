# Gold circulation and credit money — prototype plan

Status: confirmed design. The open choices in [draft/economy-money-bank.md](draft/economy-money-bank.md)
are answered and folded into this plan; the remaining forks are comparison axes, not undecided scope.
The gold-only baseline and slices G1/O2/D1/G2/B0/T1 are implemented in `prototype/particle-transfer-b2/`
(`banks.js`, `bootstrap-bank.test.js`); credit money (P0–P3) is not implemented.

## Global design

One monetary settlement kernel, with small orthogonal policy presets. Four identities stay separate:
**owner** (shared cash and debt), **facility** (location, inventory, production), **bank** (lending and
credit-note issuance), **currency** (issuer and denomination). Faction control never changes monetary
conservation. Production, geography and transport are frozen when comparing monetary rules.

Confirmed defaults:

- Gold is the only new-gold source; mining credits the mine owner. Wages and input purchases release
  gold into circulation; nothing else mints.
- All facilities owned by one owner share that owner's cash **and** debt. Owners are workers: any worker
  with money can buy or found a firm.
- Ordinary factory output is held in a bounded internal depot and transported only when a demand price
  gradient exists. Price/demand fields are always emitted and faded, regardless of whether items move.
- Paper money means **credit notes**, not gold-backed banknotes. If gold exists, pay with gold. Credit
  notes are emitted only when someone accepts them for real goods; they expand spendable claims, not gold.
- Saving the settings interface is enough for the prototype; full world save/load is later.

## M.0 Scope and design boundaries

Primary lab: `prototype/particle-transfer-b2/`. Secondary comparison substrate:
`prototype/price-model-b2/`. Stabilize the monetary rules in the particle lab before porting them to the
cell lab or the main game. Keep the transport substrate independent of issuer policy.

The gold-only economy must work without banks. Credit notes are optional and gated; they are the only
paper mechanism worth building, with fully backed notes kept as a control that shows substitution, not
expansion. Competing issuers and faction authority are independently selectable experiments, not one
mandatory system. All numerical policy settings below are initial experiment parameters, not immutable law.

This plan owns gold origin/distribution, facility ownership and funding, monetary transport accounting,
credit-note issuance, lending, note acceptance, exchange, saved monetary settings and comparison experiments.
It also defines the confirmed output-depot rule; physical production and goods movement remain with the
particle plan. Human requirements live in the source draft; the decisions recorded here come from it.
`plan-particle-transfer.md` owns worker life, production and movement; construction and wood requirements
also follow `draft/company/`.

### Inspection findings and implications

| Area | Current implementation | Design implication |
|------|------------------------|--------------------|
| Particle gold output | `actors.js`, `ActorOptimizer.stepFirm`: gold recipe has `outItem: -1`; calls `money.dig(i, made)` | Already no gold goods particle; preserve this distinction. |
| Cell gold output | `price-model-b2/actors.js` also calls `money.dig` | Same monetary principle applies to both labs. |
| Gold overlay | Particle `fields.js`, `fieldFor`: purses plus worker wallets; the other pane blends home/wage signals | This is holdings, not saleable gold. Keep it and label the second pane as a signal, not a gold price. |
| Initial money | Particle `gold.js` seeds town/firm purses and the scene's bank capital on reset; `workers.js` seeds wallets | Starting gold is a scenario parameter from a reasonable daily amount (1 g per worker), recorded once as initial owner/bank capital; placement must not mint. |
| Placement | Particle `simulation.js`, `setActor`: placing a town calls `seedTown` | Placement is an extra gold source today. Remove that source in the baseline; editing must not silently subsidize towns. |
| Ownership | `gold.js` uses cell-indexed purses; `goods.js` stores producer cell as `owner` | Introduce stable owner and facility identities; facilities owned by one owner share its cash and debt. A cell is not an economic owner. |
| Output storage | `goods.js` retains `spawnAmount`/`spawnCost` until a payable uphill route exists | This is the internal-depot control; demand-gate transport, keep demand fields always live. |
| Mining distribution | `GoldMoney.dig` credits mine purse; `settleFirm` pays wage claims and on-site surplus after reserves | Preserve claim ownership/FIFO, but specify the mine's payout budget and avoid indiscriminate on-site bonuses. |
| Mine recipe | `actors.js` gold recipe consumes labor + `WOOD 0.05` per batch; wood arrives via `goods.js` admission after a one-time `GOLD_TIMBER` reserve (G2) | Delivered wood gates extraction: outage pauses production and a restock restarts it; the reserve is recorded, never minted. |
| Wood infrastructure | Particle sawmill recipe produces `ITEM_WOOD`; `goods.js` transports it to towns/farms; `farms.js` owns forest cutting | Reuse the existing market; extend mine admission, input caps and consumption rather than add another sawmill/wood resource. |
| Transport | `goods.js` accrues haul cost; on arrival buyer pays the transport share to the Transport Company account, remainder to producer | Haul cost is not already-paid wages. Distinguish quote, settlement and actual transport operating costs. |
| Accounts | `gold.js` keeps transport fees, custody (dead-worker wallets) and the gold bank as separate accounts; `step` applies the selected T0 (drip to towns) / T1 (retained) rule to transport only | T1: company revenue, custody and bank reserves no longer blur; custody never drips and the invariant sums every account. |
| Persistence | No save/load or localStorage path in either lab's `app.js`/`simulation.js` | The prototype needs a settings-persistence path only; a world snapshot is a later contract. |

Previous monetary design: `prototype/archive/price-model-b/03-faction-money-plan.md` proposes faction notes,
note-only taxes, a defended exchange peg and spatial note bids. It is an alternative, not the default:
printing notes in exchange for gold cannot create initial demand when nobody needs or trusts those notes.

## M.1 Gold-only money and mine bootstrap

### Gold is the settlement asset

- Unit: grams of monetary gold (`g`). Goods/wage prices use `g/unit`; rest fees use `g/service`.
- Deposits are geological resources, not purses. Extraction converts a finite deposit into owned mine gold.
- No `ITEM_GOLD` enters the ordinary goods pool. No gold-for-gold demand gradient is generated.
- Wallet gold travels with its worker. Mine/owner/bank balances remain owned accounts.
- Mine markers and deposits remain visible; hiding gold cargo must not hide either mines or wealth.
- Credit-note unlock does not turn reserve gold into generic goods particles. A bank gold purchase is an
  explicit financial exchange; visible owned currency transport is deferred, not a demand-field resource.

Two quantities must be distinct:

1. **Monetized stock:** extracted gold, including gold retained at the mine.
2. **Circulation outside the mine:** gold transferred from the mine to workers and input suppliers.

`dig` increases the first; wages/input settlement transfer existing balances and increase the second on net.
Payment volume is not net issuance: the same gold can pay many bills. No money is created by price diffusion,
travel, an unpaid wage claim, worker splitting, founding, ordinary actor placement or credit-note unlocks.

### Starting gold is a scenario amount, not a hardcoded grant

Starting gold is derived from a reasonable daily amount rather than a fixed constant, so the opening
transient is not distorted. Default: **1 gold per worker** (`INITIAL_GOLD_PER_WORKER`), recorded once at
scenario initialization as `initialHistoricalGold` and allocated to named starting owners and the bank
capital account. It is historical funding, never recurring income, never per-placement minting.

- The total is `initialHistoricalGold = INITIAL_GOLD_PER_WORKER × workerCount` at scene setup.
- Allocation is explicit: named owners receive founding capital; a bank scenario assigns lendable equity.
  The gold-only reference scene assigns half to worker wallets and half equally across initial owner/town
  accounts. This is one scenario allocation, not a grant on facility creation. Every later investment or
  purchase transfers existing gold. The zero-start control allocates nothing.
- **Workers start with full food in the particle engine.** The opening transient must not be a starvation
  cycle: each seeded worker begins with a full `food` bag, so the first job/walk/rest cycle is not spent
  foraging or starving. Food is a real stock, not money; funding the bag is a scenario real-asset grant,
  recorded in the real-asset ledger, not a gold issuance.
- The amount is a comparison knob (0.5 / 1 / 2 g per worker) tested against startup transients: too low
  starves the first firms before extraction pays, too high distorts early prices.
- A strict zero-start scene remains available as a diagnostic: all accounts at zero, founders contribute
  sweat equity and locally gathered construction wood, or the scene starts with one built mine. Even there,
  seeded workers begin with full food so the bootstrap measures work/financing, not hunger.

### Adaptive prices, independent of starting gold

Initial quotes prevent startup singularities and spikes; they are not permanent price anchors. Never set a
price-level multiplier from `INITIAL_GOLD_PER_WORKER`, and never require a minimum gold supply by retaining
absolute rest, food, wage or sell-price floors in the derived economy. More or less gold changes nominal
prices through current spendable balances, observed wallets, inventories and competing demand.

- Town quotes follow smoothed current worker wealth, including zero, without restoring a seeded-wallet floor.
  Bazaar rations can sell below historical acquisition cost; cost basis is accounting, not a guaranteed bid.
- Ordinary firms split output value over joint inputs and cap quotes by the facility's spendable envelope.
  Diffused competing buyer bids are estimates, not executable supplier asks that may veto every input bid.
- Express hauling charges relative to live item value and use relative price gradients for movement, so
  changing monetary units alone cannot change transport speed or create a nominal transport-cost barrier.
- Sell floors follow carried cost, with proportional inventory write-downs recorded separately from gold.
  Startup cost must not strand inventory forever merely because nominal prices have fallen.
- Validate small-money settlement and circulation separately from physical throughput: geography, workforce,
  capital distribution and a growing mined supply can change real production. Any positive representable
  gold amount should permit trade; it does not promise identical output or remove physical bottlenecks.

### Mine funds and payouts

- Actual productive work and available deposit/materials bound output, not the wage promised on entry.
- Miners may accept an unpaid entry-wage claim before extraction. The claim belongs to the original stable
  worker ID, is not spendable currency, and is settled FIFO from actual mine gold. No wage promise mints gold.
- Proposed cash waterfall: due earned wages and accepted input bills; bounded next-shift wage/input reserves;
  scheduled debt service from remaining cash; then discretionary reinvestment or earned-worker bonuses.
  Reserve budgets cannot defer arrears forever: missed installments trigger visible arrears/default, not new
  money. Set a maximum reserve horizon so a mine does not accumulate forever.
- Reserve allocation must leave both staffing and essential wood replenishment viable. Do not let automatic
  surplus payout drain tomorrow's input budget. Insolvent mines stop ordering goods they cannot pay for.
- Bonusing is for workers who earned the productive shift, proportional to credited work, not whoever happens
  to be on site when delayed receipts arrive. Existing entry-wage claims remain separate from bonuses.
- No personal owner dividends, treasury tribute or free grants. Retained cash can repay owner debt or fund
  approved construction at another owned facility; these are distinct from dividends and new issuance.
  Shared-purse allocation cannot bypass wages/reserves/debt commitments. Capacity upgrades, machines,
  knowledge and negotiated site purchases are deferred.
- Receipts elsewhere recirculate: miners buy rest/food → towns buy goods → firms buy inputs/pay wages →
  workers buy services again. Mine wood purchases additionally fund sawmills and their workers.

### The first mine cannot require money that only the mine can produce

Gold-funded reference scenario: the scenario's `initialHistoricalGold` is assigned once to named owners,
workers and a bank capital account. Firms obtain startup cash through owner capital transfers or recorded bank
loans; an approved loan is not automatic on placement.

Strict bootstrap scenario: all accounts start at zero; founders contribute sweat equity and locally gathered
construction wood, or the scenario starts with one built mine. Workers can forage and shelter-rest for free.
The mine pays claims only after actual extraction. Begin with a small local timber reserve sufficient for a
productive shift; thereafter purchase deliveries using earned gold. Record reserves as initial real assets,
not free gold. A mine requiring purchased wood before its first extraction otherwise creates a deadlock.

Do not expand barter into a second economy for this slice. Zero-start mine placement must be deliberately
reachable: the current auto-founder scan finds coal mines/factories/farms, not gold mines. First use an
explicit bootstrap scene; automatic gold-deposit discovery/founding is a separate small extension.

### Minimal mine wood extension

Reuse the existing sawmill, `ITEM_WOOD`, forest depletion, goods pool and cost accounting. Extend gold-mine
buyer eligibility (currently towns/farms for wood), joint cash admission, input buffer and operating recipe.
Mine construction also consumes real wood under the construction draft; do not require purchased wood before
zero-start extraction unless founder gathering or recorded initial material stocks make that reachable.
An empty operating buffer pauses wood-dependent production; resupply restarts it. Wood is not payment.

### M.1a Owners, facilities and funding

Owner, facility, worker, bank and faction are separate identities. A firm owns/operates facilities; its owner
account holds spendable currency shared by all facilities the owner controls. Political control is a
relationship, not permission to mint or seize money.

**Shared ownership is the confirmed model.** One owner can hold any number of facilities; all owned facilities
share the owner's cash and debt. There is one true shared purse and owner-level debt, with bounded per-facility
cash budgets reserved before bids/admission. Isolated one-facility-per-owner is retained only as a comparison
control (O1) to expose cross-subsidy and contagion; it is not the default.

| Preset | Cash and liabilities | Question tested |
|--------|----------------------|-----------------|
| O1 isolated (control) | Each firm gets a distinct owner account; no automatic gold grant | Does each site survive on its own receipts and financing? |
| O2 shared (default) | All facilities of one owner share one purse and owner-level debt | Can existing profits finance new sites, and does one failure endanger the portfolio? |

Recommended architecture: one owner-account registry for both presets; O1 is one facility per owner, not a
second implementation. Use stable `ownerId` and `facilityId`, never recycled cell indices as payees. A
facility keeps local physical stock, productive capacity, cost/revenue attribution and committed orders. An
owner keeps cash by denomination, loans and a list/index of facilities. Workers retain personal wallets;
town treasuries, bank reserves and transport accounts remain separate unless an explicit rule transfers funds.
Do not give a portfolio each facility's full cash as an independent buying budget.

- Compute spendable cash after existing commitments, then allocate bounded per-facility wage/input budgets
  before bids/admission. Compare simple proportional or priority allocation later, not a global optimizer now.
- Cross-facility cash allocation under O2 is bookkeeping, not income. Material movement remains physical and
  uses delivery capacity/cost, even within one owner; stock is not instantly pooled across the map.
- Loans bind a stable borrower owner; the owner is liable across all its facilities. Project/facility IDs
  attribute use and results. Limited-liability subsidiaries are a later alternative, not implicit protection.
- Deleting/replacing a facility preserves the owner cash, debts, earned wage claims and cargo payee IDs.
  Ownership transfer does not rewrite existing contracts; explicit stock/contract transfers need atomic terms.
- Owner accounts without a living proprietor remain estates: their cash, facilities and wage debts persist;
  no new worker identity inherits them implicitly. Settled claims of dead workers enter the labeled custody
  account; transport and custody are separate accounts (T1), and custody never drips.
- A facility-only sale transfers the site and its local stock at an explicit worker-wallet price; the seller
  retains cash, debts and existing cargo contracts. Whole-business acquisition with liability transfer is a
  separate atomic contract, not an implicit side effect of editing a site.
- New owner starts at zero. Startup funding records lender/investor, currency, amount and repayment terms.
  No approval or insufficient funds means pending/unfunded construction, not a hidden grant.
- O2 reinvestment can finance a second site only from uncommitted owner cash or an approved loan. Record
  both facility operating results and owner-wide results; portfolio subsidies must be visible.

### Owners are workers, and founding needs no paid initiation

Owners and workers are the same class of actor. Any worker with money can buy or found a firm. A worker
without money can still found a firm where free workers and resources exist: no paid initiation is required.

- **Founding.** Where free (still/fresh) workers and resources exist, select a random free worker from the
  surrounding free workforce to become the firm's owner. The firm starts with an empty purse; the owner may
  take a bank loan (F1) to pay workers, and the mine can pay with its own extracted gold.
- **Buying.** A worker with money can buy an existing firm or facility; ownership transfers with the shared
  cash and debt unless the contract says otherwise.
- This matches the draft's sawmill spawn: the firm appears where free workers and resources exist, chosen from
  the local free workforce, not through a paid initiation gate.

### Debt limit, defaults and bankruptcy

Credit-note lending carries explicit default and run risk; the plan intends to test it, not eliminate it.

- **Debt limit per firm.** Each firm (owner) has a bounded credit limit. New debt cannot exceed the limit
  minus outstanding principal. The limit is a policy knob (fixed cap vs value/collateral-based cap) and is a
  comparison axis, not a hidden constant.
- **Negative factory.** A facility that cannot meet its obligations may be sold by its owner to the bank;
  the sale is an explicit transfer of the facility and its share of owner debt at an agreed price.
- **Firm closure.** If a firm cannot pay its workers, cannot obtain more money, and has sold its last
  facility, the firm is closed. Its facilities become bank-owned and the bank sells them (to workers, other
  owners, or at liquidation). Closure is a visible ledger event; it does not erase worker wage claims or
  other creditors' notes.
- **Runs and defaults.** A note holder's redemption or a worker's unpaid wage is a claim against the issuer/
  owner, not a reason to mint gold. Defaults write down the loan asset/equity; they do not erase other
  people's notes or wage claims.

## M.1b Output placement and internal depots

The open depot question concerns ordinary products, not monetary gold. **Confirmed default: bounded,
facility-local internal output storage, with particles emitted only when a demand price gradient exists.**
Existing `spawnAmount`/`spawnCost` are the starting point; do not add duplicate physical stock behind those
counters.

| Preset | Output policy | Trade-off / comparison purpose |
|--------|---------------|-------------------------------|
| D0 speculative map stock | Emit produced batches even at zero gradient, subject to pool capacity | Visible supply before demand, but idle cargo/haul and pool pressure; a comparison treatment. |
| D1 internal depot (default) | Retain output at zero payable gradient; dispatch when a funded reachable buyer signal appears | Bounded storage and low particle churn; demand discovery may lag. |

**D2 reserved buyer-directed dispatch is not available.** The cell and particle transport engines do not
support directed, reserved, buyer-specific dispatch by design. Do not plan it as an implementation target;
the depot dispatches on the existing demand gradient, not to a reserved buyer.

### Internal products and demand-gated transport

- Products that appear internally (`A + B = Out`, `A + work = Out`) are stored in the internal depot until a
  demand price gradient appears. If nobody asks for the product, **skip the transportation calculation** to
  save CPU; nothing is emitted and no haul cost accrues.
- This gating is about **item amounts only**. The price/demand fields are **always emitted and faded**, so
  price gradients exist over the map and the cost of any position can be predicted by simple cell
  interpolation. Demand-field computation is never skipped, even when the corresponding items are stored.
- Dispatch happens when a reachable, funded buyer signal clears the sell floor; otherwise stock stays in the
  depot. A full depot slows/stops production; it must not silently delete output or issue wages against
  fictional sales. Spoilage, pool-full loss or write-down has a named ledger counter; dispatch failure leaves
  stock in the depot.

### Harvested resources and the depot exception

- **Harvested resources appear on the map at their harvest location.** Forest → logs are placed at the cell
  where the forest was cut, then move by the ordinary demand gradient. This is the confirmed exception to the
  internal-depot rule: the cut location is a real spatial fact, and the logs enter the market from there.
- **Deferred, worth testing:** some products are better stored in a depot than on the map — food is the
  example — so a factory can hold them until a good price. This is a later comparison, not part of the first
  slice.

Planning queries distinguish `availableLocal`, `availableReachable`, `reserved`, `inTransit`, and `delivered`.
A positive global stock count proves neither access nor affordability. Construction checks reachable free
stock, delivered price, transport time, capacity and workforce before commitment; it consumes only delivered
materials (or permitted founder gathering), never stock merely counted at another facility. Same-owner stock
is excluded from sale availability once reserved for internal use. One unit occupies one inventory bucket;
production → depot → cargo → buyer stock → consumption/loss preserves quantity and carried cost.

## M.2 Transport, payment and recirculation

Goods and monetary settlement are different systems. In the first lab, a delivered good can trigger direct
remote producer credit; this is a declared clearing abstraction, not an invisible gold caravan. Worker wallets
still move physically. There is no independent gold cargo looking for a buyer.

For a delivery of `q` at buyer bid `p`:

- `buyerBill = q * p`, bounded by actual buyer money and stock room, with joint admission across arrivals.
- `haulPaid = min(buyerBill, accruedHaulQuote)`; `producerReceipt = buyerBill - haulPaid`.
- Debit/credit in one currency atomically. The same rule applies to a partial shipment.
- Accrued haul quote records incurred delivery effort for pricing; before settlement it is not gold and not a
  guaranteed company receivable. An unsold/spoiled shipment earns no transport cash. Show any unrecovered cost.
- Keep book cost, transport quote, realized revenue and monetary balances separate. No invented profit from
  converting the same receipt twice or using an indicative FX rate that cannot actually execute.

Three transport treatments can be compared without adding physical carrier workers immediately:

| Preset | Treatment | Purpose |
|--------|-----------|---------|
| T0 existing control | Transport revenue drips to towns by the current population weighting; label it as a redistribution rule | Preserve a known reference, not an unnoticed source. |
| T1 retained company cash | No drip; fees accumulate in a separate company account | Expose whether transport is the liquidity sink. |
| T2 operating payouts | Fund named maintenance purchases and/or wages for recorded haul service from company receipts | Target economic recirculation, capped by cash and actual services. |

Use T1 as a diagnostic, not automatically the final game default. T2 needs identified service providers;
never pay unrelated nearby workers merely to keep the graph moving. Transport staffing/depots remain a later
real-economy feature. If simplified transport must remain playable before T2, keep T0 explicit and measurable.
Orphan balances and erased-owner estates have separate custody accounts with a documented transfer policy;
they are not Transport Company earnings. Destruction of an actor must not destroy its held gold.

## M.3 Credit-money switch and state

UI: **Credit money**, off by default. In the lab this is a sandbox override of story/technology eligibility;
in the game, eligibility and enabled preference are separate saved values.

**Credit notes are the only paper mechanism worth building.** Fully backed notes (gold-for-note at parity) are
a misconception of real economy and are not a game feature: they mostly substitute one payment medium for
another and do not solve scarcity. If gold exists, pay with gold. Credit notes are emitted only when someone
accepts them in exchange for real goods; they expand spendable claims beyond gold and carry default/run risk,
which is the point to test.

- Enabling in a running gold-only scene creates no gold/notes, changes no wallet and imposes no surprise debt.
  Banks can be founded/funded by explicit transfers after enabling, or by a preset applied on scene reset.
- Disabling is allowed only with zero outstanding notes and note-denominated obligations. Otherwise keep
  existing settlement/redemption working and offer "stop new issuance" or "reset as gold-only"; never
  confiscate, revalue or silently convert balances. UI must explain why complete disable is blocked.
- Reload with saved preference but no world snapshot starts a fresh scene and says so. Persisting settings is
  not a claim to resume a running economy.
- **Persistence scope.** For the prototype, a settings interface is enough: namespaced, versioned local
  settings with JSON copy/export/import for comparisons, including the credit-money checkbox, presets,
  scenario seed and issuer parameters. Storage failure must not stop the file:// lab. A resumable world
  snapshot is a separate, later contract; it is not part of this prototype.
- A future snapshot must additionally contain every gold/note balance, bank reserve, outstanding loan,
  issuance/redemption counter, accepted-currency setting, contract denomination, pending claim/order, worker
  ID, custody account, owner/facility IDs and mappings, depot stock/cost, reservations, owner budgets, RNG
  state and tick. Derived price fields can be rebuilt deterministically if specified.
- Restoring an existing world never repeats scenario funding or issuance. Do not attempt ad-hoc legacy-save
  migration in the initial prototype; validate the declared snapshot/settings version.

## M.4 Issuer models to implement and compare

Banks are separate firms and can operate **without issuing their own currency**. Select bank operation
independently of the credit-money checkbox:

| Funding mode | Source of loan funds | Constraint / purpose |
|--------------|----------------------|----------------------|
| F0 owner capital | Existing owner cash transferred to project budgets | No-bank gold-only control; no placement grants. |
| F1 gold intermediary | Existing bank capital or explicitly lendable term funding | Gold-only credit reference; lending transfers gold and cannot reuse locked backing reserves. |
| F2 existing-currency intermediary | Bank's owned spendable gold or another bank's notes | Tests a non-issuing bank; it cannot mint the chosen issuer's currency. |
| F3 own-note lender | Bounded own-note issuance matched by a loan asset | Credit expansion treatment, requiring credit eligibility and acceptance. |

**Recommended sequence: F0 owner capital → F1 existing-gold bank loans → credit notes (B/F3).** F1 begins
with existing bank equity, no runnable customer deposits. A strict zero-gold world cannot obtain a gold loan
from an empty bank: bootstrap mining first. F2 reuses existing currencies after one issuer works.

Issuer identity and political control are separate. A bank can be private, town-owned or faction-owned without
changing the note ledger. Begin with at most two independent issuers, not a universal central bank.

| Model | How it issues | First demand and acceptance | What it tests / main risk |
|-------|---------------|-----------------------------|---------------------------|
| A. Gold-backed banknotes (control only) | A customer deposits gold; bank issues redeemable bearer notes at a declared parity | Depositor receives a useful claim; acceptance depends on redeemability | Substitution baseline; locking gold one-for-one does not add net gold-backed liquidity. Not a game feature. |
| B. Credit banknotes (primary) | Bank grants a bounded note loan against a productive project; loan is the bank asset and notes are its liability | Borrower spends on consenting workers/suppliers; borrowers need that bank's notes for repayment | Expands spendable claims beyond gold reserves; default, reserve shortage and runs. |
| C. Town/faction notes | Authority buys real labor/materials with new notes within a budget | Published future obligations or useful town services payable in its notes create demand | Fiscal/influence loop; coercion and over-issuance. Later alternative. |

A bank may buy existing gold from a mine or holder with notes only if that seller accepts the notes. This
moves gold into reserves; it is not new mining and it does not explain why otherwise unwanted notes have value.
Banks have operating expenses but cannot print profit without booking an issuance counterpart.

### Why Model A is only a control

At full backing, reserve gold is not additional freely spendable nonbank cash. Replacing circulating gold with
notes largely substitutes one payment medium for another; mobilizing previously idle gold may help, but cannot
be assumed to solve an insufficient-money scenario. It is retained only to distinguish convenience/trust from
genuinely elastic money supply, and to show that paper without credit expansion does not fix scarcity.

### Model B: credit money with explicit balance-sheet risk

Owner capital is transferred existing gold, not seeded by bank placement. Start one borrower with a small,
bounded productive loan and pre-consenting suppliers. Loan origination creates a note balance for the borrower
and a matching bank loan asset. It does not debit a fictional gold lender or increase physical gold.

Use zero interest first to isolate issuance. Then compare interest and maturity settings; interest must be
funded by real circulation, not automatic printing to let every borrower repay. Borrowers need a plausible
revenue path in those notes (or executable exchange into them), not just a nominally profitable gold project.

For initial testing:

- `maxNewLoanNotes = min(creditLimitRemaining, projectLimit)`.
- `creditLimitRemaining` is the firm's bounded debt limit (M.1a); it caps principal per firm/owner.
- `projectLimit` derives from a conservative repayment budget and fixed exposure cap, not a circular forecast
  assuming its own newly printed money raises prices forever.
- Principal repayment in the bank's own notes cancels loan principal and retires those notes. Interest paid in
  notes transfers to bank earnings, not automatic principal destruction. Track gold payments separately.
- A credit-origin note may be redeemed while the loan remains outstanding; redemption reduces reserve and
  note liabilities, not the borrower's debt. Later repayment/reissue can change the backing ratio.
- Loan default writes down the loan asset/equity; it does not erase other people's notes. Insolvency (assets
  insufficient) differs from illiquidity (cannot meet today's gold redemptions).
- At exhausted reserves suspend further redemption/new credit and show a queue and explicit suspension.
  Do not create gold, automatically refinance debt or grant a bailout. Liquidation/recovery can be a later policy.

### Bank pricing, debt service and profit

Start with declared fixed interest, maturity, reserve target and bid/ask quotes. Then compare a bounded
adaptive controller: update at a fixed simulated-time interval using funded loan applications, unused
lendable cash, arrears/default losses, redemption pressure and realized service profit. Excess credit demand
can raise the next offered rate; idle liquidity can lower it, subject to exposure and solvency limits.
Gold-purchase quotes respond to executable two-sided flow and reserve needs, not an assumed guaranteed peg.
Quote units are explicit: a gold seller receives notes at the bank's **ask** in `g/note` (`notes = gold/ask`);
a note seller receives gold at its **bid** (`gold = notes*bid`), subject to available funding/issuance bounds.
Do not run rate and FX adaptation simultaneously in the first experiment.

A loan fixes denomination, principal, rate per simulation-time unit, due schedule and recourse at acceptance.
Proposed first contract uses simple interest on outstanding principal, no compounding or automatic rollover;
rate changes apply to new contracts only. Pay due interest then principal from the allocated debt budget.
Cash shortage records arrears; default after a declared grace period writes down recoverable loan value.
Principal is not profit. Interest/fees less operating expenses and credit losses determine realized bank
profit; extracted gold and new note liabilities are not bank earnings. Owners repay in the contracted
currency or through an actual funded exchange. Bank lending cannot rescue a real wood/workforce shortage.

Compare fixed versus adaptive rates under identical demand shocks; measure defaults, service reach,
bank profit, borrower output and volatility together. Keeping every bank profitable is not a simulation rule.

### Model C: public demand without an adoption deadlock

Publish a small future note obligation only after the authority has spent notes on real services, with a grace
period and reachable exchange/service access. A useful rest/food service can accept notes voluntarily before
note-only taxes are tested. Acceptance in discharge of taxes retires notes in the minimal fiscal preset;
spending again is separately recorded issuance. Compare this with treasury recirculation later, not both at
once.

Influence selects membership/issuer preference, not wallet ownership or forced conversion. A town changing
faction preserves existing savings and contracted debts; only future published obligations change after notice.
Do not lock penniless workers out of basic foraging/shelter to manufacture note demand.

## M.5 Acceptance and exchange prices

Keep `g` as the common computational reference initially. This is a unit of account, not a promise that every
holder can liquidate at that value. Every issuer's notes have their own wallet column and identifier.

For bank `b`, define executable quotes in `g/note`:

- `bidGold[b]`: gold an exchange will actually pay for a note, bounded by available reserve gold.
- `askGold[b]`: gold needed to buy a note, bounded by available notes or permitted credit issuance.
- At one venue `0 <= bidGold <= askGold`; quantities and reach matter as well as price.
- Contract denomination and exact amount are fixed at acceptance. Do not retroactively reprice an earned wage
  or an existing loan whenever the rate changes.

Start with explicit fixed quotes, finite queues and volume caps. This proves settlement before an endogenous
FX market is introduced. The later market matches funded buy/sell orders; unmatched orders move next-period
quotes gradually with configured limits on *rate of change*, not an artificial eternal gold-value floor.
A bank defending parity provides bounded bid liquidity using reserves; a target peg is not the market rate.
A suspended bank can have a discounted secondary quote or no bid at all.

### Who will accept a note?

Each worker, firm and town has an acceptance policy per issuer; no universal `acceptPaper = true`.
Start with assigned consenting actors so a small loop exists; later test adaptive acceptance separately.
A note is accepted because the holder can spend it or redeem it for real goods, never because the economy
has little gold.

Proposed adaptive valuation: `effectiveValue = executableOrExpectedGoldValue * acceptanceFactor`, with
`acceptanceFactor` in `[0,1]` based on redemption success, spending opportunities and currency exposure limits.
Do not discount the same risk twice if it is already represented in the executable quote. No reachable
redemption or spending use can justify rejecting entirely; a displayed parity alone is never purchasing power.

A seller quoting `P` grams per good requires `P / effectiveValue` notes per good; a direct note-denominated
price is also allowed. Zero value means reject, not division by zero or infinite demand. E.g. at an accepted
value of `0.8 g/note`, a `4 g` good costs `5 notes`. The buyer must own the notes; settlement does not
invisibly print, lend or exchange the shortfall. Optional auto-exchange must execute a funded FX leg atomically
first.

Banks' own notes can be demanded for loan repayment; a town's notes for announced taxes/services; any holder
may also value notes as a liquid claim or savings. Merchants accept because they can reuse/redeem them, not
merely because the economy has little gold. Gold scarcity is a reason to seek credit, not an issuer's guarantee.

### Competing currencies and spatial reach

- Wallets may hold gold, Bank A notes and Bank B notes simultaneously. Wages, shops, transport companies and
  taxes can choose different denominations; gold remains available unless a specific contract says otherwise.
- Buyer price signals need currency context. For the first slice use preallocated per-currency bid channels;
  steering compares their discounted gold-reference values and arrivals verify actual acceptable tender.
  A single highest gold-equivalent field must not lure a cargo to a buyer who cannot pay its accepted currency.
- Transport fees retain the sale currency initially, subject to company acceptance. Foreign-note holdings
  are reported and can be spent/exchanged; the vault must not treat one note as one gram.
- For `rA` and `rB` in `g/note`, indicative `B per A = rA/rB`. Executable A→B via gold instead yields
  `bidGold[A]/askGold[B]`, subject to both legs' liquidity, fees and reach. Never promise free round-trip
  arbitrage.
- Banking access and merchant networks define local spendability. Stage one uses fixed catchments/quotes;
  later regional markets can differ through limited exchange access and currency shipping cost.
  Gold-reference accounting does not imply worldwide free conversion.
- Keep currency objects out of the coal/goods recipe machinery. A future visible note courier is owned cargo
  with a destination and denomination, not an unowned resource pile attracting generic demand.

## M.6 Monetary ledgers, ownership and diagnostics

Gold invariant (closed map):

`initialHistoricalGold + cumulativeExtractedGold = nonbankOwnerGold + workerGold + townGold + transportGold + bankGold + custodyGold + goldInTransit`

Mine gold is an attributed part of its owner account, never a second balance. `bankGold` includes locked
backing reserves and free lending capital exactly once. Each gram has exactly one bucket; bank capital is a
claim on bank net assets, not an additional pile of gold. `goldInTransit` is zero under immediate clearing. If
gold loss/export is introduced later it needs a named counter.

Per issuer:

`cumulativeNotesIssued - cumulativeNotesRetired = allOutstandingNoteBalances`

Count worker/firm/town/company holdings, bank-held issued notes, escrow and couriers once each. Unissued blank
paper is not money. A bank's own notes returned for redemption/principal repayment are retired atomically;
notes earned as fees/interest remain explicitly held until spent or deliberately retired.

Bank balance sheet at declared book values:

`reserveGold + loanAssetsGoldEquivalent + otherAssets = noteLiabilitiesGoldEquivalent + otherLiabilities + equity`

Show parity valuation and stressed recovery/market valuation separately. Loan interest, defaults and operating
losses change equity; marking a note cheaper on the market does not produce spendable gold profit. A loan
asset is not a circulating balance. Capital transfer moves existing gold; reserving it changes spendability,
not mass.

Copyable inspector and telemetry (2–5 Hz, no text rewrites on paused frames):

- gold: extracted, paid by mines as wages / input purchases, retained, scenario starting gold, conservation error;
- transport: fees quoted / collected / unpaid, company balances by currency, redistribution and real service payouts;
- each bank: reserves, outstanding notes, principal, defaults, equity, backing ratio, quotes, redemption queue/success;
- each owner/facility: account ID, allocated/committed/free cash, balances by denomination, operating result,
  accepted tenders, wage/loan denomination, debt limit and headroom, overdue obligations, project funding source
  and debt service;
- depot: available/reserved stock, in-transit quantities, time full/idle, loss, dispatches and reachable supply;
- bankruptcy: firm closures, facilities sold to bank, bank-owned facilities resold, wage claims and note claims
  preserved through closure;
- outcomes: trade volume, rejected payments by reason, employment, food/rest access, bankrupt/idle firms,
  gold hoarding, monetary velocity, consumption basket prices and acceptance share by currency;
- combined wealth display is explicitly mark-to-market and excludes double-counting reserve gold behind notes.

## M.7 Delivery slices and gates

| Slice | Minimal deliverable | Gate before expanding |
|-------|---------------------|-----------------------|
| G1 | Gold origin ledger, scenario starting gold (1 g/worker), no placement minting; existing wages/claims; explicit holdings labels | Zero repeatable money from town placement, founding, erase/rebuild, split or reset funding replay. |
| O2 | Stable owner/facility identities, shared cash and debt, owner-level budgets and debt limits; worker-owner founding | Two facilities cannot spend the same cash twice; erase/rebuild cannot inherit another owner's receipts or drop debts. |
| D1 | Expose internal output buffers and availability query; demand-gate transport; demand fields always live | No duplication/loss at dispatch, no sale or construction from inaccessible/reserved stocks. |
| G2 | Mine cash budget, original-worker payouts, strict bootstrap scene and existing wood-chain extension | Zero-start makes first wages without invented money; delivery uses mined gold; wood outage reduces output. |
| T1 | Separate transport/custody accounts, switchable T0/T1 rules and diagnostics | Gold invariant holds; T1 reveals rather than hides liquidity trapped in fees. |
| B0 | F0/F1 funding, one capital-funded gold bank, fixed-rate project loan, debt service/default | Firm funding is a transfer; a profitable mine can repay; empty bank cannot lend and bank placement mints nothing. |
| P0 | Saved credit-money checkbox, scenario/policy presets, multi-currency ledger and exact settlement API | Off matches G/T baseline; toggle/restore cannot duplicate assets or erase obligations. |
| P1 | One bank, bounded credit issuance/repayment/default and one productive loan (B) | Expansion adds notes, never gold; an actual repayment path exists; suspension is visible. |
| P2 | Two issuers, acceptance policies and executable FX; one-bank stress scene | Discount/rejection/run follows liquidity/trust shocks; no hidden gold or cross-currency gains. |
| P3 | Bankruptcy/bank-takeover path (sell to bank, closure, bank resale); town/faction alternative (C) if useful | Closure preserves wage/note claims; bank-owned facilities are resold, not deleted. |

Slices G1, O2, D1, G2, B0 and T1 are implemented and green in `prototype/particle-transfer-b2/`
(`bootstrap-bank.test.js` plus the existing suites); P0–P3 remain future work.

Do not implement all slices at once. The first playable target is the confirmed first scenario below.
Model A is a control slice only; D2 is not planned.

### First implementation scenario (end-to-end test)

Build and run this scenario to test the whole system before adding issuers or adaptive policy:

1. **Place a gold site** and free workers, plus some towns and other facilities.
2. **Found a firm at the gold mine:** a free worker becomes the owner. The mine can pay with its own
   extracted gold. Set a job demand gradient to hire workers.
3. **Observe workers moving to the gold mine by the job demand gradient**, being paid, and extracting gold.
4. **Place a forest** and free workers nearby.
5. **Found a sawmill:** a free worker from the surrounding free workforce becomes the owner, with no paid
   initiation.
6. **The sawmill owner borrows from the bank** to pay workers (F1 existing-gold loan).
7. **Observe bank-loan repayment** from sawmill (and mine) revenue, and the credit-money default/run path.

This exercises: starting gold, worker-owner founding, gold extraction, job-gradient hiring, forest → map logs,
internal depot + demand-gated transport, owner capital/bank loan, and debt repayment. Add credit notes (P1)
and bankruptcy (P3) only after this loop is green.

### Proposed code ownership (created only when its slice needs it)

- Existing `gold.js`: gold extraction/transfers, wage claims and conservation; use owner-account access, not
  duplicated per-cell purses. Move account storage in a separate step from changing funding behavior.
- New `owners.js`: stable owner/facility registry, shared cash and debt, debt limits, facility mapping and
  budget commitments.
- Existing `goods.js`: physical output buffers/costs, depot availability, demand-gated dispatch and cargo
  payee IDs.
- Existing `actors.js`, `workers.js`, `founding.js`: mine work/input budget and original-worker earnings;
  worker-owner founding; never put worker lifecycle or note issuance into towns.
- Existing `actors.js`, `farms.js`, `goods.js`: extend the traded wood chain to mines, not a duplicate
  `wood.js`; payment calls use the monetary owner rather than duplicating per-currency settlement arithmetic.
- New `currencies.js`: fixed-cap issuer registry, preallocated actor/worker currency balances, atomic transfer
  and denomination-aware settlement. Preserve stable worker/issuer IDs through compaction and splitting.
- New `banks.js`: gold/existing-currency lending, credit issuance, redemption, reserve commitments, principal,
  interest, default accounting, debt limits and bankruptcy/bank-takeover; no ownership of physical production.
- New `exchange.js`: funded quote/order settlement, acceptance valuation and bounded FX liquidity.
- New `settings.js`: prototype preference serialization and explicit snapshot contract; UI lives in `app.js`.
- Existing diagnostics/telemetry/render owners: labels, ledger views and currency selector. Shared inspector
  stays a view, not an issuance policy engine. Add new owners to `AGENTS.md` when code is introduced.

Classic scripts, file:// operation, SoA/preallocated hot-path storage and bounded per-tick work remain the lab
constraints. Two issuer channels suffice initially; do not build arbitrary-currency global routing first.
Update owning sections of `plan-particle-transfer.md` alongside implementation that changes its runtime rules.

## M.8 Comparison and validation

### Controlled experiments

Run the same seed, actors, real stocks, starting gold, preferences and simulation duration for each monetary
preset. Change one axis at a time (ownership, output, funding, issuer B/C, transport T, fixed/adaptive policy),
then test selected interactions rather than every Cartesian combination. Compare identical initial goods whether
stored in depots or emitted as cargo; use identical demand-shock schedules. Transfer bank seed capital from
named existing owners. Do not give banking scenes extra gold or wood.

| Scene/shock | Comparison | Evidence sought |
|-------------|------------|-----------------|
| Two sites, one profitable/one failing | O2 shared vs O1 isolated with equal total starting wealth | Productive reinvestment versus contagion; shared cash never spent twice. |
| New mine/project funding | F0 vs F1, then F3 | Who funds construction, wages and inputs; actual principal/interest repayment; unfunded projects remain unfunded. |
| Starting gold amount | 0.5 / 1 / 2 g per worker | Startup transient: starvation before first extraction vs distorted early prices. |
| Zero gradient, then demand appears | D0 vs D1 | Dispatch latency, idle cargo, depot saturation and trade; zero goods duplication. |
| Demand field with stored items | Item transport skipped vs demand field still faded | Cost prediction by cell interpolation works even when items are not moving. |
| Remote/reserved stock near proposed consumer | Availability query vs global count | Inaccessible or committed stock cannot justify consumption/construction. |
| Debt limit | Fixed cap vs value/collateral-based cap | Defaults and liquidity under identical shocks; headroom is visible. |
| Bankruptcy path | Sell to bank / closure / bank resale | Wage and note claims survive closure; facilities are resold, not deleted. |
| Loan-demand/redemption shock | Fixed vs adaptive rates, then fixed vs adaptive FX | Demand response, realized bank profit, arrears and volatility; no retroactive contract changes. |
| Low gold, functioning production | Gold-only vs credit notes (B) | Does trade improve from genuine credit expansion? Track basket inflation too. |
| Gold-only strict zero start | Built/bootstrap mine vs no reachable mine | Wages arise from work; inability to start without real assets is diagnosed, not subsidized. |
| Mine wood route interrupted | Same money, different real input access | Money does not conjure wood or prevent an input-caused shutdown. |
| Transport fees retained | T0 vs T1, later T2 | Liquidity concentration vs actual economic recycling, not just total gold. |
| Mine exhausted/shut down | All monetary presets | Existing gold still circulates; no issuance reset; bank loans do not automatically replace real production. |
| Healthy borrower vs failed project | Credit note vs default | Successful principal retirement; explicit default/equity loss, no deletion of innocent holders' notes. |
| Redemption rush | One credit bank with/without ample reserve | Queue/suspension and discount; no instantaneous gold creation to save parity. |
| Bank A over-expands, Bank B conservative | Two issuer preset | Shifting acceptance/quotes and exposure; no mandatory simultaneous collapse or artificial success. |
| New tax/service obligation | C vs voluntary bank adoption | Demand is reachable and announced; basic survival remains possible. |
| Save, reload, toggle | Off/on and outstanding liabilities | Preference persists; full restore if supplied preserves ownership and never reissues initial funding. |

Machine-readable runs record `seed`, `ticks`, `moneyPreset`, `transportPreset`, all policy parameters and the
M.6 metrics. Use several declared seeds, a warm-up and both normal/stress windows; report min/median/max and
invariant errors. Judge trade, welfare, inflation and failure exposure together; more nominal money is not success.

### Automated acceptance tests (introduced with owning slices)

- Conservation of physical gold per tick, nonnegative balances, bounded extraction and no item-gold spawning.
- Scenario starting gold equals `INITIAL_GOLD_PER_WORKER × workerCount`, allocated once; ordinary new
  actor/founder never seeds; placement mints nothing.
- Stable owner/facility IDs across cell reuse; facilities of one owner share a bounded cash budget and
  owner-level debt; owner cash, debt and wage/cargo payees survive facility removal; account and overlay
  totals do not double-count.
- Worker-owner founding from free workforce with no paid initiation; a funded worker can buy a firm; the
  firm starts with an empty purse unless a loan/transfer is recorded.
- Debt limit caps new principal per firm; a facility sale to the bank is an explicit transfer; firm closure
  preserves wage and note claims and moves facilities to bank ownership for resale.
- Depot → cargo → buyer stock identity and costs, zero-gradient retention, demand-gated transport skip,
  demand field still emitted and faded, finite capacity, no sale of reserved stock and construction refusal
  for unreachable/undelivered materials.
- Gold lending with no paper, insufficient capital refusal, fixed interest by simulation time, debt service,
  arrears/default; existing-currency bank cannot issue someone else's notes; new rates affect new loans only.
- Mine payout is a transfer, not extraction; FIFO wage claims pay original IDs after movement;
  compaction/split/despawn and removal preserve ownership under a declared estate policy. New identities
  cannot collect the same earned shift twice.
- Zero-gold bootstrap, construction wood conservation, input cash cap, output halt/restart on wood absence.
- Delivery identity for partial/multiple arrivals, spoilage and underwater sales; transport quote is not cash.
- Credit origination, principal retirement, interest transfer, loan default, redemption before maturity and
  reserve exhaustion; no unlimited lending after suspension; no gold is created by issuance.
- Accepted/rejected currencies, zero bid, cash-limited FX, both legs atomic, spreads, no profitable frictionless
  round trip, no nominal addition of different currencies; contract values do not drift after issue.
- Gold and every currency preserved across worker split/compaction, actor erase and outstanding contracts.
- G2/B0/T1 acceptance lives in `prototype/particle-transfer-b2/bootstrap-bank.test.js`: timber granted once,
  wood outage/restock, delivery purchase, debt caps and bank refusals, repayment with exact interest, equity
  identity, T0/T1 transport rules and a banked reference scene.
- Checkbox persists across boot; storage denied/file:// fallback; restore without replaying seed/loan issuance;
  off is equivalent to baseline and cannot erase outstanding notes. Full snapshot round trip only when the
  later snapshot contract is implemented.

Validation scope: documentation-only design gets link/path/diff review, not simulation reruns. During code work,
L0 syntax on edited JS; targeted gold/conservation/worker and new monetary tests at leaf changes; full particle
suite and boot/UI gates for load-order/shared changes. Run cell-lab tests only when its substrate is changed.

### Manual playtest checklist

- Inspect owner and facility views; compare one-owner-per-site with a shared multi-site purse; identify
  starting gold, project debt, cash allocations, debt limits and any cross-subsidy.
- Watch a free worker found a firm with no paid initiation; a funded worker buy an existing firm.
- At zero demand see output stored and transport skipped while the demand field still shows gradients; add
  demand and observe physical delivery; full storage stops production.
- Watch forest cutting place logs at the cut cell before they move on the demand gradient.
- Borrow actual bank gold with credit money off; watch mine and sawmill receipts pay interest/principal; an
  empty bank refuses.
- Gold mine exists, pays worked wages and buys delivered wood; there is no gold cargo sale marker.
- Gold holdings overlay is intelligible and distinct from wages/home demand; inspector explains money sources.
- Watch one miner's wallet through wage → town rest/food → firm inputs/wages; conservation remains copyable.
- Interrupt wood and transport independently; identify real shortage versus missing spendable balances.
- Place/erase towns repeatedly and verify no extra gold; see explicit scenario starting gold on init.
- Reload the credit-money preference; distinguish a fresh scene from resuming a saved scene.
- Acquire credit notes through a loan, buy from a consenting seller, encounter a rejection, redeem.
- Compare two banks; stress one reserve; see executable quotes, discounts and rejection reasons clearly.
- Force a firm closure: see facilities move to bank ownership and be resold; wage and note claims remain.
- Try turning credit money off with notes/debts outstanding; see the safe options, not disappearing savings.

## M.9 Confirmed decisions

Human input: [economy, money and banks](draft/economy-money-bank.md). Decisions below are confirmed from
that draft and are no longer open:

1. **Ownership:** shared owners. All facilities owned by one owner share its cash and debt. One true shared
   purse and owner-level debt, with bounded per-facility budgets. O1 isolated is a comparison control only.
   Owners are workers; any worker with money can buy or found a firm.
2. **Funding/bootstrap:** starting gold is not hardcoded; it comes from a reasonable daily amount, default
   1 gold per worker, recorded once as scenario initial capital. No placement minting. Workers start with
   full food in the particle engine. Loans rather than per-firm grants.
3. **Output:** internal depot by default (D1), speculative map output (D0) as comparison. Directed/reserved
   buyer dispatch (D2) is not supported by the cell and particle transport engines and is not planned.
   Internal products are stored until a demand gradient appears; transport calculation is skipped when there
   is no demand. Price/demand fields are always emitted and faded for cost prediction. Forest-cut logs are an
   exception and are placed at the cut cell. Food-in-depot is a deferred comparison.
4. **Paper money:** credit notes are the paper mechanism; gold-backed one-for-one banknotes are not a game
   feature and are kept only as a control. Notes are emitted only when accepted for real goods. Credit
   defaults/runs are intended. Debt limits, selling a negative factory to the bank, firm closure and bank
   resale of facilities are all part of the design.
5. **Mine surplus:** pay due obligations/reserve next shift, service debt, allow productive reinvestment;
   defer expansion capacity, machinery/fuel, knowledge/ore efficiency and site-purchase dialogs.
6. **Persistence/transport:** save the settings interface for the prototype; full world save is later.
   Remote settlement stays explicit; physical money couriers via roads or straight lines remain deferred.

Global recommendation: one accounting/settlement kernel and orthogonal small policy presets, not separate
copies of the economy for every model. Freeze production, geography and transport when comparing monetary
rules. First review the end-to-end mine → wages/wood → town → supplier → bank-repayment loop; only then add
competing issuers, adaptive bank policy or main-game influence. Implementation is sliced by the gates in M.7; issuer work follows the gold-only baseline.

## M.10 Prototype-to-game boundary

The particle lab is a **rules lab, not a second game**. It exists to settle monetary and economy rules cheaply
and with a fast, isolated test loop. Once a rule set is validated, the kernel is ported to the game; the lab
does not keep growing feature-by-feature until it resembles a full product, because two divergent
implementations are a defect, not a feature.

**Build-in-prototype rule.** Build in the particle lab only what is required to test a monetary/economy rule:
the gold origin, shared owner/facility accounts, internal depot + demand-gated transport, credit notes, bank
lending/default, and the ledgers that prove conservation. Nothing else.

**Build-in-game rule.** Anything that is gameplay richness without changing a monetary rule goes straight into
the game on the ported kernel: transport staffing and depots (T2), the science/tech tree, multiple firms per
cell, visible currency couriers, house owners, a general wood market, advanced bazaar pricing, roads/ships,
town upkeep and depot wear. These are game-side features; they are not prototype questions.

**End-of-prototype gate.** The prototype ends when the first end-to-end scenario (M.7) is green **and** the
confirmed comparison axes have produced a decision:

1. Gold origin ledger + scenario starting gold + no placement minting (G1).
2. Shared owners, worker-owner founding, debt limits (O2).
3. Internal depot, demand-gated transport, demand fields always live, logs at cut cell (D1).
4. Mine cash budget, wood chain, bootstrap (G2).
5. Gold lending, debt service, default; one productive loan repaid (B0/P1).

At that gate: freeze the lab, port the kernel, do not open new feature work in the lab.

**Port target and shape.** Port the monetary kernel to the game as `map-money-particle.js`, dispatched by
`mapeStepMoney` when `mape.moneyEngine === 'particle'` (the standing default-engine target in `AGENTS.md`).
Port the kernel — owner/facility/bank/currency registry, depot, settlement, ledgers — not the lab UI, render
or test harness. The lab remains the reference and regression substrate: its node tests are the gate that the
ported engine still conserves gold and preserves identities. Once the port is green and the game runs the
particle engine as default, the lab is archived; its tests move to the game's `experiments/` suite.

**Phases after the gate.**

- **Phase A (now):** finish the money prototype to the M.7 end-to-end gate. No transport staffing, no science.
- **Phase B:** port the validated monetary kernel to the game; flip the default engine; port the lab's
  conservation/identity tests into `experiments/`.
- **Phase C:** build game-side features (transport companies/depots, science/tech tree, and the rest of the
  deferred list) directly in the game on the ported engine. The prototype is not reopened for these.

This keeps one product: the lab answers "does the rule work?", the game answers "does the game play well?".
The prototype is closed by a decision, not by running out of ideas.
