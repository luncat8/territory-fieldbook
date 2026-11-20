// owns: factory placement scan gate — no-logs, staffing, deposit centroid, cover, cap, ledger
// run: node experiments/mape_factory.js

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const [, file] of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
	vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}

let failures = 0;
function check(name, ok, extra) {
	console.log('check_' + name + '=' + (ok ? 'pass' : 'fail') + (extra ? ' ' + extra : ''));
	if (!ok) failures++;
}

function cell(x, y) {
	return y * world.size + x;
}

// Controlled ground: walkable meadow, no towns, no sites, no forest, no stock.
function blank() {
	main.setup(START_SEED, '', 0, MAPE_ENGINE.DIFFUSION);
	world.terrain.fill(TERRAIN.MEADOW);
	land.disturbed.fill(0);
	economy.biomass.fill(0);
	sites.state.fill(SITE_STATE.GONE);
	sites.stock.fill(0);
	mape.pop.fill(0);
	mape.demand.fill(0);
	mape.goods.fill(0);
	mape.workforce.fill(0);
	mape.cellExport.fill(0);
	mape.workshopCount = 0;
	mape.mineCount = 0;
	mape.satGoods.fill(0);
	mape.satCoal.fill(0);
	mape.fixedResidents = true;
	mape.surplusFeedback = true;
	mapeSetWorkforceMode(MAPE_WORKFORCE_MODE.RESIDENTS);
	mape.scanOn = true;
	mape.scanAcc = 0;
	mapeRebuildSettlements();
}

function town(x, y, pop) {
	mape.pop[cell(x, y)] = pop;
	mapeRebuildSettlements();
}

// Gate 1: a region with unmet goods and no logs builds nothing, then starts
// within one scan of logs arriving (and only on the scan cadence).
blank();
town(25, 25, 18);
mapeScanRun();
check('no_logs_builds_nothing', mape.factoryCount === 0, 'count=' + mape.factoryCount);
mape.goods[MAPE_RES.LOGS * world.n + cell(25, 25)] = MAPE_BUILD_LOG_RESERVE + 2;
mape.scanAcc = 0;
for (let k = 0; k < 99; k++) mapeScanStep(0.05);
check('scan_waits_for_interval', mape.factoryCount === 0, 'count=' + mape.factoryCount);
// 0.05 does not sum exactly; the 5 s boundary lands on call 100 or 101.
mapeScanStep(0.05);
mapeScanStep(0.05);
check('starts_within_one_scan_of_logs',
	mape.factoryCount === 1 &&
	mape.factoryState[0] === MAPE_FACTORY_STATE.BUILDING &&
	(mape.factoryKind[0] === MAPE_FACTORY_KIND.CHARCOAL || mape.factoryKind[0] === MAPE_FACTORY_KIND.WOOD),
	'count=' + mape.factoryCount + ' kind=' + mape.factoryKind[0]);

// Gate 2: build time is inversely proportional to staffing — doubling the
// builders halves the time, so the progress gained in a fixed window doubles.
blank();
mape.scanOn = false;
const b1 = mapeAddFactory(20, 20, MAPE_FACTORY_STATE.BUILDING);
mape.goods[MAPE_RES.LOGS * world.n + cell(20, 20)] = 100;
mape.pop[cell(20, 20)] = 1;
const b2 = mapeAddFactory(40, 40, MAPE_FACTORY_STATE.BUILDING);
mape.goods[MAPE_RES.LOGS * world.n + cell(40, 40)] = 100;
mape.pop[cell(40, 40)] = 2;
for (let k = 0; k < 200; k++) mapeStep(0.05); // 10 s
const g1 = mape.factoryProgress[b1];
const g2 = mape.factoryProgress[b2];
check('build_time_halves_when_staffing_doubles',
	g1 > 0.02 && Math.abs(g2 / g1 - 2) <= 0.2,
	'g1=' + g1.toFixed(3) + ' g2=' + g2.toFixed(3));

// Gate 3: two deposits 10 cells apart place a general factory within 3 cells of
// their weighted centroid, and moving the towns does not move it more than 3
// cells. The towns sit on the perpendicular bisector so haul to both deposits is
// equal and the centroid is the plain stock-weighted midpoint.
blank();
const fuelSite = sitesPlaceDeposit(cell(20, 30), RES.FUEL, SITE_STATE.VISIBLE);
const oreSite = sitesPlaceDeposit(cell(30, 30), RES.ORE, SITE_STATE.VISIBLE);
mapeSeedMines();
town(25, 20, 18);
town(25, 40, 16);
mape.goods[MAPE_RES.COAL * world.n + cell(25, 20)] = 20;
mape.goods[MAPE_RES.IRON * world.n + cell(25, 20)] = 20;
mapeScanRun();
const wFuel = sites.stock[fuelSite];
const wOre = sites.stock[oreSite];
const expX = (wFuel * 20 + wOre * 30) / (wFuel + wOre);
const firstX = mape.factoryCount === 1 ? mape.factoryX[0] : -1;
const firstY = mape.factoryCount === 1 ? mape.factoryY[0] : -1;
check('general_at_deposit_centroid',
	mape.factoryCount === 1 && mape.factoryKind[0] === MAPE_FACTORY_KIND.GENERAL &&
	Math.abs(firstX - expX) <= 3 && Math.abs(firstY - 30) <= 3,
	'kind=' + (mape.factoryCount ? mape.factoryKind[0] : '-') + ' site=' + firstX + ',' + firstY + ' expected=' + expX.toFixed(1) + ',30');
