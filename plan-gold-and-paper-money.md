# Gold circulation and competing paper currencies — prototype plan

Status: proposed design; implementation requires agreement on the open choices in
[draft/economy-money-bank.md](draft/economy-money-bank.md). No monetary rules in this document imply
that a bank, tax obligation or currency has already been implemented.

## M.0 Scope and design boundaries

Primary lab: `prototype/particle-transfer-b2/`. Secondary comparison substrate:
`prototype/price-model-b2/`. Stabilize the monetary rules in the particle lab before porting them to the
cell lab or the main game. Keep the transport substrate independent of issuer policy.

The gold-only economy must work without banks. Paper money is optional and story/technology gated;
competition, credit and faction authority are independently selectable experiments, not one mandatory system.
All numerical policy settings below are initial experiment parameters, not price floors or immutable law.

This plan owns gold origin/distribution, facility ownership and funding, monetary transport accounting,
issuer policy, lending, note acceptance, exchange, saved monetary settings and comparison experiments.
It also defines the proposed output-depot experiment; physical production and goods movement remain with
the particle plan. Human requirements live in the source draft; recommendations here are not approvals.
`plan-particle-transfer.md` owns worker life, production and movement; construction and wood requirements
also follow `draft/company/`.

### Inspection findings and implications

| Area | Current implementation | Design implication |
|------|------------------------|--------------------|
| Particle gold output | `actors.js`, `ActorOptimizer.stepFirm`: gold recipe has `outItem: -1`; calls `money.dig(i, made)` | Already no gold goods particle; preserve this distinction. |
| Cell gold output | `price-model-b2/actors.js` also calls `money.dig` | Same monetary principle applies to both labs. |
| Gold overlay | Particle `fields.js`, `fieldFor`: purses plus worker wallets; the other pane blends home/wage signals | This is holdings, not saleable gold. Keep it and label the second pane as a signal, not a gold price. |
| Initial money | Particle `gold.js` seeds town/firm purses on reset; `workers.js` seeds wallets | Make historical stock explicit and fixed at scenario initialization. |
| Placement | Particle `simulation.js`, `setActor`: placing a town calls `seedTown` | Placement is an extra gold source today. Remove that source in the baseline; editing must not silently subsidize towns. |
| Ownership | `gold.js` uses cell-indexed purses; `goods.js` stores producer cell as `owner` | Introduce stable facility and owner identities before sharing purses; a cell is not an economic owner. |
| Output storage | `goods.js` retains `spawnAmount`/`spawnCost` until a payable uphill route exists | Internal producer storage partly exists; compare dispatch policies, not an invented missing inventory system. |
| Mining distribution | `GoldMoney.dig` credits mine purse; `settleFirm` pays wage claims and on-site surplus after reserves | Preserve claim ownership/FIFO, but specify the mine's payout budget and avoid indiscriminate on-site bonuses. |
| Mine recipe | Labor only; no purchased wood | A wood-input slice is required; a knob without delivery/consumption is insufficient. |
| Wood infrastructure | Particle sawmill recipe produces `ITEM_WOOD`; `goods.js` transports it to towns/farms; `farms.js` owns forest cutting | Reuse the existing market; extend mine admission, input caps and consumption rather than add another sawmill/wood resource. |
| Transport | `goods.js` accrues haul cost; on arrival buyer pays transport share to `GoldMoney.vault`, remainder to producer | Haul cost is not already-paid wages. Distinguish quote, settlement and actual transport operating costs. |
| Vault | `gold.js` combines transport income, erased-actor balances and orphan receipts; `step` drips it to towns by population weight | Conservation holds but economic ownership is blurred. Separate company revenue from estate/escrow money. |
| Persistence | No save/load or localStorage path in either lab's `app.js`/`simulation.js` | A saved checkbox requires new settings persistence, not an assumed existing world-save system. |

Previous monetary design: `prototype/archive/price-model-b/03-faction-money-plan.md` proposes faction notes,
note-only taxes, a defended exchange peg and spatial note bids. It is an alternative, not the default here:
printing notes in exchange for gold cannot create initial demand when nobody needs or trusts those notes.

## M.1 Gold-only money and mine bootstrap

### Gold is the settlement asset

- Unit: grams of monetary gold (`g`). Goods/wage prices use `g/unit`; rest fees use `g/service`.
- Deposits are geological resources, not purses. Extraction converts a finite deposit into owned mine gold.
  If the existing infinite-source recipe is retained for a tiny reference test, label it explicitly.
