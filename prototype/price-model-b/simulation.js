// Owns: the price-diffusion economy — firms and towns optimize buy prices, items and labor climb gradients.
// Edit for: profit-optimizing bids, population dynamics, price diffusion and transport. Gold lives in gold.js.
'use strict';

const ECONOMY_WIDTH = 48;
const ECONOMY_HEIGHT = 28;
const ECONOMY_SIZE = ECONOMY_WIDTH * ECONOMY_HEIGHT;
const ECONOMY_DT = 1 / 60;
const ECONOMY_MINE = 1;
const ECONOMY_FACTORY = 2;
const ECONOMY_TOWN = 3;
const ECONOMY_GOLD = 4;
const SOURCE_RATE = 0.34;
const FACTORY_RATE = 0.34;
const FACTORY_YIELD = 1;
const MINE_LABOR = 0.25;
const FACTORY_LABOR = 0.25;
const GOLD_LABOR = 0.25;
const INPUT_SHARE = 0.65;
const BUFFER_SECONDS = 1.5;
const SERVICE_SHARE = 1 - Math.exp(-ECONOMY_DT / 0.1);
const START_POP = 10;
const POP_BASE = 2;
const POP_MAX = 24;
const POP_HEADROOM = 2;
const POP_RATE = 0.05;
const TOWN_COAL_NEED = 0.01;
const TOWN_GOODS_NEED = 0.034;
const NEED_RATE = START_POP * TOWN_GOODS_NEED;
const LABOR_PER_POP = 0.06;
const COAL_COMFORT = 0.2;
const GOODS_COMFORT = 0.8;
const SAT_RATE = 1.8;
const PROFIT_RATE = 1.5;
const PRICE_DIFFUSE = 15;
const PRICE_DECAY = 0.08;
const PRICE_GATE = 0.01;
const NEED_RESPONSE = 2;
const FLOW_RATE = 7;
const LABOR_FLOW_RATE = 12;
const GRADIENT_KNEE = 0.006;
const STEERING_BLEND = ECONOMY_DT / (0.18 + ECONOMY_DT);
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
const REFERENCE_GOLD = [[3, 13]];

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

