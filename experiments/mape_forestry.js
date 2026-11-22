// owns: forestry commodity routing, workforce-scaled harvest and conversion gates
// run: node experiments/mape_forestry.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const [, file] of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
	vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}

// Keep the pre-terrain timing baseline at c = 1; mape_transport.js gates shipped terrain speeds.
tuneSet('groundMeadow', 2);

function localStock(r, idx) {
	return mape.goods[r * world.n + idx];
}

function totalStock(r) {
	const field = mape.goodsView[r];
	let sum = 0;
	for (let i = 0; i < world.n; i++) sum += field[i];
	return sum;
}

function place(kind, x, y) {
	const idx = y * world.size + x;
	const f = mapeAddFactory(x, y, MAPE_FACTORY_STATE.ACTIVE, kind);
	assert.ok(f >= 0);
	mape.pop[idx] = MAPE_FACTORY_WORKERS;
	if (mape.workforceMode === MAPE_WORKFORCE_MODE.FLUID) mape.wfFresh[idx] = 100;
	return idx;
}

function verifySingleSampleSearch() {
	main.setup(START_SEED, 'a');
	world.terrain.fill(TERRAIN.MEADOW);
	economy.biomass.fill(0);
	const saw = place(MAPE_FACTORY_KIND.SAWMILL, 20, 20);
	mape.wfFresh[saw] = 1;
	mape.demandView[MAPE_RES.LOGS].fill(1);
	const seed = 7319;
	const width = MAPE_SAWMILL_SEARCH_RADIUS * 2 + 1;
	randomSeed(seed);
	const pick = randomInt(width * width);
	const decoy = (pick + 1) % (width * width);
	const sampleIdx = (20 + (pick / width | 0) - MAPE_SAWMILL_SEARCH_RADIUS) * world.size +
		20 + pick % width - MAPE_SAWMILL_SEARCH_RADIUS;
	const decoyIdx = (20 + (decoy / width | 0) - MAPE_SAWMILL_SEARCH_RADIUS) * world.size +
		20 + decoy % width - MAPE_SAWMILL_SEARCH_RADIUS;
	economy.biomass[decoyIdx] = 1;
	randomSeed(seed);
	mapeStepForestryFactory(0, saw, 0.2);
	assert.equal(totalStock(MAPE_RES.LOGS), 0, 'a missed sample does not search another forest cell');
	economy.biomass[sampleIdx] = 1;
	randomSeed(seed);
	mapeStepForestryFactory(0, saw, 0.2);
	assert.equal(totalStock(MAPE_RES.LOGS), 0, 'a miss charges search time before retrying');
	randomSeed(seed);
	mape.factoryHarvestWork[0] = 0;
	mapeStepForestryFactory(0, saw, 0.2);
	assert.equal(localStock(MAPE_RES.LOGS, sampleIdx), 1 / MAPE_SAWMILL_FOREST_PER_LOG, 'the whole cell converts at the log yield');
	assert.equal(economy.biomass[sampleIdx], 0, 'the selected cell is felled to zero');
	assert.equal(economy.biomass[decoyIdx], 1, 'unselected forest stays intact');
	const work = mape.factoryHarvestWork[0];
	const rng = random.seed;
	mape.wfFresh[saw] = 0;
	mapeStepForestryFactory(0, saw, 0.2);
	assert.equal(mape.factoryHarvestWork[0], work, 'no workers means no harvest work');
	mape.wfFresh[saw] = 0.5;
	mapeStepForestryFactory(0, saw, 0.2);
	assert.ok(Math.abs(mape.factoryHarvestWork[0] - (work - 0.1 * landProductivity(saw))) < 1e-9, 'half crew pays half the work');
	assert.equal(random.seed, rng, 'cooldown does not sample cells');
	assert.ok(mape.factoryHarvestWork[0] > 0.8 * MAPE_SAWMILL_FELL_SEC, 'work is charged per forest felled, not per log');
	assert.equal(totalStock(MAPE_RES.LOGS), 1 / MAPE_SAWMILL_FOREST_PER_LOG, 'cooldown produces no extra logs');
	assert.equal(localStock(MAPE_RES.LOGS, decoyIdx), 0, 'the unselected forest cell is left alone');
}

