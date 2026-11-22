// owns: same-layout engine comparison, live switch invariants and market-flow smoke checks
// run: node experiments/mape_compare.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const [, file] of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
	vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}

const modes = [MAPE_ENGINE.DIFFUSION, MAPE_ENGINE.CATCHMENT, MAPE_ENGINE.QUEUE];
const keys = ['diffusion', 'catchment', 'queue'];
const sitesMode = MAPE_ENGINE.SITES;
const r = MAPE_RES.COAL;
const center = 32 * world.size + 32;
const donors = [center - 1, center + 1, center - world.size, center + world.size];
const dt = SIM_STEP_SEC;

function close(actual, expected, epsilon = 1e-6) {
	assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
}

function lab(mode, setup, feedback = true) {
	world.terrain.fill(TERRAIN.MEADOW);
	economy.biomass.fill(0);
	hydrology.soil.fill(0);
	land.disturbed.fill(0);
	mapeInit(mode, true);
	mape.surplusFeedback = feedback;
	mapePlaceSettlement(center, 20, false);
	if (setup) setup(mape.goodsView[r]);
	transportRebuild();
	mapeMarketFlowPrepare();
	mapeFinishSetup(0, true);
}

function advance(ticks) {
	for (let i = 0; i < ticks; i++) mapeStep(dt);
}

function verifyLedger() {
	close(mapeLedgerResidual(), 0, 1e-4);
	close(mapePopResidual(), 0, 1e-4);
	assert.ok(mape.goods.every(v => Number.isFinite(v) && v >= 0));
	assert.ok(mape.demand.every(Number.isFinite));
}

function pulse(mode, feedback) {
	lab(mode, null, feedback);
	const field = mape.demandView[r];
	const stock = mape.goodsView[r];
	const hungry = field[center];
	for (const i of donors) stock[i] = 2;
	mape.massIn += 8;
	advance(1);
	const moved = 8 - donors.reduce((sum, i) => sum + stock[i], 0);
	const firstUse = mape.massOut;
	advance(Math.round(2 / dt) - 1);
	const afterTwo = field[center];
	advance(Math.round(8 / dt));
	verifyLedger();
	return { hungry, moved, firstUse, afterTwo, afterTen: field[center], uptake: mape.massOut, local: stock[center] };
}

function readPressure() {
	lab(MAPE_ENGINE.CATCHMENT, stock => { for (const i of donors) stock[i] = 2; });
	const catchmentPull = mapeMarketPull(r, center);
	const stockedDemand = mape.demandView[r][center];
	close(catchmentPull, 1 / (1 + 8 / (mapeMarketUseRate(r, center) * MAPE_CATCHMENT_STOCK_SECONDS)));
	for (const i of donors) mape.goodsView[r][i] = 0;
	mape.massOut += 8;
	advance(60);
	assert.ok(mape.demandView[r][center] > stockedDemand * 1.6);
	verifyLedger();

	lab(MAPE_ENGINE.QUEUE, stock => { for (const i of donors) stock[i] = 2; });
	const stock = mape.goodsView[r];
	const ringPull = mapeMarketPull(r, center);
	assert.ok(ringPull < 0.7 && ringPull > 0.6, 'stock outside the intake already cools B');
	advance(1);
	const limit = mapeQueueCapacity(r, center);
	close(stock[center], limit);
	close(mape.massOut, 0);
	for (const i of donors) close(stock[i], stock[donors[0]]);
	const queuePull = mapeMarketPull(r, center);
	assert.ok(queuePull < ringPull * 0.8);
	advance(1);
	assert.ok(mape.massOut > 0 && stock[center] <= limit + 1e-6);
	verifyLedger();

	lab(MAPE_ENGINE.QUEUE, coal => { coal[center] = 2; });
	advance(1);
	close(mape.goodsView[r][center], 2 - mapeMarketUseRate(r, center) * dt);
	assert.ok(mapeMarketPull(r, center) < 1 - MAPE_QUEUE_COOLING);
	verifyLedger();
	console.log(`catchment_pull_with_ring=${catchmentPull.toFixed(3)} queue_pull_with_ring=${ringPull.toFixed(3)} queue_pull_at_capacity=${queuePull.toFixed(3)} queue_capacity_units=${limit.toFixed(3)}`);
}

function verifyWater(mode) {
	const size = world.size;
	const stranded = center - 2;
	lab(mode, coal => {
		for (let i = center % size - 1; i < world.n; i += size) world.terrain[i] = TERRAIN.WATER;
		coal[stranded] = 8;
		mape.goodsView[MAPE_RES.CO2][stranded] = 8;
	});
	close(mapeMarketPull(r, center), 1);
	advance(50);
	close(mape.goodsView[r][stranded], 8);
	close(mape.demandView[r][stranded], 0);
	close(mape.massOut, 0);
	assert.ok(mape.goodsView[MAPE_RES.CO2][center] > 0);
	verifyLedger();
}

