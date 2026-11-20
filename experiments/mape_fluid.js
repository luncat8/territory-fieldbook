// owns: fluid workforce model and factory runtime gates — staffing, recycling, spawning, ledgers
// run: node experiments/mape_fluid.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const [, file] of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
	vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}

function poolSums() {
	let fresh = 0;
	let depleted = 0;
	let peakDepleted = 0;
	for (let i = 0; i < world.n; i++) {
		fresh += mape.wfFresh[i];
		const d = mape.wfDepleted[i];
		depleted += d;
		if (d > peakDepleted) peakDepleted = d;
	}
	return { fresh, depleted, peakDepleted };
}

function popSum() {
	let sum = 0;
	for (let i = 0; i < world.n; i++) sum += mape.pop[i];
	return sum;
}

function activateFluid() {
	mapeSetWorkforceMode(MAPE_WORKFORCE_MODE.FLUID);
	assert.equal(mape.workforceMode, MAPE_WORKFORCE_MODE.FLUID, 'fluid mode active');
}

const checks = [];
function check(name, value) {
	checks.push([name, value]);
	console.log('check_' + name + '=' + (value ? 'pass' : 'fail'));
}

// --- Section 1: fluid staffing and workforce-linked migration in scene A
main.setup(START_SEED, 'a', 0, MAPE_ENGINE.CATCHMENT);
activateFluid();
const seededFresh = poolSums().fresh; // day-one pool seeded from pop at setup
const minedBefore = mape.minedTotal;
let genAcc = 0;
for (let k = 0, steps = Math.round(150 / SIM_STEP_SEC); k < steps; k++) {
	genAcc += popSum() * MAPE_WF_GEN * SIM_STEP_SEC;
	main.step(SIM_STEP_SEC);
}
const pools = poolSums();
const poolResidual = pools.fresh + pools.depleted + MAPE_WF_SPAWN * mape.fluidSpawned - genAcc - seededFresh;
console.log('fluid_log=spent ' + mape.fluidSpent.toFixed(2) + ' tired ' + mape.fluidTired.toFixed(2) + ' rested ' + mape.fluidRested.toFixed(2) + ' spawned ' + mape.fluidSpawned + ' mined ' + mape.minedTotal.toFixed(1));
console.log('pool_log=fresh ' + pools.fresh.toFixed(2) + ' depleted ' + pools.depleted.toFixed(2) + ' peak ' + pools.peakDepleted.toFixed(2) + ' generated ' + genAcc.toFixed(2) + ' residual ' + poolResidual.toFixed(4));
console.log('ledger_log=mape ' + mapeLedgerResidual().toFixed(6) + ' pop ' + mapePopResidual().toFixed(6));
check('mines_staffed_by_fluid', mape.minedTotal > minedBefore);
check('jobs_consume_fresh', mape.fluidSpent > 0);
check('fresh_generated', genAcc > 1);
check('settlements_rest_depleted', mape.fluidRested > 0);
check('pool_conserved', Math.abs(poolResidual) < 0.5);
check('goods_ledger_balanced', Math.abs(mapeLedgerResidual()) < 1e-3);
check('population_ledger_balanced', Math.abs(mapePopResidual()) < 1e-3);

