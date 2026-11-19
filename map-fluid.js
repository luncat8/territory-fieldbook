// owns: optional fluid workforce model — fresh/depleted pools, settlement rest, hamlet spawning
// edit for: generation, tire and rest rates, advection, spawn threshold

const MAPE_WF_GEN = 0.05;
const MAPE_WF_TIRE = 0.02;
const MAPE_WF_DIFFUSE = 0.35;
const MAPE_WF_FLOW = 1.8;
const MAPE_WF_GRAD_REF = 0.03;
const MAPE_WF_SPEND = 1.0;
const MAPE_WF_REST = 0.05;
const MAPE_WF_RETURN = 1.8;
const MAPE_WF_REST_GRAD_REF = 0.005;
const MAPE_WF_REST_SIGNAL = 0.9;
const MAPE_WF_REST_DECAY = 0.02;
const MAPE_WF_SPAWN = 10;
const MAPE_WF_SPAWN_VALUE = 0.35;
const MAPE_WF_EPS = 1e-6;
const MAPE_WF_MIGRATION_TIME = 10;
const MAPE_WF_MIGRATION_SHARE = 0.1;

function mapeFluidCapacity(i) {
	return MAPE_POP_CAP * world.settleValue[i] * landProductivity(i);
}

function mapeFluidFreeSpace(i) {
	const free = mapeFluidCapacity(i) - mape.pop[i];
	return free > 1e-5 ? free : 0;
}

function mapeFluidGenerate(dt, terrain, pop, fresh) {
	const n = world.n;
	const water = TERRAIN.WATER;
	const rate = MAPE_WF_GEN * dt;
	for (let i = 0; i < n; i++) {
		if (terrain[i] === water || pop[i] <= 0) continue;
		fresh[i] += pop[i] * rate;
	}
}

// Fresh pool advects up the workforce pull, exactly like goods up the demand gradient.
function mapeFluidAdvect(dt, size, terrain, pull, fresh, freshNext) {
	const water = TERRAIN.WATER;
	let frac = MAPE_WF_FLOW * dt;
	if (frac > MAPE_STEP_FRAC_MAX) frac = MAPE_STEP_FRAC_MAX;
	freshNext.set(fresh);
	for (let y = 0; y < size; y++) {
		const row = y * size;
		for (let x = 0; x < size; x++) {
			const i = row + x;
			if (terrain[i] === water || freshNext[i] <= MAPE_WF_EPS) continue;
			mapePushUpGradient(x, y, i, i, size, terrain, pull, freshNext, fresh[i] * frac, MAPE_WF_GRAD_REF, 0, null, mape.wfFlowX[0], mape.wfFlowY[0], true);
		}
	}
	fresh.set(freshNext);
}

function mapeFluidTire(dt, fresh, depleted) {
	const n = world.n;
	const keep = Math.exp(-MAPE_WF_TIRE * dt);
	const drop = 1 - keep;
	let tired = 0;
	for (let i = 0; i < n; i++) {
		const f = fresh[i];
		if (f <= 0) continue;
		const t = f * drop;
		fresh[i] = f - t;
		depleted[i] += t;
		tired += t;
	}
	mape.fluidTired += tired;
}

function mapeFluidSpendJobs(dt, fresh, depleted) {
	const size = world.size;
	const spend = MAPE_WF_SPEND * dt;
	const spendAt = (idx, need) => {
		const take = Math.min(fresh[idx], need * spend);
		if (take <= 0) return;
		fresh[idx] -= take;
		depleted[idx] += take;
		mape.fluidSpent += take;
	};
	for (let m = 0; m < mape.mineCount; m++) {
		if (!mapeMineActive(m)) continue;
		spendAt(mape.mineY[m] * size + mape.mineX[m], MAPE_MINE_WORKERS);
	}
	for (let f = 0; f < mape.factoryCount; f++) {
		const need = mapeFactoryWorkers(mape.factoryState[f]);
		if (need === 0) continue;
		spendAt(mape.factoryY[f] * size + mape.factoryX[f], need);
	}
}