- No `ITEM_GOLD` enters the ordinary goods pool. No gold-for-gold demand gradient is generated.
- Wallet gold travels with its worker. Mine/town/company balances remain owned accounts.
- Mine markers and deposits remain visible; hiding gold cargo must not hide either mines or wealth.
- Paper unlock does not automatically turn reserve gold into generic goods particles. A bank gold purchase is
  an explicit financial exchange; visible owned currency transport is deferred, not a demand-field resource.

Two quantities must be distinct:

1. **Monetized stock:** extracted gold, including gold retained at the mine.
2. **Circulation outside the mine:** gold transferred from the mine to workers and input suppliers.

`dig` increases the first; wages/input settlement transfer existing balances and increase the second on net.
Payment volume is not net issuance: the same gold can pay many bills. No money is created by price diffusion,
travel, an unpaid wage claim, worker splitting, founding, ordinary actor placement or paper-money unlocks.

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
- Baseline: no personal owner dividends, treasury tribute or free grants. Retained cash can repay bank debt
  or fund approved construction at another owned facility; these are distinct from dividends and new issuance.
  Shared-purse allocation cannot bypass wages/reserves/debt commitments. Compare retention and productive
  reinvestment explicitly; capacity upgrades, machines, knowledge and negotiated site purchases are deferred.
- Receipts elsewhere recirculate: miners buy rest/food → towns buy goods → firms buy inputs/pay wages → workers
  buy services again. Mine wood purchases additionally fund sawmills and their workers.

### The first mine cannot require money that only the mine can produce

Gold-funded reference scenario: fixed historical mined gold assigned once to named owners/workers and a
bank capital account. Record it as `initialHistoricalGold`, never recurring town income or automatic new-firm
wealth. Firms obtain startup cash through owner capital transfers or recorded bank loans; an approved loan
is not automatic on placement. A historical per-firm grant remains only a labeled legacy control.

Strict bootstrap scenario: all accounts start at zero; founders contribute sweat equity and locally gathered
construction wood, or the scenario starts with one built mine. Workers can forage and shelter-rest for free.
The mine pays claims only after actual extraction. Begin with a small local timber reserve sufficient for a
productive shift; thereafter purchase deliveries using earned gold. Record reserves as initial real assets,
not free gold. A mine requiring purchased wood before its first extraction otherwise creates a deadlock.

Do not expand barter into a second economy for this slice. Zero-start mine placement must be deliberately
reachable: the current auto-founder scan finds coal mines/factories/farms, not gold mines. First use an explicit
bootstrap scene; automatic gold-deposit discovery/founding is a separate small extension.

### Minimal mine wood extension

Reuse the existing sawmill, `ITEM_WOOD`, forest depletion, goods pool and cost accounting. Extend gold-mine
buyer eligibility (currently towns/farms for wood), joint cash admission, input buffer and operating recipe.
Mine construction also consumes real wood under the construction draft; do not require purchased wood before
zero-start extraction unless founder gathering or recorded initial material stocks make that reachable.
An empty operating buffer pauses wood-dependent production; resupply restarts it. Wood is not payment.

### M.1a Owners, facilities and funding

Owner, facility, worker, bank and faction are separate identities. A firm owns/operates facilities; its owner
account holds spendable currency. Political control is a relationship, not permission to mint or seize money.
The draft's two ownership settings are selectable treatments, not simultaneous accounting systems:

| Preset | Cash and liabilities | Question tested |
|--------|----------------------|-----------------|
| O1 isolated owners | Each new firm gets a distinct owner account; no automatic gold grant | Does each site survive on its own receipts and financing? |
| O2 portfolio owner | Several facilities share one owner account and owner-level debt | Can existing profits finance new sites, and does one failure endanger the portfolio? |

Recommended architecture: the same owner-account registry for both presets; O1 is one facility per owner,
not a second implementation. Use stable `ownerId` and `facilityId`, never recycled cell indices as payees.
A facility keeps local physical stock, productive capacity, cost/revenue attribution and committed orders.
An owner keeps cash by denomination, loans and a list/index of facilities. Workers retain personal wallets;
town treasuries, bank reserves and transport accounts remain separate unless an explicit rule transfers funds.
Do not give a portfolio each facility's full cash as an independent buying budget.

- Compute spendable cash after existing commitments, then allocate bounded per-facility wage/input budgets
  before bids/admission. Compare simple proportional or priority allocation later, not a global optimizer now.