// Return from a distant job on open land, and stop resting when the town is full.
{
	main.setup(START_SEED, 'a', 0, MAPE_ENGINE.CATCHMENT);
	world.terrain.fill(TERRAIN.MEADOW);
	mape.pop.fill(0);
	const town = 32 * world.size + 32;
	const job = town + 8;
	mape.pop[town] = 1;
	mape.settleCells[0] = town;
	mape.settleCount = 1;
	mape.wfRestPull.fill(0);
	mape.wfDepleted.fill(0);
	mape.wfFresh.fill(0);
	for (let k = 0; k < 2000; k++) mapeFluidRestPull(0.05, world.size, world.terrain);
	mape.wfDepleted[job] = 10;
	let directional = false;
	const before = mape.fluidRested;
	for (let k = 0; k < 2000; k++) {
		mape.wfFlowX[1].fill(0);
		mape.wfFlowY[1].fill(0);
		mapeFluidAdvectDepleted(0.05, world.size, world.terrain, mape.wfDepleted, mape.wfDepletedNext);
		if (mape.wfFlowX[1][job] < 0) directional = true;
		mapeFluidDiffuse(0.05, world.size, world.terrain, mape.wfDepleted, mape.wfDepletedNext);
		mapeFluidRest(0.05, mape.wfDepleted, mape.wfFresh);
	}
	console.log('return_log=distance_cells 8 rested ' + (mape.fluidRested - before).toFixed(3));
	check('distant_depleted_returns_and_rests', mape.fluidRested - before > 1);
	check('return_flow_points_home', directional);
	mape.pop[town] = mapeFluidCapacity(town);
	mape.wfDepleted[town] = 2;
	mapeFluidRest(1, mape.wfDepleted, mape.wfFresh);
	check('full_town_does_not_rest', mape.wfDepleted[town] === 2);
	mape.workforce.fill(0);
	mape.workforce[town + 1] = 1;
	mape.wfFresh.fill(0);
	mape.wfFresh[town] = 10;
	mape.wfFlowX[0].fill(0);
	mapeFluidAdvect(0.05, world.size, world.terrain, mape.workforce, mape.wfFresh, mape.wfFreshNext);
	check('fresh_flow_records_accepted_transfer', mape.wfFlowX[0][town] > 0 && Math.abs(mape.wfFlowX[0][town] - mape.wfFresh[town + 1]) < 1e-6);
	mape.wfDepleted.fill(0);
	mape.wfDepleted[town] = 10;
	mape.wfFlowX[1].fill(0);
	mape.wfFlowY[1].fill(0);
	mapeFluidDiffuse(0.05, world.size, world.terrain, mape.wfDepleted, mape.wfDepletedNext);
	check('diffusion_flow_records_outward_transfer', mape.wfFlowX[1][town + 1] > 0 && mape.wfFlowX[1][town - 1] < 0);

}