function runChain(engine, workforceMode) {
	main.setup(START_SEED, 'a', 0, engine);
	mapeSetWorkforceMode(workforceMode);
	world.terrain.fill(TERRAIN.MEADOW);
	economy.biomass.fill(0);
	const saw = place(MAPE_FACTORY_KIND.SAWMILL, 20, 20);
	const charcoal = place(MAPE_FACTORY_KIND.CHARCOAL, 28, 20);
	const wood = place(MAPE_FACTORY_KIND.WOOD, 28, 25);
	for (let dy = -6; dy <= 6; dy++) {
		for (let dx = -6; dx <= 6; dx++) {
			if (dx * dx + dy * dy > 36) continue;
			economy.biomass[(20 + dy) * world.size + 20 + dx] = 1;
		}
	}
	mapeRebuildSettlements();
	mapeSyncCells();
	mapeStepForestryFactory(0, saw, 0.2);
	assert.equal(totalStock(MAPE_RES.LOGS), 0, 'a sawmill stays idle with no log demand gradient');
	mapeWarmDemand();
	const logPull = mape.demandView[MAPE_RES.LOGS];
	assert.ok(logPull[saw] > MAPE_SAWMILL_MIN_PULL, 'processor demand reaches the forestry area');
	const beforeForest = economy.biomass.reduce((sum, value) => sum + value, 0);
	const beforeLogs = totalStock(MAPE_RES.LOGS);
	mape.factoryHarvestWork[0] = 0;
	mapeStepForestryFactory(0, saw, 0.2);
	const cutCells = [];
	for (let dy = -MAPE_SAWMILL_SEARCH_RADIUS; dy <= MAPE_SAWMILL_SEARCH_RADIUS; dy++) {
		for (let dx = -MAPE_SAWMILL_SEARCH_RADIUS; dx <= MAPE_SAWMILL_SEARCH_RADIUS; dx++) {
			const idx = (20 + dy) * world.size + 20 + dx;
			if (localStock(MAPE_RES.LOGS, idx) > 0) cutCells.push(idx);
		}
	}
	assert.equal(cutCells.length, 1, 'one random 5×5 cell receives the logs');
	assert.ok(economy.biomass.reduce((sum, value) => sum + value, 0) < beforeForest, 'harvesting removes forest cover');
	assert.ok(totalStock(MAPE_RES.LOGS) > beforeLogs, 'sawmill creates log stock');
	// Works convert logs on their own cell; the crew is pinned so staffing is not the subject.
	const coalCell = 20 * world.size + 28;
	mapeProduceStock(MAPE_RES.LOGS, coalCell, 1);
	mape.wfFresh[coalCell] = MAPE_FACTORY_WORKERS;
	mapeStepForestryFactory(1, coalCell, 0.2);
	assert.ok(mape.factoryCoal[1] > 0, 'charcoal works convert logs into coal');
	assert.ok(mape.factoryCo2[1] > 0, 'charcoal making returns carbon to the atmosphere');
	const woodCell = 25 * world.size + 28;
	mapeProduceStock(MAPE_RES.LOGS, woodCell, 1);
	mape.wfFresh[woodCell] = MAPE_FACTORY_WORKERS;
	mapeStepForestryFactory(2, woodCell, 0.2);
	assert.ok(mape.factoryGoods[2] > 0, 'wood works convert logs into goods');
	for (let step = 0; step < Math.round(6 / SIM_STEP_SEC); step++) main.step(SIM_STEP_SEC);
	assert.ok(Math.abs(mapeLedgerResidual()) < 1e-6, 'all log and product transfers balance');
	assert.ok(mape.goods.every(value => Number.isFinite(value) && value >= 0));
	console.log('engine=' + MAPE_ENGINE_NAME[engine] + ' coal=' + mape.factoryCoal[1].toFixed(2) +
		' goods=' + mape.factoryGoods[2].toFixed(2) + ' logs=' + totalStock(MAPE_RES.LOGS).toFixed(2) +
		' ledger=' + mapeLedgerResidual().toExponential(1));
}