- Cross-facility cash allocation under O2 is bookkeeping, not income. Material movement remains physical and
  uses delivery capacity/cost, even within one owner; stock is not instantly pooled across the map.
- Loans bind a stable borrower owner; project/facility ID attributes use and results. O2 initially has full
  owner recourse; limited-liability subsidiaries are a later alternative, not implicit protection.
- Deleting/replacing a facility preserves the owner cash, debts, earned wage claims and cargo payee IDs.
  Ownership transfer does not rewrite existing contracts; explicit stock/contract transfers need atomic terms.
- New owner starts at zero. Startup funding records lender/investor, currency, amount and repayment terms.
  No approval or insufficient funds means pending/unfunded construction, not a hidden grant.
- O2 reinvestment can finance a second site only from uncommitted owner cash or an approved loan. Record
  both facility operating results and owner-wide results; portfolio subsidies must be visible.

### M.1b Output placement and internal depots

The open depot question concerns ordinary products, not monetary gold. Recommended default: bounded,
facility-local owned output storage, with particles emitted only for a plausible sale route. Existing
`spawnAmount`/`spawnCost` are the starting point; do not add duplicate physical stock behind those counters.

| Preset | Output policy | Trade-off / comparison purpose |
|--------|---------------|-------------------------------|
| D0 speculative map stock | Emit produced batches even at zero gradient, subject to pool capacity | Visible supply before demand, but idle cargo/haul and pool pressure; a new experimental treatment. |
| D1 local depot | Retain output at zero payable gradient; dispatch when a funded reachable buyer signal appears | Recommended first slice; bounded storage and low particle churn; demand discovery may lag. |
| D2 reserved dispatch | Buyer reserves quantity and cash, then depot sends owned cargo to that buyer | Reliable delivery and investment estimates, but requires order expiry, escrow and cancellation rules; later. |

Current route-gated emission is the D1 control, not D0. Preserve existing cost relaxation as a separately
reported policy so storage and inventory valuation effects are not confused. A full depot slows/stops
production; it must not silently delete output or issue wages against fictional sales. Any later spoilage,
pool-full loss or write-down has a named ledger counter; dispatch failure leaves stock in the depot.

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

## M.3 Paper-money switch and state

UI: **Paper money**, off by default. In the lab this is a sandbox override of story/technology eligibility;
in the game, eligibility and enabled preference are separate saved values.

Saved settings include `paperMoneyEnabled`, ownership/depot/funding/issuer presets, transport preset, scenario seed, issuer parameters
and unlock state where applicable. Use a namespaced, versioned local settings record and JSON copy/export/import
for sharing comparisons. Storage failure must not stop the file:// lab; indicate when persistence is unavailable.

- Enabling in a running gold-only scene creates no gold/notes, changes no wallet and imposes no surprise debt.
  Banks can be founded/funded by explicit transfers after enabling, or by a preset applied on scene reset.
- Disabling is allowed only with zero outstanding notes and note-denominated obligations. Otherwise keep
  existing settlement/redemption working and offer “stop new issuance” or “reset as gold-only”; never confiscate,
  revalue or silently convert balances. UI must explain why complete disable is blocked.
- Reload with saved preference but no world snapshot starts a fresh scene and says so. Persisting settings is
  not a claim to resume a running economy.
- A resumable snapshot must additionally contain every gold/note balance, bank reserve, outstanding loan,
  issuance/redemption counter, accepted-currency setting, contract denomination, pending claim/order, worker ID,
  custody account, owner/facility IDs and mappings, depot stock/cost, reservations, owner budgets, RNG state and tick. Derived price fields can be rebuilt deterministically if specified.
- Restoring an existing world never repeats scenario funding or issuance. Do not attempt ad-hoc legacy-save
  migration in the initial prototype; validate the declared snapshot/settings version.

## M.4 Issuer models to implement and compare

Banks are separate firms and can operate **without issuing their own currency**. Select bank operation
independently of the paper checkbox:

| Funding mode | Source of loan funds | Constraint / purpose |
|--------------|----------------------|----------------------|
| F0 owner capital | Existing owner cash transferred to project budgets | No-bank gold-only control; no placement grants. |
| F1 gold intermediary | Existing bank capital or explicitly lendable term funding | Gold-only credit reference; lending transfers gold and cannot reuse locked backing reserves. |
| F2 existing-currency intermediary | Bank's owned spendable gold or another bank's notes | Tests a non-issuing bank; it cannot mint the chosen issuer's currency. |
| F3 own-note lender | Bounded own-note issuance matched by a loan asset | Credit expansion treatment, requiring paper eligibility and acceptance. |

