# 02 · Gold as universal money

Prices in the price-diffusion economy are denominated in gold, and gold is
the only money. Nobody mints it: towns are seeded with gold once, and gold
mines dig more. Every bid is capped by the gold its buyer can spend, so the
price level is set by the gold in circulation rather than by a fixed
ceiling. Prices start from a chosen level and then float with no upper bound.

## Money supply

- **Seed.** A town arrives with `START_PRICE × NEED_RATE × PURSE_SECONDS`
  gold: exactly enough to bid the starting price (4 g/u) for one purse
  horizon (30 s) of need. This is the only place the starting price level
  enters the model.
- **Gold mine.** A gold mine digs `GOLD_RATE` (0.4 g/s) while the wage ask
  at its cell beats `ASK_GATE`, i.e. while a town is in reach to work it.
  It buys no inputs and pays everything it digs out as wages. Gold has no
  sink, so mining is inflation: prices rise around a gold mine and stay
  steady in a closed economy.
- **No minting, no wear.** Towns never emit money and coin does not decay
  in transit. Gold is conserved exactly:
  `seeded + mined = Σ purses + Σ coin in transit`.

## Bids are capped by ability

- **Town:** `bid = spendable / (NEED_RATE × PURSE_SECONDS) / (1 + goods / STOCK_REF)`,
  where `spendable = purse − owed`. Ten times the gold bids ten times the
  price. A broke town bids zero, so its goods price fades, the factory's
  derived coal bid fades and the mines idle: the chain halts until wages
  arrive.
- **Factory:** the derived bid (`INPUT_SHARE × goods price at its cell`,
  cooled by stock on hand) is further cooled by unpaid coal bills,
  `1 + owed / (margin × FACTORY_RATE × PURSE_SECONDS)`. Firms buy on credit
  and repay from revenue first; a plant that keeps falling behind stops
  buying before it sinks. The credit scale is relative to its own margin,
  so it holds at any price level.

## Bills and payment streams

A buyer pays the price in its own cell for what it consumes: a town for
the goods it eats, a factory for the coal it burns. The bill is added to
`owed` and paid from the purse at once when gold is there.

Paid gold travels as coin, using the same uphill transport as items. Each
stream has its own coin field and its own **ask** field. The ask is injected
by the stream's receivers and diffuses and decays exactly like a bid:

| stream | paid by        | receiver (injects ask) |
|--------|----------------|------------------------|
| coal   | factories      | mines                  |
| goods  | towns          | factories              |
| wage   | all firms      | towns                  |

Goods climb the buyer's bid; gold climbs the seller's ask. A payer is never
the receiver of the stream it pays into, so coin always leaves the paying
cell. Coin that reaches a receiver joins its purse on the next tick. Cell
capacity for coin is unbounded.

**Wages** close the loop. Every firm keeps `RESERVE_SECONDS` (3 s) of its
input bills as working capital (zero for mines and gold mines) and pays
the rest out at `WAGE_RATE` (1/s) into the wage stream. Without wages, gold
would pool at mines and towns would go broke.

Removing an actor sends its purse into the wage stream at its cell and
forgives its unpaid bills.

## What the lab shows

- The gold mine's town inflates without limit (goods price 2.8 → 6.9 g/u
  over four minutes). The other town, outside the gold mine's wage reach,
  keeps its price level: regional price levels emerge from where gold is
  dug.
- In a closed economy (no gold mine) the gold supply is constant, purses
  settle and the price level holds (≈2.5 g/u at both towns).
- The **Gold** view shows gold held (purses plus coin in transit, log scale)
  and the summed payment ask, with flow arrows for all three streams. Price
  legends rescale in 1-2-5 steps because prices have no ceiling.

## Main-game integration

- `map-money.js`: delete big-town minting (`MAPE_MINT_*`) and transit wear
  (`MAPE_PAY_WEAR`). Town seed cash (`25 × pop`) becomes the gold seed,
  calibrated to the starting price. The two owed-pull pay stocks (BUY,
  WAGE) become ask-steered coin streams, one per receiver kind, steered by
  ask fields injected by receivers instead of by owed pull.
- `map-industry.js`: a gold deposit is a mine kind whose output goes
  straight into its purse; it pays out wages like any firm.
- The money ledger keeps its shape with `mined` replacing `minted` and no
  wear term.

## Open questions

- Gold mines never deplete, so inflation never ends. Deposit depletion
  (finite gold per deposit) is the natural brake.
- The mine gate (`PRICE_GATE`) and the gradient knee are fixed in gold.
  Under inflation they become relatively cheaper, so production and
  transport loosen as prices rise. They may need to scale with the local
  price level or with wages.
- Transport is free in gold: decay weakens the signal, but the seller is
  paid the buyer's full price. Carriers earning the price gap would add a
  real transport cost and a gold sink.
