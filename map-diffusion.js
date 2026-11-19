// owns: diffusion map-economy step — demand/workforce Jacobi fields, gradient goods/worker flow, mine output
// edit for: diffusion and decay constants, advection speed, workforce recruitment, scaling kernel

const MAPE_MAX_STEP = 0.2;
const MAPE_DIFFUSE = 0.72;
const MAPE_DIFFUSE_PASSES = 2;
const MAPE_DECAY = 0.008;
const MAPE_DEMAND_GAIN = 8.0;
const MAPE_STOCK_SIGNAL = 0.25;
const MAPE_CO2_DIFFUSE = 0.45;
const MAPE_FLOW_SPEED = 1.8;
const MAPE_GRAD_REF = 0.02;
const MAPE_TRANSPORT_BASE = 0.5;
const MAPE_TRANSPORT_REF_POP = 1.0;
const MAPE_WORK_SIGNAL = 3.2;
const MAPE_WORK_DECAY = 0.10;
const MAPE_WORK_SPEED = 1.8;
const MAPE_WORK_LEAVE = 0.035;
const MAPE_WORK_GRAD_REF = 0.03;
const MAPE_STEP_FRAC_MAX = 0.75;
const MAPE_WARM_SEC = 8;
const MAPE_SWITCH_WARM_SEC = 2;
const MAPE_MARKET_WARM_SEC = 3;
const MAPE_EPS = 1e-6;
const MAPE_DENORM_FLOOR = 1e-12;

function mapeSyncCells() {
	const size = world.size;
	const job = mape.jobNeed;
	const exp = mape.cellExport;
	job.fill(0);
	exp.fill(0);
	for (let k = 0; k < mape.workshopCount; k++) exp[mape.workshopCells[k]] |= MAPE_CELL_INDUSTRY;
	for (let m = 0; m < mape.mineCount; m++) {
		const idx = mape.mineY[m] * size + mape.mineX[m];
		exp[idx] |= MAPE_CELL_INDUSTRY;
		if (mapeMineActive(m)) job[idx] += MAPE_MINE_WORKERS;
	}
	for (let f = 0; f < mape.factoryCount; f++) {
		const st = mape.factoryState[f];
		if (st === MAPE_FACTORY_STATE.GONE) continue;
		const idx = mape.factoryY[f] * size + mape.factoryX[f];
		exp[idx] |= MAPE_CELL_INDUSTRY;
		const need = mapeFactoryWorkers(st);
		if (need > 0) job[idx] += need;
	}
}

function mapeInjectDemand(dt, marketsOnly) {
	const local = mape.engine === MAPE_ENGINE.DIFFUSION;
	if (!local && marketsOnly) return;
	const n = world.n;
	const size = world.size;
	const water = TERRAIN.WATER;
	const terrain = world.terrain;
	const disturbed = land.disturbed;
	const pop = mape.pop;
	const demand = mape.demand;
	const goods = mape.goods;
	const biomass = economy.biomass;
	const gain = MAPE_DEMAND_GAIN * dt;
	const coalOff = MAPE_RES.COAL * n;
	const ironOff = MAPE_RES.IRON * n;
	const goodsOff = MAPE_RES.GOODS * n;
	const co2Off = MAPE_RES.CO2 * n;
	const co2Scale = MAPE_FOREST_CO2 / BIO_FIX[TERRAIN.FOREST] * gain;
	for (let i = 0; i < n; i++) {
		const t = terrain[i];
		if (t === water) continue;
		const p = pop[i];
		if (p > 0 && local) {
			demand[goodsOff + i] += p * MAPE_NEED_GOODS * gain;
			demand[coalOff + i] += p * MAPE_NEED_COAL * gain;
		}
		if (marketsOnly) continue;
		if (p > 0) demand[co2Off + i] -= p * MAPE_NEED_COAL * gain;
		const fix = BIO_FIX[t];
		if (fix > 0 && biomass[i] > 0) demand[co2Off + i] += biomass[i] * fix * (1 - disturbed[i]) * co2Scale;
	}
	for (let f = 0; f < mape.factoryCount; f++) {
		const st = mape.factoryState[f];
		const idx = mape.factoryY[f] * size + mape.factoryX[f];
		if (st === MAPE_FACTORY_STATE.BUILDING) {
			if (!marketsOnly) demand[ironOff + idx] += MAPE_FACTORY_BUILD_IRON * gain;
		} else if (st === MAPE_FACTORY_STATE.ACTIVE) {
			if (local) demand[coalOff + idx] += MAPE_FACTORY_COAL * gain;
			if (marketsOnly) continue;
			demand[ironOff + idx] += MAPE_FACTORY_IRON * gain;
			demand[co2Off + idx] -= MAPE_FACTORY_CO2 * gain;
		}
	}
	if (!mape.surplusFeedback) return;
	const stockStep = MAPE_STOCK_SIGNAL * dt;
	for (let r = 0; r < MAPE_RES.CO2; r++) {
		const marketItem = mapeIsMarketItem(r);
		if (marketItem ? !local : marketsOnly) continue;
		const off = r * n;
		for (let i = 0; i < n; i++) {
			const stock = goods[off + i];
			if (stock <= MAPE_EPS || terrain[i] === water) continue;
			demand[off + i] -= stock * stockStep;
		}
	}
}

