// owns: bounded coal/goods demand, stock feedback and household uptake
// edit for: catchment pressure, signal speed and queue service

const MAPE_MARKET_STEP = 0.05;
const MAPE_MARKET_COAL_USE = 0.03;
const MAPE_MARKET_GOODS_USE = 0.024;
const MAPE_MARKET_RESERVE = 1.5;
const MAPE_CATCHMENT_STOCK_SECONDS = 9;
const MAPE_CATCHMENT_RESPONSE = 0.9;
const MAPE_CATCHMENT_STRENGTH = 5;
const MAPE_QUEUE_STOCK_SECONDS = 12;
const MAPE_QUEUE_RESPONSE = 1.6;
const MAPE_QUEUE_SECONDS = 0.25;
const MAPE_QUEUE_SERVICE_SECONDS = 0.1;
const MAPE_QUEUE_COOLING = 0.32;
const MAPE_MARKET_PRESSURE = 0.32;
const MAPE_MARKET_AMBIENT = 0.3;

function mapeIsMarketItem(r) {
	return r === MAPE_RES.COAL || r === MAPE_RES.GOODS;
}

function mapeMarketUseRate(r, i) {
	return mape.pop[i] * (r === MAPE_RES.COAL ? MAPE_MARKET_COAL_USE : MAPE_MARKET_GOODS_USE);
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
	const { demand, marketSignal, pop } = mape;
	const off = r * world.n;
	const response = 1 - Math.exp(-(queue ? MAPE_QUEUE_RESPONSE : MAPE_CATCHMENT_RESPONSE) * dt);
	const strength = 1 - Math.exp(-MAPE_CATCHMENT_STRENGTH * dt);
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		const p = off + i;
		const hungry = Math.min(1, 0.52 + 0.024 * pop[i]);
		const target = hungry * mapeMarketPull(r, i);
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
	if (r !== MAPE_RES.COAL) return;
	for (let f = 0; f < mape.factoryCount; f++) {
		if (mape.factoryState[f] !== MAPE_FACTORY_STATE.ACTIVE) continue;
		const p = off + mape.factoryY[f] * world.size + mape.factoryX[f];
		demand[p] += (1 - demand[p]) * strength;
	}
}

function mapeMarketJacobi(src, dst, off, mix) {
	const { links, land, landCount } = mapeMarketFlow;
	for (let k = 0; k < landCount; k++) {
		const i = land[k];
		const pos = off + i;
		const base = i * MAPE_LAND_LINKS;
		const here = src[pos];
		const sum = src[off + links[base]] + src[off + links[base + 1]] + src[off + links[base + 2]] + src[off + links[base + 3]];
		dst[pos] = here + mix * (sum - 4 * here);
	}
}

function mapeMarketPinQueues(dst, off) {
	for (let k = 0; k < mape.settleCount; k++) {
		const p = off + mape.settleCells[k];
		dst[p] = mape.marketSignal[p];
	}
}

function mapeDriftMarketSlice(off, dt, queue) {
	const { land, landCount } = mapeMarketFlow;
	const { demand, goods, localPressure, marketFill } = mape;
	const ambient = localPressure ? Math.max(MAPE_MARKET_AMBIENT, marketFill) : marketFill;
	const recover = 1 - Math.exp(-(localPressure ? 0.12 : queue ? 0.065 : 0.025) * dt);
	for (let k = 0; k < landCount; k++) {
		const p = off + land[k];
		const here = demand[p];
		const next = here + (ambient - here) * recover;
		const pressure = localPressure ? 1 + goods[p] * MAPE_MARKET_PRESSURE * dt : 1;
		demand[p] = next > 1e-12 ? next / pressure : 0;
	}
	if (queue) mapeMarketPinQueues(demand, off);
}

function mapeUpdateMarketSlice(r, dt, queue) {
	const off = r * world.n;
	const { demand, demandNext } = mape;
	const mix = 0.2 * dt / MAPE_MARKET_STEP;
	mapePullMarketSlice(r, dt, queue);
	// More Jacobi passes give town signals time to reach lanes before stock piles up at a mine.
	for (let pass = 0, pairs = queue ? 2 : 3; pass < pairs; pass++) {
		mapeMarketJacobi(demand, demandNext, off, mix);
		if (queue) mapeMarketPinQueues(demandNext, off);
		mapeMarketJacobi(demandNext, demand, off, mix);
		if (queue) mapeMarketPinQueues(demand, off);
	}
	mapeDriftMarketSlice(off, dt, queue);
}

function mapeUpdateMarketFields(dt) {
	const queue = mape.engine === MAPE_ENGINE.QUEUE;
	mapeUpdateMarketSlice(MAPE_RES.COAL, dt, queue);
	mapeUpdateMarketSlice(MAPE_RES.GOODS, dt, queue);
}

function mapeMarketUsable(r, i, stock = mape.goods[r * world.n + i]) {
	return r === MAPE_RES.GOODS && mapeIsSettlement(i) ? Math.max(0, stock - MAPE_MARKET_RESERVE) : stock;
}

function mapeQueueCapacity(r, i) {
	return mapeMarketUseRate(r, i) * MAPE_QUEUE_SECONDS;
}

function mapeUseMarketStock(p, amount) {
	if (amount <= 0) return;
	const before = mape.goods[p];
	mape.goods[p] = Math.max(0, before - amount);
	mape.massOut += before - mape.goods[p];
}

function mapeUseCatchmentStock(r, i, dt) {
	const off = r * world.n;
	const { catchments, counts } = mapeMarketFlow;
	const base = i * MAPE_CATCHMENT_SIZE;
	const end = base + counts[i];
	let stock = 0;
	for (let k = base; k < end; k++) stock += mapeMarketUsable(r, catchments[k]);
	if (stock <= 0) return;
	const share = Math.min(1, mapeMarketUseRate(r, i) * mape.demand[off + i] * dt / stock);
	for (let k = base; k < end; k++) {
		const cell = catchments[k];
		mapeUseMarketStock(off + cell, mapeMarketUsable(r, cell) * share);
	}
}

function mapeUseCatchments(dt) {
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		mapeUseCatchmentStock(MAPE_RES.COAL, i, dt);
		mapeUseCatchmentStock(MAPE_RES.GOODS, i, dt);
	}
}

function mapeServeQueue(r, i, dt, share) {
	const p = r * world.n + i;
	const ready = Math.min(mapeMarketUseRate(r, i) * dt, mapeMarketUsable(r, i) * share);
	mapeUseMarketStock(p, ready);
}

function mapeServeQueues(dt) {
	const share = 1 - Math.exp(-dt / MAPE_QUEUE_SERVICE_SECONDS);
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		mapeServeQueue(MAPE_RES.COAL, i, dt, share);
		mapeServeQueue(MAPE_RES.GOODS, i, dt, share);
	}
}

if (typeof module !== 'undefined') module.exports = { mapeMarketPull, mapeMarketUseRate, mapeQueueCapacity };
