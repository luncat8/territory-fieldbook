# factory placement worklog (Phase 3)

Follows charcoal-fix-worklog.md. Implements the plan's Phase 3 remainder:
placement scan, log-paid construction, idle-rule job-site fix, factory gate.

## idle rule (plan "Factory and mine lifecycle" §3)
- `mapeFactoryWorkers` (map-economy.js): IDLE no longer advertises slots — an
  idled plant is not a job site, the pull leaves for live work.
- `mapeStepFactories` (map-industry.js): IDLE handled before the staff guard;
  wakes on the first tick with coal+iron on hand (the old wake sat after the
  `staff <= 0` guard, which is unreachable once IDLE has no slots).
- `mapeInjectDemand` (map-diffusion.js): an idled plant keeps demanding its
  inputs — demand is what lets haulage resume and wake it. IDLE stops the CO2
  draw (not burning).

## log-paid construction (plan §2, replaces MAPE_FACTORY_BUILD_IRON)
- constants (map-economy.js): `MAPE_BUILD_WOOD_RATE = 0.10` logs/builder/s,
  `MAPE_BUILD_SAWMILL_RATE = 0.02` biomass/builder/s, `MAPE_BUILD_LOG_RESERVE = 8`.
  `MAPE_FACTORY_BUILD_IRON(_MIN)` removed (dead after this).
- `mapeStepFactoryBuild` (map-industry.js): one BUILDING handler for all kinds —
  logs from local stock (massOut), or a sawmill fells its own footprint
  (biomass, outside the goods ledger). Progress `staff·dt / MAPE_BUILD_SEC`,
  material and labour both required; stalls starve.
- demand: BUILDING sites inject LOGS demand at the build rate (was iron);
  a BUILDING sawmill injects none (fells forest).
- hud: building panel shows logs/forest rate + stock instead of iron.

## placement scan (new map-factory-scan.js, loaded after map-diffusion.js)
- cadence `MAPE_SCAN_SEC = 5` accumulator on `mape.scanAcc`; skipped in scenes
  (`mapScene.id`) and when `mape.scanOn` is off (unit tests).
- region: best settlement anchor by 1/d²-weighted unmet goods need, cleared
  against `MAPE_FACTORY_THRESHOLD = 6.0`. Unmet is the plan's
  `pop·rate − delivered` normalised by the rate → `pop·(1 − satGoods)`, so the
  threshold reads in persons' worth of uncovered need (engine-rate independent).
- regional stocks over the anchor's 12-cell disc gate the kind:
  - `GENERAL` only when coal **and** iron goods are on hand **and** stock-carrying
    deposits of both inputs exist (no ORE-bound mine → never chosen; BFS walking
    haul fields anchor it on the deposits, `w = stock/(1+haul)`);
  - below `MAPE_BUILD_LOG_RESERVE` only a `SAWMILL` (wood before wood is spent;
    hard floor `mapeForestCover ≥ 0.45`);
  - else the log-fed works the region is shorter of, ties toward coal.
- site: centroid snapped within `MAPE_FACTORY_SNAP = 2`, scored by deposit stock
  over walking distance − `MAPE_DISTURB_PENALTY · disturbed` + 0.35·pop proximity;
  legal = walkable, non-settlement, clear of sites, `MAPE_FACTORY_SPACING = 4`
  from other factories.
- sawmill output now scales `MAPE_SAWMILL_RATE · (1 + 0.15 · cover)` (plan §3).

## gate — experiments/mape_factory.js (all pass)
no-logs builds nothing then starts within one scan of logs · scan waits for the
5 s interval · build time halves when staffing doubles (0.125 vs 0.250 in 10 s) ·
general plant within 3 cells of the stock-weighted centroid of two deposits
10 apart (site 23,30 vs expected 25,30) and town move along the bisector
shifts it 0 cells · sawmill never below 0.45 cover (placed at 0.80) and output
rises with cover (1.183 → 1.265) · no GENERAL on the seeded map in 60 s of live
scans (4 log-fed builds) · cap stops builds · full build completes in 401 ticks
and massIn/out residual 1e-13.

## test fallout fixed
- mape_fluid: `factory_builds_with_iron` → seeds logs (`..._with_logs`),
  `factory_starves_without_iron` → `..._without_logs`.
- mape_spread: `mape.scanOn = false` (physics unit tests measure an
  undisturbed map); coal-chain factory staffed while ACTIVE (`facPopActive`)
  and a new `idle_factory_releases_workforce` check — the never-supplied
  factory idles at 40 s and releases its pop, which is the plan's rule.

## validation
L0 `node --check` on every changed .js. L1: all 14 experiments exit 0 —
smoke, dom_smoke, mape_scenes, mape_population, mape_fluid, map_views,
mape_spread, mape_compare, mape_forest, mape_forestry, mape_factory,
mape_fluid_migration, survey_spread, hydrology.

## next
Phase 4: `mapeStepSites` (distance-priced orders, SoA shipment delay pool,
stock satisfaction, margin-based placement). Then Phase 5: HUD sites toggle,
+10% player influence boost, victory stability, mape_compare extension.