// Symmetric edge fluxes give exact zero-flux bounds at water and map borders.
function mapeDiffuseLandPass(src, dst, off, size, terrain, edgeMix, keep) {
	const water = TERRAIN.WATER;
	const decay = 1 - keep;
	const end = size - 1;
	let loss = 0;
	for (let y = 0; y < size; y++) {
		const row = y * size;
		const innerY = y > 0 && y < end;
		for (let x = 0; x < size; x++) {
			const i = row + x;
			const p = off + i;
			if (terrain[i] === water) {
				dst[p] = 0;
				continue;
			}
			const cur = src[p];
			let delta = 0;
			if (innerY && x > 0 && x < end) {
				if (terrain[i - 1] !== water) delta += src[p - 1] - cur;
				if (terrain[i + 1] !== water) delta += src[p + 1] - cur;
				if (terrain[i - size] !== water) delta += src[p - size] - cur;
				if (terrain[i + size] !== water) delta += src[p + size] - cur;
			} else {
				if (x > 0 && terrain[i - 1] !== water) delta += src[p - 1] - cur;
				if (x < end && terrain[i + 1] !== water) delta += src[p + 1] - cur;
				if (y > 0 && terrain[i - size] !== water) delta += src[p - size] - cur;
				if (y < end && terrain[i + size] !== water) delta += src[p + size] - cur;
			}
			const mixed = cur + edgeMix * delta;
			if (decay > 0) loss += mixed < 0 ? -mixed : mixed;
			const next = mixed * keep;
			dst[p] = next > -MAPE_DENORM_FLOOR && next < MAPE_DENORM_FLOOR ? 0 : next;
		}
	}
	return loss * decay;
}

function mapeDiffuseAllPass(src, dst, off, size, edgeMix, keep) {
	const decay = 1 - keep;
	const end = size - 1;
	let loss = 0;
	for (let y = 0; y < size; y++) {
		const row = y * size;
		const innerY = y > 0 && y < end;
		for (let x = 0; x < size; x++) {
			const p = off + row + x;
			const cur = src[p];
			let delta = 0;
			if (innerY && x > 0 && x < end) {
				delta = src[p - 1] + src[p + 1] + src[p - size] + src[p + size] - 4 * cur;
			} else {
				if (x > 0) delta += src[p - 1] - cur;
				if (x < end) delta += src[p + 1] - cur;
				if (y > 0) delta += src[p - size] - cur;
				if (y < end) delta += src[p + size] - cur;
			}
			const mixed = cur + edgeMix * delta;
			if (decay > 0) loss += mixed < 0 ? -mixed : mixed;
			const next = mixed * keep;
			dst[p] = next > -MAPE_DENORM_FLOOR && next < MAPE_DENORM_FLOOR ? 0 : next;
		}
	}
	return loss * decay;
}

function mapeDiffuseSlice(field, scratch, off, size, terrain, landOnly, mix, decayRate, dt) {
	const edgeMix = mix * 0.25 * (dt / MAPE_MAX_STEP);
	const keep = decayRate > 0 ? 1 - decayRate * dt : 1;
	let loss = 0;
	for (let p = 0; p < MAPE_DIFFUSE_PASSES; p++) {
		const k = p + 1 === MAPE_DIFFUSE_PASSES ? keep : 1;
		const src = (p & 1) === 0 ? field : scratch;
		const dst = (p & 1) === 0 ? scratch : field;
		loss += landOnly
			? mapeDiffuseLandPass(src, dst, off, size, terrain, edgeMix, k)
			: mapeDiffuseAllPass(src, dst, off, size, edgeMix, k);
	}
	return loss;
}

