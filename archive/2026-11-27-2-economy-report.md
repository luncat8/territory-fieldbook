### 1. Why `price-model-b2` Looked Smooth While `particle-transfer-b2` Stalled

`prototype/price-model-b2` is an **Eulerian cell-fluid** lab, whereas `prototype/particle-transfer-b2` is a **Lagrangian discrete-particle / individual-worker** lab:

| Mechanism | `price-model-b2` (Eulerian fluid) | `particle-transfer-b2` before fix |
|---|---|---|
| **Transport & haulage** | Continuous cell-to-cell density advection (`FLOW_RATE = 7`, `LABOR_FLOW_RATE = 12`) up normalized price gradients with **no nominal per-cell haul fee**. | Discrete batches accrued a hardcoded nominal fee `HAUL_COST_RATE = 0.032 g/u/cell` (`~0.038 g/u/cell` on meadow/forest). |
| **Town taxes & purse recycling** | `taxPerPop` derives directly from live worker wallets (`price-model-b2/gold.js`), and town `purse > reserve` rebates back to residents every tick. | `BASE_REST_FEE = 1.05 g` / `BASE_RATION_FEE = 0.45 g` floors and no excess-purse rebate let towns hoard **41.2% (`30.78 g`)** of all gold while `entry_wage` was `0.099 g`. |
| **Buyer intake** | Continuous stock transfer into cell storage. | `admitKind` shaved **all** waiting particles proportionally (`room / req`), splitting batches into hundreds of unsellable crumbs. |
| **Monetary scale** | `gold-seeding.test.js` already audited `0.5 / 1 / 2 g/worker` circulation after starting gold dropped from `~14 g/worker` to `1 g/worker`. | Still carried `[g^1]` gates, knees, split floors, display ramps, and fixed `1e-6` / `1e-9` gold epsilons calibrated to the old `14 g/worker` regime. |

---

### 2. Root Causes Behind Your `t=01:26 (5201 ticks)` Snapshot

