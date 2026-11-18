// Owns: the demand field, stock transport, and the production/uptake ledger.
'use strict';

const ECONOMY_WIDTH = 36;
const ECONOMY_HEIGHT = 24;
const ECONOMY_SIZE = ECONOMY_WIDTH * ECONOMY_HEIGHT;
const ECONOMY_DT = 1 / 60;
const ECONOMY_SOURCE = 1;
const ECONOMY_CONSUMER = 2;
const SOURCE_RATE = 0.34;
const UPTAKE_RATE = 0.95;
const DEMAND_DIFFUSION = 15;
const DEMAND_RECOVERY = 0.08;
const NEED_RESPONSE = 1.4;
const STOCK_PRESSURE = 1;
const FLOW_RATE = 7;
const GRADIENT_KNEE = 0.0012;
const DEMAND_FLOOR_BAND = 0.001;
const FLOOR_SPREAD_RATE = 1.8;
const economyClamp = (value) => Math.max(0, Math.min(1, value));
const economyIndex = (x, y) => y * ECONOMY_WIDTH + x;

const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]]
	.map(([x, y]) => {
		const inverseLength = x && y ? Math.SQRT1_2 : 1;
		return { x, y, inverseLength, ux: x * inverseLength, uy: y * inverseLength, weight: x && y ? 1 : 4 };
	});
const DEGREE = DIRECTIONS.length;
const NEIGHBORS = buildEconomyNeighbors();