function makeScratch(buyers, cell, rate = FLOW_RATE) {
	return {
		buyers, cell, rate,
		cap: new Float64Array(ECONOMY_SIZE).fill(cell),
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

function clearScratch(scratch) {
	scratch.cap.fill(scratch.cell);
	scratch.headX.fill(0);
	scratch.headY.fill(0);
	scratch.flowX.fill(0);
	scratch.flowY.fill(0);
	scratch.flowRate.fill(0);
}

// Every buyer optimizes profit with the same rule: bid a margin-preserving share of marginal
// value, dropping to zero once stock on hand covers its finite operating target.
function optimalBid(value, stock, target, cool, suppress) {
	if (value <= 0 || target <= 0 || !Number.isFinite(cool)) return 0;
	const need = suppress ? Math.max(0, 1 - stock / target) : 1;
	return INPUT_SHARE * value * need / cool;
}

class PriceEconomy {
	constructor() {
		this.actors = new Uint8Array(ECONOMY_SIZE);
		this.coal = new Float64Array(ECONOMY_SIZE);
		this.goods = new Float64Array(ECONOMY_SIZE);
		this.labor = new Float64Array(ECONOMY_SIZE);
		this.priceCoal = new Float64Array(ECONOMY_SIZE);
		this.priceGoods = new Float64Array(ECONOMY_SIZE);
		this.priceLabor = new Float64Array(ECONOMY_SIZE);
		this.nextPriceCoal = new Float64Array(ECONOMY_SIZE);
		this.nextPriceGoods = new Float64Array(ECONOMY_SIZE);
		this.nextPriceLabor = new Float64Array(ECONOMY_SIZE);
		this.pop = new Float64Array(ECONOMY_SIZE);
		this.satCoal = new Float64Array(ECONOMY_SIZE);
		this.satGoods = new Float64Array(ECONOMY_SIZE);
		this.profit = new Float64Array(ECONOMY_SIZE);
		this.coalFlow = makeScratch((1 << ECONOMY_FACTORY) | (1 << ECONOMY_TOWN), 1, FLOW_RATE);
		this.goodsFlow = makeScratch(1 << ECONOMY_TOWN, 1, FLOW_RATE);
		this.laborFlow = makeScratch((1 << ECONOMY_MINE) | (1 << ECONOMY_FACTORY) | (1 << ECONOMY_GOLD), 1, LABOR_FLOW_RATE);
		this.satBlend = 1 - Math.exp(-ECONOMY_DT * SAT_RATE);
		this.profitBlend = 1 - Math.exp(-ECONOMY_DT * PROFIT_RATE);
		this.money = new GoldMoney(this);
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
		for (const [x, y] of REFERENCE_GOLD) this.actors[economyIndex(x, y)] = ECONOMY_GOLD;
		for (const field of [this.coal, this.goods, this.labor, this.priceCoal, this.priceGoods, this.priceLabor, this.pop, this.satCoal, this.satGoods, this.profit]) field.fill(0);
		clearScratch(this.coalFlow);
		clearScratch(this.goodsFlow);
		clearScratch(this.laborFlow);
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (this.actors[i] === ECONOMY_TOWN) this.pop[i] = START_POP;
		}
		this.money.reset();
		this.ticks = this.producedCoal = this.burnedCoal = this.producedGoods = this.consumedGoods = 0;
		this.suppliedLabor = this.workedLabor = 0;
		this.coalRate = this.goodsRate = this.uptakeRate = 0;
	}

	setActor(i, kind) {
		if (kind && this.actors[i]) return false;
		if (!kind && this.actors[i]) {
			this.money.release(i);
			this.pop[i] = this.satCoal[i] = this.satGoods[i] = this.profit[i] = 0;
		}
		this.actors[i] = kind;
		if (kind === ECONOMY_TOWN) {
			this.pop[i] = START_POP;
			this.money.seed(i);
		}
		return true;
	}

	clearTowns() {
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (this.actors[i] === ECONOMY_TOWN) this.setActor(i, 0);
		}
	}

	townPopPlan(i) {
		return Math.min(POP_MAX, this.pop[i] + POP_HEADROOM);
	}

	townCoalTarget(i) {
		return Math.min(1, this.townPopPlan(i) * TOWN_COAL_NEED * BUFFER_SECONDS);
	}

	townGoodsTarget(i) {
		return Math.min(1, this.townPopPlan(i) * TOWN_GOODS_NEED * BUFFER_SECONDS);
	}

	townTaxRate(i) {
		return this.derived ? this.money.taxPerPop(i) : START_TAX_PER_POP;
	}

	// A town optimizes like a factory: it buys coal and goods only up to the marginal tax
	// an attracted resident brings in, and stops bidding once its finite ration buffer is full.
	townGoodsBid(i) {
		const tax = this.townTaxRate(i);
		const cool = this.money.townCool(i, INPUT_SHARE * tax * this.pop[i] * PURSE_SECONDS);
		return optimalBid((GOODS_COMFORT / TOWN_GOODS_NEED) * tax, this.goods[i], this.townGoodsTarget(i), cool, this.suppression);
	}

	townCoalBid(i) {
		const tax = this.townTaxRate(i);
		const cool = this.money.townCool(i, INPUT_SHARE * tax * this.pop[i] * PURSE_SECONDS);
		return optimalBid((COAL_COMFORT / TOWN_COAL_NEED) * tax, this.coal[i], this.townCoalTarget(i), cool, this.suppression);
	}

	townBid(i) {
		return this.townGoodsBid(i);
	}

	// A factory splits its output value across coal and labor: paying more for labor leaves
	// less margin for coal, and either input cools to zero once its plant buffer is met.
	factoryCoalBid(i) {
		const out = this.derived ? this.priceGoods[i] : START_PRICE;
		const sellRoom = this.suppression ? Math.max(0, 1 - this.goods[i] / (FACTORY_RATE * BUFFER_SECONDS)) : 1;
		const wageCost = this.derived ? this.priceLabor[i] * FACTORY_LABOR * FACTORY_YIELD : 0;
		const cool = this.money.creditCool(i, INPUT_SHARE * out * FACTORY_RATE * PURSE_SECONDS);
		return optimalBid(Math.max(0, out * FACTORY_YIELD - wageCost) * sellRoom, this.coal[i], FACTORY_RATE * BUFFER_SECONDS, cool, this.suppression);
	}

	factoryLaborBid(i) {
		const out = this.derived ? this.priceGoods[i] : START_PRICE;
		const sellRoom = this.suppression ? Math.max(0, 1 - this.goods[i] / (FACTORY_RATE * BUFFER_SECONDS)) : 1;
		const coalCost = this.derived ? this.priceCoal[i] / FACTORY_YIELD : 0;
		const cool = this.money.creditCool(i, INPUT_SHARE * out * FACTORY_RATE * PURSE_SECONDS);
		return optimalBid(Math.max(0, (out - coalCost) / FACTORY_LABOR) * sellRoom, this.labor[i], FACTORY_RATE * FACTORY_LABOR * BUFFER_SECONDS, cool, this.suppression);
	}

	factoryBid(i) {
		return this.factoryCoalBid(i);
	}

	mineLaborBid(i) {
		const out = this.derived ? this.priceCoal[i] : START_PRICE * 0.5;
		const sellRoom = this.suppression ? Math.max(0, 1 - this.coal[i] / (SOURCE_RATE * BUFFER_SECONDS)) : 1;
		const cool = this.money.creditCool(i, INPUT_SHARE * out * SOURCE_RATE * PURSE_SECONDS);
		return optimalBid((out / MINE_LABOR) * sellRoom, this.labor[i], SOURCE_RATE * MINE_LABOR * BUFFER_SECONDS, cool, this.suppression);
	}

	goldLaborBid(i) {
		return optimalBid(GOLD_YIELD, this.labor[i], SOURCE_RATE * GOLD_LABOR * BUFFER_SECONDS, 1, this.suppression);
	}

	step() {
		this.updatePrices();
		this.coalFlow.cap.fill(1);
		this.goodsFlow.cap.fill(1);
		this.laborFlow.cap.fill(1);
		const coalBefore = this.producedCoal, burnBefore = this.burnedCoal;
		const goodsBefore = this.producedGoods, eatBefore = this.consumedGoods;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const actor = this.actors[i];
			if (!actor) continue;
			let earned = 0;
			if (actor === ECONOMY_MINE) earned = this.stepMine(i);
			else if (actor === ECONOMY_FACTORY) earned = this.stepFactory(i);
			else if (actor === ECONOMY_GOLD) earned = this.stepGold(i);
			else earned = this.stepTown(i);
			this.profit[i] += this.profitBlend * (earned - this.profit[i]);
		}
		this.money.step();
		this.transport(this.coalFlow, this.coal, this.priceCoal);
		this.transport(this.goodsFlow, this.goods, this.priceGoods);
		this.transport(this.laborFlow, this.labor, this.priceLabor);
		this.coalRate = (this.producedCoal - coalBefore) / ECONOMY_DT;
		this.goodsRate = (this.producedGoods - goodsBefore) / ECONOMY_DT;
		this.uptakeRate = (this.consumedGoods - eatBefore) / ECONOMY_DT;
		this.ticks++;
	}

	stepMine(i) {
		this.laborFlow.cap[i] = SOURCE_RATE * MINE_LABOR * BUFFER_SECONDS;
		if (this.priceCoal[i] <= PRICE_GATE) return 0;
		if (this.derived && this.priceCoal[i] < this.priceLabor[i] * MINE_LABOR) return 0;
		const made = Math.min(1 - this.coal[i], SOURCE_RATE * ECONOMY_DT, this.labor[i] / MINE_LABOR);
		const work = made * MINE_LABOR;
		const wageCost = work * this.priceLabor[i];
		this.coal[i] += made;
		this.labor[i] -= work;
		this.producedCoal += made;
		this.workedLabor += work;
		this.money.bill(i, PAY_WAGE, wageCost);
		return (made * this.priceCoal[i] - wageCost) / ECONOMY_DT;
	}

	stepFactory(i) {
		this.coalFlow.cap[i] = FACTORY_RATE * BUFFER_SECONDS;
		this.laborFlow.cap[i] = FACTORY_RATE * FACTORY_LABOR * BUFFER_SECONDS;
		const unitCost = this.priceCoal[i] / FACTORY_YIELD + this.priceLabor[i] * FACTORY_LABOR;
		if (this.derived && this.priceGoods[i] < unitCost) return 0;
		const burn = Math.min(this.coal[i], FACTORY_RATE * ECONOMY_DT, (1 - this.goods[i]) / FACTORY_YIELD, this.labor[i] / (FACTORY_LABOR * FACTORY_YIELD));
		const made = burn * FACTORY_YIELD;
		const work = made * FACTORY_LABOR;
		const coalCost = burn * this.priceCoal[i];
		const wageCost = work * this.priceLabor[i];
		this.coal[i] -= burn;
		this.goods[i] += made;
		this.labor[i] -= work;
		this.burnedCoal += burn;
		this.producedGoods += made;
		this.workedLabor += work;
		this.money.bill(i, PAY_COAL, coalCost);
		this.money.bill(i, PAY_WAGE, wageCost);
		return (made * this.priceGoods[i] - coalCost - wageCost) / ECONOMY_DT;
	}

	stepGold(i) {
		this.laborFlow.cap[i] = SOURCE_RATE * GOLD_LABOR * BUFFER_SECONDS;
		if (this.priceLabor[i] > GOLD_YIELD) return 0;
		const work = Math.min(this.labor[i], SOURCE_RATE * GOLD_LABOR * ECONOMY_DT);
		const dug = work * GOLD_YIELD;
		const wageCost = work * this.priceLabor[i];
		this.labor[i] -= work;
		this.workedLabor += work;
		this.money.dig(i, dug);
		this.money.bill(i, PAY_WAGE, wageCost);
		return (dug - wageCost) / ECONOMY_DT;
	}

	stepTown(i) {
		this.coalFlow.cap[i] = this.townCoalTarget(i);
		this.goodsFlow.cap[i] = this.townGoodsTarget(i);
		const pop = this.pop[i];
		const workCap = Math.min(1, pop * LABOR_PER_POP * BUFFER_SECONDS);
		const supplied = Math.min(Math.max(0, workCap - this.labor[i]), pop * LABOR_PER_POP * ECONOMY_DT);
		this.labor[i] += supplied;
		this.suppliedLabor += supplied;

		const wantCoal = pop * TOWN_COAL_NEED * ECONOMY_DT;
		const wantGoods = pop * TOWN_GOODS_NEED * ECONOMY_DT;
		const tax = this.townTaxRate(i);
		const canCoal = !this.derived || this.priceCoal[i] <= (COAL_COMFORT / TOWN_COAL_NEED) * tax;
		const canGoods = !this.derived || this.priceGoods[i] <= (GOODS_COMFORT / TOWN_GOODS_NEED) * tax;
		const usedCoal = canCoal ? Math.min(this.coal[i] * SERVICE_SHARE, wantCoal) : 0;
		const usedGoods = canGoods ? Math.min(this.goods[i] * SERVICE_SHARE, wantGoods) : 0;
		const coalCost = usedCoal * this.priceCoal[i];
		const goodsCost = usedGoods * this.priceGoods[i];
		this.coal[i] -= usedCoal;
		this.goods[i] -= usedGoods;
		this.burnedCoal += usedCoal;
		this.consumedGoods += usedGoods;
		this.money.bill(i, PAY_COAL, coalCost);
		this.money.bill(i, PAY_GOODS, goodsCost);

		this.satCoal[i] += this.satBlend * ((wantCoal > 0 ? usedCoal / wantCoal : 0) - this.satCoal[i]);
		this.satGoods[i] += this.satBlend * ((wantGoods > 0 ? usedGoods / wantGoods : 0) - this.satGoods[i]);
		const comfort = COAL_COMFORT * this.satCoal[i] + GOODS_COMFORT * this.satGoods[i];
		const afford = this.money.workerPurse[i] / (this.money.workerPurse[i] + pop * 0.25);
		this.pop[i] += ECONOMY_DT * POP_RATE * (POP_BASE + (POP_MAX - POP_BASE) * comfort * afford - this.pop[i]);
		return this.money.collectTax(i, comfort) - (coalCost + goodsCost) / ECONOMY_DT;
	}

	updatePrices() {
		const { actors, priceCoal, priceGoods, priceLabor, nextPriceCoal, nextPriceGoods, nextPriceLabor } = this;
		const decay = this.decay ? PRICE_DECAY : 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = actors[i];
			const bCoal = a === ECONOMY_FACTORY ? this.factoryCoalBid(i) : a === ECONOMY_TOWN ? this.townCoalBid(i) : -1;
			const bGoods = a === ECONOMY_TOWN ? this.townGoodsBid(i) : -1;
			const bLabor = a === ECONOMY_FACTORY ? this.factoryLaborBid(i) : a === ECONOMY_MINE ? this.mineLaborBid(i) : a === ECONOMY_GOLD ? this.goldLaborBid(i) : -1;
			nextPriceCoal[i] = stepBid(priceCoal, i, priceCoal[i], bCoal, decay);
			nextPriceGoods[i] = stepBid(priceGoods, i, priceGoods[i], bGoods, decay);
			nextPriceLabor[i] = stepBid(priceLabor, i, priceLabor[i], bLabor, decay);
		}
		this.priceCoal = nextPriceCoal;
		this.nextPriceCoal = priceCoal;
		this.priceGoods = nextPriceGoods;
		this.nextPriceGoods = priceGoods;
		this.priceLabor = nextPriceLabor;
		this.nextPriceLabor = priceLabor;
	}

	transport(scratch, stock, price) {
		const { requests, room, receiving, delta, buyers, cap, cell } = scratch;
		requests.fill(0);
		receiving.fill(0);
		delta.fill(0);
		scratch.flowX.fill(0);
		scratch.flowY.fill(0);
		scratch.flowRate.fill(0);
		for (let i = 0; i < ECONOMY_SIZE; i++) room[i] = Math.max(0, cap[i] - stock[i]);
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (stock[i] > 1e-12 && !(buyers & (1 << this.actors[i]))) this.planOutflow(scratch, stock, price, i);
		}
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (receiving[i] > 0) receiving[i] = Math.min(1, room[i] / receiving[i]);
		}
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (stock[i] <= 1e-12 || (buyers & (1 << this.actors[i]))) continue;
			this.acceptTransfers(scratch, stock, i);
		}
		for (let i = 0; i < ECONOMY_SIZE; i++) stock[i] = Math.min(cell, Math.max(0, stock[i] + delta[i]));
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
		const { requests, receiving, rate } = scratch;
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
		const outflow = stock[i] * rate * ECONOMY_DT * steepest / (steepest + GRADIENT_KNEE);
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
	return value < 0 ? 0 : value;
}

// A satisfied buyer does not pull down a steeper price diffusing across it from a rival buyer.
function stepBid(field, i, here, bid, decay) {
	const ambient = diffuse(field, i, here, decay);
	if (bid < 0) return ambient;
	const relaxed = here + ECONOMY_DT * NEED_RESPONSE * (bid - here);
	return ambient > here && ambient > relaxed ? ambient : relaxed;
}

if (typeof module === 'object') module.exports = { PriceEconomy, economyIndex };