F1 begins with existing bank equity, no runnable customer deposits. Add term deposits only with maturity and
liquidity rules; fully backed Model A custody is never lendable funding. A strict zero-gold world cannot obtain
a gold loan from an empty bank: bootstrap mining first. A zero-reserve paper bootstrap is a distinct possible
experiment, not supported by the reserve-constrained credit rule below and not the first default.

Issuer identity and political control are separate. A bank can be private, town-owned or faction-owned without
changing the note ledger. Begin with at most two independent issuers, not a universal central bank.

| Model | How it issues | First demand and acceptance | What it tests / main risk |
|-------|---------------|-----------------------------|---------------------------|
| A. Gold-backed banknotes | A customer deposits gold; bank issues redeemable bearer notes at a declared parity | Depositor receives a useful claim; a small opted-in merchant network accepts it because it can redeem | Credibility/control baseline; locking gold one-for-one does not add net gold-backed liquidity. |
| B. Credit banknotes | Bank grants a bounded note loan against a productive project; loan is the bank asset and notes are its liability | Borrower spends on consenting workers/suppliers; borrowers need that bank's notes for repayment; redemption and merchant reuse support wider acceptance | Expands spendable claims beyond gold reserves; default, reserve shortage and runs. Recommended main liquidity experiment after A. |
| C. Town/faction notes | Authority buys real labor/materials with new notes within a budget | Published future tax/fee obligations or useful town services payable in its notes create demand | Fiscal/influence loop; coercion and over-issuance; cannot assume independent merchants accept by decree. |

A bank may buy existing gold from a mine or holder with notes only if that seller accepts the notes. This
moves gold into reserves; it is not new mining and it does not explain why otherwise unwanted notes have value.
Banks have operating expenses but cannot print profit without booking an issuance counterpart.

### Recommended sequence

Gold-only owner funding → F1 (gold lender) → A (one fully backed bank) → B/F3 (one credit bank)
→ B (two competing banks). F2 reuses existing currencies after one issuer works.
Keep C as a later selectable alternative, not a prerequisite for trying banks. A is worth retaining even if it
has weak adoption: it distinguishes convenience/trust from genuinely elastic money supply.

### Model A: backed notes, not a magic cure for scarcity

Each issuer defines parity `q` in `g/note`; e.g. `q = 1`. A gold deposit `G` moves that actual gold into the bank
reserve and creates `G/q` notes for the depositor. Redemption burns returned notes and releases `q*N` gold.
Start with zero fees to make conservation transparent; introduce a spread as a separate experiment.
Gold allocated to notes cannot simultaneously fund loans, wages or owner withdrawals.

Adoption needs a benefit: trusted redeemability plus more widely accepted/smaller-denomination settlement,
or a measured gold-transfer friction advantage. The current instantaneous clearing abstraction makes paper
no more convenient automatically; do not hardcode adoption success without adding and exposing a benefit.

At full backing, reserve gold is not additional freely spendable nonbank cash. Replacing circulating gold
with notes largely substitutes one payment medium for another; mobilizing previously idle gold may help,
but cannot be assumed to solve an insufficient-money scenario.

### Model B: credit money with explicit balance-sheet risk

Owner capital is transferred existing gold, not seeded by bank placement. Start one borrower with a small,
bounded productive loan and pre-consenting suppliers. Loan origination creates a note balance for the borrower
and a matching bank loan asset. It does not debit a fictional gold lender or increase physical gold.

Use zero interest first to isolate issuance. Then compare interest and maturity settings; interest must be
funded by real circulation, not automatic printing to let every borrower repay. Borrowers need a plausible
revenue path in those notes (or executable exchange into them), not just a nominally profitable gold project.

For initial testing:

- `maxNewLoanNotes = min(creditLimitRemaining, reserveHeadroom, projectLimit)`.
- `reserveHeadroom = max(0, reserveGold / (reserveRatioTarget * q) - outstandingNotes)`.
- `reserveRatioTarget` in `(0, 1]`; reserve assets used by other promises are excluded. Fully backed issuance
  never uses this credit shortcut: Model A deposits remain one-for-one.
