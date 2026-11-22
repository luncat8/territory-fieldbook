# Price model B · diffusion propagation as demand from buyer

One field per resource does both jobs the old money prototype split in two:
it carries the buyer's demand and it steers the goods. Buyers inject a bid
(price), the bid diffuses across the map and weakens with distance, and stock
climbs the price gradient toward the highest bid. There is no separate demand
field. A factory that lacks an input derives its bid for that input from the
sell price of its product at the factory's own cell, so the price signal
travels backward through the production chain while goods travel forward.

## Why the old money prototype needed rework

The shipped price law (`map-money.js`) computes a local price from local pull
and local stock, but goods are steered by the pull, not by the price. A cell
can be dear yet pull nothing, or pull goods it values at 1×: two fields, two
truths. The pull knows nothing about value, so the purse patches it after the
fact (dear prices lower the purse, which lowers the pull, which lowers the
price) with no single owner of the loop. Factory inputs are free, so the
goods price never reaches the mine: the value chain is broken at the plant.
Price has no distance penalty, so a distant mine sees the same price as a
near one. And the owed pull is a third diffused field steering money with a
third decay. Price model B replaces all of that with one mechanism.

## Fields

Per resource (coal, goods in the lab; coal, iron, goods, food in the game):

- **Stock** (items per cell, conserved): produced, burned, eaten and moved by
  fraction-of-stock transfers. Ledgers close per resource.
- **Price** (money per unit, not conserved): injected by buyers, diffused,
  decayed. Price is a signal, never a stock; its dissipation is not material
  loss, exactly as signed demand decay was not.

Price starts at zero. Zero is the natural floor: no buyer, no price, no
trade. There is no ambient price and no fill preset.

## Bid laws

A bid is need capped by ability, cooled by the stock already on hand. The
cooling is the stock feedback, moved from the pull onto the price:

- **Town** (buys goods): `bid = BID_MAX / (1 + goods / STOCK_REF)`. A flooded
  town stops pulling distant stock because its diffused bid falls, not because
  a separate signal tells it to.
- **Factory** (buys coal, sells goods): the input budget is derived from the
  output price at the factory cell, `budget = price_goods × YIELD × SHARE`,
  split across inputs by recipe weight, so `bid_coal = budget × w / q` for
  `q` units of coal per unit of output. The bid is cooled by coal on hand
  (do not overbuy) and by goods on hand (do not produce into an unsold pile).
  With `SHARE < 1` the factory keeps a margin and the loop gain stays below
  one: dear goods pull coal in, cheap goods starve the plant. With two inputs
  the budget splits by cost weight; neither input can bid the output price
  away from the other.

Quantity stays separate from price. A town eats at a fixed need rate and a
factory burns at a fixed rate, each capped by a short intake queue, exactly
as the queue engine does today. Price steers; need feeds. That separation is
what keeps the model from flooding a buyer with infinite goods at a high
price.

## Diffusion and transport cost

Price diffuses with one Jacobi pass per tick and decays while it travels:

```
next = here + dt × (D/6 × laplacian − decay × here)
```

Reach is `sqrt(D / decay)`, an outcome, never a cutoff. Decay is the
transport cost: a bid injected in a town arrives at a distant mine weakened,
so the mine sees a lower price and the gradient that pulls its stock is
flatter and slower. The lab runs `D = 15`, `decay = 0.08` at `dt = 1/60`
(reach ≈ 13.7 cells). At the game's canonical tick (`dt = 0.05 s`, `D ≤ 3`
by the units rule) the same reach needs `decay ≈ 0.016`.

Stock moves by fraction-of-stock uphill transfers on the price gradient of
its own resource, with smoothed steering, a gradient knee and headroom
resolution against pre-transfer room. The knee is where transport cost bites
hardest: a near-zero distant gradient moves almost nothing.

## Production gate instead of floor spread

A mine produces only while the coal price at its cell beats a small gate
(the cost of digging and hauling). Beyond the faded price it idles instead
of producing into a void. That replaces the zero-floor spread the demand
lab needed: with no buyer there is no price, production stops, stock waits
at the source, and the chain halts gracefully. A factory produces only while
inputs are on hand. No signed field, no ambient consumption, no special
case.

## Money

Bills are `price × units` at the buyer's cell. The purse caps the bid
(ability), so a broke town bids low and pulls little — the old buy factor,
now owned by the bid law instead of scaling the pull. Minting and transit
wear are untouched: the money supply is orthogonal to steering and neither
reads the other. Player trade uses the same diffused price at the market
cell; the separate scarcity ratio goes away.

## Game properties

- **Factory siting is a tradeoff.** A factory wants a high goods price
  (near towns) and a low coal price (near mines). The margin between the two
  diffused fields at its cell is the siting score; the old fixed yard pull
  had no such tradeoff.
- **Towns have a hinterland.** Beyond the faded price, mines idle and goods
  do not move. Distance is priced without any explicit shipping cost.
- **Competition bids up.** Overlapping diffused bids add (the PDE is
  linear), so two towns bidding for one mine raise its price. That is the
  intended auction, not an artifact.
- **The map reads itself.** Purple is dear, dark is cheap, and the steering
  field is the thing drawn. No separate demand view is needed for market
  items.

## What stays demand

CO2 (signed uptake), logs (construction and forestry) and the workforce rest
pull keep their demand fields. Only market items switch to price. Labour
follows the same pattern later: a wage bid from the site's purse and job
need, diffused, with workforce climbing the wage gradient.

## Main-game integration

- `map-money.js`: the price law becomes bid injection. Towns inject
  goods/coal/food bids from need, purse and stock; factories inject input
  bids from the output-price margin; mines inject nothing. `mapeMoneyPrices`
  is deleted as a ratio; bills read the diffused price.
- `map-diffusion.js` / `map-market-demand.js`: for market items the demand
  slices carry price (same arrays, new unit and range), the transport guide
  is the price slice, and the A/B pull, catchment cooling and queue pinning
  are deleted as signals. Catchment and queue intake stay as quantity logic
  (who eats what, how fast). `mapeMarketPull` goes away.
- `map-industry.js`: factories burn inputs only while the derived bid
  justifies them; the idle rule already keys on missing inputs and stays.
- Views and tests: price layers already exist and become the steering field;
  the 0–1 pull assertions in `mape_spread` / `mape_compare` are rewritten
  for price range and depletion; the money ledger is unchanged.
- The Sites engine is compatible: its delivered-price orders can read the
  diffused bid instead of the local ratio.

## Open questions

- `BID_MAX` calibration against `RES_BASE_VALUE`: the lab uses 4 $/u flat;
  the game needs per-resource caps so coal and goods bids stay comparable.
- Two-input split weights for coal + iron: cost weights from base values, or
  recipe quantities? The lab's single input cannot decide.
- Whether the mine gate should scale with terrain speed (haul cost) once
  roads exist. The lab's flat gate is the minimal version.