// --- Section 2: factory runtime — active production, construction, starvation
{
	main.setup(START_SEED, 'a', 0, MAPE_ENGINE.CATCHMENT);
	mapeSetWorkforceMode(MAPE_WORKFORCE_MODE.RESIDENTS);
	const totalCo2 = () => {
		let sum = 0;
		for (let i = 0; i < world.n; i++) sum += mape.goods[MAPE_RES.CO2 * world.n + i];
		return sum;
	};
	const idx = 39 * world.size + 34;
	assert.equal(mape.factoryCount, 0, 'scene starts with no factories');
	const f = mapeAddFactory(34, 39, MAPE_FACTORY_STATE.ACTIVE);
	const n = world.n;
	mape.goods[MAPE_RES.COAL * n + idx] = 100;
	mape.goods[MAPE_RES.IRON * n + idx] = 100;
	mape.pop[idx] = MAPE_FACTORY_WORKERS;
	const co2Before = totalCo2();
	const disturbBefore = land.disturbed[idx];
	for (let k = 0, steps = Math.round(30 / SIM_STEP_SEC); k < steps; k++) main.step(SIM_STEP_SEC);
	console.log('factory_log=goods ' + mape.goods[MAPE_RES.GOODS * n + idx].toFixed(2) + ' coal_left ' + mape.goods[MAPE_RES.COAL * n + idx].toFixed(2) + ' rate ' + mape.factoryGoods[f].toFixed(2));
	check('factory_produces_goods', mape.factoryGoods[f] > 0.5);
	check('factory_consumes_coal', mape.factoryCoal[f] > 0.4);
	check('factory_emits_co2', totalCo2() > co2Before + 5);
	check('factory_disturbs_cell', land.disturbed[idx] > disturbBefore);
	check('factory_goods_rate_recorded', mape.factoryGoods[f] > 0);

	const b = mapeAddFactory(36, 39, MAPE_FACTORY_STATE.BUILDING);
	const bidx = 39 * world.size + 36;
	mape.goods[MAPE_RES.IRON * n + bidx] = 100;
	mape.pop[bidx] = MAPE_FACTORY_BUILD_WORKERS;
	for (let k = 0, steps = Math.round(5 / SIM_STEP_SEC); k < steps; k++) main.step(SIM_STEP_SEC);
	check('factory_builds_with_iron', mape.factoryProgress[b] > 0.05);
	const c = mapeAddFactory(3, 3, MAPE_FACTORY_STATE.BUILDING);
	const cidx = 3 * world.size + 3;
	mape.pop[cidx] = MAPE_FACTORY_BUILD_WORKERS;
	const starvedBefore = mape.factoryStarved[c];
	for (let k = 0, steps = Math.round(5 / SIM_STEP_SEC); k < steps; k++) main.step(SIM_STEP_SEC);
	check('factory_starves_without_iron', mape.factoryProgress[c] === 0 && mape.factoryStarved[c] > starvedBefore + 4);

	const s = mapeAddFactory(3, 9, MAPE_FACTORY_STATE.ACTIVE);
	const sidx = 9 * world.size + 3;
	mape.pop[sidx] = MAPE_FACTORY_WORKERS;
	const starved = mape.factoryStarved[s];
	for (let k = 0, steps = Math.round(3 / SIM_STEP_SEC); k < steps; k++) main.step(SIM_STEP_SEC);
	check('factory_starves_without_inputs', mape.factoryStarved[s] > starved + 2 && mape.factoryGoods[s] === 0);

	mapeSetWorkforceMode(MAPE_WORKFORCE_MODE.FLUID);
	const industryPop = mape.pop[idx];
	mape.pop[idx] = 5;
	mape.popDelta += 5 - industryPop;
	mapePopulationClamp();
	check('industry_cell_holds_no_residents', mape.pop[idx] === 0);
}

