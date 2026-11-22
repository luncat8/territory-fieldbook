// owns: diffusion map-economy step — demand/workforce Jacobi fields, gradient goods/worker flow, mine output
// edit for: diffusion and decay constants, advection speed, workforce recruitment, scaling kernel

// Diffusion speeds are coefficients in cells²/s; a field fades by its decay rate, and its reach
// sqrt(D / decay) is a result of the two, never a cutoff. Stability comes from units, not from
// passes: one Jacobi pass per canonical tick, mix = D · SIM_STEP_SEC ≤ MAPE_MIX_MAX (0.15, hard
// bound 0.25) — units-and-scales.md; audited by experiments/mape_diffusion_speed.js.
const MAPE_DIFFUSE = 1.8;
const MAPE_MIX_MAX = 0.15;
const MAPE_DECAY = 0.008;
const MAPE_DEMAND_GAIN = 8.0;
const MAPE_STOCK_SIGNAL = 0.25;
const MAPE_CO2_DIFFUSE = 0.5625;
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
	mape.jobSlots = 0;
	mape.jobFilled.fill(0);
	mape.jobVacant.fill(0);
	for (let k = 0; k < mape.workshopCount; k++) exp[mape.workshopCells[k]] |= MAPE_CELL_INDUSTRY;
	for (let m = 0; m < mape.mineCount; m++) {
		const idx = mape.mineY[m] * size + mape.mineX[m];
		exp[idx] |= MAPE_CELL_INDUSTRY;
		if (mapeMineActive(m)) {
			job[idx] += MAPE_MINE_WORKERS;
			mape.jobSlots += MAPE_MINE_WORKERS;
		}
	}
	for (let f = 0; f < mape.factoryCount; f++) {
		const st = mape.factoryState[f];
		if (st === MAPE_FACTORY_STATE.GONE) continue;
		const idx = mape.factoryY[f] * size + mape.factoryX[f];
		exp[idx] |= MAPE_CELL_INDUSTRY;
		const need = mapeFactoryWorkers(f);
		if (need > 0) {
			job[idx] += need;
			mape.jobSlots += need;
		}
	}
	mapeTabulateJobs();
}

// Which towns actually staff the work they own: a town credits the jobs it fills and owes the
// ones it leaves empty. Two-sided by construction, so it can drive migration where raw workforce
// traffic cannot. A site on the town's own cell counts as filled while the crew body is there.
function mapeTabulateJobs() {
	const size = world.size;
	const fresh = mape.wfFresh;
	const filled = mape.jobFilled;
	const vacant = mape.jobVacant;
	const credit = (town, idx, need, workers) => {
		const staffed = idx === town ? Math.min(need, 1 + fresh[idx]) : Math.min(need, fresh[idx]);
		filled[town] += staffed;
		vacant[town] += need - staffed;
	};
	for (let m = 0; m < mape.mineCount; m++) {
		if (!mapeMineActive(m)) continue;
		const town = mapeNearestSettlement(mape.mineX[m], mape.mineY[m]);
		if (town < 0) continue;
		credit(town, mape.mineY[m] * size + mape.mineX[m], MAPE_MINE_WORKERS, 0);
	}
	for (let f = 0; f < mape.factoryCount; f++) {
		const need = mapeFactoryWorkers(f);
		if (need <= 0) continue;
		const town = mapeNearestSettlement(mape.factoryX[f], mape.factoryY[f]);
		if (town < 0) continue;
		credit(town, mape.factoryY[f] * size + mape.factoryX[f], need, 0);
	}
}

