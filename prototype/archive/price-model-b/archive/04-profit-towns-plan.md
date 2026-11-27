# 04 · Optimizing firms and towns: labor, wages, population and taxes

Every actor in the spatial economy is a profit-optimizing producer. Mines,
factories and gold mines hire workers, buy inputs and sell output; towns buy
household coal and goods to attract residents who supply labor and pay taxes.
All buyers set their buy prices with one shared optimization rule, and every
physical need has a finite buffer so no buyer demands unlimited stock even at
price zero.

## Three markets on one kernel

Coal, goods and labor share the same diffused-bid and uphill-transport kernel:

| market | sellers / suppliers | buyers (inject bid)        | unit |
|--------|---------------------|----------------------------|------|
| coal   | coal mines          | factories, towns           | g/u  |
| goods  | factories           | towns                      | g/u  |
| labor  | towns (residents)   | coal mines, factories, gold mines | g/u (wage) |

All three stock fields (`coal`, `goods`, `labor`) are conserved in `[0, 1]`:
- `producedCoal − burnedCoal = Σ coal`
- `producedGoods − consumedGoods = Σ goods`
- `suppliedLabor − workedLabor = Σ labor`

When two actor kinds buy the same input, a satisfied buyer (`bid = 0`) does
not pull down a steeper price diffusing across its cell from a rival buyer:
`stepBid` yields to `ambient` whenever `ambient > here` and `ambient > relaxed`.
Its cell room for that item also closes at its finite buffer target, so transit
shipments route around a full buyer toward the hungrier one.

## Shared profit-optimizing bid law

Every buyer computes the marginal gross value `V` of one more unit of input
(after paying complementary inputs) and sets its buy price with:

```
optimalBid(V, stock, target, cool) = INPUT_SHARE × V × max(0, 1 − stock / target) / cool
```

- **Margin (`INPUT_SHARE = 0.65`):** for supply rising with bid, bidding a
  sub-unit share of marginal value maximizes `flow × (V − bid)` and guarantees
  a positive operating margin at full scarcity; abundant nearby supply fills
  `stock` toward `target` and lowers the bid further, widening profit.
- **Finite need (`1 − stock / target`):** once local stock covers
  `BUFFER_SECONDS` (1.5 s) of operating need, marginal need is zero and the
  bid hits exact `0`. Even when coal is free (`priceCoal = 0`), a town stops
  pulling and consumes at most `pop × TOWN_COAL_NEED`.
- **Solvency (`cool`):** unpaid bills (`creditCool`) and municipal budget
  limits (`townCool`) cool bids before an unprofitable actor sinks.

## Firms: mines, factories and gold mines

- **Coal mine:** needs `MINE_LABOR` (0.25) labor per unit of coal. Marginal
  labor value is `(priceCoal / MINE_LABOR) × sellRoom`. It digs only while
  `priceCoal` beats `PRICE_GATE` and covers its wage bill.
- **Factory:** needs 1 coal and `FACTORY_LABOR` (0.25) labor per unit of
  goods. Coal and labor are complements, so each input's marginal value is
  `priceGoods` less the other input's current local cost, scaled by unsold
  output room. Rising wages narrow the coal bid; dear coal narrows the wage
  bid; the plant pauses if `priceGoods` falls below unit cost.
- **Gold mine:** needs `GOLD_LABOR` (0.25) labor at `GOLD_YIELD` g/labor
  (0.40 g/s at full crew). It bids `optimalBid(GOLD_YIELD, ...)` for labor and
  idles if local inflation pushes wages above `GOLD_YIELD`, making the gold
  standard self-regulating at high price levels.

## Towns: population, living comfort and taxes

A town is an optimizing firm whose output is habitable urban living:

- **Supplies and finite rations:** a town of `pop` residents uses at most
  `pop × TOWN_COAL_NEED` (0.01 u/person/s) coal and `pop × TOWN_GOODS_NEED`
  (0.034 u/person/s) goods, planning buffers for `min(POP_MAX, pop + 2)`.
- **Comfort and population:** smoothed ration shares `satCoal` and `satGoods`
  form `comfort = 0.2 × satCoal + 0.8 × satGoods`. Combined with worker
  affordability (`workerPurse`), population relaxes at `POP_RATE` (0.05/s)
  toward `POP_BASE + (POP_MAX − POP_BASE) × comfort × afford` (`2 … 24`).
  Coal alone caps a town near 6.4 residents; goods plus jobs grow it past 16,
  and a second factory lifts it past 21.
- **Labor supply:** residents replenish local `labor` up to their buffer at
  `pop × LABOR_PER_POP`, and town wage-ask strength scales with `pop / START_POP`
  so larger workforces draw a matching share of the wage stream.
- **Workers and taxes:** incoming `PAY_WAGE` coin lands in `workerPurse[i]`
  (workers' savings, separate from the municipal `purse[i]`). Workers pay
  living taxes `workerPurse × taxShare × comfort` into `purse[i]`; an
  unsupplied town (`comfort = 0`) collects zero tax and earns zero profit.
- **Optimal town buy prices:** with potential tax per resident `taxPerPop`,
  marginal tax per unit of goods is `(0.8 / TOWN_GOODS_NEED) × taxPerPop` and
  per unit of coal is `(0.2 / TOWN_COAL_NEED) × taxPerPop`. Because
  `0.8 + 0.2 = 1`, maximum combined ration spend is `INPUT_SHARE × taxPerPop`
  per resident — strictly below tax revenue at any positive price level.

## Gold circulation and reserves

Gold is conserved (`seeded + mined = Σ purse + Σ workerPurse + Σ coin`):

- Each stream (`coal → mines`, `goods → factories`, `wage → towns`) carries
  its own `owed` array, settled pro-rata from the payer's `purse`.
- Firms retain `RESERVE_SECONDS` (4 s) of input and wage costs as working
  capital and distribute surplus profit into `PAY_WAGE` (owner/worker income
  in towns). Towns retain one `PURSE_SECONDS` (15 s) of planned supply spend
  and circulate excess fiscal surplus back to local residents as civic wages
  while `comfort > 0`. Neither vault hoards the money supply in a closed
  economy.

## Manual verification checklist

- **Coal / Goods / Labor / Gold tabs:** all four views render stock/force on
  Map 01 with animated transfer arrows and diffused price/wage/ask on Map 02
  with 1-2-5 contours; 3D relief scales cleanly as gold inflates prices.
- **Cell inspector:** pinning a town shows `Pop`, `Coal / Goods / Labor`,
  `Coal / Goods / Wage` prices, `Town` vs `Workers` gold and positive `Profit`;
  pinning an active factory or mine shows positive `Profit`.
- **Isolated town:** placing a town far from mines and factories leaves its
  profit at `0.00/s` as its population drifts down toward `2.0`.
- **Ledgers:** Coal, Goods, Labor and Gold balance lines in the Field guide
  close simultaneously.
