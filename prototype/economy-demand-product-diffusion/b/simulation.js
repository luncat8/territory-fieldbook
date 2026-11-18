// Owns: the bounded demand field, conservative face transfers and resource ledger.
'use strict';

const ECONOMY_WIDTH = 48;
const ECONOMY_HEIGHT = 28;
const ECONOMY_SIZE = ECONOMY_WIDTH * ECONOMY_HEIGHT;
const ECONOMY_DT = 1 / 60;
const ECONOMY_SOURCE = 1;
const ECONOMY_CONSUMER = 2;
const SOURCE_RATE = 0.34;
const UPTAKE_RATE = 0.95;
const QUEUE_SECONDS = 0.25;
const SERVICE_SHARE = 1 - Math.exp(-ECONOMY_DT / 0.1);
const CATCHMENT_RADIUS = 4;
const CATCHMENT_HALF = 3;
const DEMAND_DIFFUSION = 15;
const DEMAND_RECOVERY = 0.08;
const NEED_RESPONSE = 1.4;
const STOCK_PRESSURE = 2.4;
const FLOW_RATE = 7;
const GRADIENT_KNEE = 0.0001;
const STEERING_BLEND = ECONOMY_DT / (0.18 + ECONOMY_DT);
const FLOOR_BAND = 0.001;
const FLOOR_SPREAD_RATE = 1.8;
const economyClamp = value => Math.max(0, Math.min(1, value));
const economyIndex = (x, y) => y * ECONOMY_WIDTH + x;

const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]]
	.map(([x, y]) => {
		const inv = x && y ? Math.SQRT1_2 : 1;
		return { x, y, inv, ux: x * inv, uy: y * inv, weight: x && y ? 1 : 4 };
	});
const CATCHMENT = buildCatchment();
const DEGREE = DIRECTIONS.length;
const NEIGHBORS = buildEconomyNeighbors();
const REFERENCE_SOURCES = [[7, 8], [22, 21], [39, 7]];
const REFERENCE_CONSUMERS = [[19, 5], [9, 20], [34, 18]];

function buildCatchment() {
	// One table for every cell: in-map ring offsets nearest first, with a 1/(d+1)
	// falloff so a settlement weighs its own cell above its outskirts.
	const entries = [];
	for (let y = -CATCHMENT_RADIUS; y <= CATCHMENT_RADIUS; y++) for (let x = -CATCHMENT_RADIUS; x <= CATCHMENT_RADIUS; x++) {
		const distance = Math.hypot(x, y);
		if (distance <= CATCHMENT_RADIUS) entries.push({ x, y, distance, weight: 1 / (distance + 1) });
	}
	entries.sort((a, b) => a.distance - b.distance);
	const size = entries.length;
	const offsets = new Int16Array(ECONOMY_SIZE * size);
	const weights = new Float32Array(ECONOMY_SIZE * size);
	const counts = new Int16Array(ECONOMY_SIZE);
	for (let i = 0; i < ECONOMY_SIZE; i++) {
		const count = fillCatchmentCell(i, entries, offsets, weights, size);
		counts[i] = count;
		normalizeCatchmentRow(i, weights, size, count);
	}
	return { offsets, weights, counts, size };
}

function fillCatchmentCell(i, entries, offsets, weights, size) {
	const cx = i % ECONOMY_WIDTH, cy = Math.floor(i / ECONOMY_WIDTH);
	let count = 0;
	for (const entry of entries) {
		const x = cx + entry.x, y = cy + entry.y;
		if (x < 0 || x >= ECONOMY_WIDTH || y < 0 || y >= ECONOMY_HEIGHT) continue;
		offsets[i * size + count] = y * ECONOMY_WIDTH + x - i;
		weights[i * size + count] = entry.weight;
		count++;
	}
	return count;
}

// Normalise at build time so the hot path divides once per settlement, not per cell.
function normalizeCatchmentRow(i, weights, size, count) {
	let total = 0;
	for (let k = 0; k < count; k++) total += weights[i * size + k];
	for (let k = 0; k < count; k++) weights[i * size + k] /= total;
}

function buildEconomyNeighbors() {
	const result = new Int16Array(ECONOMY_SIZE * DEGREE).fill(-1);
	for (let i = 0; i < ECONOMY_SIZE; i++) {
		for (let k = 0; k < DEGREE; k++) {
			const x = i % ECONOMY_WIDTH + DIRECTIONS[k].x;
			const y = Math.floor(i / ECONOMY_WIDTH) + DIRECTIONS[k].y;
			if (x >= 0 && x < ECONOMY_WIDTH && y >= 0 && y < ECONOMY_HEIGHT) result[i * DEGREE + k] = economyIndex(x, y);
		}
	}
	return result;
}

