// owns: the walkable market stencil, catchment reach and headroom-resolved queue transport
// edit for: routing, shoreline handling, queue admissions and field smoothing

// Intake reach is a travel-time budget in meadow steps; a road (c = 1) steps twice as far, so
// the stencil is sized for that diamond.
const MAPE_CATCHMENT_STEPS = 4;
const MAPE_CATCHMENT_ROAD_STEPS = 2 * MAPE_CATCHMENT_STEPS;
const MAPE_CATCHMENT_SIZE = 1 + 2 * MAPE_CATCHMENT_ROAD_STEPS * (MAPE_CATCHMENT_ROAD_STEPS + 1);
const MAPE_CATCHMENT_TIME_EPS = 1e-6;
const MAPE_MARKET_FLOW_SPEED = 13;
const MAPE_MARKET_GRAD_REF = 0.0015;
const MAPE_QUEUE_FLOW_SPEED = 14;
const MAPE_FOOD_FLOW_MULT = 0.25;
const MAPE_QUEUE_GRAD_REF = 0.0002;
const MAPE_LAND_LINKS = 8;
const MAPE_DX = [-1, 1, 0, 0, -1, 1, -1, 1];
const MAPE_DY = [0, 0, -1, 1, -1, -1, 1, 1];
const MAPE_EDGE_UNIT = [1, 1, 1, 1, Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2];

const mapeMarketFlow = {
	land: null,
	landCount: 0,
	links: null,
	catchments: null,
	weights: null,
	counts: null,
	requests: null,
	room: null,
	accepted: null
};

function mapeMarketFlowPrepare() {
	const n = world.n;
	if (!mapeMarketFlow.land || mapeMarketFlow.land.length !== n) {
		mapeMarketFlow.land = new Uint16Array(n);
		mapeMarketFlow.links = new Uint16Array(n * MAPE_LAND_LINKS);
		mapeMarketFlow.catchments = new Uint16Array(n * MAPE_CATCHMENT_SIZE);
		mapeMarketFlow.weights = new Float32Array(n * MAPE_CATCHMENT_SIZE);
		mapeMarketFlow.counts = new Uint8Array(n);
		mapeMarketFlow.requests = new Float64Array(n * MAPE_LAND_LINKS);
		mapeMarketFlow.room = new Float64Array(n);
		mapeMarketFlow.accepted = new Float64Array(n);
	}
	mapeBuildMarketLinks();
	mapeBuildCatchments();
}

function mapeBuildMarketLinks() {
	const { links, land } = mapeMarketFlow;
	const { size, n, terrain } = world;
	let count = 0;
	for (let i = 0; i < n; i++) {
		const base = i * MAPE_LAND_LINKS;
		for (let d = 0; d < MAPE_LAND_LINKS; d++) links[base + d] = i;
		if (terrain[i] === TERRAIN.WATER) continue;
		land[count++] = i;
		const left = i % size > 0 && terrain[i - 1] !== TERRAIN.WATER;
		const right = i % size < size - 1 && terrain[i + 1] !== TERRAIN.WATER;
		const up = i >= size && terrain[i - size] !== TERRAIN.WATER;
		const down = i < n - size && terrain[i + size] !== TERRAIN.WATER;
		if (left) links[base] = i - 1;
		if (right) links[base + 1] = i + 1;
		if (up) links[base + 2] = i - size;
		if (down) links[base + 3] = i + size;
		// Reflect at blocked edges; diagonals cannot clip the corner of a water tile.
		if (up && left && terrain[i - size - 1] !== TERRAIN.WATER) links[base + 4] = i - size - 1;
		if (up && right && terrain[i - size + 1] !== TERRAIN.WATER) links[base + 5] = i - size + 1;
		if (down && left && terrain[i + size - 1] !== TERRAIN.WATER) links[base + 6] = i + size - 1;
		if (down && right && terrain[i + size + 1] !== TERRAIN.WATER) links[base + 7] = i + size + 1;
	}
	mapeMarketFlow.landCount = count;
}

// Falloff runs on travel time, so a slow cell inside the reach counts for less than a near one.
function mapeBuildCatchments() {
	const { land, landCount, catchments, counts, weights } = mapeMarketFlow;
	const budget = MAPE_CATCHMENT_STEPS + MAPE_CATCHMENT_TIME_EPS;
	const falloff = 1 / (MAPE_CATCHMENT_STEPS + 1);
	counts.fill(0);
	for (let iLand = 0; iLand < landCount; iLand++) {
		const i = land[iLand];
		const base = i * MAPE_CATCHMENT_SIZE;
		const count = transportTravel(i, budget);
		for (let k = 0; k < count; k++) {
			const cell = transport.order[k];
			catchments[base + k] = cell;
			weights[base + k] = 1 - transport.time[cell] * falloff;
		}
		counts[i] = count;
	}
}

function mapeCatchmentCells(i) {
	return mapeMarketFlow.counts[i];
}

