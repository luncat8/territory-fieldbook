// owns: optional fluid workforce model — fresh/depleted pools, settlement rest, hamlet spawning
// edit for: generation, tire and rest rates, advection, spawn threshold

const MAPE_WF_GEN = 0.05;
const MAPE_WF_TIRE = 0.02;
const MAPE_WF_DIFFUSE = 0.875;
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
const MAPE_SETTLE_KEEP = 8;
const MAPE_WF_TOWN_REACH = 8;

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
	const rate = MAPE_WF_GEN * tune.labour * dt;
	for (let i = 0; i < n; i++) {
		if (terrain[i] === water || pop[i] <= 0) continue;
		const add = pop[i] * rate;
		fresh[i] += add;
		mape.fluidGenerated += add;
	}
}

// Fresh pool advects up the workforce pull, exactly like goods up the demand gradient.
function mapeFluidAdvect(dt, size, terrain, pull, fresh, freshNext) {
	const water = TERRAIN.WATER;
	let frac = MAPE_WF_FLOW * tune.walk * dt;
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

// Idle availability is not a person walking around: unspent fresh effort fades back home.
// Only a job that spends workforce hands the same amount back as exhausted workers,
// so a pool system with no work cannot found towns or move population.
// Tiring hand-off: fresh effort becomes depleted effort in place. The depleted pool is the
// reserve the land can still put back to work, so it is a transfer, never a loss.
function mapeFluidTire(dt, fresh, depleted) {
	const n = world.n;
	const drop = 1 - Math.exp(-MAPE_WF_TIRE * dt);
	for (let i = 0; i < n; i++) {
		const f = fresh[i];
		if (f <= 0) continue;
		const t = f * drop;
		fresh[i] = f - t;
		depleted[i] += t;
		mape.fluidTired += t;
	}
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
		const need = mapeFactoryWorkers(f);
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
			mapeFluidRecordMove(i, i - 1, left);
			mapeFluidRecordMove(i, i + 1, right);
			mapeFluidRecordMove(i, i - size, up);
			mapeFluidRecordMove(i, i + size, down);
		}
	}
}

// One pass per tick (mix = D · dt ≤ MAPE_MIX_MAX by the units rule, units-and-scales.md), then
// blit back so the caller keeps its buffer identity. Water cells stay 0: the pass writes them.
function mapeFluidDiffuse(dt, size, terrain, depleted, depletedNext) {
	if (dt <= 0) return;
	mapeDepletedPass(depleted, depletedNext, size, terrain, MAPE_WF_DIFFUSE * dt);
	depleted.set(depletedNext);
	mapeFluidRecordDiffusionFlow(size, terrain, depleted);
}

// Flow marks read the blended wavefront — where the spread content sits against its neighbours
// is where it travels next tick, so a fresh blob records outward transfer on both flanks.
function mapeFluidRecordDiffusionFlow(size, terrain, src) {
	const water = TERRAIN.WATER;
	const end = size - 1;
	const flowX = mape.wfFlowX[1];
	const flowY = mape.wfFlowY[1];
	for (let y = 0; y < size; y++) {
		const row = y * size;
		for (let x = 0; x < size; x++) {
			const i = row + x;
			const cur = src[i];
			if (cur === 0 || terrain[i] === water) continue;
			const left = x > 0 && terrain[i - 1] !== water ? Math.max(0, cur - src[i - 1]) : 0;
			const right = x < end && terrain[i + 1] !== water ? Math.max(0, cur - src[i + 1]) : 0;
			const up = y > 0 && terrain[i - size] !== water ? Math.max(0, cur - src[i - size]) : 0;
			const down = y < end && terrain[i + size] !== water ? Math.max(0, cur - src[i + size]) : 0;
			flowX[i] += right - left;
			flowY[i] += down - up;
		}
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
	let frac = MAPE_WF_RETURN * tune.walk * dt;
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

// Migration is a transfer, never a birth: towns that cannot staff the work they own (vacant
// slots) receive from towns that are staffed up (spare residents), and the map's total population
// does not move. Food decides whether a town grows; only famine and waste shrink it. Raw workforce
// traffic cannot drive this — every town exports fresh effort on its first step and no town
// receives another's export, so outbound traffic is structurally one-sided and would empty a map.
function mapeFluidMigrate(dt) {
	const blend = 1 - Math.exp(-dt / MAPE_WF_MIGRATION_TIME);
	const share = mape.jobSlots > 0 ? MAPE_WF_MIGRATION_SHARE : 0;
	const donors = mape.wfDonor;
	const takers = mape.wfTaker;
	donors.fill(0);
	takers.fill(0);
	let spare = 0;
	let need = 0;
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		const vacant = mape.jobVacant[i];
		const filled = mape.jobFilled[i];
		const room = mapeFluidFreeSpace(i);
		if (vacant > 0) {
			const want = Math.min(vacant, room);
			if (want > 0) { takers[i] = want; need += want; }
		}
		// Residents beyond the work they already staff, and never below the keep floor.
		const excess = mape.pop[i] - filled - MAPE_SETTLE_KEEP;
		if (excess > 0) { donors[i] = excess; spare += excess; }
	}
	if (need <= 0 || spare <= 0 || share <= 0) {
		mape.wfMigration.fill(0);
		return;
	}
	const moved = Math.min(spare, need, spare * share) * dt;
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		const before = mape.pop[i];
		let change = 0;
		if (donors[i] > 0) change -= moved * donors[i] / spare;
		if (takers[i] > 0) change += moved * takers[i] / need;
		if (change === 0) continue;
		let next = before + change;
		// A town never passes its carrying capacity on an influx, and never drops below zero.
		const cap = Math.max(before, mapeFluidCapacity(i));
		if (next > cap) next = cap;
		if (next < 0) next = 0;
		mape.pop[i] = next;
		mape.popDelta += next - before;
	}
	if (mape.jobSlots > 0) {
		for (let k = 0; k < mape.settleCount; k++) {
			const i = mape.settleCells[k];
			const goal = (takers[i] > 0 ? 1 : -1) * moved / Math.max(1e-9, mape.pop[i] + 1);
			const rate = mape.wfMigration[i] + (goal - mape.wfMigration[i]) * blend;
			mape.wfMigration[i] = rate;
		}
	}
	mapeRebuildSettlements();
}

