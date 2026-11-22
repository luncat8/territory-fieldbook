// owns: bounded coal/goods demand, stock feedback and household uptake
// edit for: catchment pressure, signal speed and queue service

const MAPE_MARKET_COAL_USE = 0.045;
const MAPE_MARKET_GOODS_USE = 0.036;
const MAPE_MARKET_FOOD_USE = 0.036;
const MAPE_MARKET_RESERVE = 1.5;
const MAPE_CATCHMENT_STOCK_SECONDS = 9;
const MAPE_CATCHMENT_RESPONSE = 0.9;
const MAPE_CATCHMENT_STRENGTH = 5;
// Pull diffusion obeys the units rule (units-and-scales.md): one Jacobi pass per canonical tick
// with mix = D · SIM_STEP_SEC ≤ MAPE_MIX_MAX, so D ≤ 3 cells²/s. D and decay are scaled together
// to keep reach sqrt(D / decay): 24 / 0.8 → 3 / 0.1 = 5.5 cells, 16 / 0.8 → 2 / 0.1 = 4.5 cells.
const MAPE_CATCHMENT_DECAY = 0.1;
const MAPE_CATCHMENT_DIFFUSE = 3;
const MAPE_QUEUE_STOCK_SECONDS = 12;
const MAPE_QUEUE_RESPONSE = 1.6;
const MAPE_QUEUE_DECAY = 0.1;
const MAPE_QUEUE_DIFFUSE = 2;
const MAPE_QUEUE_SECONDS = 0.25;
const MAPE_QUEUE_SERVICE_SECONDS = 0.1;
const MAPE_QUEUE_COOLING = 0.32;
const MAPE_HUNGRY_POP = 8;
const MAPE_FACTORY_YARD = 4;
const MAPE_MARKET_PRESSURE = 0.32;
const MAPE_MARKET_AMBIENT = 0.3;

function mapeIsMarketItem(r) {
	return r === MAPE_RES.COAL || r === MAPE_RES.GOODS || r === MAPE_RES.FOOD;
}

function mapeMarketUseRate(r, i) {
	if (r === MAPE_RES.FOOD) return mape.pop[i] * MAPE_MARKET_FOOD_USE;
	return mape.pop[i] * (r === MAPE_RES.COAL ? MAPE_MARKET_COAL_USE : MAPE_MARKET_GOODS_USE);
}

// Population picks the target so a crowded town pulls harder than a hamlet; a flat floor pulled every town alike.
function mapeMarketHungry(i) {
	const pop = mape.pop[i];
	return pop / (pop + MAPE_HUNGRY_POP);
}

// A single pinned cell loses its coal to a bigger town halo next door; the yard keeps a graded pull all round the plant.
function mapePullFactoryYard(off, center, strength) {
	const size = world.size;
	const terrain = world.terrain;
	for (let dy = -MAPE_FACTORY_YARD; dy <= MAPE_FACTORY_YARD; dy++) {
		for (let dx = -MAPE_FACTORY_YARD; dx <= MAPE_FACTORY_YARD; dx++) {
			const i = center + dy * size + dx;
			if (terrain[i] === TERRAIN.WATER) continue;
			const ring = Math.max(dx < 0 ? -dx : dx, dy < 0 ? -dy : dy);
			const want = 1 - ring / (MAPE_FACTORY_YARD + 1);
			const p = off + i;
			if (want <= mape.demand[p]) continue;
			mape.demand[p] += (want - mape.demand[p]) * strength;
		}
	}
}

function mapeMarketStock(reach, off, i) {
	const { catchments, counts, weights } = mapeMarketFlow;
	const base = i * MAPE_CATCHMENT_SIZE;
	let total = 0;
	for (let k = base, end = base + counts[i]; k < end; k++) {
		total += mape.goods[off + catchments[k]] * (reach ? weights[k] : 1);
	}
	return total;
}

function mapeMarketPull(r, i, rate = mapeMarketUseRate(r, i)) {
	if (!mape.surplusFeedback || rate <= 0) return 1;
	const off = r * world.n;
	const queue = mape.engine === MAPE_ENGINE.QUEUE;
	const stock = mapeMarketStock(queue, off, i);
	const half = Math.max(1, rate * (queue ? MAPE_QUEUE_STOCK_SECONDS : MAPE_CATCHMENT_STOCK_SECONDS));
	const pull = 1 / (1 + stock / half);
	if (!queue) return pull;
	const fill = Math.min(1, mapeMarketUsable(r, i) / (rate * MAPE_QUEUE_SECONDS));
	return pull * (1 - MAPE_QUEUE_COOLING * fill);
}

