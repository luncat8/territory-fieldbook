// Owns: the price-diffusion economy — buyer bids diffuse as price, goods climb the price gradient.
// Edit for: bid laws, price diffusion and decay, chain rates and transport.
'use strict';

const ECONOMY_WIDTH = 48;
const ECONOMY_HEIGHT = 28;
const ECONOMY_SIZE = ECONOMY_WIDTH * ECONOMY_HEIGHT;
const ECONOMY_DT = 1 / 60;
const ECONOMY_MINE = 1;
const ECONOMY_FACTORY = 2;
const ECONOMY_TOWN = 3;
const SOURCE_RATE = 0.34;
const FACTORY_RATE = 0.34;
const NEED_RATE = 0.34;
const QUEUE_SECONDS = 0.25;
const SERVICE_SHARE = 1 - Math.exp(-ECONOMY_DT / 0.1);
const BID_MAX = 4;
const PRICE_MAX = 6;
const STOCK_REF = 0.08;
const NEED_RESPONSE = 1.4;
const PRICE_DIFFUSE = 15;
const PRICE_DECAY = 0.08;
const PRICE_GATE = 0.03;
const FLOW_RATE = 7;
const GRADIENT_KNEE = 0.01;
const STEERING_BLEND = ECONOMY_DT / (0.18 + ECONOMY_DT);
const FACTORY_YIELD = 1;
const INPUT_SHARE = 0.6;
const economyClamp = value => Math.max(0, Math.min(1, value));
const economyIndex = (x, y) => y * ECONOMY_WIDTH + x;

const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]]
	.map(([x, y]) => {
		const inv = x && y ? Math.SQRT1_2 : 1;
		return { x, y, inv, ux: x * inv, uy: y * inv, weight: x && y ? 1 : 4 };
	});
const DEGREE = DIRECTIONS.length;
const NEIGHBORS = buildEconomyNeighbors();
const REFERENCE_MINES = [[7, 8], [22, 21], [39, 7]];
const REFERENCE_FACTORIES = [[13, 13], [33, 10]];
const REFERENCE_TOWNS = [[9, 20], [28, 12]];

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

function makeScratch(buyer, cap) {
	return {
		buyer, cap,
		requests: new Float64Array(NEIGHBORS.length),
		room: new Float64Array(ECONOMY_SIZE),
		receiving: new Float64Array(ECONOMY_SIZE),
		delta: new Float64Array(ECONOMY_SIZE),
		headX: new Float64Array(ECONOMY_SIZE),
		headY: new Float64Array(ECONOMY_SIZE),
		flowX: new Float64Array(ECONOMY_SIZE),
		flowY: new Float64Array(ECONOMY_SIZE),
		flowRate: new Float64Array(ECONOMY_SIZE)
	};
}

class PriceEconomy {
	constructor() {
		this.actors = new Uint8Array(ECONOMY_SIZE);
		this.coal = new Float64Array(ECONOMY_SIZE);
		this.goods = new Float64Array(ECONOMY_SIZE);
		this.priceCoal = new Float64Array(ECONOMY_SIZE);
		this.priceGoods = new Float64Array(ECONOMY_SIZE);
		this.nextPriceCoal = new Float64Array(ECONOMY_SIZE);
		this.nextPriceGoods = new Float64Array(ECONOMY_SIZE);
		this.coalFlow = makeScratch(ECONOMY_FACTORY, FACTORY_RATE * QUEUE_SECONDS);
		this.goodsFlow = makeScratch(ECONOMY_TOWN, NEED_RATE * QUEUE_SECONDS);
		this.decay = true;
		this.derived = true;
		this.suppression = true;
		this.reset();
	}

