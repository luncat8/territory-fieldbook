// owns: Phase 4 site engine gate — price matching, delay pool, stock satisfaction, margin siting, ledger
// run: node experiments/mape_sites.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const [, file] of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
	vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}

function cell(x, y) {
	return y * world.size + x;
}

function dist(a, b) {
	const size = world.size;
	const dx = (a % size) - (b % size);
	const dy = ((a / size) | 0) - ((b / size) | 0);
	return Math.sqrt(dx * dx + dy * dy);
}

function advance(seconds) {
	for (let k = 0, count = Math.round(seconds / SIM_STEP_SEC); k < count; k++) main.step(SIM_STEP_SEC);
}

// Controlled ground: walkable meadow, no towns, no sites, no stock — the Sites engine only.
function blank() {
	main.setup(START_SEED, '', 0, MAPE_ENGINE.SITES);
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
	mapeSetWorkforceMode(MAPE_WORKFORCE_MODE.RESIDENTS);
	mapeInit(MAPE_ENGINE.SITES);
	mape.surplusFeedback = false;
	mape.scanOn = false;
	mape.scanAcc = 0;
	mape.fixedResidents = true;
	mapeRebuildSettlements();
}

function town(x, y, pop) {
	mapePlaceSettlement(cell(x, y), pop, false);
	mapeRebuildSettlements();
}

// Gate 1 — distance-priced order: the abundant far seller beats the scarce near
// one on price, then the shipment lands exactly eta = dist / speed later.
blank();
town(10, 10, 18);
mape.goods[MAPE_RES.GOODS * world.n + cell(11, 10)] = 2;
mape.goods[MAPE_RES.GOODS * world.n + cell(30, 10)] = 500;
mapeFinishSetup(0, true);
assert.equal(mape.massOut, 0, 'warming the demand view does not consume stock');
assert.ok(mape.demandView[MAPE_RES.GOODS][cell(10, 10)] > 0, 'sites warms a signed goods demand view');
const listPrice = mapeSitePrice(MAPE_RES.GOODS, 500, 20);
assert.ok(Math.abs(listPrice - (144 / 501 + 1.6)) < 1e-12, 'delivered price = base*ref/(stock+1) + dist*transport');
advance(SIM_STEP_SEC);
assert.equal(mapeSites.shipCount, 1, 'the town places one order');
assert.equal(mapeSites.shipFrom[0], cell(30, 10), 'price matching picks the abundant seller over the near one');
assert.ok(Math.abs(mapeSites.shipEta[0] - 10) < 1e-6, 'eta = dist / MAPE_TRANSPORT_SPEED = 10 s across 20 cells');
const shippedQty = mapeSites.shipQty[0];
assert.ok(mape.transit > 0, 'in-transit stock joins the ledger as transit');
const midResidual = mapeLedgerResidual();
assert.ok(Math.abs(midResidual) < 1e-9, 'ledger balances while the shipment is in flight');
advance(9.9);
const townGoods = mape.goods[MAPE_RES.GOODS * world.n + cell(10, 10)];
assert.equal(townGoods, 0, 'no arrival before eta');
assert.ok(mape.transit > 0, 'shipment still in the pool');
advance(0.2);
assert.ok(mape.goods[MAPE_RES.GOODS * world.n + cell(10, 10)] > 0, 'shipment arrives after eta');
assert.ok(Math.abs(mape.transit) < 1e-9, 'pool drains to zero after arrival');
assert.ok(Math.abs(mapeLedgerResidual()) < 1e-9, 'ledger balances after arrival');
console.log(`order_price=${listPrice.toFixed(3)} eta_s=10.0 qty=${shippedQty.toFixed(3)} transit=${mape.transit.toFixed(3)}`);