function mapeResetMarketFields(fill) {
	const { land, landCount } = mapeMarketFlow;
	const n = world.n;
	for (let r = 0; r < MAPE_RES.CO2; r++) {
		if (!mapeIsMarketItem(r)) continue;
		const off = r * n;
		const end = off + n;
		mape.marketSignal.fill(0, off, end);
		mape.demand.fill(0, off, end);
		mape.demandNext.fill(0, off, end);
		mape.flowX.fill(0, off, end);
		mape.flowY.fill(0, off, end);
		for (let k = 0; k < landCount; k++) {
			const p = off + land[k];
			mape.demand[p] = mape.marketSignal[p] = fill;
		}
	}
}

function mapePullMarketSlice(r, dt, queue) {
	const { catchments, counts, weights } = mapeMarketFlow;
	const { demand, marketSignal } = mape;
	const off = r * world.n;
	const response = 1 - Math.exp(-(queue ? MAPE_QUEUE_RESPONSE : MAPE_CATCHMENT_RESPONSE) * dt);
	const strength = 1 - Math.exp(-MAPE_CATCHMENT_STRENGTH * dt);
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		const p = off + i;
		const hungry = mapeMarketHungry(i);
		const target = hungry * mapeMarketPull(r, i) * mapeMoneyBuy(i);
		const signal = marketSignal[p] + (target - marketSignal[p]) * response;
		marketSignal[p] = signal;
		if (queue) {
			demand[p] = signal;
			continue;
		}
		const base = i * MAPE_CATCHMENT_SIZE;
		for (let j = base, end = base + counts[i]; j < end; j++) {
			const cell = off + catchments[j];
			demand[cell] += (signal - demand[cell]) * strength * weights[j];
		}
	}
	// Only a general works burns coal. A charcoal works that pulled coal would cage the coal
	// it makes inside its own yard, outranking the town halo that should carry it away.
	if (r !== MAPE_RES.COAL) return;
	for (let f = 0; f < mape.factoryCount; f++) {
		if (mape.factoryState[f] !== MAPE_FACTORY_STATE.ACTIVE || mape.factoryKind[f] !== MAPE_FACTORY_KIND.GENERAL) continue;
		mapePullFactoryYard(off, mape.factoryY[f] * world.size + mape.factoryX[f], strength);
	}
}

function mapeMarketJacobi(src, dst, off, mix, cond) {
	const { links, land, landCount } = mapeMarketFlow;
	if (!cond) {
		for (let k = 0; k < landCount; k++) {
			const i = land[k];
			const pos = off + i;
			const base = i * MAPE_LAND_LINKS;
			const here = src[pos];
			const sum = src[off + links[base]] + src[off + links[base + 1]] + src[off + links[base + 2]] + src[off + links[base + 3]];
			dst[pos] = here + mix * (sum - 4 * here);
		}
		return;
	}
	const condR = cond.condR;
	const condD = cond.condD;
	for (let k = 0; k < landCount; k++) {
		const i = land[k];
		const pos = off + i;
		const base = i * MAPE_LAND_LINKS;
		const here = src[pos];
		const l = links[base];
		const r = links[base + 1];
		const u = links[base + 2];
		const d = links[base + 3];
		const cL = l === i ? 0 : condR[l];
		const cR = r === i ? 0 : condR[i];
		const cU = u === i ? 0 : condD[u];
		const cD = d === i ? 0 : condD[i];
		dst[pos] = here + mix * (cL * (src[off + l] - here) + cR * (src[off + r] - here) + cU * (src[off + u] - here) + cD * (src[off + d] - here));
	}
}

function mapeMarketPinQueues(dst, off) {
	for (let k = 0; k < mape.settleCount; k++) {
		const p = off + mape.settleCells[k];
		dst[p] = mape.marketSignal[p];
	}
}

function mapeMarketDecay(queue) {
	return queue ? MAPE_QUEUE_DECAY : MAPE_CATCHMENT_DECAY;
}

// The pull fades toward ambient over time; how far it carries is sqrt(D / decay), so a diffusion
// speed change moves the reach with it. Measured: ~5 cells keeps 2–5-cell town spacing readable.
function mapeDriftMarketSlice(off, dt, queue) {
	const { land, landCount } = mapeMarketFlow;
	const { demand, goods, localPressure, marketFill } = mape;
	const ambient = localPressure ? Math.max(MAPE_MARKET_AMBIENT, marketFill) : marketFill;
	// The pressure-mode return scales with the diffusion rescale (0.12 / 8) so its wider reach,
	// sqrt(D / recover) ≈ 14 cells, is unchanged.
	const recover = 1 - Math.exp(-(localPressure ? 0.015 : mapeMarketDecay(queue)) * dt);
	for (let k = 0; k < landCount; k++) {
		const p = off + land[k];
		const here = demand[p];
		const next = here + (ambient - here) * recover;
		const pressure = localPressure ? 1 + goods[p] * MAPE_MARKET_PRESSURE * dt : 1;
		demand[p] = next > 1e-12 ? next / pressure : 0;
	}
	if (queue) mapeMarketPinQueues(demand, off);
}

