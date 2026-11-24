// Owns: the particle economy core — grid geometry, diffused price/appeal fields, docked stocks, tick order and conservation accessors.
// Edit for: grid, price diffusion and tick order. Goods particles: particles.js; worker particles: workers.js.
'use strict';

const ECONOMY_WIDTH = 48;
const ECONOMY_HEIGHT = 28;
const ECONOMY_SIZE = ECONOMY_WIDTH * ECONOMY_HEIGHT;
const ECONOMY_DT = 1 / 60;
const ECONOMY_MINE = 1;
const ECONOMY_FACTORY = 2;
const ECONOMY_TOWN = 3;
const ECONOMY_GOLD = 4;
const ITEM_COAL = 0;
const ITEM_GOODS = 1;
const ITEM_LABOR = 2;
const ITEM_DEPLETED = 3;
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
const GRADIENT_KNEE = 0.006;
const STEERING_BLEND = ECONOMY_DT / (0.18 + ECONOMY_DT);
const economyIndex = (x, y) => y * ECONOMY_WIDTH + x;

function wealthClassFor(i) {
	let h = (Math.imul(i + 1, 2654435761) >>> 0);
	h = (Math.imul(h ^ (h >>> 15), 2246822519) >>> 0);
	return h % 3;
}

const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]]
	.map(([x, y]) => {
		const inv = x && y ? Math.SQRT1_2 : 1;
		return { x, y, inv, ux: x * inv, uy: y * inv, weight: x && y ? 1 : 4 };
	});
const DEGREE = DIRECTIONS.length;
const NEIGHBORS = buildEconomyNeighbors();

// Phase 1 reference chain: one mine -> one factory -> one town on non-desert ground.
const REFERENCE_MINES = [[7, 8]];
const REFERENCE_FACTORIES = [[13, 13]];
const REFERENCE_TOWNS = [[9, 20]];
const REFERENCE_GOLD = [];

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

function makeScratch(buyers, blend = false) {
	return {
		buyers, alt: null, intent: null,
		cap: new Float64Array(ECONOMY_SIZE).fill(1),
		cost: new Float64Array(ECONOMY_SIZE),
		gold: new Float64Array(ECONOMY_SIZE),
		mix: blend ? new Float64Array(ECONOMY_SIZE) : null,
		still: new Float64Array(ECONOMY_SIZE).fill(1),
		flowX: new Float64Array(ECONOMY_SIZE),
		flowY: new Float64Array(ECONOMY_SIZE),
		flowRate: new Float64Array(ECONOMY_SIZE)
	};
}

function clearScratch(scratch) {
	scratch.cap.fill(1);
	scratch.cost.fill(0);
	scratch.gold.fill(0);
	if (scratch.mix) scratch.mix.fill(0);
	if (scratch.intent) scratch.intent.fill(0);
	scratch.still.fill(1);
	scratch.flowX.fill(0);
	scratch.flowY.fill(0);
	scratch.flowRate.fill(0);
}

function hasBetterNeighbor(scratch, price, i) {
	const mix = scratch.mix ? scratch.mix[i] : 0;
	const here = blendedScore(price, scratch.alt, mix, i);
	const base = i * DEGREE;
	for (let k = 0; k < DEGREE; k++) {
		const to = NEIGHBORS[base + k];
		if (to >= 0 && blendedScore(price, scratch.alt, mix, to) > here + 1e-9) return true;
	}
	return false;
}