// Debit what the receiver actually got, including rounding in Float32 population fields.
function mapeApplyTransfer(next, srcIdx, dstIdx, amount, dstMax) {
	if (amount <= 0) return 0;
	const dstBefore = next[dstIdx];
	if (dstMax > 0) {
		const room = dstMax - dstBefore;
		if (room <= 0) return 0;
		if (amount > room) amount = room;
	}
	const srcBefore = next[srcIdx];
	next[srcIdx] = srcBefore - amount;
	const taken = srcBefore - next[srcIdx];
	if (taken <= 0) {
		next[srcIdx] = srcBefore;
		return 0;
	}
	next[dstIdx] = dstBefore + taken;
	const moved = next[dstIdx] - dstBefore;
	if (moved <= 0 || moved > srcBefore) {
		next[dstIdx] = dstBefore;
		next[srcIdx] = srcBefore;
		return 0;
	}
	next[srcIdx] = srcBefore - moved;
	return moved;
}

function mapeDiffuseCo2Stock(goods, next, off, size, dt) {
	const end = size - 1;
	const edgeMix = MAPE_CO2_DIFFUSE * 0.25 * (dt / MAPE_MAX_STEP);
	for (let y = 0; y < size; y++) {
		const row = off + y * size;
		for (let x = 0; x < size; x++) {
			const p = row + x;
			const cur = goods[p];
			if (x < end) {
				const d = cur - goods[p + 1];
				if (d > MAPE_EPS) mapeApplyTransfer(next, p, p + 1, d * edgeMix, 0);
				else if (d < -MAPE_EPS) mapeApplyTransfer(next, p + 1, p, -d * edgeMix, 0);
			}
			if (y < end) {
				const d = cur - goods[p + size];
				if (d > MAPE_EPS) mapeApplyTransfer(next, p, p + size, d * edgeMix, 0);
				else if (d < -MAPE_EPS) mapeApplyTransfer(next, p + size, p, -d * edgeMix, 0);
			}
		}
	}
}

function mapeDiffuseFields(dt, marketsOnly) {
	const marketFlow = mape.engine !== MAPE_ENGINE.DIFFUSION;
	const size = world.size;
	const n = world.n;
	const terrain = world.terrain;
	for (let r = 0; r < MAPE_R; r++) {
		const marketItem = mapeIsMarketItem(r);
		if (marketItem ? marketFlow : marketsOnly) continue;
		const landOnly = r !== MAPE_RES.CO2;
		mape.dissipated += mapeDiffuseSlice(mape.demand, mape.demandNext, r * n, size, terrain, landOnly, MAPE_DIFFUSE, MAPE_DECAY, dt);
	}
}

// Normalized gradient g_k / (gSum + ref) keeps steady speed across 20 cells and around water.
function mapePushUpGradient(x, y, i, p, size, terrain, field, next, budget, gradRef, cap, disturbed, flowX, flowY) {
	const water = TERRAIN.WATER;
	const end = size - 1;
	const cur = field[p];
	const gL = x > 0 && terrain[i - 1] !== water && field[p - 1] > cur ? field[p - 1] - cur : 0;
	const gR = x < end && terrain[i + 1] !== water && field[p + 1] > cur ? field[p + 1] - cur : 0;
	const gU = y > 0 && terrain[i - size] !== water && field[p - size] > cur ? field[p - size] - cur : 0;
	const gD = y < end && terrain[i + size] !== water && field[p + size] > cur ? field[p + size] - cur : 0;
	const gSum = gL + gR + gU + gD;
	if (gSum <= 0) return 0;
	const scale = budget / (gSum + gradRef);
	const left = gL > 0 ? mapeApplyTransfer(next, p, p - 1, gL * scale, cap > 0 ? cap * (1 - disturbed[i - 1]) : 0) : 0;
	const right = gR > 0 ? mapeApplyTransfer(next, p, p + 1, gR * scale, cap > 0 ? cap * (1 - disturbed[i + 1]) : 0) : 0;
	const up = gU > 0 ? mapeApplyTransfer(next, p, p - size, gU * scale, cap > 0 ? cap * (1 - disturbed[i - size]) : 0) : 0;
	const down = gD > 0 ? mapeApplyTransfer(next, p, p + size, gD * scale, cap > 0 ? cap * (1 - disturbed[i + size]) : 0) : 0;
	if (flowX) {
		flowX[p] = right - left;
		flowY[p] = down - up;
	}
	return left + right + up + down;
}

function mapeHaulBudget(i, stock, fraction, pop, work) {
	const staff = pop[i] / (pop[i] + work[i] + MAPE_TRANSPORT_REF_POP);
	return stock * fraction * (MAPE_TRANSPORT_BASE + (1 - MAPE_TRANSPORT_BASE) * staff);
}