function mapeInjectDemand(dt, marketsOnly) {
	const local = !mapeMarketEngine();
	if (!local && marketsOnly) return;
	const n = world.n;
	const size = world.size;
	const water = TERRAIN.WATER;
	const terrain = world.terrain;
	const pop = mape.pop;
	const demand = mape.demand;
	const goods = mape.goods;
	const gain = MAPE_DEMAND_GAIN * dt;
	const coalOff = MAPE_RES.COAL * n;
	const ironOff = MAPE_RES.IRON * n;
	const goodsOff = MAPE_RES.GOODS * n;
	const foodOff = MAPE_RES.FOOD * n;
	const co2Off = MAPE_RES.CO2 * n;
	for (let i = 0; i < n; i++) {
		const t = terrain[i];
		if (t === water) continue;
		const p = pop[i];
		if (p > 0 && local) {
			demand[goodsOff + i] += p * MAPE_NEED_GOODS * gain;
			demand[coalOff + i] += p * MAPE_NEED_COAL * gain;
			demand[foodOff + i] += p * MAPE_NEED_FOOD * gain;
		}
		if (marketsOnly) continue;
		if (p > 0 && !mapeIsIndustry(i)) demand[MAPE_RES.LOGS * n + i] += p * MAPE_NEED_LOGS * gain;
		if (p > 0) demand[co2Off + i] -= p * MAPE_NEED_COAL * gain;
		const uptake = economyForestRate(i, goods[co2Off + i]) * BIO_CARBON_PER_COVER;
		demand[co2Off + i] += uptake * gain;
	}
	for (let f = 0; f < mape.factoryCount; f++) {
		const st = mape.factoryState[f];
		if (st === MAPE_FACTORY_STATE.GONE) continue;
		const idx = mape.factoryY[f] * size + mape.factoryX[f];
		const kind = mape.factoryKind[f];
		if (kind !== MAPE_FACTORY_KIND.GENERAL) {
			if (marketsOnly) continue;
			if (st === MAPE_FACTORY_STATE.BUILDING) {
				// Construction hauls logs to the site; a sawmill fells its own footprint instead.
				if (kind !== MAPE_FACTORY_KIND.SAWMILL) demand[MAPE_RES.LOGS * n + idx] += MAPE_BUILD_WOOD_RATE * gain;
			} else if (kind === MAPE_FACTORY_KIND.CHARCOAL || kind === MAPE_FACTORY_KIND.WOOD) {
				demand[MAPE_RES.LOGS * n + idx] += MAPE_FORESTRY_INPUT * gain;
			}
			continue;
		}
		if (st === MAPE_FACTORY_STATE.BUILDING) {
			if (!marketsOnly) demand[MAPE_RES.LOGS * n + idx] += MAPE_BUILD_WOOD_RATE * gain;
		} else if (st === MAPE_FACTORY_STATE.ACTIVE || st === MAPE_FACTORY_STATE.IDLE) {
			// An idled plant still wants its inputs; demand is what wakes it.
			if (local) demand[coalOff + idx] += MAPE_FACTORY_COAL * gain;
			if (marketsOnly) continue;
			demand[ironOff + idx] += MAPE_FACTORY_IRON * gain;
			if (st === MAPE_FACTORY_STATE.ACTIVE) demand[co2Off + idx] -= MAPE_FACTORY_CO2 * gain;
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

// Symmetric edge fluxes give exact zero-flux bounds at water and map borders. With
// conductance each edge flux is weighted by c (harmonic-mean speed), so pull bends
// along fast ground and its reach over slow ground shrinks by about sqrt(c). A null
// conductance is the all-1 map (c = 1 on land edges) and reproduces the old pass.
function mapeDiffuseLandPass(src, dst, off, size, terrain, edgeMix, keep, condR, condD) {
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
				if (condR) {
					delta = condR[i - 1] * (src[p - 1] - cur) + condR[i] * (src[p + 1] - cur) + condD[i - size] * (src[p - size] - cur) + condD[i] * (src[p + size] - cur);
				} else {
					if (terrain[i - 1] !== water) delta += src[p - 1] - cur;
					if (terrain[i + 1] !== water) delta += src[p + 1] - cur;
					if (terrain[i - size] !== water) delta += src[p - size] - cur;
					if (terrain[i + size] !== water) delta += src[p + size] - cur;
				}
			} else if (condR) {
				if (x > 0) delta += condR[i - 1] * (src[p - 1] - cur);
				if (x < end) delta += condR[i] * (src[p + 1] - cur);
				if (y > 0) delta += condD[i - size] * (src[p - size] - cur);
				if (y < end) delta += condD[i] * (src[p + size] - cur);
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

// One Jacobi pass per tick. mix = rate · dt must sit at or below MAPE_MIX_MAX by construction
// (units-and-scales.md): rates are scaled so a single pass is always stable — no pass count, no
// substeps. With conductance the budget is D · max(c) · dt; max stays 1.0 by normalization.
// The pass reads field and writes scratch, then the slice is copied back so callers
// keep their buffer identities (demandView subarrays point into mape.demand).
function mapeDiffuseSlice(field, scratch, off, size, terrain, landOnly, rate, decayRate, dt, cond) {
	if (rate <= 0 || dt <= 0) return 0;
	const edgeMix = rate * dt;
	const keep = decayRate > 0 ? Math.exp(-decayRate * dt) : 1;
	const loss = landOnly
		? mapeDiffuseLandPass(field, scratch, off, size, terrain, edgeMix, keep, cond ? cond.condR : null, cond ? cond.condD : null)
		: mapeDiffuseAllPass(field, scratch, off, size, edgeMix, keep);
	const end = off + size * size;
	for (let p = off; p < end; p++) field[p] = scratch[p];
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

// Pairwise stock transfer in one pass: mix = D · dt ≤ MAPE_MIX_MAX by the units rule. Transfers
// stay conservative and are bounded by what each cell holds.
function mapeDiffuseCo2Stock(goods, next, off, size, dt) {
	if (dt <= 0) return;
	mapeCo2Pass(goods, next, off, size, MAPE_CO2_DIFFUSE * dt);
}

function mapeCo2Pass(src, next, off, size, edgeMix) {
	const end = size - 1;
	for (let y = 0; y < size; y++) {
		const row = off + y * size;
		for (let x = 0; x < size; x++) {
			const p = row + x;
			const cur = src[p];
			if (x < end) {
				const d = cur - src[p + 1];
				if (d > MAPE_EPS) mapeApplyTransfer(next, p, p + 1, d * edgeMix, 0);
				else if (d < -MAPE_EPS) mapeApplyTransfer(next, p + 1, p, -d * edgeMix, 0);
			}
			if (y < end) {
				const d = cur - src[p + size];
				if (d > MAPE_EPS) mapeApplyTransfer(next, p, p + size, d * edgeMix, 0);
				else if (d < -MAPE_EPS) mapeApplyTransfer(next, p + size, p, -d * edgeMix, 0);
			}
		}
	}
}

function mapeDiffuseFields(dt, marketsOnly) {
	const marketFlow = mapeMarketEngine();
	const size = world.size;
	const n = world.n;
	const terrain = world.terrain;
	for (let r = 0; r < MAPE_R; r++) {
		const marketItem = mapeIsMarketItem(r);
		if (marketItem ? marketFlow : marketsOnly) continue;
		const landOnly = r !== MAPE_RES.CO2;
		mape.dissipated += mapeDiffuseSlice(mape.demand, mape.demandNext, r * n, size, terrain, landOnly, MAPE_DIFFUSE, MAPE_DECAY, dt, transport);
	}
}

// Normalized gradient g_k·c_k / (Σg·c + ref) keeps steady speed across 20 cells and
// around water, and prefers a fast route with a comparable gradient. Returns the
// transport effort (moved / c · per-unit), so slow ground costs more labour.
function mapePushUpGradient(x, y, i, p, size, terrain, field, next, budget, gradRef, cap, disturbed, flowX, flowY, workforceBalance, cond) {
	const water = TERRAIN.WATER;
	const end = size - 1;
	const cur = field[p];
	const cL = cond ? (x > 0 ? cond.condR[i - 1] : 0) : (x > 0 && terrain[i - 1] !== water ? 1 : 0);
	const cR = cond ? (x < end ? cond.condR[i] : 0) : (x < end && terrain[i + 1] !== water ? 1 : 0);
	const cU = cond ? (y > 0 ? cond.condD[i - size] : 0) : (y > 0 && terrain[i - size] !== water ? 1 : 0);
	const cD = cond ? (y < end ? cond.condD[i] : 0) : (y < end && terrain[i + size] !== water ? 1 : 0);
	const gL = x > 0 && cL > 0 && field[p - 1] > cur ? field[p - 1] - cur : 0;
	const gR = x < end && cR > 0 && field[p + 1] > cur ? field[p + 1] - cur : 0;
	const gU = y > 0 && cU > 0 && field[p - size] > cur ? field[p - size] - cur : 0;
	const gD = y < end && cD > 0 && field[p + size] > cur ? field[p + size] - cur : 0;
	const wL = gL * cL;
	const wR = gR * cR;
	const wU = gU * cU;
	const wD = gD * cD;
	const wSum = wL + wR + wU + wD;
	if (wSum <= 0) return 0;
	const scale = budget / (wSum + gradRef);
	const left = wL > 0 ? mapeApplyTransfer(next, p, p - 1, wL * scale, cap > 0 ? cap * (1 - disturbed[i - 1]) : 0) : 0;
	const right = wR > 0 ? mapeApplyTransfer(next, p, p + 1, wR * scale, cap > 0 ? cap * (1 - disturbed[i + 1]) : 0) : 0;
	const up = wU > 0 ? mapeApplyTransfer(next, p, p - size, wU * scale, cap > 0 ? cap * (1 - disturbed[i - size]) : 0) : 0;
	const down = wD > 0 ? mapeApplyTransfer(next, p, p + size, wD * scale, cap > 0 ? cap * (1 - disturbed[i + size]) : 0) : 0;
	if (workforceBalance) {
		mapeFluidRecordMove(i, i - 1, left);
		mapeFluidRecordMove(i, i + 1, right);
		mapeFluidRecordMove(i, i - size, up);
		mapeFluidRecordMove(i, i + size, down);
	}
	if (flowX) {
		flowX[p] = right - left;
		flowY[p] = down - up;
	}
	return ((cL > 0 ? left / cL : 0) + (cR > 0 ? right / cR : 0) + (cU > 0 ? up / cU : 0) + (cD > 0 ? down / cD : 0)) * MAPE_WORKFORCE_PER_UNIT;
}

function mapeHaulBudget(i, stock, fraction, pop, work) {
	const staff = pop[i] / (pop[i] + work[i] + MAPE_TRANSPORT_REF_POP);
	return stock * fraction * (MAPE_TRANSPORT_BASE + (1 - MAPE_TRANSPORT_BASE) * staff);
}

function mapeTransportSlice(r, size, terrain, demand, goods, next, pop, work, workNext, dt, fast, flowX, flowY, cond) {
	const off = r * size * size;
	const water = TERRAIN.WATER;
	const baseFrac = Math.min(MAPE_STEP_FRAC_MAX, (fast ? MAPE_MARKET_FLOW_SPEED : MAPE_FLOW_SPEED) * mapeFoodFlowMultiplier(r) * tune.haul * dt);
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
			const effort = mapePushUpGradient(x, y, i, p, size, terrain, demand, next, budget, gradRef, 0, null, flowX, flowY, false, cond);
			if (effort <= 0) continue;
			workNext[i] += effort;
			workTotal += effort;
		}
	}
	return workTotal;
}

// Job slots stay factual in jobNeed; only the pull field carries walking work, and only for residents.
function mapeStepWorkforce(dt, transportBuffer) {
	const n = world.n;
	const pop = mape.pop;
	const job = mape.jobNeed;
	const work = mape.workforce;
	const hauling = mape.workforceMode === MAPE_WORKFORCE_MODE.RESIDENTS;
	const invDt = 1 / dt;
	const signal = MAPE_WORK_SIGNAL * dt;
	// Demand is "proportional on what the factory needs and gets" (draft): once a site is
	// staffed with fresh workforce, its pull falls to zero instead of keep calling for more.
	for (let i = 0; i < n; i++) {
		const present = mapeWorkPresent(i);
		const siteNeed = job[i] > 0 ? Math.max(0, job[i] - present) : 0;
		const haulNeed = hauling ? transportBuffer[i] * invDt : 0;
		if (siteNeed > 0) {
			if (hauling && siteNeed + haulNeed <= pop[i]) continue;
			work[i] += (siteNeed + haulNeed) * signal;
		} else if (haulNeed > pop[i]) {
			work[i] += (haulNeed - pop[i]) * 0.25 * dt;
		}
	}
	mapeDiffuseSlice(work, mape.workforceNext, 0, world.size, world.terrain, true, MAPE_DIFFUSE, MAPE_WORK_DECAY, dt, transport);
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
	let walkFrac = MAPE_WORK_SPEED * tune.walk * dt;
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
			if (mapePushUpGradient(x, y, i, i, size, terrain, work, next, budget, MAPE_WORK_GRAD_REF, MAPE_POP_CAP, disturbed, null, null, false, transport) > 0) moved = true;
		}
	}
	if (!moved) return;
	pop.set(next);
	mapeRebuildSettlements();
}

function mapeDiffusionTick(dt) {
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
			mapeRouteQueues(r, dt, transport);
			continue;
		}
		const fast = catchment && marketItem;
		const guide = fast ? mapeFilterMarketDemand(r) : mape.demand;
		mape.transportWork += mapeTransportSlice(r, size, terrain, guide, goods, goodsNext, mape.pop, mape.workforce, workScratch, dt, fast, mape.flowX, mape.flowY, transport);
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
	economyStep(dt);
	mapeRecoverMoney(dt);
}