1. **Nominal haulage exceeded spatial price decay ($\kappa \bar{p}$), freezing `coal` and `food` mid-road:**
   - Diffused buyer bids decay spatially at rate $\kappa = \sqrt{\text{fade} / D} \approx 0.073\text{ cell}^{-1}$. A producer $d$ cells away only sees an uphill slope when per-cell haulage $h < \kappa \bar{p}$.
   - With `HAUL_COST_RATE = 0.032` (`~0.038 g/u/cell`), **any good priced below `~0.52 g/u` went underwater in transit** (`coal ask 0.459` with `haul = 0.323` -> **96 of 97 coal particles stopped**; `food ask 0.245 > town bid 0.057` -> **109 food particles stranded**, `10.48` spoiled, causing the farm's `1.50 g` bank default).
   - Starved of coal, factories at `13,13` (`labor=5, coal=0`) and `11,20` (`labor=3, coal=0`) held `8+` workers in shift/pool slots instead of `1` standby worker, leaving almost no walkers on the map (`walking=4`, `goods_made=0.20`, `goods_eaten=0.02`).
2. **Proportional `admitKind` shaving created crumb storms:**
   - Whenever a town consumed a tiny sliver of shelf space, `admitKind` multiplied *every* waiting particle by `room / req`, leaving hundreds of `~0.002 u` stopped crumbs and tens of thousands of micro-deliveries, while also reading stale owner cash across multi-site buyers in the same tick.
3. **Barn-blind seasonal harvests & zero food dispatch gate:**
   - `itemGate(ITEM_FOOD)` was `0` (so `stepSpawn` relaxed book costs to `~0.001` and dumped entire barns onto 99%-full towns to rot on the road), and `farms.js` kept running full shift crews even when a farm's own output depot was already full.
4. **Residual `[g^1]` nominal constants and epsilons broke arbitrary-scale invariance:**
   - Nominal gates (`SAWMILL_GATE = 0.10`, `PRICE_GATE = 0.01`, `FARM_MIN_PRICE = 0.12`, `WALLET_REFERENCE = 8`, `wealthRatio >= 0.45`, `BASE_REST_FEE = 1.05`, `BASE_RATION_FEE = 0.45`, `START_PRICE * 1.5` claim cap, `WORKER_SPLIT_GOLD = 16`).
   - Fixed `[g^1]` steering/money thresholds (`GRADIENT_KNEE`, `DOCK_SLOPE`, `gLen > 1e-9` and `+ 1e-6`/`+ 1e-9` neighbor checks in `steering.js`, `bid + 1e-6 >= ask` in `goods.js`, and `1e-9`/`1e-6` wallet/cash checks in `workers.js`, `gold.js`, `owners.js`, `banks.js`) — at micro-denominations (`1e-6 g/worker`), `gLen ~ 1e-10` fell below `1e-9` and stalled trade completely.
5. **Visual & HUD defects:**
   - `ACTOR_TAGS` in `track.js` lacked `[ECONOMY_SAWMILL]: 'S'`, rendering sawmill actor tags/badges as `SNaN` (`"S" + undefined` coerced to `NaN`).
   - `fields.js` used fixed nominal `8–16 g` color ramps that washed out `1 g/worker` price/gold overlays.

---

### 3. Key Fixes Applied (`prototype/particle-transfer-b2/`)

- **Scale-invariant monetary kernel & steering (`gold.js`, `owners.js`, `banks.js`, `simulation.js`, `steering.js`):**
  - Added `money.unitScale()` / `money.eps()` (`1e-9 * scale`), live peak-relative `fieldKnee` / `fieldDock` (`REL_KNEE * peak`, `2.5e-3 * peakLabor`, `REL_DOCK * peak`), and relative neighbor/gradient comparisons (`Math.abs(here) * 1e-12`, `gLen > 0`).
- **Labor/value-relative haulage, dispatch gates & whole-particle FIFO intake (`goods.js`, `actors.js`):**
  - Derived haulage accrues `max(HAUL_LABOR * priceLabor, HAUL_VALUE_FLOOR * priceKind) * amount * ds / conductance`, keeping transport profitable across multi-cell routes at every money scale.
  - Added labor-relative `itemGate` floors (`4–8 * HAUL_LABOR * priceLabor`, `0.15 * priceLabor * SAWMILL_LABOR`) so depots hold inventory when buyers cannot cover road haulage.
  - Replaced proportional shaving in `admitKind` with sequential whole-particle FIFO admission against live `room[cell]` and `money.cashAt(cell)` (splitting only the boundary particle).
  - Tuned batch/motion pacing (`SPAWN_UNIT = 0.06`, `GOODS_SPEED = 5`, `WORKER_SPEED = 7`) so steady streams of visible particles and workers traverse the map.
- **Wallet-adaptive town fees & reserve rebates (`towns.js`, `workforce.js`, `settlement.js`):**
  - Derived rest and ration fees scale with observed local worker wallets (`REST_WALLET_SHARE = 0.24`), and town purses above operating reserve (`max(4, pop) * 1.5 * refRestFee`) rebate to resting workers.
- **Balanced firm/farm staffing & splitting (`workers.js`, `worker-life.js`, `farms.js`, `founding.js`):**
  - Coal-less factories hold at most `1` standby worker (`totalCap = 1` while `coal <= 1e-6`); farms size `crewTarget` from dimensionless `priceFood / wage` (`1..12`) and pause field shifts when their output depot is full (`outputHeld >= 1.5 * FARM_YIELD`, `FARM_SPACING = 22`, `SAWMILL_SPACING = 12`); derived worker split threshold scales as `0.5 * money.unitScale()` (`births = 4` by `t=02:00`).
- **UI & rendering (`track.js`, `fields.js`, `diagnostics.js`, `ui.test.js`):**
  - Added `S` tag for `ECONOMY_SAWMILL`, adaptive field/purse normalization in `fields.js`, scale-relative diagnostics flags, and a `fillText` `!txt.includes('NaN')` assertion in `ui.test.js`.

---

### 4. Verification

#### A. `t=01:26 (5201 ticks)` & `t=02:00 (7200 ticks)` Reference Runs (`1 g/worker` default)

| Metric | Before (`5201` ticks) | After (`5201` ticks) | After (`7200` ticks) |
|---|---:|---:|---:|
| `coal` made / burned | `15.5` / `8.1` (`96/97` stopped) | **`26.82` / `18.30`** (`ask 0.050 < bid 0.092`) | **`35.71` / `29.99`** |
| `goods` made / eaten | `0.20` / `0.02` | **`12.41` / `11.93`** (`0` stopped) | **`21.51` / `19.40`** |
| `food` made / eaten | `37.80` / `19.8` (`10.48` spoiled, underwater) | **`62.40` / `25.31`** (`0` hungry, `0` starved) | **`70.11` / `43.87`** |
| `wood` made / built | `~1.0` / `1.0` | **`8.09` / `6.18`** (`0` stopped, `0` spoiled) | **`11.16` / `8.27`** |
| `workers` / `births` / `deaths` | `24` / `0` / `0` (`8+` stuck in empty factories) | **`24` / `0` / `0`** (`11` shift, `6` walking, `4` room) | **`28` / `4` / `0`** |
| `town_purse` share | `41.2%` (`30.78 g`) | **`21.5%` (`16.07 g`)** (`wallets = 55.2%`) | **`~20%`** |
| Bank `defaults` / `firm_owed` | `1` default (`1.50 g` lost) | **`0` defaults / `0.000 g` owed** | **`0` defaults** |
| Gold ledger error | conserved | **`-6.6e-13 g`** | **`-4.2e-12 g`** |

#### B. Closed-Economy Redenomination Invariance (`55 s` = `3300` ticks, gold mine removed)

Across **12 orders of magnitude** of starting gold (`goldPerWorker`), real physical trajectories and normalized monetary flows match to **15 significant digits** (and `0` gold runs cleanly with zero minted gold, zero `NaN`s, and survival by foraging):

| `goldPerWorker` | `coalMade` | `goodsMade` | `goodsEaten` | `woodMade` | `foodMade` | `workedLabor` | `wages / gpw` | `taxes / gpw` | Rel. gold error |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `0` | `0` | `0` | `0` | `0` | `0` | `0` | `0` | `0` | `0` |
| `1e-6` | `27.3203272727279` | `19.5085978520856` | `13.3455156860063` | `3.8081229386919` | `62.1898122163611` | `79.9908176372937` | `2.1663507970852` | `3.7518873958109` | `4.2e-16` |
| `0.5` | `27.3203272727279` | `19.5085978520856` | `13.3455156860063` | `3.8081229386919` | `62.1898122163611` | `79.9908176372937` | `2.1663507970852` | `3.7518873958109` | `1.9e-15` |
| `1` | `27.3203272727279` | `19.5085978520856` | `13.3455156860063` | `3.8081229386919` | `62.1898122163611` | `79.9908176372937` | `2.1663507970852` | `3.7518873958109` | `1.9e-15` |
| `2` | `27.3203272727279` | `19.5085978520856` | `13.3455156860063` | `3.8081229386919` | `62.1898122163611` | `79.9908176372937` | `2.1663507970852` | `3.7518873958109` | `1.9e-15` |
| `14` | `27.3203272727279` | `19.5085978520856` | `13.3455156860063` | `3.8081229386919` | `62.1898122163611` | `79.9908176372937` | `2.1663507970852` | `3.7518873958109` | `1.2e-15` |
| `1e6` | `27.3203272727279` | `19.5085978520856` | `13.3455156860063` | `3.8081229386919` | `62.1898122163611` | `79.9908176372937` | `2.1663507970852` | `3.7518873958109` | `3.1e-16` |

#### C. Test Suites & Standing Docs
- `node --check prototype/particle-transfer-b2/*.js`: **pass**.
- All **12** test suites in `prototype/particle-transfer-b2/*.test.js` (`52/52` subtests, including new `gold-seeding.test.js` and `NaN` canvas text guard in `ui.test.js`): **pass** with zero modifications to existing test assertions.
- Updated `plan-particle-transfer.md`, `plan-gold-and-paper-money.md`, `findings-pitfalls-skills.md`, and `archive/gold-and-paper-money-worklog.md` (`git diff --check` clean).