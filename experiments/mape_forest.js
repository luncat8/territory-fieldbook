// owns: humidity/CO2 forest response, carbon exchange and all-engine regression gates
// run: node experiments/mape_forest.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
for (const [, file] of fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"><\/script>/g)) {
	vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}
for (const mode of [MAPE_ENGINE.DIFFUSION, MAPE_ENGINE.CATCHMENT, MAPE_ENGINE.QUEUE]) {
	main.setup(START_SEED, '', 0, mode);
	assert.ok(!world.terrain.includes(TERRAIN.FOREST));
	const i = world.terrain.findIndex(t => t === TERRAIN.HILLS);
	world.humidity[i] = 0.5;
	const optimal = economyForestTarget(i, 0.1);
	world.humidity[i] = 0.7;
	assert.ok(economyForestTarget(i, 0.1) < optimal);
	assert.ok(economyForestTarget(i, 2) > economyForestTarget(i, 0.1));
	world.humidity[i] = 0.5;
	economy.biomass.fill(0);
	mape.goodsView[MAPE_RES.CO2].fill(0.4);
	mape.initialGoods = mapeGoodsTotal();
	mape.massIn = mape.massOut = 0;
	const initialCarbon = mape.goodsView[MAPE_RES.CO2][i];
	for (let k = 0; k < 200; k++) economyStep(0.05);
	const cover = economy.biomass[i];
	assert.ok(cover > 0.35, 'bare hills visibly reforest in 10 sim seconds');
	assert.ok(Math.abs(mape.goodsView[MAPE_RES.CO2][i] + cover * BIO_CARBON_PER_COVER - initialCarbon) < 1e-6);
	world.humidity[i] = 1;
	const before = mape.goodsView[MAPE_RES.CO2][i];
	for (let k = 0; k < 200; k++) economyStep(0.05);
	assert.ok(economy.biomass[i] < cover * 0.5, 'unsuitable forest dies back visibly');
	assert.ok(mape.goodsView[MAPE_RES.CO2][i] > before, 'decay returns carbon');
	const water = world.terrain.indexOf(TERRAIN.WATER);
	assert.equal(economy.biomass[water], 0);
	assert.ok(Math.abs(mapeLedgerResidual()) < 0.01);
	mape.goodsView[MAPE_RES.CO2].fill(0);
	economy.biomass.fill(0);
	economyStep(10);
	assert.equal(economy.biomass[i], 0, 'no carbon means no growth');
	console.log('forest_engine=' + mode + ' cover_10s=' + cover.toFixed(3) + ' carbon_error_lt=0.000001');
	main.setup(START_SEED, '', 0, mode);
	const start = economy.biomass.slice();
	for (let k = 0; k < 200; k++) main.step(0.05);
	assert.ok(economy.biomass.some((b, k) => Math.abs(b - start[k]) > 0.05));
	assert.ok(mape.goods.every(v => Number.isFinite(v) && v >= 0));
	assert.ok(Math.abs(mapeLedgerResidual()) < 0.01);
}