class DiffusionEconomy {
	constructor() {
		this.actors = new Uint8Array(ECONOMY_SIZE);
		this.stock = new Float64Array(ECONOMY_SIZE);
		this.demand = new Float64Array(ECONOMY_SIZE);
		this.nextDemand = new Float64Array(ECONOMY_SIZE);
		this.requests = new Float64Array(NEIGHBORS.length);
		this.room = new Float64Array(ECONOMY_SIZE);
		this.receiving = new Float64Array(ECONOMY_SIZE);
		this.stockDelta = new Float64Array(ECONOMY_SIZE);
		this.headingX = new Float64Array(ECONOMY_SIZE);
		this.headingY = new Float64Array(ECONOMY_SIZE);
		this.flowX = new Float64Array(ECONOMY_SIZE);
		this.flowY = new Float64Array(ECONOMY_SIZE);
		this.flowRate = new Float64Array(ECONOMY_SIZE);
		this.pressure = false;
		this.catchment = false;
		this.reset(0);
	}

	reset(fill) {
		this.baseline = economyClamp(fill);
		this.actors.fill(0);
		for (const [x, y] of REFERENCE_SOURCES) this.actors[economyIndex(x, y)] = ECONOMY_SOURCE;
		for (const [x, y] of REFERENCE_CONSUMERS) this.actors[economyIndex(x, y)] = ECONOMY_CONSUMER;
		this.demand.fill(this.baseline);
		this.stock.fill(0);
		this.headingX.fill(0);
		this.headingY.fill(0);
		this.flowX.fill(0);
		this.flowY.fill(0);
		this.flowRate.fill(0);
		this.ticks = this.produced = this.consumed = this.productionRate = this.uptakeRate = 0;
	}

	setActor(i, kind) {
		if (kind && this.actors[i]) return false;
		this.actors[i] = kind;
		return true;
	}