	reset() {
		this.actors.fill(0);
		for (const [x, y] of REFERENCE_MINES) this.actors[economyIndex(x, y)] = ECONOMY_MINE;
		for (const [x, y] of REFERENCE_FACTORIES) this.actors[economyIndex(x, y)] = ECONOMY_FACTORY;
		for (const [x, y] of REFERENCE_TOWNS) this.actors[economyIndex(x, y)] = ECONOMY_TOWN;
		this.coal.fill(0);
		this.goods.fill(0);
		this.priceCoal.fill(0);
		this.priceGoods.fill(0);
		for (const scratch of [this.coalFlow, this.goodsFlow]) {
			scratch.headX.fill(0);
			scratch.headY.fill(0);
			scratch.flowX.fill(0);
			scratch.flowY.fill(0);
			scratch.flowRate.fill(0);
		}
		this.ticks = this.producedCoal = this.burnedCoal = this.producedGoods = this.consumedGoods = 0;
		this.coalRate = this.goodsRate = this.uptakeRate = 0;
	}

	setActor(i, kind) {
		if (kind && this.actors[i]) return false;
		this.actors[i] = kind;
		return true;
	}

	clearTowns() {
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (this.actors[i] === ECONOMY_TOWN) this.actors[i] = 0;
		}
	}

	// A town's bid is need capped by ability, cooled by the stock already on hand.
	townBid(i) {
		const cool = this.suppression ? 1 + this.goods[i] / STOCK_REF : 1;
		return Math.min(BID_MAX, BID_MAX / cool);
	}

	// A factory's input bid is derived from the output price at its own cell: it can
	// only pay for coal out of what the goods it makes will sell for, less its margin.
	factoryBid(i) {
		const margin = this.derived ? this.priceGoods[i] * FACTORY_YIELD * INPUT_SHARE : BID_MAX;
		let cool = 1;
		if (this.suppression) cool = (1 + this.coal[i] / STOCK_REF) * (1 + this.goods[i] / STOCK_REF);
		return Math.min(BID_MAX, margin / cool);
	}

	step() {
		this.updatePrices();
		let coalMade = 0, burned = 0, goodsMade = 0, eaten = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const actor = this.actors[i];
			if (actor === ECONOMY_MINE && this.priceCoal[i] > PRICE_GATE) {
				const amount = Math.min(1 - this.coal[i], SOURCE_RATE * ECONOMY_DT);
				this.coal[i] += amount;
				coalMade += amount;
			}
			if (actor === ECONOMY_FACTORY) {
				const burn = Math.min(this.coal[i], FACTORY_RATE * ECONOMY_DT, (1 - this.goods[i]) / FACTORY_YIELD);
				this.coal[i] -= burn;
				this.goods[i] += burn * FACTORY_YIELD;
				burned += burn;
				goodsMade += burn * FACTORY_YIELD;
			}
			if (actor !== ECONOMY_TOWN) continue;
			const ready = Math.min(this.goods[i] * SERVICE_SHARE, NEED_RATE * ECONOMY_DT);
			this.goods[i] -= ready;
			eaten += ready;
		}
		this.transport(this.coalFlow, this.coal, this.priceCoal);
		this.transport(this.goodsFlow, this.goods, this.priceGoods);
		this.producedCoal += coalMade;
		this.burnedCoal += burned;
		this.producedGoods += goodsMade;
		this.consumedGoods += eaten;
		this.coalRate = coalMade / ECONOMY_DT;
		this.goodsRate = goodsMade / ECONOMY_DT;
		this.uptakeRate = eaten / ECONOMY_DT;
		this.ticks++;
	}

	updatePrices() {
		const { actors, priceCoal, priceGoods, nextPriceCoal, nextPriceGoods } = this;
		const decay = this.decay ? PRICE_DECAY : 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const actor = actors[i];
			const coalHere = priceCoal[i];
			const goodsHere = priceGoods[i];
			if (actor === ECONOMY_FACTORY) nextPriceCoal[i] = coalHere + ECONOMY_DT * NEED_RESPONSE * (this.factoryBid(i) - coalHere);
			else nextPriceCoal[i] = diffuse(priceCoal, i, coalHere, decay);
			if (actor === ECONOMY_TOWN) nextPriceGoods[i] = goodsHere + ECONOMY_DT * NEED_RESPONSE * (this.townBid(i) - goodsHere);
			else nextPriceGoods[i] = diffuse(priceGoods, i, goodsHere, decay);
		}
		this.priceCoal = nextPriceCoal;
		this.nextPriceCoal = priceCoal;
		this.priceGoods = nextPriceGoods;
		this.nextPriceGoods = priceGoods;
	}

	transport(scratch, stock, price) {
		const { requests, room, receiving, delta, buyer, cap } = scratch;
		requests.fill(0);
		receiving.fill(0);
		delta.fill(0);
		scratch.flowX.fill(0);
		scratch.flowY.fill(0);
		scratch.flowRate.fill(0);
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const capacity = this.actors[i] === buyer ? cap : 1;
			room[i] = Math.max(0, capacity - stock[i]);
		}
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (stock[i] > 1e-12 && this.actors[i] !== buyer) this.planOutflow(scratch, stock, price, i);
		}
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (receiving[i] > 0) receiving[i] = Math.min(1, room[i] / receiving[i]);
		}
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (stock[i] <= 1e-12 || this.actors[i] === buyer) continue;
			this.acceptTransfers(scratch, stock, i);
		}
		for (let i = 0; i < ECONOMY_SIZE; i++) stock[i] = economyClamp(stock[i] + delta[i]);
	}

	planOutflow(scratch, stock, price, i) {
		const { requests, room } = scratch;
		const base = i * DEGREE;
		const here = price[i];
		let gx = 0, gy = 0, steepest = 0;
		for (let k = 0; k < DEGREE; k++) {
			const to = NEIGHBORS[base + k];
			if (to < 0 || price[to] <= here) continue;
			if (room[to] <= 0) continue;
			const dir = DIRECTIONS[k];
			const slope = (price[to] - here) * dir.inv;
			requests[base + k] = slope;
			steepest = Math.max(steepest, slope);
			gx += dir.ux * slope;
			gy += dir.uy * slope;
		}
		scratch.headX[i] += STEERING_BLEND * (gx - scratch.headX[i]);
		scratch.headY[i] += STEERING_BLEND * (gy - scratch.headY[i]);
		if (steepest > 0) this.routeUphill(scratch, stock, i, steepest);
	}

	routeUphill(scratch, stock, i, steepest) {
		const { requests, receiving } = scratch;
		const base = i * DEGREE;
		const length = Math.hypot(scratch.headX[i], scratch.headY[i]) || 1;
		const gx = scratch.headX[i] / length, gy = scratch.headY[i] / length;
		let sum = 0;
		for (let k = 0; k < DEGREE; k++) {
			const edge = base + k;
			if (!requests[edge]) continue;
			const dir = DIRECTIONS[k];
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

	acceptTransfers(scratch, stock, i) {
		const { requests, receiving, delta } = scratch;
		const base = i * DEGREE;
		let amountOut = 0, vx = 0, vy = 0;
		for (let k = 0; k < DEGREE; k++) {
			const edge = base + k;
			if (!requests[edge]) continue;
			const to = NEIGHBORS[edge];
			const amount = requests[edge] * receiving[to];
			delta[to] += amount;
			amountOut += amount;
			vx += DIRECTIONS[k].ux * amount;
			vy += DIRECTIONS[k].uy * amount;
		}
		delta[i] -= amountOut;
		scratch.flowRate[i] = amountOut / ECONOMY_DT;
		scratch.flowX[i] = vx / ECONOMY_DT;
		scratch.flowY[i] = vy / ECONOMY_DT;
	}
}

function diffuse(field, i, here, decay) {
	let laplacian = 0;
	const base = i * DEGREE;
	for (let k = 0; k < DEGREE; k++) {
		const to = NEIGHBORS[base + k];
		if (to >= 0) laplacian += DIRECTIONS[k].weight * (field[to] - here);
	}
	const value = here + ECONOMY_DT * (PRICE_DIFFUSE / 6 * laplacian - decay * here);
	return value < 0 ? 0 : value > PRICE_MAX ? PRICE_MAX : value;
}

if (typeof module !== 'undefined') {
	module.exports = {
		PriceEconomy, ECONOMY_DT, ECONOMY_WIDTH, ECONOMY_HEIGHT, ECONOMY_MINE, ECONOMY_FACTORY, ECONOMY_TOWN,
		economyIndex, SOURCE_RATE, FACTORY_RATE, NEED_RATE, QUEUE_SECONDS, BID_MAX, PRICE_DECAY, PRICE_GATE, INPUT_SHARE
	};
}