// Advance a duration in whole canonical ticks: one tick (SIM_STEP_SEC) is the only step size the
// economy has, and a final partial tick is never longer than the tick — so every mix stays inside
// the units budget no matter how long the caller asks for.
function mapeStepDiffusion(seconds) {
	let left = seconds;
	while (left > 1e-9) {
		const dt = Math.min(SIM_STEP_SEC, left);
		mapeDiffusionTick(dt);
		left -= dt;
	}
}

// Rebuild the visible signals without advancing inventories or the clock.
function mapeWarmDemand(marketsOnly) {
	if (!marketsOnly) mapeSyncCells();
	const fieldMarkets = mapeMarketEngine();
	if (!marketsOnly || !fieldMarkets) {
		const dissipated = mape.dissipated;
		const steps = Math.round((marketsOnly ? MAPE_SWITCH_WARM_SEC : MAPE_WARM_SEC) / SIM_STEP_SEC);
		for (let s = 0; s < steps; s++) {
			mapeInjectDemand(SIM_STEP_SEC, marketsOnly);
			mapeDiffuseFields(SIM_STEP_SEC, marketsOnly);
		}
		mape.dissipated = dissipated;
	}
	if (!fieldMarkets) return;
	const marketSteps = Math.round((marketsOnly ? MAPE_SWITCH_WARM_SEC : MAPE_MARKET_WARM_SEC) / SIM_STEP_SEC);
	for (let s = 0; s < marketSteps; s++) mapeUpdateMarketFields(SIM_STEP_SEC);
}