// A worked deposit with no town in reach needs people, so it founds one where they can live.
// Pools left by resting workers are not population and must not create towns.
function mapeFluidSpawn(depleted, terrain) {
	const best = mapeFluidFindSite(depleted, terrain);
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
	eventsAdd('Workers settle a new hamlet at ' + x + ',' + y + '.');
}

// Only a job site nobody lives near needs a new town; a site inside a town's reach is staffed
// by migration instead.
function mapeFluidFindSite(depleted, terrain) {
	let best = -1;
	for (let m = 0; m < mape.mineCount; m++) {
		if (!mapeMineActive(m)) continue;
		const near = mapeFluidNearestTown(mape.mineX[m], mape.mineY[m]);
		if (near < MAPE_WF_TOWN_REACH) continue;
		best = mapeFluidSiteNear(depleted, terrain, best, mape.mineX[m], mape.mineY[m], MAPE_WF_TOWN_REACH);
	}
	for (let f = 0; f < mape.factoryCount; f++) {
		if (mape.factoryState[f] !== MAPE_FACTORY_STATE.ACTIVE) continue;
		if (mapeFluidNearestTown(mape.factoryX[f], mape.factoryY[f]) < MAPE_WF_TOWN_REACH) continue;
		best = mapeFluidSiteNear(depleted, terrain, best, mape.factoryX[f], mape.factoryY[f], MAPE_WF_TOWN_REACH);
	}
	return best;
}

function mapeFluidNearestTown(x, y) {
	const size = world.size;
	let best = Infinity;
	for (let k = 0; k < mape.settleCount; k++) {
		const idx = mape.settleCells[k];
		const dx = (idx % size) - x;
		const dy = ((idx / size) | 0) - y;
		const d = dx * dx + dy * dy;
		if (d < best) best = d;
	}
	return Math.sqrt(best);
}

function mapeFluidSiteNear(depleted, terrain, best, x, y, reach) {
	const size = world.size;
	let pick = best;
	let bestPool = best < 0 ? MAPE_WF_SPAWN : depleted[best];
	for (let dy = -reach; dy <= reach; dy++) {
		for (let dx = -reach; dx <= reach; dx++) {
			if (dx * dx + dy * dy > reach * reach) continue;
			const idx = (y + dy) * size + x + dx;
			if (idx < 0 || idx >= world.n) continue;
			if (mape.pop[idx] > 0 || terrain[idx] === TERRAIN.WATER || mapeIsIndustry(idx)) continue;
			if (world.settleValue[idx] < MAPE_WF_SPAWN_VALUE) continue;
			const pool = depleted[idx];
			if (pool <= bestPool) continue;
			pick = idx;
			bestPool = pool;
		}
	}
	return pick;
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
