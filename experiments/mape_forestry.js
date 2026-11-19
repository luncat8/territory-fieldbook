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
	mapeStepForestryFactory(0, saw, 0.2, 1);
	assert.equal(totalStock(MAPE_RES.LOGS), 0, 'a sawmill stays idle with no log demand gradient');
	mapeWarmDemand();
	const logPull = mape.demandView[MAPE_RES.LOGS];
	assert.ok(logPull[saw] > MAPE_SAWMILL_MIN_PULL, 'processor demand reaches the forestry area');
	const beforeForest = economy.biomass.reduce((sum, value) => sum + value, 0);
	const beforeLogs = totalStock(MAPE_RES.LOGS);
	mapeStepForestryFactory(0, saw, 0.2, 1);
	const cutCells = [];
	for (let dy = -6; dy <= 6; dy++) {
		for (let dx = -6; dx <= 6; dx++) {
			if (dx * dx + dy * dy > 36) continue;
			const idx = (20 + dy) * world.size + 20 + dx;
			if (localStock(MAPE_RES.LOGS, idx) > 0) cutCells.push(idx);
		}
	}
	assert.ok(cutCells.length > 0, 'logs are stocked on the forest cell cut');
	assert.ok(economy.biomass.reduce((sum, value) => sum + value, 0) < beforeForest, 'harvesting removes forest cover');
	assert.ok(totalStock(MAPE_RES.LOGS) > beforeLogs, 'sawmill creates log stock');
	for (let step = 0; step < Math.round(6 / SIM_STEP_SEC); step++) main.step(SIM_STEP_SEC);
	assert.ok(mape.factoryCoal[1] > 0, 'charcoal works convert logs into coal');
	assert.ok(mape.factoryCo2[1] > 0, 'charcoal making returns carbon to the atmosphere');
	assert.ok(mape.factoryGoods[2] > 0, 'wood works convert logs into goods');
	assert.ok(Math.abs(mapeLedgerResidual()) < 1e-6, 'all log and product transfers balance');
	assert.ok(mape.goods.every(value => Number.isFinite(value) && value >= 0));
	console.log('engine=' + MAPE_ENGINE_NAME[engine] + ' coal=' + mape.factoryCoal[1].toFixed(2) +
		' goods=' + mape.factoryGoods[2].toFixed(2) + ' logs=' + totalStock(MAPE_RES.LOGS).toFixed(2) +
		' ledger=' + mapeLedgerResidual().toExponential(1));
}

runChain(MAPE_ENGINE.DIFFUSION, MAPE_WORKFORCE_MODE.FLUID);
runChain(MAPE_ENGINE.CATCHMENT, MAPE_WORKFORCE_MODE.RESIDENTS);

main.setup(START_SEED, 'a');
for (const [tool, kind] of [[5, MAPE_FACTORY_KIND.SAWMILL], [6, MAPE_FACTORY_KIND.CHARCOAL], [7, MAPE_FACTORY_KIND.WOOD]]) {
	mapScene.tool = tool;
	mapSceneEdit(5 + tool, 5);
	assert.equal(mape.factoryKind[mape.factoryCount - 1], kind);
}
console.log('forestry_checks=pass');