function mapeTransportSlice(r, size, terrain, demand, goods, next, pop, work, workNext, dt, fast, flowX, flowY) {
	const off = r * size * size;
	const water = TERRAIN.WATER;
	const baseFrac = Math.min(MAPE_STEP_FRAC_MAX, (fast ? MAPE_MARKET_FLOW_SPEED : MAPE_FLOW_SPEED) * dt);
	const gradRef = fast ? MAPE_MARKET_GRAD_REF : MAPE_GRAD_REF;
	let workTotal = 0;
	for (let y = 0; y < size; y++) {
		const row = y * size;
		for (let x = 0; x < size; x++) {
			const i = row + x;
			const p = off + i;
			const stock = goods[p];
			if (stock <= MAPE_EPS || terrain[i] === water) continue;
			const budget = fast ? mapeMarketUsable(r, i, stock) * baseFrac : mapeHaulBudget(i, stock, baseFrac, pop, work);
			if (budget <= 0) continue;
			const out = mapePushUpGradient(x, y, i, p, size, terrain, demand, next, budget, gradRef, 0, null, flowX, flowY);
			if (out <= 0) continue;
			const effort = out * MAPE_WORKFORCE_PER_UNIT;
			workNext[i] += effort;
			workTotal += effort;
		}
	}
	return workTotal;
}

// Injects unmet mine/factory jobs plus transport effort; only site jobs retain permanent residents.
function mapeStepWorkforce(dt, transportBuffer) {
	const n = world.n;
	const pop = mape.pop;
	const job = mape.jobNeed;
	const work = mape.workforce;
	const invDt = 1 / dt;
	const signal = MAPE_WORK_SIGNAL * dt;
	for (let i = 0; i < n; i++) {
		const siteNeed = job[i];
		const haulNeed = transportBuffer[i] * invDt;
		const totalNeed = siteNeed + haulNeed;
		if (siteNeed > 0) {
			job[i] = totalNeed;
			if (mape.workforceMode === MAPE_WORKFORCE_MODE.FLUID || totalNeed > pop[i]) work[i] += totalNeed * signal;
		} else if (haulNeed > pop[i]) {
			work[i] += (haulNeed - pop[i]) * 0.25 * dt;
		}
	}
	mapeDiffuseSlice(work, mape.workforceNext, 0, world.size, world.terrain, true, MAPE_DIFFUSE, MAPE_WORK_DECAY, dt);
}

function mapeTransportWorkers(dt) {
	const size = world.size;
	const water = TERRAIN.WATER;
	const terrain = world.terrain;
	const disturbed = land.disturbed;
	const pop = mape.pop;
	const next = mape.popNext;
	const job = mape.jobNeed;
	const work = mape.workforce;
	let walkFrac = MAPE_WORK_SPEED * dt;
	if (walkFrac > MAPE_STEP_FRAC_MAX) walkFrac = MAPE_STEP_FRAC_MAX;
	const leaveFrac = MAPE_WORK_LEAVE * dt;
	let moved = false;
	next.set(pop);
	for (let y = 0; y < size; y++) {
		const row = y * size;
		for (let x = 0; x < size; x++) {
			const i = row + x;
			const curPop = pop[i];
			const idle = curPop - job[i];
			if (idle <= MAPE_EPS || terrain[i] === water) continue;
			const budget = idle * (curPop >= MAPE_SETTLE_MIN ? leaveFrac : walkFrac);
			if (mapePushUpGradient(x, y, i, i, size, terrain, work, next, budget, MAPE_WORK_GRAD_REF, MAPE_POP_CAP, disturbed) > 0) moved = true;
		}
	}
	if (!moved) return;
	pop.set(next);
	mapeRebuildSettlements();
}

