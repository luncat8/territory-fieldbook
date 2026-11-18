// owns: A's settlement catchments and B's local intake queues for coal and goods
// edit for: stock feedback, settlement uptake and queue admission

const MAPE_CATCHMENT_STEPS = 4;
const MAPE_CATCHMENT_SIZE = 1 + 2 * MAPE_CATCHMENT_STEPS * (MAPE_CATCHMENT_STEPS + 1);
const MAPE_CATCHMENT_STOCK_SECONDS = 16;
const MAPE_QUEUE_SECONDS = 0.25;
const MAPE_QUEUE_SERVICE_SECONDS = 0.1;
const MAPE_QUEUE_COOLING = 0.5;
const MAPE_MARKET_DEMAND_DECAY = 0.32;
const MAPE_MARKET_FLOW_SPEED = 3.6;
const MAPE_MARKET_GRAD_REF = 0.004;
const MAPE_LAND_LINKS = 4;

const mapeMarketFlow = {
	links: null,
	linksReady: false,
	catchments: null,
	catchmentsReady: false,
	counts: null,
	requests: null,
	room: null,
	accepted: null
};

function mapeIsMarketItem(r) {
	return r === MAPE_RES.COAL || r === MAPE_RES.GOODS;
}

function mapeMarketUseRate(r, i) {
	return mape.pop[i] * (r === MAPE_RES.COAL ? MAPE_NEED_COAL : MAPE_NEED_GOODS);
}

function mapeMarketFlowPrepare(newMap) {
	if (newMap) {
		mapeMarketFlow.linksReady = false;
		mapeMarketFlow.catchmentsReady = false;
	}
	if (mape.engine === MAPE_ENGINE.DIFFUSION) return;
	const n = world.n;
	if (!mapeMarketFlow.linksReady) {
		if (!mapeMarketFlow.links) mapeMarketFlow.links = new Int16Array(n * MAPE_LAND_LINKS);
		mapeBuildMarketLinks();
		mapeMarketFlow.linksReady = true;
	}
	if (mape.engine === MAPE_ENGINE.CATCHMENT) {
		if (mapeMarketFlow.catchmentsReady) return;
		if (!mapeMarketFlow.catchments) {
			mapeMarketFlow.catchments = new Uint16Array(n * MAPE_CATCHMENT_SIZE);
			mapeMarketFlow.counts = new Uint8Array(n);
		}
		mapeBuildCatchments();
		mapeMarketFlow.catchmentsReady = true;
	} else if (!mapeMarketFlow.requests) {
		mapeMarketFlow.requests = new Float64Array(n * MAPE_LAND_LINKS);
		mapeMarketFlow.room = new Float64Array(n);
		mapeMarketFlow.accepted = new Float64Array(n);
	}
}

function mapeBuildMarketLinks() {
	const { links } = mapeMarketFlow;
	const { size, n, terrain } = world;
	const water = TERRAIN.WATER;
	links.fill(-1);
	for (let i = 0; i < n; i++) {
		if (terrain[i] === water) continue;
		const x = i % size;
		const base = i * MAPE_LAND_LINKS;
		if (x > 0 && terrain[i - 1] !== water) links[base] = i - 1;
		if (x < size - 1 && terrain[i + 1] !== water) links[base + 1] = i + 1;
		if (i >= size && terrain[i - size] !== water) links[base + 2] = i - size;
		if (i < n - size && terrain[i + size] !== water) links[base + 3] = i + size;
	}
}

function mapeBuildCatchments() {
	const { links, catchments, counts } = mapeMarketFlow;
	const visited = new Uint16Array(world.n);
	for (let i = 0; i < world.n; i++) {
		counts[i] = 0;
		if (world.terrain[i] === TERRAIN.WATER) continue;
		const base = i * MAPE_CATCHMENT_SIZE;
		const mark = i + 1;
		let end = base + 1;
		let read = base;
		catchments[base] = i;
		visited[i] = mark;
		// Shortest walkable paths keep stock on the far side of a shoreline out of reach.
		for (let step = 0; step < MAPE_CATCHMENT_STEPS; step++) {
			const layerEnd = end;
			for (; read < layerEnd; read++) {
				const edge = catchments[read] * MAPE_LAND_LINKS;
				for (let d = 0; d < MAPE_LAND_LINKS; d++) {
					const to = links[edge + d];
					if (to < 0 || visited[to] === mark) continue;
					visited[to] = mark;
					catchments[end++] = to;
				}
			}
		}
		counts[i] = end - base;
	}
}

function mapeCatchmentStock(off, i) {
	const { catchments, counts } = mapeMarketFlow;
	const base = i * MAPE_CATCHMENT_SIZE;
	let total = 0;
	for (let k = base, end = base + counts[i]; k < end; k++) total += mape.goods[off + catchments[k]];
	return total;
}

function mapeMarketPull(r, i, rate = mapeMarketUseRate(r, i)) {
	if (!mape.surplusFeedback) return 1;
	const off = r * world.n;
	if (mape.engine === MAPE_ENGINE.CATCHMENT) {
		return 1 / (1 + mapeCatchmentStock(off, i) / (rate * MAPE_CATCHMENT_STOCK_SECONDS));
	}
	const fill = Math.min(1, mape.goods[off + i] / (rate * MAPE_QUEUE_SECONDS));
	return 1 - MAPE_QUEUE_COOLING * fill;
}