function buildEconomyNeighbors() {
	const result = new Int16Array(ECONOMY_SIZE * DEGREE).fill(-1);
	for (let i = 0; i < ECONOMY_SIZE; i++) {
		const x = i % ECONOMY_WIDTH;
		const y = Math.floor(i / ECONOMY_WIDTH);
		for (let k = 0; k < DEGREE; k++) {
			const nx = x + DIRECTIONS[k].x;
			const ny = y + DIRECTIONS[k].y;
			if (nx >= 0 && nx < ECONOMY_WIDTH && ny >= 0 && ny < ECONOMY_HEIGHT) {
				result[i * DEGREE + k] = economyIndex(nx, ny);
			}
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
		this.receiving = new Float64Array(ECONOMY_SIZE);
		this.stockDelta = new Float64Array(ECONOMY_SIZE);
		this.flowTo = new Int16Array(ECONOMY_SIZE);
		this.flowRate = new Float64Array(ECONOMY_SIZE);
		this.pressure = false;
		this.reset(0);
	}

	reset(fill) {
		this.baseline = economyClamp(fill);
		this.actors.fill(0);
		this.actors[economyIndex(5, 12)] = ECONOMY_SOURCE;
		this.actors[economyIndex(29, 5)] = ECONOMY_SOURCE;
		this.actors[economyIndex(13, 6)] = ECONOMY_CONSUMER;
		this.actors[economyIndex(13, 18)] = ECONOMY_CONSUMER;
		this.actors[economyIndex(29, 14)] = ECONOMY_CONSUMER;
		this.stock.fill(0);
		this.demand.fill(this.baseline);
		this.flowTo.fill(-1);
		this.flowRate.fill(0);
		this.ticks = 0;
		this.produced = 0;
		this.consumed = 0;
		this.productionRate = 0;
		this.uptakeRate = 0;
	}

	setActor(i, kind) {
		if (!kind || !this.actors[i]) this.actors[i] = kind;
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
			if (this.actors[i] !== ECONOMY_SOURCE) continue;
			const amount = Math.min(1 - this.stock[i], SOURCE_RATE * ECONOMY_DT);
			this.stock[i] += amount;
			produced += amount;
		}
		this.transportStock();
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (this.actors[i] !== ECONOMY_CONSUMER) continue;
			const amount = Math.min(this.stock[i], UPTAKE_RATE * this.demand[i] * ECONOMY_DT);
			this.stock[i] -= amount;
			consumed += amount;
		}
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
				// Anchoring the peak at the consumer puts the end of the route on the sink.
				const need = 1 - (pressure ? 0.3 : 0.2) * stock[i];
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
			const suppression = pressure ? STOCK_PRESSURE * stock[i] * here : 0;
			nextDemand[i] = economyClamp(here + ECONOMY_DT * (DEMAND_DIFFUSION / 6 * laplacian + recovery - suppression));
		}
		this.demand = nextDemand;
		this.nextDemand = demand;
	}

	transportStock() {
		const { stock, requests, receiving, stockDelta, flowTo, flowRate } = this;
		requests.fill(0);
		receiving.fill(0);
		stockDelta.fill(0);
		flowTo.fill(-1);
		flowRate.fill(0);
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (stock[i] > 0) this.planOutflow(i);
		}
		// Resolve against pre-transfer room so sharing a destination never drops stock.
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (receiving[i] > 0) receiving[i] = Math.min(1, (1 - stock[i]) / receiving[i]);
		}
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (stock[i] === 0) continue;
			const base = i * DEGREE;
			let strongest = 0;
			for (let k = 0; k < DEGREE; k++) {
				const requested = requests[base + k];
				if (requested === 0) continue;
				const to = NEIGHBORS[base + k];
				const amount = requested * receiving[to];
				stockDelta[i] -= amount;
				stockDelta[to] += amount;
				if (amount > strongest) {
					strongest = amount;
					flowTo[i] = to;
				}
			}
			flowRate[i] = strongest / ECONOMY_DT;
		}
		for (let i = 0; i < ECONOMY_SIZE; i++) stock[i] = economyClamp(stock[i] + stockDelta[i]);
	}

	planOutflow(i) {
		const { demand, requests } = this;
		const base = i * DEGREE;
		const here = demand[i];
		let highest = here;
		let gx = 0;
		let gy = 0;
		let steepest = 0;
		// Demand diffusion supplies the smoothing. Use actual uphill faces so a centered
		// slope cannot send stock past a peak or skip a diagonal ascent.
		for (let k = 0; k < DEGREE; k++) {
			const to = NEIGHBORS[base + k];
			if (to < 0 || demand[to] <= here) continue;
			highest = Math.max(highest, demand[to]);
			const dir = DIRECTIONS[k];
			const slope = (demand[to] - here) * dir.inverseLength;
			requests[base + k] = slope;
			steepest = Math.max(steepest, slope);
			gx += dir.ux * slope;
			gy += dir.uy * slope;
		}
		if (steepest > 0) this.routeUphill(i, gx, gy, steepest);
		if (this.pressure && highest < DEMAND_FLOOR_BAND) {
			this.spreadAtFloor(i, 1 - highest / DEMAND_FLOOR_BAND);
		}
	}

	routeUphill(i, gx, gy, steepest) {
		const { stock, requests, receiving } = this;
		const base = i * DEGREE;
		const magnitude = Math.sqrt(gx * gx + gy * gy) || 1;
		gx /= magnitude;
		gy /= magnitude;
		let sum = 0;
		for (let k = 0; k < DEGREE; k++) {
			const slope = requests[base + k];
			if (slope === 0) continue;
			const dir = DIRECTIONS[k];
			const alignment = Math.max(0, gx * dir.ux + gy * dir.uy);
			const weight = slope * (0.25 + 0.75 * alignment);
			requests[base + k] = weight;
			sum += weight;
		}
		const outflow = stock[i] * FLOW_RATE * ECONOMY_DT * steepest / (steepest + GRADIENT_KNEE);
		for (let k = 0; k < DEGREE; k++) {
			const edge = base + k;
			if (requests[edge] === 0) continue;
			const amount = outflow * (requests[edge] / sum);
			requests[edge] = amount;
			receiving[NEIGHBORS[edge]] += amount;
		}
	}

	spreadAtFloor(i, blend) {
		// A zero plateau cannot be lowered. Spread by stock difference there instead
		// of inventing a negative demand field that the map doesn't show.
		const { stock, requests, receiving } = this;
		const base = i * DEGREE;
		for (let k = 0; k < DEGREE; k++) {
			const to = NEIGHBORS[base + k];
			if (to < 0 || stock[to] >= stock[i]) continue;
			const weight = DIRECTIONS[k].weight / 20;
			const amount = (stock[i] - stock[to]) * blend * FLOOR_SPREAD_RATE * ECONOMY_DT * weight;
			requests[base + k] += amount;
			receiving[to] += amount;
		}
	}
}

if (typeof module !== 'undefined') {
	module.exports = { DiffusionEconomy, ECONOMY_DT, ECONOMY_WIDTH, ECONOMY_HEIGHT, ECONOMY_SOURCE, ECONOMY_CONSUMER, economyIndex, SOURCE_RATE, UPTAKE_RATE };
}