// --- Section 3: a starved job site founds a hamlet; pools alone never do
{
	main.setup(START_SEED, 'a', 0, MAPE_ENGINE.CATCHMENT);
	activateFluid();
	// Pick the worked deposit farthest from every town: that is the one that needs people.
	let job = -1;
	let bestReach = MAPE_WF_TOWN_REACH;
	for (let m = 0; m < mape.mineCount; m++) {
		if (!mapeMineActive(m)) continue;
		const reach = mapeFluidNearestTown(mape.mineX[m], mape.mineY[m]);
		if (reach > bestReach) { bestReach = reach; job = mape.mineY[m] * world.size + mape.mineX[m]; }
	}
	assert.ok(job >= 0, 'a worked deposit sits beyond every town reach');
	let site = -1;
	for (const d of [-world.size, world.size, -1, 1]) {
		const i = job + d;
		if (world.terrain[i] === TERRAIN.WATER || mapeIsIndustry(i)) continue;
		if (world.settleValue[i] < MAPE_WF_SPAWN_VALUE) continue;
		site = i;
		break;
	}
	assert.ok(site >= 0, 'workable ground beside the deposit');
	const settleBefore = mape.settleCount;
	// A pool with no job near it creates nobody: pick open land far from every mine and town.
	const size = world.size;
	let lonely = -1;
	for (let i = 0; i < world.n; i++) {
		if (world.terrain[i] === TERRAIN.WATER || mape.pop[i] > 0 || mapeIsIndustry(i)) continue;
		if (world.settleValue[i] < MAPE_WF_SPAWN_VALUE) continue;
		const x = i % size;
		const y = (i / size) | 0;
		let near = false;
		for (let d = 0; d < 12 && !near; d++) {
			const cx = x + (d % 5) - 2;
			const cy = y + ((d / 5) | 0) - 1;
			if (cx < 0 || cy < 0 || cx >= size || cy >= size) continue;
			const j = cy * size + cx;
			if (mape.pop[j] > 0 || mapeIsIndustry(j)) near = true;
		}
		if (!near && Math.sqrt((x - job % size) ** 2 + (y - ((job / size) | 0)) ** 2) > 24) { lonely = i; break; }
	}
	assert.ok(lonely >= 0, 'found an empty far meadow cell');
	mape.wfDepleted[lonely] = MAPE_WF_SPAWN * 3;
	main.step(SIM_STEP_SEC);
	check('pool_alone_founds_nothing', mape.fluidSpawned === 0 && !mapeIsSettlement(lonely));
	// The same pool at the starved deposit founds a hamlet there and pays for it.
	mape.wfDepleted[site] = MAPE_WF_SPAWN + 5;
	main.step(SIM_STEP_SEC);
	check('starved_job_founds_settlement', mape.fluidSpawned === 1 && mapeIsSettlement(site) && mape.settleCount === settleBefore + 1);
	check('spawn_debits_pool', mape.wfDepleted[site] < 5 + MAPE_WF_SPAWN);
	const swampIdx = 20 * world.size + 34;
	world.terrain[swampIdx] = TERRAIN.SWAMP;
	world.terrain[swampIdx - 1] = TERRAIN.SWAMP;
	world.terrain[swampIdx + 1] = TERRAIN.SWAMP;
	world.terrain[swampIdx - world.size] = TERRAIN.SWAMP;
	world.terrain[swampIdx + world.size] = TERRAIN.SWAMP;
	worldSettleValues();
	assert.equal(world.settleValue[swampIdx], 0, 'swamp interior value is zero');
	const spawned = mape.fluidSpawned;
	mape.wfDepleted[swampIdx] = MAPE_WF_SPAWN * 2;
	main.step(SIM_STEP_SEC);
	check('swamp_pool_never_spawns', mape.fluidSpawned === spawned);
	check('population_ledger_after_spawn', Math.abs(mapePopResidual()) < 1e-3);
}

// --- Section 4: diffusion engine with fluid mode — no migration walk, no NaN
{
	main.setup(START_SEED, '', 0, MAPE_ENGINE.DIFFUSION);
	activateFluid();
	for (let k = 0, steps = Math.round(60 / SIM_STEP_SEC); k < steps; k++) main.step(SIM_STEP_SEC);
	const { fresh, depleted } = poolSums();
	let ok = Number.isFinite(fresh) && Number.isFinite(depleted);
	for (let i = 0; i < world.n && ok; i++) {
		if (!Number.isFinite(mape.pop[i]) || mape.pop[i] < 0) ok = false;
		if (!Number.isFinite(mape.wfFresh[i]) || !Number.isFinite(mape.wfDepleted[i])) ok = false;
	}
	check('diffusion_fluid_stable', ok && popSum() >= 0);
}

// --- Section 5: residents model unchanged (fluid off)
{
	main.setup(START_SEED, 'a', 0, MAPE_ENGINE.CATCHMENT);
	mapeSetWorkforceMode(MAPE_WORKFORCE_MODE.RESIDENTS);
	mapeSetWorkforceMode(MAPE_WORKFORCE_MODE.RESIDENTS);
	let genStart = 0;
	for (let i = 0; i < world.n; i++) genStart += mape.wfFresh[i];
	for (let k = 0, steps = Math.round(10 / SIM_STEP_SEC); k < steps; k++) main.step(SIM_STEP_SEC);
	let genAfter = 0;
	for (let i = 0; i < world.n; i++) genAfter += mape.wfFresh[i];
	check('residents_mode_generates_no_pool', genAfter === genStart);
}

const failed = checks.filter(([, ok]) => !ok);
if (failed.length > 0) {
	console.log('fluid_failures=' + failed.length + ' failed: ' + failed.map(([name]) => name).join(','));
	process.exit(1);
}
console.log('fluid_failures=0');