// Exercises the exact diffusion + advection kernels at arbitrary R and grid size for Phase 1 scaling gates.
function mapeKernelStep(size, rCount, terrain, demand, demandNext, goods, goodsNext, pop, work, workNext, dt, cond) {
	const n = size * size;
	for (let r = 0; r < rCount; r++) {
		const landOnly = r + 1 < rCount || rCount === 1;
		mapeDiffuseSlice(demand, demandNext, r * n, size, terrain, landOnly, MAPE_DIFFUSE, MAPE_DECAY, dt, cond);
	}
	goodsNext.set(goods);
	workNext.fill(0);
	const matCount = rCount > 1 ? rCount - 1 : 1;
	for (let r = 0; r < matCount; r++) {
		mapeTransportSlice(r, size, terrain, demand, goods, goodsNext, pop, work, workNext, dt, false, null, null, cond);
	}
	if (rCount > 1) mapeDiffuseCo2Stock(goods, goodsNext, (rCount - 1) * n, size, dt);
	goods.set(goodsNext);
	const invDt = 1 / dt;
	for (let i = 0; i < n; i++) {
		const need = workNext[i] * invDt;
		if (need > pop[i]) work[i] += (need - pop[i]) * 0.25 * dt;
	}
	mapeDiffuseSlice(work, workNext, 0, size, terrain, true, MAPE_DIFFUSE, MAPE_WORK_DECAY, dt, cond);
}

if (typeof module !== 'undefined') {
	module.exports = {
		mapeStepDiffusion, mapeWarmDemand, mapeKernelStep,
		MAPE_DIFFUSE, MAPE_MIX_MAX, MAPE_DECAY, MAPE_FLOW_SPEED
	};
}