function mapeDiffusionSubstep(dt) {
	mapePopulationBeginStep();
	const size = world.size;
	const n = world.n;
	const terrain = world.terrain;
	const goods = mape.goods;
	const goodsNext = mape.goodsNext;
	const workScratch = mape.workforceNext;
	mapeSyncLocks();
	mapeSyncCells();
	mapeInjectDemand(dt);
	mapeDiffuseFields(dt);
	const queues = mape.engine === MAPE_ENGINE.QUEUE;
	const catchment = mape.engine === MAPE_ENGINE.CATCHMENT;
	if (catchment || queues) mapeUpdateMarketFields(dt);
	if (queues) mapeServeQueues(dt);
	goodsNext.set(goods);
	workScratch.fill(0);
	mape.flowX.fill(0);
	mape.flowY.fill(0);
	mape.flowDt = dt;
	for (let r = 0; r < MAPE_RES.CO2; r++) {
		const marketItem = mapeIsMarketItem(r);
		if (queues && marketItem) {
			mapeRouteQueues(r, dt);
			continue;
		}
		const fast = catchment && marketItem;
		const guide = fast ? mapeFilterMarketDemand(r) : mape.demand;
		mape.transportWork += mapeTransportSlice(r, size, terrain, guide, goods, goodsNext, mape.pop, mape.workforce, workScratch, dt, fast, mape.flowX, mape.flowY);
	}
	mapeDiffuseCo2Stock(goods, goodsNext, MAPE_RES.CO2 * n, size, dt);
	goods.set(goodsNext);
	if (catchment) mapeUseCatchments(dt);
	if (mape.engine === MAPE_ENGINE.DIFFUSION) mapeUseDiffusionStock(dt);
	mapeStepWorkforce(dt, workScratch);
	if (mape.workforceMode === MAPE_WORKFORCE_MODE.FLUID) mapeFluidStep(dt);
	else if (!mape.fixedResidents) mapeTransportWorkers(dt);
	mapePopulationStep(dt);
	mapeStepMines(dt);
	mapeStepFactories(dt);
	mapeStepWorkshops(dt);
	mapeRecoverMoney(dt);
}

function mapeStepDiffusion(seconds) {
	const step = mape.engine === MAPE_ENGINE.DIFFUSION ? MAPE_MAX_STEP : MAPE_MARKET_STEP;
	let left = seconds;
	while (left > 1e-9) {
		const dt = Math.min(step, left);
		mapeDiffusionSubstep(dt);
		left -= dt;
	}
}

// Rebuild the visible signals without advancing inventories or the clock.
function mapeWarmDemand(marketsOnly) {
	if (!marketsOnly) mapeSyncCells();
	const fieldMarkets = mape.engine !== MAPE_ENGINE.DIFFUSION;
	if (!marketsOnly || !fieldMarkets) {
		const dissipated = mape.dissipated;
		const steps = Math.round((marketsOnly ? MAPE_SWITCH_WARM_SEC : MAPE_WARM_SEC) / MAPE_MAX_STEP);
		for (let s = 0; s < steps; s++) {
			mapeInjectDemand(MAPE_MAX_STEP, marketsOnly);
			mapeDiffuseFields(MAPE_MAX_STEP, marketsOnly);
		}
		mape.dissipated = dissipated;
	}
	if (!fieldMarkets) return;
	const marketSteps = Math.round((marketsOnly ? MAPE_SWITCH_WARM_SEC : MAPE_MARKET_WARM_SEC) / MAPE_MARKET_STEP);
	for (let s = 0; s < marketSteps; s++) mapeUpdateMarketFields(MAPE_MARKET_STEP);
}

// Exercises the exact diffusion + advection kernels at arbitrary R and grid size for Phase 1 scaling gates.
function mapeKernelStep(size, rCount, terrain, demand, demandNext, goods, goodsNext, pop, work, workNext, dt) {
	const n = size * size;
	for (let r = 0; r < rCount; r++) {
		const landOnly = r + 1 < rCount || rCount === 1;
		mapeDiffuseSlice(demand, demandNext, r * n, size, terrain, landOnly, MAPE_DIFFUSE, MAPE_DECAY, dt);
	}
	goodsNext.set(goods);
	workNext.fill(0);
	const matCount = rCount > 1 ? rCount - 1 : 1;
	for (let r = 0; r < matCount; r++) {
		mapeTransportSlice(r, size, terrain, demand, goods, goodsNext, pop, work, workNext, dt);
	}
	if (rCount > 1) mapeDiffuseCo2Stock(goods, goodsNext, (rCount - 1) * n, size, dt);
	goods.set(goodsNext);
	const invDt = 1 / dt;
	for (let i = 0; i < n; i++) {
		const need = workNext[i] * invDt;
		if (need > pop[i]) work[i] += (need - pop[i]) * 0.25 * dt;
	}
	mapeDiffuseSlice(work, workNext, 0, size, terrain, true, MAPE_DIFFUSE, MAPE_WORK_DECAY, dt);
}

if (typeof module !== 'undefined') {
	module.exports = {
		mapeStepDiffusion, mapeWarmDemand, mapeKernelStep,
		MAPE_DIFFUSE, MAPE_DIFFUSE_PASSES, MAPE_DECAY, MAPE_FLOW_SPEED
	};
}