function mapeInjectMarketDemand(gain) {
	const goodsOff = MAPE_RES.GOODS * world.n;
	const coalOff = MAPE_RES.COAL * world.n;
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		if (!mapeIsSettlement(i)) continue;
		const coalRate = mapeMarketUseRate(MAPE_RES.COAL, i);
		const goodsRate = mapeMarketUseRate(MAPE_RES.GOODS, i);
		mape.demand[coalOff + i] += coalRate * gain * mapeMarketPull(MAPE_RES.COAL, i, coalRate);
		mape.demand[goodsOff + i] += goodsRate * gain * mapeMarketPull(MAPE_RES.GOODS, i, goodsRate);
	}
}

function mapeUseMarketStock(p, amount) {
	if (amount <= 0) return;
	const before = mape.goods[p];
	mape.goods[p] = Math.max(0, before - amount);
	mape.massOut += before - mape.goods[p];
}

function mapeUseCatchmentStock(r, i, dt) {
	const off = r * world.n;
	const stock = mapeCatchmentStock(off, i);
	if (stock <= 0) return;
	const share = Math.min(1, mapeMarketUseRate(r, i) * dt / stock);
	const { catchments, counts } = mapeMarketFlow;
	const base = i * MAPE_CATCHMENT_SIZE;
	for (let k = base, end = base + counts[i]; k < end; k++) {
		const p = off + catchments[k];
		mapeUseMarketStock(p, mape.goods[p] * share);
	}
}

function mapeUseCatchments(dt) {
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		if (!mapeIsSettlement(i)) continue;
		mapeUseCatchmentStock(MAPE_RES.COAL, i, dt);
		mapeUseCatchmentStock(MAPE_RES.GOODS, i, dt);
	}
}

function mapeServeQueue(r, i, dt, share) {
	const p = r * world.n + i;
	mapeUseMarketStock(p, Math.min(mapeMarketUseRate(r, i) * dt, mape.goods[p] * share));
}

function mapeServeQueues(dt) {
	const share = 1 - Math.exp(-dt / MAPE_QUEUE_SERVICE_SECONDS);
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		if (!mapeIsSettlement(i)) continue;
		mapeServeQueue(MAPE_RES.COAL, i, dt, share);
		mapeServeQueue(MAPE_RES.GOODS, i, dt, share);
	}
}

function mapeRequestQueueTransfers(i, off, fraction) {
	const { links, requests, room, accepted } = mapeMarketFlow;
	const { demand, goods } = mape;
	const here = demand[off + i];
	const base = i * MAPE_LAND_LINKS;
	let sum = 0;
	for (let d = 0; d < MAPE_LAND_LINKS; d++) {
		const to = links[base + d];
		if (to < 0 || room[to] === 0 || demand[off + to] <= here) continue;
		const slope = demand[off + to] - here;
		requests[base + d] = slope;
		sum += slope;
	}
	if (!sum) return;
	const scale = mapeHaulBudget(i, goods[off + i], fraction, mape.pop, mape.workforce) / (sum + MAPE_MARKET_GRAD_REF);
	for (let d = 0; d < MAPE_LAND_LINKS; d++) {
		const edge = base + d;
		if (!requests[edge]) continue;
		requests[edge] *= scale;
		const to = links[edge];
		if (room[to] >= 0) accepted[to] += requests[edge];
	}
}

function mapeApplyQueueTransfers(i, off) {
	const { links, requests, room, accepted } = mapeMarketFlow;
	const base = i * MAPE_LAND_LINKS;
	let moved = 0;
	for (let d = 0; d < MAPE_LAND_LINKS; d++) {
		const edge = base + d;
		if (!requests[edge]) continue;
		const to = links[edge];
		const share = room[to] < 0 ? 1 : accepted[to];
		moved += mapeApplyTransfer(mape.goodsNext, off + i, off + to, requests[edge] * share, 0);
	}
	return moved;
}

function mapeRouteQueues(r, dt) {
	const n = world.n;
	const off = r * n;
	const fraction = Math.min(MAPE_STEP_FRAC_MAX, MAPE_MARKET_FLOW_SPEED * dt);
	const { requests, room, accepted } = mapeMarketFlow;
	requests.fill(0);
	room.fill(-1);
	accepted.fill(0);
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		if (mapeIsSettlement(i)) room[i] = Math.max(0, mapeMarketUseRate(r, i) * MAPE_QUEUE_SECONDS - mape.goods[off + i]);
	}
	for (let i = 0; i < n; i++) {
		if (room[i] < 0 && mape.goods[off + i] > MAPE_EPS) mapeRequestQueueTransfers(i, off, fraction);
	}
	// Resolve all requests against the same headroom so the first mine scanned does not win.
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		if (accepted[i] > 0) accepted[i] = Math.min(1, room[i] / accepted[i]);
	}
	for (let i = 0; i < n; i++) {
		if (room[i] >= 0 || mape.goods[off + i] <= MAPE_EPS) continue;
		const effort = mapeApplyQueueTransfers(i, off) * MAPE_WORKFORCE_PER_UNIT;
		mape.workforceNext[i] += effort;
		mape.transportWork += effort;
	}
}

if (typeof module !== 'undefined') module.exports = { mapeMarketFlowPrepare, mapeMarketPull, mapeCatchmentStock };