// Gate 2 — stock-based satisfaction: a supplied settlement grows, an unsupplied
// one holds. Households spend delivered stock, so satisfaction and growth read it.
function growthSetup(withSeller) {
	blank();
	mape.fixedResidents = false;
	town(10, 10, 18);
	if (withSeller) {
		mape.goods[MAPE_RES.GOODS * world.n + cell(14, 10)] = 300;
		mape.goods[MAPE_RES.COAL * world.n + cell(14, 10)] = 300;
	}
	mapeFinishSetup(0, true);
	return cell(10, 10);
}
const supplied = growthSetup(true);
const startSupplied = mape.pop[supplied];
advance(120);
const endSupplied = mape.pop[supplied];
const endSatG = mape.satGoods[supplied];
const endSatC = mape.satCoal[supplied];
assert.ok(endSupplied > startSupplied + 1, `supplied settlement grows ${startSupplied.toFixed(1)} -> ${endSupplied.toFixed(1)}`);
assert.ok(endSatG > 0.9 && endSatC > 0.9, 'satisfaction reads delivered stock');
assert.ok(mape.massOut > 0, 'households consumed delivered stock');
assert.ok(Math.abs(mapeLedgerResidual()) < 1e-6, 'exact conservation through growth');
const hungry = growthSetup(false);
const startHungry = mape.pop[hungry];
advance(120);
assert.ok(mape.pop[hungry] <= startHungry + 1e-6, `unsupplied settlement does not grow ${startHungry.toFixed(1)} -> ${mape.pop[hungry].toFixed(1)}`);
assert.ok(mape.satGoods[hungry] < 0.1, 'no delivery, no satisfaction');
assert.ok(Math.abs(mapeLedgerResidual()) < 1e-6, 'exact conservation on the dry map');
console.log(`supplied=${startSupplied.toFixed(1)}->${endSupplied.toFixed(1)} hungry=${startHungry.toFixed(1)}->${mape.pop[hungry].toFixed(1)} satG=${endSatG.toFixed(3)} satC=${endSatC.toFixed(3)}`);

// Gate 3 — margin siting: the hungry town's price outweighs the haul to the
// inputs, so the plant lands on the demand side, not on the deposit centroid.
blank();
town(10, 10, 18);
town(40, 10, 18);
mape.goods[MAPE_RES.GOODS * world.n + cell(40, 10)] = 200;
mape.goods[MAPE_RES.COAL * world.n + cell(14, 14)] = 50;
mape.goods[MAPE_RES.IRON * world.n + cell(14, 14)] = 50;
sitesPlaceDeposit(cell(10, 40), RES.FUEL, SITE_STATE.VISIBLE);
sitesPlaceDeposit(cell(20, 40), RES.ORE, SITE_STATE.VISIBLE);
mapeSeedMines();
mapeFinishSetup(0, true);
advance(10); // satisfaction settles so the stocked town stops reading as unmet
assert.ok(mape.satGoods[cell(40, 10)] > 0.5, 'stocked town reads satisfied');
mapeScanRun();
assert.equal(mape.factoryCount, 1, 'one plant planned');
assert.equal(mape.factoryKind[0], MAPE_FACTORY_KIND.GENERAL, 'regional coal and iron choose a general plant');
const site = cell(mape.factoryX[0], mape.factoryY[0]);
const dHungry = dist(site, cell(10, 10));
const dFull = dist(site, cell(40, 10));
assert.ok(dHungry < dFull, `margin sits toward the hungry buyer d_hungry=${dHungry.toFixed(1)} d_full=${dFull.toFixed(1)}`);
assert.ok(dHungry <= 6, `site stays with its buyer d=${dHungry.toFixed(1)}`);
console.log(`margin_site=${mape.factoryX[0]},${mape.factoryY[0]} d_hungry=${dHungry.toFixed(1)} d_full=${dFull.toFixed(1)}`);

// Gate 4 — build: log-fed plant placed by margin finishes inside 10–30 s with
// its crew and one delivered batch of logs.
blank();
town(25, 25, 18);
mape.goods[MAPE_RES.LOGS * world.n + cell(25, 25)] = 10;
mapeFinishSetup(0, true);
mapeScanRun();
assert.equal(mape.factoryCount, 1, 'one plant planned');
assert.equal(mape.factoryKind[0], MAPE_FACTORY_KIND.CHARCOAL, 'logs on hand plus unmet coal choose a charcoal works');
assert.equal(mape.factoryState[0], MAPE_FACTORY_STATE.BUILDING, 'plant starts in building state');
mape.pop[cell(mape.factoryX[0], mape.factoryY[0])] = MAPE_FACTORY_BUILD_WORKERS;
let buildSteps = 0;
while (mape.factoryState[0] !== MAPE_FACTORY_STATE.ACTIVE && buildSteps < 1200) {
	main.step(SIM_STEP_SEC);
	buildSteps++;
}
const buildSec = buildSteps * SIM_STEP_SEC;
assert.equal(mape.factoryState[0], MAPE_FACTORY_STATE.ACTIVE, 'plant comes online');
assert.ok(buildSec >= 10 && buildSec <= 30, `build time inside 10-30 s: ${buildSec.toFixed(1)} s`);
assert.ok(mape.massOut > 1, 'construction consumed delivered logs');
assert.ok(Math.abs(mapeLedgerResidual()) < 1e-6, 'exact conservation through a full build');
console.log(`build_sec=${buildSec.toFixed(1)} kind=${MAPE_FACTORY_KIND_NAME[mape.factoryKind[0]]}`);