- Project limit derives from a conservative repayment budget and fixed exposure cap, not a circular forecast
  assuming its own newly printed money raises prices forever.
- Principal repayment in the bank's own notes cancels loan principal and retires those notes. Interest paid
  in notes transfers to bank earnings, not automatic principal destruction. Track gold payments separately.
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
note-only taxes are tested. Acceptance in discharge of taxes retires notes in the minimal fiscal preset; spending
again is separately recorded issuance. Compare this with treasury recirculation later, not both at once.

Influence selects membership/issuer preference, not wallet ownership or forced conversion. A town changing
faction preserves existing savings and contracted debts; only future published obligations change after notice.
Do not lock penniless workers out of basic foraging/shelter to manufacture note demand.

## M.5 Acceptance and exchange prices

Keep `g` as the common computational reference initially. This is a unit of account, not a promise that every
holder can liquidate at that value. Every issuer's notes have their own wallet column and identifier.

For bank `b`, define executable quotes in `g/note`:

- `bidGold[b]`: gold an exchange will actually pay for a note, bounded by available reserve gold.
- `askGold[b]`: gold needed to buy a note, bounded by available notes or permitted backed issuance.
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

Proposed adaptive valuation: `effectiveValue = executableOrExpectedGoldValue * acceptanceFactor`, with
`acceptanceFactor` in `[0,1]` based on redemption success, spending opportunities and currency exposure limits.
Do not discount the same risk twice if it is already represented in the executable quote. No reachable redemption
or spending use can justify rejecting entirely; a displayed parity alone is never purchasing power.

A seller quoting `P` grams per good requires `P / effectiveValue` notes per good; a direct note-denominated
price is also allowed. Zero value means reject, not division by zero or infinite demand. E.g. at an accepted
value of `0.8 g/note`, a `4 g` good costs `5 notes`. The buyer must own the notes; settlement does not invisibly
print, lend or exchange the shortfall. Optional auto-exchange must execute a funded FX leg atomically first.

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
  `bidGold[A]/askGold[B]`, subject to both legs' liquidity, fees and reach. Never promise free round-trip arbitrage.
- Banking access and merchant networks define local spendability. Stage one uses fixed catchments/quotes;
  later regional markets can differ through limited exchange access and currency shipping cost.
  Gold-reference accounting does not imply worldwide free conversion.
- Keep currency objects out of the coal/goods recipe machinery. A future visible note courier is owned cargo
  with a destination and denomination, not an unowned resource pile attracting generic demand.

## M.6 Monetary ledgers, ownership and diagnostics

Gold invariant (closed map):

`initialHistoricalGold + cumulativeExtractedGold = nonbankOwnerGold + workerGold + townGold + transportGold + bankGold + custodyGold + goldInTransit`

Mine gold is an attributed part of its owner account, never a second balance. `bankGold` includes locked
backing reserves and free lending capital exactly once. Each gram has exactly one bucket; bank capital is a claim on bank net assets, not an additional pile of gold.
`goldInTransit` is zero under immediate clearing. If gold loss/export is introduced later it needs a named counter.

Per issuer:

`cumulativeNotesIssued - cumulativeNotesRetired = allOutstandingNoteBalances`

Count worker/firm/town/company holdings, bank-held issued notes, escrow and couriers once each. Unissued blank
paper is not money. A bank's own notes returned for redemption/principal repayment are retired atomically;
notes earned as fees/interest remain explicitly held until spent or deliberately retired.

Bank balance sheet at declared book values:

`reserveGold + loanAssetsGoldEquivalent + otherAssets = noteLiabilitiesGoldEquivalent + otherLiabilities + equity`

Show parity valuation and stressed recovery/market valuation separately. Loan interest, defaults and operating
losses change equity; marking a note cheaper on the market does not produce spendable gold profit. A loan asset
is not a circulating balance. Capital transfer moves existing gold; reserving it changes spendability, not mass.

Copyable inspector and telemetry (2–5 Hz, no text rewrites on paused frames):

- gold: extracted, paid by mines as wages / input purchases, retained, historical funding, conservation error;
- transport: fees quoted / collected / unpaid, company balances by currency, redistribution and real service payouts;
- each bank: reserves, outstanding notes, principal, defaults, equity, backing ratio, quotes, redemption queue/success;
- each owner/facility: account ID, allocated/committed/free cash, balances by denomination, operating result,
  accepted tenders, wage/loan denomination, overdue obligations, project funding source and debt service;