mapeRemoveFactory(0);
mape.pop[cell(25, 20)] = 0;
mape.pop[cell(25, 40)] = 0;
town(25, 15, 18);
town(25, 45, 16);
mapeScanRun();
const moved = mape.factoryCount === 2 && mape.factoryState[1] !== MAPE_FACTORY_STATE.GONE;
const dx = moved ? mape.factoryX[1] - firstX : 99;
const dy = moved ? mape.factoryY[1] - firstY : 99;
check('town_move_keeps_site',
	moved && Math.sqrt(dx * dx + dy * dy) <= 3,
	'dx=' + dx + ' dy=' + dy);

// Gate 4a: a sawmill is never placed below 0.45 forest cover.
blank();
for (let y = 38; y <= 42; y++) {
	for (let x = 38; x <= 42; x++) economy.biomass[cell(x, y)] = 1;
}
town(40, 40, 18);
mapeScanRun();
const sawOk = mape.factoryCount === 1 && mape.factoryKind[0] === MAPE_FACTORY_KIND.SAWMILL;
const sawCover = sawOk ? mapeForestCover(mape.factoryX[0], mape.factoryY[0]) : 0;
check('sawmill_never_below_cover_floor', sawOk && sawCover >= MAPE_SAWMILL_MIN_COVER,
	'kind=' + (mape.factoryCount ? mape.factoryKind[0] : '-') + ' cover=' + sawCover.toFixed(2));

// Gate 4b: sawmill output rises with cover.
blank();
mape.demandView[MAPE_RES.LOGS].fill(1);
economy.biomass.fill(0.5);
const sA = mapeAddFactory(10, 10, MAPE_FACTORY_STATE.ACTIVE, MAPE_FACTORY_KIND.SAWMILL);
mapeStepForestryFactory(sA, cell(10, 10), 1, 1);
const outA = mape.factoryGoods[sA];
economy.biomass.fill(1);
const sB = mapeAddFactory(50, 50, MAPE_FACTORY_STATE.ACTIVE, MAPE_FACTORY_KIND.SAWMILL);
mapeStepForestryFactory(sB, cell(50, 50), 1, 1);
const outB = mape.factoryGoods[sB];
check('sawmill_output_rises_with_cover', outB > outA,
	'cover0.5=' + outA.toFixed(3) + ' cover1.0=' + outB.toFixed(3));

// Gate 5: on the seeded map no ORE mine is bound, so GENERAL is never chosen
// even after a full minute of live scans.
main.setup(START_SEED, '');
mape.scanOn = true;
for (let k = 0; k < 1200; k++) mapeStep(0.05);
let built = 0;
let general = 0;
for (let f = 0; f < mape.factoryCount; f++) {
	if (mape.factoryState[f] === MAPE_FACTORY_STATE.GONE) continue;
	built++;
	if (mape.factoryKind[f] === MAPE_FACTORY_KIND.GENERAL) general++;
}
check('no_general_without_ore_mine', general === 0, 'built=' + built + ' general=' + general);

// Gate 6: at MAPE_FACTORY_CAP no further builds start.
blank();
town(25, 25, 18);
mape.goods[MAPE_RES.LOGS * world.n + cell(25, 25)] = 20;
mape.factoryCount = MAPE_FACTORY_CAP;
mapeScanRun();
check('cap_stops_builds', mape.factoryCount === MAPE_FACTORY_CAP, 'count=' + mape.factoryCount);
mape.factoryCount = 0;

// Gate 7: massIn/massOut still close to 1e-6 through a full build.
blank();
mape.scanOn = false;
const bf = mapeAddFactory(30, 30, MAPE_FACTORY_STATE.BUILDING);
mape.goods[MAPE_RES.LOGS * world.n + cell(30, 30)] = 50;
mape.initialGoods = mapeGoodsTotal();
mape.pop[cell(30, 30)] = MAPE_FACTORY_BUILD_WORKERS;
let ticks = 0;
while (mape.factoryState[bf] !== MAPE_FACTORY_STATE.ACTIVE && ticks < 1600) {
	mapeStep(0.05);
	ticks++;
}
check('full_build_completes', mape.factoryState[bf] === MAPE_FACTORY_STATE.ACTIVE,
	'ticks=' + ticks + ' progress=' + mape.factoryProgress[bf].toFixed(3));
const residual = mapeLedgerResidual();
check('mass_balance_through_build', Math.abs(residual) < 1e-6, 'residual=' + residual.toExponential(2));

console.log('factory_scan_checks=' + (failures === 0 ? 'pass' : 'FAIL') + ' failures=' + failures);
if (failures > 0) process.exitCode = 1;