class PriceEconomy {
	constructor() {
		this.actors = new Uint8Array(ECONOMY_SIZE);
		this.coal = new Float64Array(ECONOMY_SIZE);
		this.goods = new Float64Array(ECONOMY_SIZE);
		this.coalCost = new Float64Array(ECONOMY_SIZE);
		this.goodsCost = new Float64Array(ECONOMY_SIZE);
		this.labor = new Float64Array(ECONOMY_SIZE);
		this.depleted = new Float64Array(ECONOMY_SIZE);
		this.priceCoal = new Float64Array(ECONOMY_SIZE);
		this.priceGoods = new Float64Array(ECONOMY_SIZE);
		this.priceLabor = new Float64Array(ECONOMY_SIZE);
		this.priceHome = new Float64Array(ECONOMY_SIZE);
		this.priceRest = new Float64Array(ECONOMY_SIZE);
		this.nextPriceCoal = new Float64Array(ECONOMY_SIZE);
		this.nextPriceGoods = new Float64Array(ECONOMY_SIZE);
		this.nextPriceLabor = new Float64Array(ECONOMY_SIZE);
		this.nextPriceHome = new Float64Array(ECONOMY_SIZE);
		this.nextPriceRest = new Float64Array(ECONOMY_SIZE);
		this.pop = new Float64Array(ECONOMY_SIZE);
		this.scale = new Float64Array(ECONOMY_SIZE);
		this.taxMult = new Float64Array(ECONOMY_SIZE);
		this.wealthClass = new Uint8Array(ECONOMY_SIZE);
		this.vacantTicks = new Float64Array(ECONOMY_SIZE);
		this.satCoal = new Float64Array(ECONOMY_SIZE);
		this.satGoods = new Float64Array(ECONOMY_SIZE);
		this.workLoad = new Float64Array(ECONOMY_SIZE);
		this.profit = new Float64Array(ECONOMY_SIZE);
		this.earned = new Float64Array(ECONOMY_SIZE);
		this.laborFlow = makeScratch((1 << ECONOMY_MINE) | (1 << ECONOMY_FACTORY) | (1 << ECONOMY_GOLD));
		this.depletedFlow = makeScratch(1 << ECONOMY_TOWN, true);
		this.depletedFlow.intent = new Float64Array(ECONOMY_SIZE);
		this.stocks = [this.coal, this.goods, this.labor, this.depleted];
		this.itemCosts = [this.coalCost, this.goodsCost, this.laborFlow.cost, null];
		this.particles = new GoodsParticles(this);
		this.workers = new WorkerParticles(this);
		this.optimizer = new ActorOptimizer(this);
		this.money = new GoldMoney(this);
		this.workforce = new WorkerPolicy(this);
		this.land = new Land(this);
		this.settlements = new Settlements(this);
		this.decay = true;
		this.derived = true;
		this.suppression = true;
		this.reset();
	}

	isProducer(i) {
		const a = i >= 0 && i < ECONOMY_SIZE ? this.actors[i] : 0;
		return a === ECONOMY_MINE || a === ECONOMY_FACTORY;
	}

	pricesAt(item) {
		return item === ITEM_COAL ? this.priceCoal : item === ITEM_GOODS ? this.priceGoods : item === ITEM_LABOR ? this.priceLabor : this.priceHome;
	}

	siteStockAt(item, i) {
		if (item === ITEM_COAL || item === ITEM_GOODS) return this.stocks[item][i] + this.particles.spawnAt(item, i);
		return this.stocks[item][i];
	}

	unitCostAt(item, i) {
		if (item === ITEM_COAL || item === ITEM_GOODS) {
			const stock = this.stocks[item][i] + this.particles.spawnAt(item, i);
			const cost = this.itemCosts[item][i] + this.particles.spawnCostAt(item, i);
			return stock > 1e-9 ? cost / stock : 0;
		}
		const stock = this.stocks[item][i];
		return stock > 1e-9 ? this.itemCosts[item][i] / stock : 0;
	}

	totalItem(item) {
		let sum = 0;
		const stock = this.stocks[item];
		for (let i = 0; i < ECONOMY_SIZE; i++) sum += stock[i];
		if (item === ITEM_COAL || item === ITEM_GOODS) sum += this.particles.spawnTotal(item) + this.particles.inFlightTotal(item);
		else sum += this.workers.inFlightTotal(item - ITEM_LABOR);
		return sum;
	}

	workerGoldAt(i) {
		return this.laborFlow.gold[i] + this.depletedFlow.gold[i];
	}

