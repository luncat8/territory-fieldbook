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
		assert.ok(land.disturbed[dense + 1] > 0.01, 'household waste settles on neighbouring land');
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
	console.log(`engine=${MAPE_ENGINE_NAME[mode]} supplied=${startSupplied.toFixed(1)}->${mape.pop[supplied].toFixed(1)} unsupplied=${startHungry.toFixed(1)}->${mape.pop[hungry].toFixed(1)} dense_d=${land.disturbed[dense].toFixed(3)} ring_d=${land.disturbed[dense + 1].toFixed(3)} small_d=${land.disturbed[supplied].toFixed(3)} residual=${mapeLedgerResidual().toExponential(1)}`);
}

for (const mode of [MAPE_ENGINE.DIFFUSION, MAPE_ENGINE.CATCHMENT, MAPE_ENGINE.QUEUE, MAPE_ENGINE.SITES]) validate(mode);

// A filled landfill leaves no carrying capacity for a settlement.
const full = setup(MAPE_ENGINE.DIFFUSION);
land.disturbed[full.dense] = 1;
mapePopulationClamp();
mapeRebuildSettlements();
assert.equal(mape.pop[full.dense], 0, 'full waste leaves no settlement room');
assert.ok(Math.abs(mapePopResidual()) < 1e-3, 'waste eviction stays on the population ledger');
console.log(`waste_checks=pass empty_cell_pop=${mape.pop[full.dense]}`);

const { supplied } = setup(MAPE_ENGINE.DIFFUSION);
const destination = supplied + 1;
mape.workforce[destination] = 20;
mapePopulationBeginStep();
mapePopulationStep(SIM_STEP_SEC);
assert.ok(mape.pop[destination] > 0, 'unmet jobs attract population across a walkable edge');
assert.ok(Math.abs(mapePopResidual()) < 1e-4);
console.log(`population_checks=pass migration=${mape.pop[destination].toFixed(3)}`);

function verifySettlementDemand() {
	mape.surplusFeedback = true;
	mape.localPressure = false;
	main.setup(START_SEED, '', 0, MAPE_ENGINE.DIFFUSION);
	const diffusionTown = mape.settleCells[0];
	const diffusionGoods = mape.demandView[MAPE_RES.GOODS][diffusionTown];
	const diffusionCoal = mape.demandView[MAPE_RES.COAL][diffusionTown];
	assert.ok(diffusionGoods > 0.5 && diffusionCoal > 0.4, 'households create visible signed goods and coal pull');
	assert.equal(mape.massOut, 0, 'warming the demand view does not consume stock');
	main.setup(START_SEED, '', 0, MAPE_ENGINE.CATCHMENT);
	const marketTown = mape.settleCells[0];
	const marketGoods = mape.demandView[MAPE_RES.GOODS][marketTown];
	const marketCoal = mape.demandView[MAPE_RES.COAL][marketTown];
	assert.ok(marketGoods > 0.1 && marketCoal > 0.2, 'market settlements advertise stronger import pull');
	assert.equal(mape.massOut, 0, 'warming the market pull does not consume stock');
	console.log(`settlement_demand=diffusion ${diffusionGoods.toFixed(2)}/${diffusionCoal.toFixed(2)} market ${marketGoods.toFixed(2)}/${marketCoal.toFixed(2)}`);
}

verifySettlementDemand();