// Exhausted workforce spreads like a gas; water blocks it, nothing drains it but settlements.
function mapeDepletedPass(src, dst, size, terrain, mix) {
	const water = TERRAIN.WATER;
	const end = size - 1;
	for (let y = 0; y < size; y++) {
		const row = y * size;
		const innerY = y > 0 && y < end;
		for (let x = 0; x < size; x++) {
			const i = row + x;
			if (terrain[i] === water) {
				dst[i] = 0;
				continue;
			}
			const cur = src[i];
			let delta = 0;
			if (innerY && x > 0 && x < end) {
				if (terrain[i - 1] !== water) delta += src[i - 1] - cur;
				if (terrain[i + 1] !== water) delta += src[i + 1] - cur;
				if (terrain[i - size] !== water) delta += src[i - size] - cur;
				if (terrain[i + size] !== water) delta += src[i + size] - cur;
			} else {
				if (x > 0 && terrain[i - 1] !== water) delta += src[i - 1] - cur;
				if (x < end && terrain[i + 1] !== water) delta += src[i + 1] - cur;
				if (y > 0 && terrain[i - size] !== water) delta += src[i - size] - cur;
				if (y < end && terrain[i + size] !== water) delta += src[i + size] - cur;
			}
			dst[i] = cur + mix * delta;
			const left = x > 0 && terrain[i - 1] !== water ? Math.max(0, cur - src[i - 1]) * mix : 0;
			const right = x < end && terrain[i + 1] !== water ? Math.max(0, cur - src[i + 1]) * mix : 0;
			const up = y > 0 && terrain[i - size] !== water ? Math.max(0, cur - src[i - size]) * mix : 0;
			const down = y < end && terrain[i + size] !== water ? Math.max(0, cur - src[i + size]) * mix : 0;
			mape.wfFlowX[1][i] += right - left;
			mape.wfFlowY[1][i] += down - up;
			mapeFluidRecordMove(i, i - 1, left);
			mapeFluidRecordMove(i, i + 1, right);
			mapeFluidRecordMove(i, i - size, up);
			mapeFluidRecordMove(i, i + size, down);
		}
	}
}

function mapeFluidDiffuse(dt, size, terrain, depleted, depletedNext) {
	const edgeMix = MAPE_WF_DIFFUSE * 0.25 * (dt / MAPE_MAX_STEP);
	for (let p = 0; p < MAPE_DIFFUSE_PASSES; p++) {
		const src = (p & 1) === 0 ? depleted : depletedNext;
		const dst = (p & 1) === 0 ? depletedNext : depleted;
		mapeDepletedPass(src, dst, size, terrain, edgeMix);
	}
}

// Rest pull: settlements with room advertise it; depleted follows this gradient home.
function mapeFluidRestPull(dt, size, terrain) {
	const pull = mape.wfRestPull;
	const response = 1 - Math.exp(-MAPE_WF_REST_SIGNAL * dt);
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		const target = mapeFluidFreeSpace(i) / MAPE_POP_CAP;
		pull[i] += (target - pull[i]) * response;
	}
	mapeDiffuseSlice(pull, mape.wfRestPullNext, 0, size, terrain, true, MAPE_DIFFUSE, MAPE_WF_REST_DECAY, dt);
}

function mapeFluidAdvectDepleted(dt, size, terrain, depleted, depletedNext) {
	let frac = MAPE_WF_RETURN * dt;
	if (frac > MAPE_STEP_FRAC_MAX) frac = MAPE_STEP_FRAC_MAX;
	depletedNext.set(depleted);
	for (let y = 0; y < size; y++) {
		const row = y * size;
		for (let x = 0; x < size; x++) {
			const i = row + x;
			if (terrain[i] === TERRAIN.WATER || depletedNext[i] <= MAPE_WF_EPS) continue;
			mapePushUpGradient(x, y, i, i, size, terrain, mape.wfRestPull, depletedNext, depleted[i] * frac, MAPE_WF_REST_GRAD_REF, 0, null, mape.wfFlowX[1], mape.wfFlowY[1], true);
		}
	}
	depleted.set(depletedNext);
}

