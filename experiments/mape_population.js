// owns: Phase 2 population, household intake, disturbance and conservation gates
// run: node experiments/mape_population.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const [, file] of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
	vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}

function setup(mode) {
	main.setup(START_SEED, '', 0, mode);
	world.terrain.fill(TERRAIN.MEADOW);
	land.disturbed.fill(0);
	economy.biomass.fill(0);
	sites.state.fill(SITE_STATE.GONE);
	sites.stock.fill(0);
	sites.claim.fill(0);
	sites.initialStock = sites.remainingStock = 0;
	mapeSetWorkforceMode(MAPE_WORKFORCE_MODE.RESIDENTS);
	mapeInit(mode);
	mape.surplusFeedback = false;
	const supplied = 20 * world.size + 20;
	const hungry = 10 * world.size + 10;
	const dense = 48 * world.size + 48;
	mapePlaceSettlement(supplied, 20, false);
	mapePlaceSettlement(hungry, 20, false);
	mapePlaceSettlement(dense, 100, false);
	for (const i of [supplied, dense]) {
		mape.goodsView[MAPE_RES.GOODS][i] = 1000;
		mape.goodsView[MAPE_RES.COAL][i] = 1000;
	}
	mapeMarketFlowPrepare();
	mapeFinishSetup(1, true);
	return { supplied, hungry, dense };
}

function advance(seconds) {
	for (let k = 0, count = Math.round(seconds / SIM_STEP_SEC); k < count; k++) main.step(SIM_STEP_SEC);
}

function validate(mode) {
	const { supplied, hungry, dense } = setup(mode);
	const startSupplied = mape.pop[supplied];
	const startHungry = mape.pop[hungry];
	advance(120);
	if (mode === MAPE_ENGINE.DIFFUSION) {
		assert.ok(mape.pop[supplied] > startSupplied, 'supplied settlement grows');
		assert.ok(mape.pop[hungry] < startHungry, 'unsupplied settlement declines');
		assert.ok(land.disturbed[supplied] < 0.25 && land.disturbed[dense] > 0.25, 'waste scales from a small village to a dense city');
	} else {
		assert.ok(mape.massOut > 0, `${MAPE_ENGINE_NAME[mode]} consumes household stock`);
	}

	for (let i = 0; i < world.n; i++) {
		assert.ok(Number.isFinite(mape.pop[i]) && mape.pop[i] >= 0);
		assert.ok(mape.pop[i] <= MAPE_POP_CAP * landProductivity(i) + 1e-4, 'population respects productivity cap');
	}
	assert.ok(mape.goods.every(v => Number.isFinite(v) && v >= 0));
	assert.ok(mape.demand.every(Number.isFinite));
	assert.ok(mape.totalPop < world.n * MAPE_POP_CAP, 'population remains bounded');
	assert.ok(Math.abs(mapeLedgerResidual()) < 1e-4);
	assert.ok(Math.abs(mapePopResidual()) < 1e-3);
	console.log(`engine=${MAPE_ENGINE_NAME[mode]} supplied=${startSupplied.toFixed(1)}->${mape.pop[supplied].toFixed(1)} unsupplied=${startHungry.toFixed(1)}->${mape.pop[hungry].toFixed(1)} dense_d=${land.disturbed[dense].toFixed(3)} small_d=${land.disturbed[supplied].toFixed(3)} residual=${mapeLedgerResidual().toExponential(1)}`);
}

for (const mode of [MAPE_ENGINE.DIFFUSION, MAPE_ENGINE.CATCHMENT, MAPE_ENGINE.QUEUE]) validate(mode);

const { supplied } = setup(MAPE_ENGINE.DIFFUSION);
const destination = supplied + 1;
mape.workforce[destination] = 20;
mapePopulationBeginStep();
mapePopulationStep(SIM_STEP_SEC);
assert.ok(mape.pop[destination] > 0, 'unmet jobs attract population across a walkable edge');
assert.ok(Math.abs(mapePopResidual()) < 1e-4);
console.log(`population_checks=pass migration=${mape.pop[destination].toFixed(3)}`);
