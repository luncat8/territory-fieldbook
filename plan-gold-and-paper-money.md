# Gold circulation and competing paper currencies — prototype plan

Status: proposed design; implementation requires agreement on the open choices in
[draft/gold-and-paper-money.md](draft/gold-and-paper-money.md). No monetary rules in this document imply
that a bank, tax obligation or currency has already been implemented.

## M.0 Scope and design boundaries

Primary lab: `prototype/particle-transfer-b2/`. Secondary comparison substrate:
`prototype/price-model-b2/`. Stabilize the monetary rules in the particle lab before porting them to the
cell lab or the main game. Keep the transport substrate independent of issuer policy.

The gold-only economy must work without banks. Paper money is optional and story/technology gated;
competition, credit and faction authority are independently selectable experiments, not one mandatory system.
All numerical policy settings below are initial experiment parameters, not price floors or immutable law.

This plan owns gold origin/distribution, monetary transport accounting, issuer policy, note acceptance,
exchange, saved monetary settings and comparison experiments. `plan-particle-transfer.md` owns worker life,
production and movement; construction and wood requirements also follow `draft/company/`.

### Inspection findings and implications

| Area | Current implementation | Design implication |
|------|------------------------|--------------------|
| Particle gold output | `actors.js`, `ActorOptimizer.stepFirm`: gold recipe has `outItem: -1`; calls `money.dig(i, made)` | Already no gold goods particle; preserve this distinction. |
| Cell gold output | `price-model-b2/actors.js` also calls `money.dig` | Same monetary principle applies to both labs. |
| Gold overlay | Particle `fields.js`, `fieldFor`: purses plus worker wallets; the other pane blends home/wage signals | This is holdings, not saleable gold. Keep it and label the second pane as a signal, not a gold price. |
| Initial money | Particle `gold.js` seeds town/firm purses on reset; `workers.js` seeds wallets | Make historical stock explicit and fixed at scenario initialization. |
| Placement | Particle `simulation.js`, `setActor`: placing a town calls `seedTown` | Placement is an extra gold source today. Remove that source in the baseline; editing must not silently subsidize towns. |
| Mining distribution | `GoldMoney.dig` credits mine purse; `settleFirm` pays wage claims and on-site surplus after reserves | Preserve claim ownership/FIFO, but specify the mine's payout budget and avoid indiscriminate on-site bonuses. |
| Mine recipe | Labor only; no purchased wood | A wood-input slice is required; a knob without delivery/consumption is insufficient. |
| Wood infrastructure | Particle `simulation.js` has `wood`, but `GOODS_ITEMS` contains only coal/goods/food; `farms.js` obtains local wood | Do not assume a sawmill/wood delivery market exists in this lab. Reuse the goods path for a minimal wood chain. |
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
- Order for available mine cash: due wage claims; bounded upcoming wage/input reserves; current input bills;
  discretionary wage bonus from surplus. Set a maximum reserve horizon so a mine does not accumulate forever.
- Reserve allocation must leave both staffing and essential wood replenishment viable. Do not let automatic
  surplus payout drain tomorrow's input budget. Insolvent mines stop ordering goods they cannot pay for.
- Bonusing is for workers who earned the productive shift, proportional to credited work, not whoever happens
  to be on site when delayed receipts arrive. Existing entry-wage claims remain separate from bonuses.
- Baseline: no mine owner dividends, treasury tribute or free grants. Retained excess and the resulting slower
  circulation are visible outcomes; an owner-dividend policy is a later explicit comparison if desired.
- Receipts elsewhere recirculate: miners buy rest/food → towns buy goods → firms buy inputs/pay wages → workers
  buy services again. Mine wood purchases additionally fund sawmills and their workers.

### The first mine cannot require money that only the mine can produce

Reference scenario: fixed historical gold distributed once to named wallets/accounts. Record it as
`initialHistoricalGold`, never as recurring town income or free money for newly founded actors.

Strict bootstrap scenario: all accounts start at zero; founders contribute sweat equity and locally gathered
construction wood, or the scenario starts with one built mine. Workers can forage and shelter-rest for free.
The mine pays claims only after actual extraction. Begin with a small local timber reserve sufficient for a
productive shift; thereafter purchase deliveries using earned gold. Record reserves as initial real assets,
not free gold. A mine requiring purchased wood before its first extraction otherwise creates a deadlock.

Do not expand barter into a second economy for this slice. Zero-start mine placement must be deliberately
reachable: the current auto-founder scan finds coal mines/factories/farms, not gold mines. First use an explicit
bootstrap scene; automatic gold-deposit discovery/founding is a separate small extension.

### Minimal wood slice