- depot: available/reserved stock, in-transit quantities, time full/idle, loss, dispatches and reachable supply;
- outcomes: trade volume, rejected payments by reason, employment, food/rest access, bankrupt/idle firms,
  gold hoarding, monetary velocity, consumption basket prices and acceptance share by currency;
- combined wealth display is explicitly mark-to-market and excludes double-counting reserve gold behind notes.

## M.7 Delivery slices and gates

| Slice | Minimal deliverable | Gate before expanding |
|-------|---------------------|-----------------------|
| G1 | Gold origin ledger, fixed historical funding, no placement minting; existing wages/claims; explicit holdings labels | Zero repeatable money from town placement, founding, erase/rebuild, split or reset funding replay. |
| O1 | Stable owner/facility identities, O1/O2 settings and owner-level budgets; zero-funded new owners | Two sites cannot spend the same cash; erase/rebuild cannot inherit another owner's receipts or drop debts. |
| D1 | Expose existing internal output buffers and availability query; selectable D0 dispatch experiment | No duplication/loss at dispatch, no sale or construction from inaccessible/reserved stocks. |
| G2 | Mine cash budget, original-worker payouts, strict bootstrap scene and existing wood-chain extension | Zero-start makes first wages without invented money; delivery uses mined gold; wood outage reduces output. |
| T1 | Separate transport/custody accounts, switchable T0/T1 rules and diagnostics | Gold invariant holds; T1 reveals rather than hides liquidity trapped in fees. |
| B0 | F0/F1 funding, one capital-funded gold bank, fixed-rate project loan, debt service/default | Firm funding is a transfer; a profitable mine can repay; empty bank cannot lend and bank placement mints nothing. |
| P0 | Saved paper-money checkbox, scenario/policy presets, multi-currency ledger and exact settlement API | Off matches G/T baseline; toggle/restore cannot duplicate assets or erase obligations. |
| P1 | One bank, backed deposits/redemption and consenting merchant loop (A) | No over-issue; holder can reuse/redeem; locked reserve isn't counted as free gold. |
| P2 | Bounded credit issuance/repayment/default and one productive loan (B) | Expansion adds notes, never gold; an actual repayment path exists; suspension is visible. |
| P3 | Two issuers, acceptance policies and executable FX; one-bank stress scene | Discount/rejection/run follows liquidity/trust shocks; no hidden gold or cross-currency gains. |
| P4 | Town/faction alternative (C), then adaptive acceptance and spatial FX if useful | Compare against bank presets before involving main-game influence or porting either lab. |

Do not implement all slices at once. First playable target is G1 + minimal O1/D1 + G2/B0: one gold mine,
one wood supplier and one loan that can be repaid. Prove O1 before an O2 two-facility comparison;
D0 is an optional comparison, D2 is deferred. This is not a complete banking simulation.
T2 real transport payouts require a separate service-provider slice rather than arbitrary subsidies.

### Proposed code ownership (created only when its slice needs it)

- Existing `gold.js`: gold extraction/transfers, wage claims and conservation; use owner-account access, not
  duplicated per-cell purses. Move account storage in a separate step from changing funding behavior.
- New `owners.js`: stable owner/facility registry, facility mapping, shared accounts and budget commitments.
- Existing `goods.js`: physical output buffers/costs, depot availability, dispatch and cargo payee IDs.
- Existing `actors.js`, `workers.js`, `founding.js`: mine work/input budget and original-worker earnings;
  never put worker lifecycle or note issuance into towns.
- Existing `actors.js`, `farms.js`, `goods.js`: extend the traded wood chain to mines, not a duplicate `wood.js`;
  payment calls use the monetary owner rather than duplicating per-currency settlement arithmetic.
- New `currencies.js`: fixed-cap issuer registry, preallocated actor/worker currency balances, atomic transfer
  and denomination-aware settlement. Preserve stable worker/issuer IDs through compaction and splitting.
- New `banks.js`: gold/existing-currency lending, issuance, redemption, reserve commitments, principal,
  interest, default accounting and bounded policy updates; no ownership of physical production.
- New `exchange.js`: funded quote/order settlement, acceptance valuation and bounded FX liquidity.
- New `settings.js`: lab preference serialization and explicit snapshot contract; UI lives in `app.js`.
- Existing diagnostics/telemetry/render owners: labels, ledger views and currency selector. Shared inspector
  stays a view, not an issuance policy engine. Add new owners to `AGENTS.md` when code is introduced.