function mapeFilterMarketDemand(r) {
	const { land, landCount, links } = mapeMarketFlow;
	const off = r * world.n;
	const src = mape.demand;
	const dst = mape.demandNext;
	for (let k = 0; k < landCount; k++) {
		const i = land[k];
		const base = i * MAPE_LAND_LINKS;
		let sum = src[off + i];
		for (let d = 0; d < MAPE_LAND_LINKS; d++) sum += src[off + links[base + d]];
		dst[off + i] = sum / 9;
	}
	return dst;
}

function mapeQueueCond(cond, i, to, d) {
	if (!cond) return 1;
	if (to === i) return 0;
	if (d === 0) return cond.condR[to];
	if (d === 1) return cond.condR[i];
	if (d === 2) return cond.condD[to];
	if (d === 3) return cond.condD[i];
	return transportEdge(cond.speed[i], cond.speed[to]);
}

function mapeRequestQueueTransfers(i, off, fraction, cond) {
	const { links, requests, room, accepted } = mapeMarketFlow;
	const { demand, goods } = mape;
	const here = demand[off + i];
	const base = i * MAPE_LAND_LINKS;
	let sum = 0;
	let steepest = 0;
	for (let d = 0; d < MAPE_LAND_LINKS; d++) {
		const to = links[base + d];
		const slope = (demand[off + to] - here) * MAPE_EDGE_UNIT[d];
		if (slope <= 0 || room[to] === 0) continue;
		const w = slope * mapeQueueCond(cond, i, to, d);
		if (w <= 0) continue;
		requests[base + d] = w;
		sum += slope;
		if (slope > steepest) steepest = slope;
	}
	if (sum <= 0) return;
	// Raw slopes saturate the send and c only weights it, so uniformly slow ground sends less
	// (Σ requests ≤ max c), matching the field haul share.
	const scale = goods[off + i] * fraction * steepest / (sum * (steepest + MAPE_QUEUE_GRAD_REF));
	for (let d = 0; d < MAPE_LAND_LINKS; d++) {
		const edge = base + d;
		if (requests[edge] <= 0) continue;
		requests[edge] *= scale;
		const to = links[edge];
		if (room[to] >= 0) accepted[to] += requests[edge];
	}
}

function mapeApplyQueueTransfers(i, off, cond) {
	const { links, requests, room, accepted } = mapeMarketFlow;
	const base = i * MAPE_LAND_LINKS;
	let effort = 0;
	let vx = 0;
	let vy = 0;
	for (let d = 0; d < MAPE_LAND_LINKS; d++) {
		const edge = base + d;
		if (requests[edge] <= 0) continue;
		const to = links[edge];
		const share = room[to] < 0 ? 1 : accepted[to];
		const amount = mapeApplyTransfer(mape.goodsNext, off + i, off + to, requests[edge] * share, 0);
		const c = mapeQueueCond(cond, i, to, d);
		if (c > 0) effort += amount / c;
		vx += amount * MAPE_DX[d] * MAPE_EDGE_UNIT[d];
		vy += amount * MAPE_DY[d] * MAPE_EDGE_UNIT[d];
	}
	mape.flowX[off + i] = vx;
	mape.flowY[off + i] = vy;
	return effort * MAPE_WORKFORCE_PER_UNIT;
}

function mapeFoodFlowMultiplier(r) {
	return r === MAPE_RES.FOOD ? MAPE_FOOD_FLOW_MULT : 1;
}

function mapeRouteQueues(r, dt, cond) {
	const off = r * world.n;
	const fraction = Math.min(MAPE_STEP_FRAC_MAX, MAPE_QUEUE_FLOW_SPEED * mapeFoodFlowMultiplier(r) * tune.haul * dt);
	const { requests, room, accepted, land, landCount } = mapeMarketFlow;
	requests.fill(0);
	room.fill(-1);
	accepted.fill(0);
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		room[i] = Math.max(0, mapeQueueCapacity(r, i) - mapeMarketUsable(r, i));
	}
	for (let k = 0; k < landCount; k++) {
		const i = land[k];
		if (room[i] < 0 && mape.goods[off + i] > MAPE_EPS) mapeRequestQueueTransfers(i, off, fraction, cond);
	}
	// Resolve against pre-transfer headroom, so the first donor scanned does not win.
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		if (accepted[i] > 0) accepted[i] = Math.min(1, room[i] / accepted[i]);
	}
	for (let k = 0; k < landCount; k++) {
		const i = land[k];
		if (room[i] >= 0 || mape.goods[off + i] <= MAPE_EPS) continue;
		const effort = mapeApplyQueueTransfers(i, off, cond);
		mape.workforceNext[i] += effort;
		mape.transportWork += effort;
	}
}

if (typeof module !== 'undefined') module.exports = { mapeMarketFlowPrepare, mapeCatchmentCells, mapeFilterMarketDemand, mapeRouteQueues };