Add one wood resource, one simple sawmill supplier and a mine construction/operating wood buffer. Sawmill
labor converts real nearby forest into owned wood batches. Founders can gather only the small startup wood
allowance; normal operation buys transported wood. Mine capacity/uptime depends on consumption; an empty
buffer pauses the wood-dependent work, never generates unpaid deliveries. Forest clearing conserves wood
and waste under the construction draft. Reuse goods admission, costs and delivery; avoid a new transport engine.

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

Saved settings include `paperMoneyEnabled`, issuer preset, transport preset, scenario seed, issuer parameters
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
  custody account, RNG state and tick. Derived price fields can be rebuilt deterministically if specified.
- Restoring an existing world never repeats scenario funding or issuance. Do not attempt ad-hoc legacy-save
  migration in the initial prototype; validate the declared snapshot/settings version.

## M.4 Issuer models to implement and compare

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

Gold-only → A (one fully backed bank) → B (one credit bank) → B (two competing banks).
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

`initialHistoricalGold + cumulativeExtractedGold = mineHeld + nonbankWalletsAndPurses + companyGold + bankReserves + custodyGold + goldInTransit`

Each gram has exactly one bucket; bank capital is a claim on bank net assets, not an additional pile of gold.
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
- each actor: balances by denomination, accepted tenders, wage/loan denomination, overdue obligations;
- outcomes: trade volume, rejected payments by reason, employment, food/rest access, bankrupt/idle firms,
  gold hoarding, monetary velocity, consumption basket prices and acceptance share by currency;
- combined wealth display is explicitly mark-to-market and excludes double-counting reserve gold behind notes.

## M.7 Delivery slices and gates

| Slice | Minimal deliverable | Gate before expanding |
|-------|---------------------|-----------------------|
| G1 | Gold origin ledger, fixed historical funding, no placement minting; existing wages/claims; explicit holdings labels | Zero repeatable money from town placement, founding, erase/rebuild, split or reset funding replay. |
| G2 | Mine cash budget, original-worker payouts, strict bootstrap scene and one wood supplier/input loop | Zero-start makes first wages without invented money; delivery uses mined gold; wood outage reduces output. |
| T1 | Separate transport/custody accounts, switchable T0/T1 rules and diagnostics | Gold invariant holds; T1 reveals rather than hides liquidity trapped in fees. |
| P0 | Saved paper-money checkbox, scenario/policy presets, multi-currency ledger and exact settlement API | Off matches G/T baseline; toggle/restore cannot duplicate assets or erase obligations. |
| P1 | One bank, backed deposits/redemption and consenting merchant loop (A) | No over-issue; holder can reuse/redeem; locked reserve isn't counted as free gold. |
| P2 | Bounded credit issuance/repayment/default and one productive loan (B) | Expansion adds notes, never gold; an actual repayment path exists; suspension is visible. |
| P3 | Two issuers, acceptance policies and executable FX; one-bank stress scene | Discount/rejection/run follows liquidity/trust shocks; no hidden gold or cross-currency gains. |
| P4 | Town/faction alternative (C), then adaptive acceptance and spatial FX if useful | Compare against bank presets before involving main-game influence or porting either lab. |

Do not implement all slices at once. First playable approval target is G1/G2, not a complete banking simulation.
T2 real transport payouts require a separate service-provider slice rather than arbitrary subsidies.

### Proposed code ownership (created only when its slice needs it)

- Existing `gold.js`: gold balances, transfers, extraction and wage claims; factor custody ownership here.
- Existing `actors.js`, `workers.js`, `founding.js`: mine work/input budget and original-worker earnings;
  never put worker lifecycle or note issuance into towns.
- Existing `goods.js`, `farms.js` plus a small `wood.js`: wood production/delivery/consumption; payment calls
  use the monetary owner rather than duplicating per-currency settlement arithmetic.
- New `currencies.js`: fixed-cap issuer registry, preallocated actor/worker currency balances, atomic transfer
  and denomination-aware settlement. Preserve stable worker/issuer IDs through compaction and splitting.
- New `banks.js`: issuance, redemption, reserve commitments, loan principal and default accounting.
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
preset. Transfer bank seed capital from named existing owners. Do not give banking scenes extra gold or wood.
Credit limits and acceptance networks are explicit treatment variables. Report at fixed simulation time, not
frame count or wall-clock speed. A fair baseline can fail: do not secretly add money until a scene survives.

| Scene/shock | Comparison | Evidence sought |
|-------------|------------|-----------------|
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

Confirm the five choices in the source draft before G1/G2 behavior work. Agree on the minimum bank model and
whether settings-only persistence is sufficient before P0/P1. Review measured gold-only and transport outcomes
before enabling credit; review one-bank failure before adding faction influence or wider currency routing.