// Gate 5 — CO2 loop: coal burned at a settlement grows forest there and nowhere else.
blank();
let emitter = -1;
for (let i = 0; i < world.n && emitter < 0; i++) {
	if (Math.abs(hydrology.soil[i] - 0.5) < 0.04 && world.settleValue[i] >= 0.6) emitter = i;
}
const ex = emitter % world.size;
const ey = (emitter / world.size) | 0;
let far = -1;
for (let i = 0; i < world.n && far < 0; i++) {
	const dx = (i % world.size) - ex;
	const dy = ((i / world.size) | 0) - ey;
	if (dx * dx + dy * dy >= 40 * 40) far = i;
}
assert.ok(emitter >= 0 && far >= 0, 'found emitter and control cells');
mape.pop[emitter] = 18;
mape.money[emitter] = 18 * MAPE_MONEY_PER_POP;
mapeRebuildSettlements();
mape.goods[MAPE_RES.COAL * world.n + (emitter + 10)] = 300;
mapeFinishSetup(0, true);
assert.equal(mape.goods[MAPE_RES.CO2 * world.n + emitter], 0, 'atmosphere starts empty');
advance(120);
const co2 = mape.goods[MAPE_RES.CO2 * world.n + emitter];
assert.ok(co2 > 0.01, `burning coal leaves CO2 at the settlement co2=${co2.toFixed(3)}`);
assert.ok(mape.goods[MAPE_RES.CO2 * world.n + far] < 1e-6, 'far cell stays carbon-free');
assert.ok(economy.biomass[emitter] > 0.02, `forest grows near the emitter cover=${economy.biomass[emitter].toFixed(3)}`);
assert.ok(economy.biomass[far] < 1e-9, 'no CO2, no growth');
assert.ok(Math.abs(mapeLedgerResidual()) < 1e-6, 'exact conservation through the carbon loop');
console.log(`emitter_co2=${co2.toFixed(3)} emitter_cover=${economy.biomass[emitter].toFixed(3)} far_cover=${economy.biomass[far].toFixed(3)}`);

// Gate 6 — the seeded survey on Sites: live scans, workshops feeding towns,
// shipments crossing the pool, exact conservation over two simulated minutes.
main.setup(START_SEED, '', 0, MAPE_ENGINE.SITES);
assert.equal(mape.engine, MAPE_ENGINE.SITES, 'survey boots into the site engine');
mape.scanOn = true;
let sawTransit = false;
let transitPeak = 0;
const tickStart = Date.now();
for (let k = 0; k < 2400; k++) {
	main.step(SIM_STEP_SEC);
	if (mape.transit > 0) sawTransit = true;
	if (mape.transit > transitPeak) transitPeak = mape.transit;
}
const tickMs = (Date.now() - tickStart) / 2400;
assert.ok(sawTransit, 'shipments crossed the pool on the live map');
assert.ok(mape.factoryCount > 0, `live scans placed factories count=${mape.factoryCount}`);
assert.ok(mape.goods.every(v => Number.isFinite(v) && v >= 0), 'stocks stay finite and non-negative');
assert.ok(mape.demand.every(Number.isFinite), 'demand fields stay finite');
assert.ok(Math.abs(mapeLedgerResidual()) < 1e-6, `exact conservation on the live map residual=${mapeLedgerResidual().toExponential(2)}`);
let built = 0;
for (let f = 0; f < mape.factoryCount; f++) if (mape.factoryState[f] !== MAPE_FACTORY_STATE.GONE) built++;
console.log(`sites_tick_ms=${tickMs.toFixed(3)} transit_peak=${transitPeak.toFixed(2)} built=${built} residual=${mapeLedgerResidual().toExponential(2)}`);

console.log('sites_checks=pass');
