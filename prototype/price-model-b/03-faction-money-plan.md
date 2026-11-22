# 03 · Faction money and influence

Status: design for future work. Builds on 01 (price diffusion), 02 (gold as
universal money) and 04 (optimizing firms, worker purses and town taxes).

A faction can issue its own money, called **notes**. Notes are an item
traded with exactly the same mechanics as coal or goods: a stock field, a
price field in gold that buyers inject and that diffuses and decays, and
uphill transport. The note price is not capped or fixed by law. It ends up
wherever holders and the faction's treasury bid it. Gold stays the unit of
account for every price field, because fields add linearly and must share
one unit. A note's gold price at a cell is the local exchange rate.

## Setting

`Faction money` checkbox, off by default. Off: gold only, exactly as in 02.
On: towns that join a faction adopt its notes, and the treasury tools
appear.

## Influence → membership

- Player influence is a per-faction field (the game's `territory.js`
  already has per-faction influence and control). A town joins the faction
  whose control at its cell beats a threshold and leaves when control is
  lost.
- In the lab, a `Claim` tool toggles a town into the player faction, and
  the first claimed town becomes the **treasury**.
- Joining converts nothing. Town and worker gold purses stay untouched. What
  changes is that the member town collects resident living taxes in notes
  (tax-driven legal tender). That obligation is the base demand for notes and
  does not require outside firms to accept them.

## Notes as an item

| field          | meaning                                                  |
|----------------|----------------------------------------------------------|
| `notes`        | notes on the market per cell (conserved, outside purses) |
| `priceNote`    | bid for notes in g/note: diffused, decayed, ≥ 0, no cap  |
| `notePurse`    | notes held by actors (next to the gold purse)            |
| note coin      | one note-coin field per payment stream, next to gold coin |

Bid laws follow the same pattern as goods (need, capped by ability, cooled
by stock on hand):

- **Residents of a member town:** owe living taxes in notes. Their bid for
  notes in gold is their gold tax obligation (`workerPurse × taxShare × comfort`)
  divided by their note holdings, cooled once their note purse covers the tax
  horizon. Workers short of notes bid up the local note price in gold.
- **Treasury buyback:** bids `buyRate` (g/note) for notes, capped by its
  gold reserve exactly like a town's purse caps its bid. Notes that reach
  the treasury are retired, and the seller is paid gold through a stream
  whose receivers are towns.
- **Outsiders** (non-member firms and towns that were paid in notes) have
  no use for notes. They push their note purse onto the market at their
  cell, where it climbs the note-price gradient toward member towns or the
  treasury.

Emission is the sell side:

- **Press:** while `priceNote` at the treasury beats `sellRate`, the
  treasury prints notes onto the market at `pressRate`. Buyers pay their
  local note price in gold into a stream whose receiver is the treasury.
  That gold is seigniorage and fills the reserve.

## Treasury policy (player knobs)

- **Desired gold price** of a note (the peg), e.g. 1 note = 0.25 g.
- **Exchange rates** around the peg: `buyRate` below it (where the treasury
  buys notes back) and `sellRate` above it (where it prints). The spread is
  the treasury's margin.
- **Press limit**: maximum notes printed per second.

The peg is only a wish. The treasury defends it with its reserve and its
press, nothing else. The note price is set by the diffused bids. It sags
far from member towns (decay as transport cost), can collapse when the
reserve is spent defending it, and climbs when members are short of notes.

## Game properties

- **Seigniorage vs credibility.** Printing turns notes into gold reserve
  quickly. Over-printing floods the market, the note price falls below
  `buyRate`, buybacks drain the reserve, and then the note price is free to
  fall. Members' purchasing power falls with it.
- **Influence feedback.** A member town's satisfaction reads the stability
  of its note purchasing power. Steady notes hold loyalty, and inflation
  erodes control (hook: the victory stability checks).
- **Rival currencies.** Each faction's notes are a separate item with
  their own `priceNote` field, and the cross rate at a cell is the ratio of
  the two. Border towns see both bids, so currency competition is spatial.
- **Gold mines matter more.** Gold is the reserve asset, so gold deposits
  are strategic for any faction that wants to defend a peg.

## Minimal first slice (lab)

One faction, one treasury, one note item. Only member towns' goods bills
are in notes. Firms are paid notes and dump them to market. Show: the note
stock and price maps, the treasury reserve, notes printed and retired, and
the ledger `printed − retired = market + purses + coin`.
Tests: the peg holds while the reserve lasts, collapses after, the press
fills the reserve, and the gold and note ledgers close.

## Open questions

- **How does a forest pay for CO2?** It doesn't: it gets paid, and only if
  someone makes CO2 cost something. CO2 is a bad, so its price is negative.
  A forest is a buyer of CO2 that bids a negative price, and by the 02 bill
  rule (`price × units` at the buyer's cell) a negative bill sends gold
  from the emitter to the forest. In a gold-only world, free disposal into
  the air pins the CO2 price at zero, so forests earn nothing and lose to
  logging. A faction makes the price negative in one of two ways:
  - an emission levy: emitters in its territory owe `CO2 × carbon price`
    in notes, paid through a stream whose receivers are forests (forests
    inject the ask);
  - paying from the press: the treasury bids for uptake and pays forests
    with new notes, so the commons is funded by inflation.

  Either way the carbon price is a policy knob, just like the peg.
- Credit: can a treasury lend notes to firms (owed denominated in notes),
  and what is the interest rate field?
- Whether outsiders should be allowed to hold notes as savings (a store of
  value when the note price rises), not only dump them.
- Wages inside the territory: notes or gold? Notes make the currency
  self-sustaining (members earn notes, not only buy them), but they need a
  rule for how firms acquire notes.
