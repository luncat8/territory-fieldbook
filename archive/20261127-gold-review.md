Created the **[design and implementation plan](plan-gold-and-paper-money.md)** and a concise **[draft with requirements and open decisions](draft/gold-and-paper-money.md)**. No runtime changes yet.

### What inspection found
- Both prototypes already credit mined gold directly to the mine—**there is no gold cargo item**. The holdings overlay can remain.
- Initial funding and placing towns can create gold; these need separating from mining.
- The particle mine has no purchased-wood input yet.
- Transport fees enter a shared vault that redistributes funds to towns. This conserves money, but obscures economic ownership and circulation.

### Recommended sequence
1. **Gold-only baseline:** mining is the only source of new gold; mine wages and genuine input purchases release it into circulation. Test both historical starting wealth and a strict zero-gold bootstrap.
2. **One fully gold-backed bank:** prove note ownership, acceptance, redemption and the saved checkbox.
3. **Credit-issuing bank:** test whether lending notes funds productive activity when gold is insufficient.
4. **Two competing banks:** compare acceptance, discounts, exchange liquidity and bank runs.
5. **Town/faction notes:** retain as an alternative driven by taxes or useful services, with influence affecting adoption—not confiscating wallets.

**Important distinction:** fully backed notes mostly replace circulating gold; they do not automatically solve a gold shortage. Credit notes expand spendable claims, but introduce default and redemption risk. Scarcity alone does not make people accept an issuer’s paper.

### Choices before implementation
My proposed defaults are:
- **Mine payouts:** wages and necessary inputs only; defer owner dividends.
- **Starting wealth:** allow explicitly recorded historical gold, plus a separate zero-start scenario.
- **Banking:** backed-note control first, then credit as a selectable experiment.
- **Saving:** persist checkbox/settings initially; complete world resumption is separate.
- **Payments:** keep direct remote settlement as an explicit prototype abstraction; defer physical currency shipments.

The plan includes accounting invariants, issuance and repayment flows, acceptance/FX rules, safe disabling with outstanding notes, and controlled comparison scenarios.

**Next step:** confirm or adjust these defaults, then implement the gold-only baseline before banking. Documentation links and whitespace checks passed.