// One Jacobi pass per tick, mix = D · dt inside the units budget (units-and-scales.md). The pass
// reads demand and writes demandNext; queue cells are pinned in the destination so the spread
// starts from the settlement signal, then the land slice is copied back for the drift step.
function mapeUpdateMarketSlice(r, dt, queue) {
	const off = r * world.n;
	const { demand, demandNext } = mape;
	const mix = (queue ? MAPE_QUEUE_DIFFUSE : MAPE_CATCHMENT_DIFFUSE) * dt;
	mapePullMarketSlice(r, dt, queue);
	mapeMarketJacobi(demand, demandNext, off, mix, transport);
	if (queue) mapeMarketPinQueues(demandNext, off);
	const { land, landCount } = mapeMarketFlow;
	for (let k = 0; k < landCount; k++) {
		const p = off + land[k];
		demand[p] = demandNext[p];
	}
	mapeDriftMarketSlice(off, dt, queue);
}

function mapeUpdateMarketFields(dt) {
	const queue = mape.engine === MAPE_ENGINE.QUEUE;
	mapeUpdateMarketSlice(MAPE_RES.COAL, dt, queue);
	mapeUpdateMarketSlice(MAPE_RES.GOODS, dt, queue);
	mapeUpdateMarketSlice(MAPE_RES.FOOD, dt, queue);
}

function mapeMarketUsable(r, i, stock = mape.goods[r * world.n + i]) {
	return r === MAPE_RES.GOODS && mapeIsSettlement(i) ? Math.max(0, stock - MAPE_MARKET_RESERVE) : stock;
}

function mapeQueueCapacity(r, i) {
	return mapeMarketUseRate(r, i) * MAPE_QUEUE_SECONDS;
}

function mapeUseMarketStock(p, amount) {
	if (amount <= 0) return 0;
	const before = mape.goods[p];
	mape.goods[p] = Math.max(0, before - amount);
	const used = before - mape.goods[p];
	mape.massOut += used;
	return used;
}

// A town's own granary is a reserve the market must not touch, so only the usable part may be
// spent. Drawing the raw stock and then reporting it as eaten let a town feed itself from a
// reserve that never fell — satisfaction without a source.
function mapeSpendUsable(r, cell, amount) {
	const usable = Math.min(amount, mapeMarketUsable(r, cell));
	return mapeUseMarketStock(r * world.n + cell, usable);
}

// Household need is fixed; scaling it by the demand signal let stock cool the pull and then stop its own uptake.
function mapeUseCatchmentStock(r, i, dt) {
	const off = r * world.n;
	const { catchments, counts } = mapeMarketFlow;
	const base = i * MAPE_CATCHMENT_SIZE;
	const end = base + counts[i];
	let stock = 0;
	for (let k = base; k < end; k++) stock += mapeMarketUsable(r, catchments[k]);
	if (stock <= 0) return;
	const share = Math.min(1, mapeMarketUseRate(r, i) * dt / stock);
	let used = 0;
	for (let k = base; k < end; k++) {
		const cell = catchments[k];
		used += mapeSpendUsable(r, cell, mapeMarketUsable(r, cell) * share);
	}
	if (used > 0) mapeRecordUse(r, i, used);
}

function mapeUseCatchments(dt) {
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		mapeUseCatchmentStock(MAPE_RES.COAL, i, dt);
		mapeUseCatchmentStock(MAPE_RES.GOODS, i, dt);
		mapeUseCatchmentStock(MAPE_RES.FOOD, i, dt);
		mapeUseLocalStock(MAPE_RES.LOGS, i, mape.pop[i] * MAPE_NEED_LOGS * dt);
	}
}

function mapeServeQueue(r, i, dt, share) {
	const p = r * world.n + i;
	const ready = Math.min(mapeMarketUseRate(r, i) * dt, mapeMarketUsable(r, i) * share);
	const used = mapeSpendUsable(r, i, ready);
	if (used > 0) mapeRecordUse(r, i, used);
}

function mapeServeQueues(dt) {
	const share = 1 - Math.exp(-dt / MAPE_QUEUE_SERVICE_SECONDS);
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		mapeServeQueue(MAPE_RES.COAL, i, dt, share);
		mapeServeQueue(MAPE_RES.GOODS, i, dt, share);
		mapeServeQueue(MAPE_RES.FOOD, i, dt, share);
		mapeUseLocalStock(MAPE_RES.LOGS, i, mape.pop[i] * MAPE_NEED_LOGS * dt);
	}
}

if (typeof module !== 'undefined') module.exports = { mapeMarketPull, mapeMarketUseRate, mapeQueueCapacity };