	reset() {
		this.actors.fill(0);
		for (const [x, y] of REFERENCE_MINES) this.actors[economyIndex(x, y)] = ECONOMY_MINE;
		for (const [x, y] of REFERENCE_FACTORIES) this.actors[economyIndex(x, y)] = ECONOMY_FACTORY;
		for (const [x, y] of REFERENCE_TOWNS) this.actors[economyIndex(x, y)] = ECONOMY_TOWN;
		for (const [x, y] of REFERENCE_GOLD) this.actors[economyIndex(x, y)] = ECONOMY_GOLD;
		for (const field of [this.coal, this.goods, this.coalCost, this.goodsCost, this.labor, this.depleted, this.priceCoal, this.priceGoods, this.priceLabor, this.priceHome, this.priceRest, this.pop, this.scale, this.taxMult, this.satCoal, this.satGoods, this.workLoad, this.profit, this.earned]) field.fill(0);
		this.wealthClass.fill(0);
		this.vacantTicks.fill(0);
		clearScratch(this.laborFlow);
		clearScratch(this.depletedFlow);
		this.particles.reset();
		this.workers.reset();
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (!this.actors[i]) continue;
			this.scale[i] = 1;
			if (this.actors[i] === ECONOMY_TOWN) {
				this.pop[i] = START_POP;
				this.taxMult[i] = 1;
				this.wealthClass[i] = wealthClassFor(i);
			}
		}
		this.money.reset();
		this.settlements.reset();
		this.ticks = this.producedCoal = this.burnedCoal = this.producedGoods = this.consumedGoods = 0;
		this.suppliedLabor = this.workedLabor = this.emittedDepleted = this.restedDepleted = 0;
		this.coalRate = this.goodsRate = this.uptakeRate = 0;
	}

	setActor(i, kind) {
		if (kind && this.actors[i]) return false;
		if (!kind && this.actors[i]) {
			this.money.release(i);
			this.pop[i] = this.scale[i] = this.taxMult[i] = this.satCoal[i] = this.satGoods[i] = this.workLoad[i] = this.profit[i] = 0;
			this.wealthClass[i] = 0;
			this.vacantTicks[i] = 0;
			this.coalCost[i] = this.goodsCost[i] = this.laborFlow.cost[i] = 0;
			this.particles.clearSell(i);
		}
		this.actors[i] = kind;
		this.settlements.placed(i, kind);
		if (kind) {
			this.scale[i] = 1;
			this.workLoad[i] = 0;
		}
		if (kind === ECONOMY_TOWN) {
			this.pop[i] = START_POP;
			this.taxMult[i] = 1;
			this.wealthClass[i] = wealthClassFor(i);
			this.vacantTicks[i] = 0;
			this.money.seed(i);
		}
		return true;
	}

	clearTowns() {
		for (let i = 0; i < ECONOMY_SIZE; i++) if (this.actors[i] === ECONOMY_TOWN) this.setActor(i, 0);
	}

	sellPrice(i) { return this.optimizer.sellPrice(i); }
	poolTarget(i) { return this.optimizer.poolTarget(i); }
	poolOccupancy(i) { return this.optimizer.poolOccupancy(i); }
	firmLaborPool(i) { return this.optimizer.firmLaborPool(i, this.optimizer.recipes[this.actors[i]]); }
	townWaitPool(i) { return this.optimizer.townWaitPool(i); }
	townGoodsTarget(i) { return this.optimizer.townGoodsTarget(i); }
	townCoalTarget(i) { return this.optimizer.townCoalTarget(i); }
	townTaxRate(i) { return this.optimizer.townTaxRate(i); }
	townRestTax(i) { return this.optimizer.townRestTax(i); }
	townGoodsBid(i) { return this.optimizer.townGoodsBid(i); }
	townCoalBid(i) { return this.optimizer.townCoalBid(i); }
	factoryCoalBid(i) { return this.optimizer.factoryCoalBid(i); }
	factoryLaborBid(i) { return this.optimizer.factoryLaborBid(i); }
	mineLaborBid(i) { return this.optimizer.mineLaborBid(i); }
	goldLaborBid(i) { return this.optimizer.goldLaborBid(i); }
	unemployment() { return this.workers.unemployment(); }
	unemployedAt(i) { return this.workers.unemployedAt(i); }
	facilityDemand() { return this.workers.facilityDemand(); }

	step() {
		this.earned.fill(0);
		this.particles.prepareStep();
		this.laborFlow.cap.fill(1);
		this.depletedFlow.cap.fill(1);
		this.updatePrices();
		const coalBefore = this.producedCoal, goodsBefore = this.producedGoods, eatBefore = this.consumedGoods;
		this.optimizer.stepActors();
		this.money.step();
		this.particles.step();
		this.workforce.weighWallets();
		this.workforce.stepStill();
		this.workers.step();
		this.settlements.step();
		this.optimizer.adaptActors();
		this.coalRate = (this.producedCoal - coalBefore) / ECONOMY_DT;
		this.goodsRate = (this.producedGoods - goodsBefore) / ECONOMY_DT;
		this.uptakeRate = (this.consumedGoods - eatBefore) / ECONOMY_DT;
		this.ticks++;
	}

	updatePrices() {
		const { actors, optimizer, workforce, priceCoal, priceGoods, priceLabor, priceHome, priceRest, nextPriceCoal, nextPriceGoods, nextPriceLabor, nextPriceHome, nextPriceRest } = this;
		const decay = this.decay ? PRICE_DECAY : 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = actors[i];
			let bCoal = -1, bGoods = -1, bLabor = -1, bHome = -1, bRest = -1;
			if (a === ECONOMY_TOWN) {
				bCoal = optimizer.townCoalBid(i);
				bGoods = optimizer.townGoodsBid(i);
				bHome = workforce.homeValueBid(i);
				bRest = workforce.homeRestBid(i);
			} else if (a) {
				const recipe = optimizer.recipes[a];
				optimizer.firmBids(i, recipe);
				for (let m = 0; m < recipe.inputs.length; m++) {
					const item = recipe.inputs[m].item;
					if (item === ITEM_COAL) bCoal = optimizer.bidOut[m];
					else if (item === ITEM_LABOR) bLabor = optimizer.bidOut[m];
				}
			}
			nextPriceCoal[i] = stepBid(priceCoal, i, priceCoal[i], bCoal, decay);
			nextPriceGoods[i] = stepBid(priceGoods, i, priceGoods[i], bGoods, decay);
			nextPriceLabor[i] = stepBid(priceLabor, i, priceLabor[i], bLabor, decay);
			nextPriceHome[i] = stepBid(priceHome, i, priceHome[i], bHome, decay);
			nextPriceRest[i] = stepBid(priceRest, i, priceRest[i], bRest, decay);
		}
		this.priceCoal = nextPriceCoal;
		this.nextPriceCoal = priceCoal;
		this.priceGoods = nextPriceGoods;
		this.nextPriceGoods = priceGoods;
		this.priceLabor = nextPriceLabor;
		this.nextPriceLabor = priceLabor;
		this.priceHome = nextPriceHome;
		this.nextPriceHome = priceHome;
		this.priceRest = nextPriceRest;
		this.nextPriceRest = priceRest;
		this.depletedFlow.alt = this.priceRest;
	}

	buyArrival(scratch, i, bill) {
		scratch.cost[i] += bill;
		this.money.payOnEntry(i, bill);
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

function stepBid(field, i, here, bid, decay) {
	const ambient = diffuse(field, i, here, decay);
	if (bid < 0) return ambient;
	const relaxed = here + ECONOMY_DT * NEED_RESPONSE * (bid - here);
	return ambient > here && ambient > relaxed ? ambient : relaxed;
}

if (typeof module === 'object') module.exports = { PriceEconomy, economyIndex };
