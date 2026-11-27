# Gold mines, circulation and optional paper money

## Requirements (user design brief)

- Work in the prototypes first. Inspect gold mines, transport and the connected economy.
- Before paper money, gold is money, not an item offered for sale on the map: there is no other money to buy it with.
- Gold mining is the only source of new gold in the economy. It enters circulation through miners' wages and payments for resources needed to operate or construct the mine, including wood.
- Introduce paper money as a separate next phase, unlocked by storyline or technology. A checkbox enables it; that state must be saved.
- Decide who issues paper money: banks, towns, or player factions according to influence. Banks issuing their own notes are a promising first experiment, not a settled global design.
- Explain how notes enter circulation; who first needs them when gold is insufficient; who accepts them and at what price; competition between currencies; stability and exchange rates against gold.
- Develop a draft and plan before implementation. Keep several approaches available to implement and compare.

## Proposed design for discussion (not approved requirements)

- Keep gold balances, mine markers and a gold-holdings overlay, but no unowned gold cargo or gold-for-gold market.
- Distinguish extraction into mine inventory from money paid out into wider circulation. Neither extraction nor payments may count the same gold twice.
- Default new-gold distribution is wages plus genuine mine input purchases; retained gold funds future mine expenses. No arbitrary town grants or creation on actor placement.
- Start with a gold-only baseline and explicit historical initial balances. Also test a zero-gold bootstrap using founder labor, local construction materials and payment from actual extraction.
- Retain simplified transport initially, but expose transport cash accumulation and redistribution separately from mining. Compare the existing town drip with payouts for actual services.
- Use gold grams as the common accounting reference initially, with separate balances for every bank's notes. Never sum different currencies as nominal units.
- Compare gold-backed redeemable banknotes (control), bank credit notes (liquidity experiment), and town/faction notes (tax/service demand experiment).
- Enabling notes neither converts existing gold nor gives everybody free notes. Turning notes off cannot delete outstanding balances or debts.

## Decisions needing confirmation

1. Does “only miners' wages” mean wages are the only payout besides necessary mine inputs, or may mines later distribute owner profit? Proposed default: wages and necessary inputs only; no owner dividend yet.
2. May a scenario start with historical mined gold in existing wallets, or must every scenario begin at zero? Proposed default: historical-gold reference scenario plus a strict zero-start test.
3. Is fractional/credit issuance allowed, including default and bank runs, or should the first paper-money feature remain fully redeemable? Proposed sequence: fully backed control, then a separate credit preset.
4. Is saving the checkbox across reloads enough initially, or is complete resumable simulation saving required now? Proposed default: persist settings first, label that clearly, and keep complete monetary state in the snapshot contract.
5. Is direct remote payment acceptable as the first lab abstraction? Proposed default: yes, visibly distinguished from physical transport; currency shipping, caravans and robbery are deferred.

Implementation and comparison design: [Gold and paper money plan](../plan-gold-and-paper-money.md).