Classic scripts, file:// operation, SoA/preallocated hot-path storage and bounded per-tick work remain the lab
constraints. Two issuer channels suffice initially; do not build arbitrary-currency global routing first.
Update owning sections of `plan-particle-transfer.md` alongside implementation that changes its runtime rules.

## M.8 Comparison and validation

### Controlled experiments

Run the same seed, actors, real stocks, historical gold, preferences and simulation duration for each monetary
preset. Change one axis at a time (O, D, F, issuer A/B/C, transport T, fixed/adaptive policy), then test
selected interactions rather than every Cartesian combination. Compare identical initial goods whether stored
in depots or emitted as cargo; use identical demand-shock schedules. Transfer bank seed capital from named existing owners. Do not give banking scenes extra gold or wood.
Credit limits and acceptance networks are explicit treatment variables. Report at fixed simulation time, not
frame count or wall-clock speed. A fair baseline can fail: do not secretly add money until a scene survives.

| Scene/shock | Comparison | Evidence sought |
|-------------|------------|-----------------|
| Two sites, one profitable/one failing | O1 vs O2 with equal total starting wealth | Productive reinvestment versus contagion; shared cash never spent twice. |
| New mine/project funding | F0 vs F1, then F3 | Who funds construction, wages and inputs; actual principal/interest repayment; unfunded projects remain unfunded. |
| Zero gradient, then demand appears | D0 vs D1; D2 later | Dispatch latency, idle cargo, depot saturation, spoilage and trade; zero goods duplication. |
| Remote/reserved stock near proposed consumer | Availability query vs global count | Inaccessible or committed stock cannot justify consumption/construction. |
| Loan-demand/redemption shock | Fixed vs adaptive rates, then fixed vs adaptive FX | Demand response, realized bank profit, arrears and volatility; no retroactive contract changes. |
| Low gold, functioning production | Gold-only vs A vs B | Does trade improve from reuse/convenience or genuine credit expansion? Track basket inflation too. |
| Gold-only strict zero start | Built/bootstrap mine vs no reachable mine | Wages arise from work; inability to start without real assets is diagnosed, not subsidized. |
| Mine wood route interrupted | Same money, different real input access | Money does not conjure wood or prevent an input-caused shutdown. |
| Transport fees retained | T0 vs T1, later T2 | Liquidity concentration vs actual economic recycling, not just total gold. |
| Mine exhausted/shut down | All monetary presets | Existing gold still circulates; no issuance reset; bank loans do not automatically replace real production. |
| Healthy borrower vs failed project | A vs B | Successful principal retirement; explicit default/equity loss, no deletion of innocent holders' notes. |
| Redemption rush | One credit bank with/without ample reserve | Queue/suspension and discount; no instantaneous gold creation to save parity. |
| Bank A over-expands, Bank B conservative | Two issuer preset | Shifting acceptance/quotes and exposure; no mandatory simultaneous collapse or artificial success. |
| New tax/service obligation | C vs voluntary bank adoption | Demand is reachable and announced; basic survival remains possible. |
| Save, reload, toggle | Off/on and outstanding liabilities | Preference persists; full restore if supplied preserves ownership and never reissues initial funding. |

Machine-readable runs record `seed`, `ticks`, `moneyPreset`, `transportPreset`, all policy parameters and the
M.6 metrics. Use several declared seeds, a warm-up and both normal/stress windows; report min/median/max and
invariant errors. Judge trade, welfare, inflation and failure exposure together; more nominal money is not success.

### Automated acceptance tests (introduced with owning slices)

- Conservation of physical gold per tick, nonnegative balances, bounded extraction and no item-gold spawning.
- Stable owner/facility IDs across cell reuse; two facilities share a bounded owner cash budget; owner cash,
  debt and wage/cargo payees survive facility removal; account and overlay totals do not double-count.
- Depot → cargo → buyer stock identity and costs, zero-gradient retention, full-pool retention, finite capacity,
  no sale of reserved stock and construction refusal for unreachable/undelivered materials.
- Gold lending with no paper, insufficient capital refusal, fixed interest by simulation time, debt service,
  arrears/default; existing-currency bank cannot issue someone else's notes; new rates affect new loans only.
- Gold historical funding once; ordinary new actor/founder never seeds; mine payout is a transfer, not extraction.
- FIFO wage claims pay original IDs after movement; compaction/split/despawn and removal preserve ownership
  under a declared estate policy. New identities cannot collect the same earned shift twice.