function mapeFluidRest(dt, depleted, fresh) {
	let rested = 0;
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		const free = mapeFluidFreeSpace(i);
		if (free <= 0) continue;
		const take = Math.min(depleted[i], MAPE_WF_REST * free * dt);
		if (take <= 0) continue;
		depleted[i] -= take;
		fresh[i] += take;
		rested += take;
	}
	mape.fluidRested += rested;
}

function mapeFluidRecordMove(src, dst, amount) {
	if (amount <= 0) return;
	if (mapeIsSettlement(src)) mape.wfBalance[src] -= amount;
	if (mapeIsSettlement(dst)) mape.wfBalance[dst] += amount;
}

function mapeFluidMigrate(dt) {
	const blend = 1 - Math.exp(-dt / MAPE_WF_MIGRATION_TIME);
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		const rate = mape.wfMigration[i] + (mape.wfBalance[i] / dt - mape.wfMigration[i]) * blend;
		mape.wfMigration[i] = rate;
		const before = mape.pop[i];
		const change = rate * MAPE_WF_MIGRATION_SHARE * dt;
		mape.pop[i] = Math.max(0, Math.min(Math.max(before, mapeFluidCapacity(i)), before + change));
		mape.popDelta += mape.pop[i] - before;
		if (mape.pop[i] < MAPE_SETTLE_MIN) mape.wfMigration[i] = 0;
	}
	mapeRebuildSettlements();
}

// One hamlet per tick, at the deepest pool on settlement-worthy land.
function mapeFluidSpawn(depleted, terrain) {
	const n = world.n;
	let best = -1;
	let bestPool = MAPE_WF_SPAWN;
	for (let i = 0; i < n; i++) {
		const pool = depleted[i];
		if (pool <= bestPool) continue;
		if (mape.pop[i] > 0 || terrain[i] === TERRAIN.WATER || mapeIsIndustry(i)) continue;
		if (world.settleValue[i] < MAPE_WF_SPAWN_VALUE) continue;
		best = i;
		bestPool = pool;
	}
	if (best < 0) return;
	depleted[best] -= MAPE_WF_SPAWN;
	const x = best % world.size;
	const y = (best / world.size) | 0;
	const before = mapeGoodsTotal();
	mapePlaceSettlement(best, MAPE_POP_SEED_MIN, true);
	mape.massIn += mapeGoodsTotal() - before;
	mape.popDelta += MAPE_POP_SEED_MIN;
	mape.fluidSpawned += 1;
	mapeRebuildSettlements();
	eventsAdd('Exhausted workers pool into a new settlement at ' + x + ',' + y + '.');
}

function mapeFluidStep(dt) {
	const size = world.size;
	const terrain = world.terrain;
	const fresh = mape.wfFresh;
	const depleted = mape.wfDepleted;
	mape.wfBalance.fill(0);
	mapeFluidGenerate(dt, terrain, mape.pop, fresh);
	mapeFluidAdvect(dt, size, terrain, mape.workforce, fresh, mape.wfFreshNext);
	mapeFluidTire(dt, fresh, depleted);
	mapeFluidSpendJobs(dt, fresh, depleted);
	mapeFluidRestPull(dt, size, terrain);
	mapeFluidAdvectDepleted(dt, size, terrain, depleted, mape.wfDepletedNext);
	mapeFluidDiffuse(dt, size, terrain, depleted, mape.wfDepletedNext);
	mapeFluidRest(dt, depleted, fresh);
	mapeFluidMigrate(dt);
	mapeFluidSpawn(depleted, terrain);
}

if (typeof module !== 'undefined') {
	module.exports = { mapeFluidStep, MAPE_WF_GEN, MAPE_WF_TIRE, MAPE_WF_REST, MAPE_WF_RETURN, MAPE_WF_SPAWN, MAPE_WF_SPAWN_VALUE };
}