function snapshot() {
	return {
		worldSeed: world.seed, seed: random.seed, clock: clock.seconds, funds: party.funds,
		inventory: economy.inventory.slice(), pop: mape.pop.slice(), goods: mape.goods.slice(), money: mape.money.slice(),
		workforce: mape.workforce.slice(), ironDemand: mape.demandView[MAPE_RES.IRON].slice(), co2Demand: mape.demandView[MAPE_RES.CO2].slice(),
		siteStock: sites.stock.slice(), mineUnlocked: mape.mineUnlocked.slice(), storageCount: mape.storageCount,
		factories: mape.factoryCount, mined: mape.minedTotal, initialGoods: mape.initialGoods, massIn: mape.massIn, massOut: mape.massOut
	};
}

function verifyLiveSwitch() {
	main.setup(START_SEED);
	assert.equal(mape.engine, MAPE_ENGINE.CATCHMENT);
	clock.seconds = 19;
	const town = mape.settleCells[0];
	economyAddResource(RES.FUEL, 1.5);
	assert.ok(mapeSell(RES.FUEL, town) > 0);
	assert.ok(mapeBuySupplies(town, 5) > 0);
	assert.ok(mapeRecruit(town, 20));
	assert.ok(mapeUnlockMine(0));
	const save = snapshot();
	for (const mode of [MAPE_ENGINE.QUEUE, MAPE_ENGINE.DIFFUSION, MAPE_ENGINE.CATCHMENT, MAPE_ENGINE.SITES]) {
		const field = mape.demandView[r].slice();
		assert.ok(mapeSetEngine(mode));
		assert.equal(mape.engine, mode);
		assert.notDeepEqual(mape.demandView[r], field);
		assert.deepEqual(snapshot(), save);
		assert.equal(mapeSetEngine(mode), false);
		assert.deepEqual(snapshot(), save);
		verifyLedger();
	}
	assert.equal(mapeSetEngine(-1), false);
	assert.equal(mapeSetEngine(99), false);
	assert.deepEqual(snapshot(), save);
}

function benchRealMap(mode) {
	main.setup(START_SEED);
	mapeSetWorkforceMode(MAPE_WORKFORCE_MODE.RESIDENTS); // resident staffing assertions; fluid covered in mape_fluid.js
	mape.surplusFeedback = true;
	if (mape.engine !== mode) mapeSetEngine(mode);
	const mine = mape.mineCount - 1;
	const slot = mape.mineSite[mine];
	const cell = mape.mineY[mine] * world.size + mape.mineX[mine];
	advance(10);
	assert.equal(mape.minedTotal, 0);
	sites.state[slot] = SITE_STATE.VISIBLE;
	sites.claim[slot] = FACTION_PLAYER + 1;
	investigation.progress[cell] = 1;
	advance(600);
	const start = performance.now();
	advance(400);
	const tickMs = (performance.now() - start) / 400;
	assert.equal(mape.mineUnlocked[mine], 1);
	assert.ok(mape.pop[cell] > MAPE_MINE_MIN_WORKERS && mape.minedTotal > 1);
	assert.ok(mape.transportWork > 1);
	verifyLedger();
	return tickMs;
}

verifyLiveSwitch();
readPressure();
for (let i = 0; i < modes.length; i++) {
	const mode = modes[i];
	const off = pulse(mode, false);
	const on = pulse(mode, true);
	assert.ok(on.afterTwo < off.afterTwo);
	assert.ok(on.moved > 0);
	if (mode !== MAPE_ENGINE.DIFFUSION) {
		assert.ok(on.uptake > 0.8);
		verifyWater(mode);
	}
	const tickMs = benchRealMap(mode);
	console.log(`engine=${keys[i]} hungry_d=${on.hungry.toFixed(3)} cooled_d_2s=${on.afterTwo.toFixed(3)} fixed_d_2s=${off.afterTwo.toFixed(3)} cooled_d_10s=${on.afterTen.toFixed(3)} donor_drop_first_tick_units=${on.moved.toFixed(3)} first_tick_used_units=${on.firstUse.toFixed(3)} used_10s_units=${on.uptake.toFixed(3)} local_10s_units=${on.local.toFixed(3)} seeded_map_ms_per_tick=${tickMs.toFixed(3)}`);
}
// Sites: discrete shipments instead of a continuous pull field. Same seed, same layout, so the
// mine unlock and haulage still have to carry the served towns; the demand field is not its proxy.
const sitesTickMs = benchRealMap(sitesMode);
console.log(`engine=sites seeded_map_ms_per_tick=${sitesTickMs.toFixed(3)}`);
console.log('mape_compare_checks=pass');