- Zero-gold bootstrap, construction wood conservation, input cash cap, output halt/restart on wood absence.
- Delivery identity for partial/multiple arrivals, spoilage and underwater sales; transport quote is not cash.
- Deposit/issue/redeem round trip; per-bank note invariant and balance sheet; no reserve double-pledging.
- Credit origination, principal retirement, interest transfer, loan default, redemption before maturity and
  reserve exhaustion; no unlimited lending after suspension.
- Accepted/rejected currencies, zero bid, cash-limited FX, both legs atomic, spreads, no profitable frictionless
  round trip, no nominal addition of different currencies; contract values do not drift after issue.
- Gold and every currency preserved across worker split/compaction, actor erase and outstanding contracts.
- Checkbox persists across boot; storage denied/file:// fallback; restore without replaying seed/loan issuance;
  off is equivalent to baseline and cannot erase outstanding notes. Full snapshot round trip when implemented.

Validation scope: documentation-only design gets link/path/diff review, not simulation reruns. During code work,
L0 syntax on edited JS; targeted gold/conservation/worker and new monetary tests at leaf changes; full particle
suite and boot/UI gates for load-order/shared changes. Run cell-lab tests only when its substrate is changed.

### Manual playtest checklist

- Inspect owner and facility views; compare one-owner-per-site with a shared two-site purse; identify
  startup funding, project debt, cash allocations and any cross-subsidy.
- Remove/replace a facility with cargo and debt outstanding; receipts go to the original owner, not the new site.
- At zero demand see output stored; add demand and observe physical delivery; full storage stops production.
- Borrow actual bank gold with paper off; watch mine receipts pay interest/principal; an empty bank refuses.
- Gold mine exists, pays worked wages and buys delivered wood; there is no gold cargo sale marker.
- Gold holdings overlay is intelligible and distinct from wages/home demand; inspector explains money sources.
- Watch one miner's wallet through wage → town rest/food → firm inputs/wages; conservation remains copyable.
- Interrupt wood and transport independently; identify real shortage versus missing spendable balances.
- Place/erase towns repeatedly and verify no extra gold; see explicit historical stock on scene initialization.
- Reload the paper preference; distinguish a fresh scene from resuming a saved scene.
- Acquire notes through a deposit or loan, buy from a consenting seller, encounter a rejection, redeem.
- Compare two banks; stress one reserve; see executable quotes, discounts and rejection reasons clearly.
- Try turning paper off with notes/debts outstanding; see the safe options, not disappearing savings.

## M.9 Approval checkpoints

Human input: [economy, money and banks](draft/economy-money-bank.md). Keep that draft minimally changed;
record confirmed answers there before behavior work. Suggested decisions, not assumed approvals:

1. **Ownership:** expose O1/O2, default O1 first. Under O2 use one true shared purse and owner-level debt;
   no personal dividends yet. Confirm whether owners also need personal worker consumption now (recommend defer).
2. **Funding/bootstrap:** use historical mined gold in named bank/owner accounts for the reference, loans
   rather than per-firm grants; retain strict zero-start mining as a separate scene. Confirm historical stock.
3. **Output:** D1 bounded local depots by default, D0 as comparison, D2 later. Count reachable unreserved stock,
   not global inventory, when evaluating construction. Confirm whether forest-cut logs are an exception that
   must first appear at the cut cell per `draft/company/all.md` (recommend preserve that distinction).
4. **Banking:** gold-only F1 first, then backed A and credit B; fixed terms before adaptive rates/FX. Confirm
   credit-note risk (defaults/runs) is intended, rather than requiring all notes to stay fully backed.
5. **Mine surplus:** pay due obligations/reserve next shift, service debt, allow productive reinvestment;
   defer expansion capacity, machinery/fuel, knowledge/ore efficiency and site-purchase letter dialogs.
6. **Persistence/transport:** save settings including checkbox first; full world resumption separate. Remote
   settlement stays explicit; physical money couriers via roads or straight lines remain deferred.

Global recommendation: one accounting/settlement kernel and orthogonal small policy presets, not separate
copies of the economy for every model. Freeze production, geography and transport when comparing monetary
rules. First review the end-to-end mine → wages/wood → town → supplier → bank-repayment loop; only then add
competing issuers, adaptive bank policy or main-game influence. No implementation is authorized by this plan.