function verifyHouseholdLogs(engine) {
	main.setup(START_SEED, 'a', 0, engine);
	world.terrain.fill(TERRAIN.MEADOW);
	mapeSetWorkforceMode(MAPE_WORKFORCE_MODE.RESIDENTS);
	mapeInit(engine, true);
	const town = 20 * world.size + 20;
	mapePlaceSettlement(town, 20, false);
	mapeRebuildSettlements();
	mapeSyncCells();
	mapeWarmDemand();
	assert.ok(mape.demandView[MAPE_RES.LOGS][town] > MAPE_SAWMILL_MIN_PULL, 'households pull logs without processors');
	mapeProduceStock(MAPE_RES.LOGS, town, 1);
	const before = localStock(MAPE_RES.LOGS, town);
	if (engine === MAPE_ENGINE.DIFFUSION) mapeUseDiffusionStock(1);
	if (engine === MAPE_ENGINE.CATCHMENT) mapeUseCatchments(1);
	if (engine === MAPE_ENGINE.QUEUE) mapeServeQueues(1);
	if (engine === MAPE_ENGINE.SITES) {
		assert.equal(mapeSitesHouseholdHold(MAPE_RES.LOGS, town), 20 * MAPE_NEED_LOGS * MAPE_SITE_HOLD_SEC);
		mapeSitesMetabolism(1);
	}
	assert.ok(Math.abs(before - localStock(MAPE_RES.LOGS, town) - 20 * MAPE_NEED_LOGS) < 1e-9, 'household log consumption is population-scaled');
	assert.ok(Math.abs(mapeLedgerResidual()) < 1e-6, 'household log consumption balances');
	economy.biomass.fill(1);
	const saw = place(MAPE_FACTORY_KIND.SAWMILL, 22, 20);
	mapeSyncCells();
	mapeWarmDemand();
	randomSeed(7319);
	const logs = totalStock(MAPE_RES.LOGS);
	mapeStepForestryFactory(0, saw, 0.2);
	assert.ok(totalStock(MAPE_RES.LOGS) > logs, 'household demand alone starts sawmill production');
}

function verifyHarvestCadence(dt, workers) {
	main.setup(START_SEED, 'a');
	world.terrain.fill(TERRAIN.MEADOW);
	land.disturbed.fill(0);
	economy.biomass.fill(1);
	mape.demandView[MAPE_RES.LOGS].fill(1);
	const saw = place(MAPE_FACTORY_KIND.SAWMILL, 20, 20);
	mape.wfFresh[saw] = workers;
	randomSeed(7319);
	// Haulers clear the yard every step, so the crew alone sets the pace.
	let cut = 0;
	for (let step = 0; step < Math.round(120 / dt); step++) {
		mapeStepForestryFactory(0, saw, dt);
		cut += totalStock(MAPE_RES.LOGS);
		mape.goodsView[MAPE_RES.LOGS].fill(0);
	}
	return cut;
}

// Logs nobody hauls away fill the yard; a full yard holds the crew whatever the log pull says.
function verifyFullYardHolds() {
	main.setup(START_SEED, 'a');
	world.terrain.fill(TERRAIN.MEADOW);
	economy.biomass.fill(1);
	mape.demandView[MAPE_RES.LOGS].fill(1);
	const saw = place(MAPE_FACTORY_KIND.SAWMILL, 20, 20);
	mape.wfFresh[saw] = 16;
	randomSeed(7319);
	for (let step = 0; step < Math.round(60 / 0.2); step++) mapeStepForestryFactory(0, saw, 0.2);
	const yard = totalStock(MAPE_RES.LOGS);
	assert.ok(yard >= MAPE_SAWMILL_YARD_LOGS && yard < MAPE_SAWMILL_YARD_LOGS + 1 / MAPE_SAWMILL_FOREST_PER_LOG + 1e-9, 'a full yard stops cutting yard=' + yard);
	console.log('full_yard_logs=' + yard.toFixed(2));
}

verifySingleSampleSearch();
const coarse = verifyHarvestCadence(0.2, 1);
const fine = verifyHarvestCadence(0.05, 1);
const half = verifyHarvestCadence(0.2, 0.5);
const full = verifyHarvestCadence(0.2, 16);
assert.equal(coarse, fine, 'different engine steps produce the same cuts');
assert.ok(half < coarse, 'lower staffing slows cutting');
assert.ok(full > coarse, 'a full crew cuts several cells per second');
verifyFullYardHolds();
console.log('harvest_1worker_120s=' + coarse + ' dt005=' + fine + ' half=' + half + ' full_crew16=' + full);
for (const engine of [MAPE_ENGINE.DIFFUSION, MAPE_ENGINE.CATCHMENT, MAPE_ENGINE.QUEUE, MAPE_ENGINE.SITES]) verifyHouseholdLogs(engine);
runChain(MAPE_ENGINE.DIFFUSION, MAPE_WORKFORCE_MODE.FLUID);
runChain(MAPE_ENGINE.CATCHMENT, MAPE_WORKFORCE_MODE.RESIDENTS);

main.setup(START_SEED, 'a');
for (const [tool, kind] of [[5, MAPE_FACTORY_KIND.SAWMILL], [6, MAPE_FACTORY_KIND.CHARCOAL], [7, MAPE_FACTORY_KIND.WOOD]]) {
	mapScene.tool = tool;
	mapSceneEdit(5 + tool, 5);
	assert.equal(mape.factoryKind[mape.factoryCount - 1], kind);
}
console.log('forestry_checks=pass');