	clearConsumers() {
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (this.actors[i] === ECONOMY_CONSUMER) this.actors[i] = 0;
		}
	}

	step() {
		this.updateDemand();
		let produced = 0;
		let consumed = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (this.actors[i] === ECONOMY_SOURCE) {
				const amount = Math.min(1 - this.stock[i], SOURCE_RATE * ECONOMY_DT);
				this.stock[i] += amount;
				produced += amount;
			}
			if (this.actors[i] !== ECONOMY_CONSUMER) continue;
			// Service existing stock before arrivals. Even a tiny shipment has a residence time.
			const ready = Math.min(this.stock[i] * SERVICE_SHARE, UPTAKE_RATE * ECONOMY_DT);
			const amount = this.demand[i] * ready;
			this.stock[i] -= amount;
			consumed += amount;
		}
		this.transportStock();
		this.produced += produced;
		this.consumed += consumed;
		this.productionRate = produced / ECONOMY_DT;
		this.uptakeRate = consumed / ECONOMY_DT;
		this.ticks++;
	}

	updateDemand() {
		const { demand, nextDemand, stock, actors, pressure, baseline } = this;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const here = demand[i];
			if (actors[i] === ECONOMY_CONSUMER) {
				const queue = Math.min(1, stock[i] / (QUEUE_SECONDS * UPTAKE_RATE));
				const reach = this.catchment ? 1 + CATCHMENT_HALF * this.catchmentMean(i) : 1;
				const need = (1 - (pressure ? 0.5 : 0.35) * queue) / reach;
				nextDemand[i] = here + ECONOMY_DT * NEED_RESPONSE * (need - here);
				continue;
			}
			let laplacian = 0;
			const base = i * DEGREE;
			for (let k = 0; k < DEGREE; k++) {
				const to = NEIGHBORS[base + k];
				if (to >= 0) laplacian += DIRECTIONS[k].weight * (demand[to] - here);
			}
			const recovery = DEMAND_RECOVERY * (baseline - here);
			const suppression = pressure ? STOCK_PRESSURE * stock[i] : 0;
			nextDemand[i] = economyClamp(here + ECONOMY_DT * (DEMAND_DIFFUSION / 6 * laplacian + recovery - suppression));
		}
		this.demand = nextDemand;
		this.nextDemand = demand;
	}

	// Stock queued in the ring around a settlement, not just in its own cell:
	// coal parked one step outside still tells the settlement its supply is secure.
	catchmentMean(i) {
		const { offsets, weights, counts, size } = CATCHMENT;
		let sum = 0;
		for (let k = 0, base = i * size, count = counts[i]; k < count; k++) sum += this.stock[i + offsets[base + k]] * weights[base + k];
		return sum;
	}

	transportStock() {
		const { actors, stock, demand, room, requests, receiving, stockDelta } = this;
		requests.fill(0);
		receiving.fill(0);
		stockDelta.fill(0);
		this.flowX.fill(0);
		this.flowY.fill(0);
		this.flowRate.fill(0);
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			// A consumer admits only what it can process in one short service window.
			const capacity = actors[i] === ECONOMY_CONSUMER ? UPTAKE_RATE * demand[i] * QUEUE_SECONDS : 1;
			room[i] = Math.max(0, capacity - stock[i]);
		}
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (stock[i] > 1e-12 && actors[i] !== ECONOMY_CONSUMER) this.planOutflow(i);
		}
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (receiving[i] > 0) receiving[i] = Math.min(1, room[i] / receiving[i]);
		}
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (stock[i] <= 1e-12 || actors[i] === ECONOMY_CONSUMER) continue;
			this.acceptTransfers(i);
		}
		for (let i = 0; i < ECONOMY_SIZE; i++) stock[i] = economyClamp(stock[i] + stockDelta[i]);
	}

	planOutflow(i) {
		const { demand, requests, room } = this;
		const base = i * DEGREE;
		const here = demand[i];
		let highest = here, gx = 0, gy = 0, steepest = 0;
		for (let k = 0; k < DEGREE; k++) {
			const to = NEIGHBORS[base + k];
			if (to < 0 || demand[to] <= here) continue;
			highest = Math.max(highest, demand[to]);
			if (room[to] <= 0) continue;
			const dir = DIRECTIONS[k];
			const slope = (demand[to] - here) * dir.inv;
			requests[base + k] = slope;
			steepest = Math.max(steepest, slope);
			gx += dir.ux * slope;
			gy += dir.uy * slope;
		}
		this.headingX[i] += STEERING_BLEND * (gx - this.headingX[i]);
		this.headingY[i] += STEERING_BLEND * (gy - this.headingY[i]);
		if (steepest > 0) this.routeUphill(i, steepest);
		if (this.pressure && highest < FLOOR_BAND) this.spreadAtFloor(i, 1 - highest / FLOOR_BAND);
	}

	routeUphill(i, steepest) {
		const { stock, requests, receiving } = this;
		const base = i * DEGREE;
		const length = Math.hypot(this.headingX[i], this.headingY[i]) || 1;
		const gx = this.headingX[i] / length, gy = this.headingY[i] / length;
		let sum = 0;
		for (let k = 0; k < DEGREE; k++) {
			const edge = base + k;
			if (!requests[edge]) continue;
			const dir = DIRECTIONS[k];
			// Smooth steering, but gate every face by its current uphill slope: no coasting past a peak.
			requests[edge] *= 0.25 + 0.75 * Math.max(0, gx * dir.ux + gy * dir.uy);
			sum += requests[edge];
		}
		const outflow = stock[i] * FLOW_RATE * ECONOMY_DT * steepest / (steepest + GRADIENT_KNEE);
		for (let k = 0; k < DEGREE; k++) {
			const edge = base + k;
			if (!requests[edge]) continue;
			requests[edge] *= outflow / sum;
			receiving[NEIGHBORS[edge]] += requests[edge];
		}
	}

	spreadAtFloor(i, blend) {
		// At zero there is no lower demand to encode. Only here, use the stock gradient to relieve pressure.
		const { stock, requests, receiving } = this;
		const base = i * DEGREE;
		for (let k = 0; k < DEGREE; k++) {
			const to = NEIGHBORS[base + k];
			if (to < 0 || stock[to] >= stock[i] || this.demand[to] < this.demand[i] || !this.room[to]) continue;
			const amount = (stock[i] - stock[to]) * blend * FLOOR_SPREAD_RATE * ECONOMY_DT * DIRECTIONS[k].weight / 20;
			requests[base + k] += amount;
			receiving[to] += amount;
		}
	}

	acceptTransfers(i) {
		const { requests, receiving, stockDelta } = this;
		const base = i * DEGREE;
		let amountOut = 0, vx = 0, vy = 0;
		for (let k = 0; k < DEGREE; k++) {
			const edge = base + k;
			if (!requests[edge]) continue;
			const to = NEIGHBORS[edge];
			const amount = requests[edge] * receiving[to];
			stockDelta[to] += amount;
			amountOut += amount;
			vx += DIRECTIONS[k].ux * amount;
			vy += DIRECTIONS[k].uy * amount;
		}
		stockDelta[i] -= amountOut;
		this.flowRate[i] = amountOut / ECONOMY_DT;
		this.flowX[i] = vx / ECONOMY_DT;
		this.flowY[i] = vy / ECONOMY_DT;
	}
}

if (typeof module !== 'undefined') {
	module.exports = { DiffusionEconomy, ECONOMY_DT, ECONOMY_WIDTH, ECONOMY_HEIGHT, ECONOMY_SOURCE, ECONOMY_CONSUMER, economyIndex, SOURCE_RATE, UPTAKE_RATE, QUEUE_SECONDS, CATCHMENT_HALF };
}
