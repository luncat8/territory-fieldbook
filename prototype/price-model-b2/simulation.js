// Owns: the cell transport engine — spatial fields, price diffusion, cost-basis sell gate, worker-gold advection and stillness.
// Edit for: grid geometry, diffusion/decay rates and the conserved transfer kernel. Rules: actors, towns, workforce, farms, gold.
'use strict';

const ECONOMY_WIDTH = 48;
const ECONOMY_HEIGHT = 28;
const ECONOMY_SIZE = ECONOMY_WIDTH * ECONOMY_HEIGHT;
const ECONOMY_DT = 1 / 60;
const ECONOMY_MINE = 1;
const ECONOMY_FACTORY = 2;
const ECONOMY_TOWN = 3;
const ECONOMY_GOLD = 4;
const ECONOMY_SAWMILL = 5;
const ECONOMY_FARM = 6;
const ITEM_COAL = 0;
const ITEM_GOODS = 1;
const ITEM_LABOR = 2;
const ITEM_DEPLETED = 3;
const ITEM_WOOD = 4;
const ITEM_FOOD = 5;
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
const WORKER_PER_POP = 0.18;
const DEPLETED_SPREAD = 0.03;
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

// Torus topology: wrapping X and Y leaves every cell with all 8 neighbours, so no corner or rim is special.
// Bounded edges reflect diffusing bids into the corners — remnant price peaks linger there and attract stock.
let MAP_WRAP = true;
const wrapX = x => ((x % ECONOMY_WIDTH) + ECONOMY_WIDTH) % ECONOMY_WIDTH;
const wrapY = y => ((y % ECONOMY_HEIGHT) + ECONOMY_HEIGHT) % ECONOMY_HEIGHT;

// Cell for raw coordinates: wrapped on a torus, -1 off a bounded map.
function wrapCell(x, y) {
	if (x < 0 || y < 0 || x >= ECONOMY_WIDTH || y >= ECONOMY_HEIGHT) {
		if (!MAP_WRAP) return -1;
		x = wrapX(x); y = wrapY(y);
	}
	return economyIndex(x, y);
}

const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]]
	.map(([x, y]) => {
		const inv = x && y ? Math.SQRT1_2 : 1;
		return { x, y, inv, ux: x * inv, uy: y * inv, weight: x && y ? 1 : 4 };
	});
const DEGREE = DIRECTIONS.length;
let NEIGHBORS = buildEconomyNeighbors();
const REFERENCE_MINES = [[7, 8], [22, 21], [39, 7]];
const REFERENCE_FACTORIES = [[13, 13], [33, 10]];
const REFERENCE_TOWNS = [[9, 20], [28, 12]];
const REFERENCE_GOLD = [[3, 13]];
const REFERENCE_SAWMILLS = [[26, 7]];
const REFERENCE_FARMS = [[32, 16]];

function buildEconomyNeighbors() {
	const result = new Int16Array(ECONOMY_SIZE * DEGREE).fill(-1);
	for (let i = 0; i < ECONOMY_SIZE; i++) {
		for (let k = 0; k < DEGREE; k++) {
			let x = i % ECONOMY_WIDTH + DIRECTIONS[k].x;
			let y = Math.floor(i / ECONOMY_WIDTH) + DIRECTIONS[k].y;
			if (MAP_WRAP) { x = wrapX(x); y = wrapY(y); }
			if (x >= 0 && x < ECONOMY_WIDTH && y >= 0 && y < ECONOMY_HEIGHT) result[i * DEGREE + k] = economyIndex(x, y);
		}
	}
	return result;
}

// Swap topology live: rebuilds the shared neighbour table; callers re-stamp derived land state (land.refresh()).
function setMapWrap(wrap) {
	if (MAP_WRAP === wrap) return;
	MAP_WRAP = wrap;
	NEIGHBORS = buildEconomyNeighbors();
}

function makeScratch(buyers, cell, rate = FLOW_RATE, payStream = -1, seller = 0, spread = 0, carriesGold = false, blend = false, trackedPaid = false) {
	return {
		buyers, cell, rate, payStream, seller, spread, carriesGold, alt: null, intent: null, deltaIntent: null,
		hasCost: payStream >= 0 || seller > 0,
		cap: new Float64Array(ECONOMY_SIZE).fill(cell),
		sell: new Float64Array(ECONOMY_SIZE),
		cost: new Float64Array(ECONOMY_SIZE),
		paid: trackedPaid ? new Float64Array(ECONOMY_SIZE) : null,
		deltaPaid: trackedPaid ? new Float64Array(ECONOMY_SIZE) : null,
		owner: trackedPaid ? new Int32Array(ECONOMY_SIZE).fill(-1) : null,
		gold: carriesGold ? new Float64Array(ECONOMY_SIZE) : null,
		deltaGold: carriesGold ? new Float64Array(ECONOMY_SIZE) : null,
		mix: blend ? new Float64Array(ECONOMY_SIZE) : null,
		still: new Float64Array(ECONOMY_SIZE).fill(1),
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
	scratch.sell.fill(0);
	scratch.cost.fill(0);
	if (scratch.paid) {
		scratch.paid.fill(0);
		scratch.deltaPaid.fill(0);
		scratch.owner.fill(-1);
	}
	if (scratch.gold) {
		scratch.gold.fill(0);
		scratch.deltaGold.fill(0);
	}
	if (scratch.mix) scratch.mix.fill(0);
	if (scratch.intent) scratch.intent.fill(0);
	scratch.still.fill(1);
	scratch.headX.fill(0);
	scratch.headY.fill(0);
	scratch.flowX.fill(0);
	scratch.flowY.fill(0);
	scratch.flowRate.fill(0);
}

// A blended scratch scores cell `to` with the mover's own weight at `from`: price + w·(alt − price).
function scoreAt(scratch, price, from, to) {
	return scratch.alt ? price[to] + scratch.mix[from] * (scratch.alt[to] - price[to]) : price[to];
}

function hasBetterNeighbor(scratch, price, i) {
	const here = scoreAt(scratch, price, i, i);
	const base = i * DEGREE;
	for (let k = 0; k < DEGREE; k++) {
		const to = NEIGHBORS[base + k];
		if (to >= 0 && scoreAt(scratch, price, i, to) > here + 1e-9) return true;
	}
	return false;
}

class PriceEconomy {
	constructor() {
		this.actors = new Uint8Array(ECONOMY_SIZE);
		this.coal = new Float64Array(ECONOMY_SIZE);
		this.goods = new Float64Array(ECONOMY_SIZE);
		this.labor = new Float64Array(ECONOMY_SIZE);
		this.depleted = new Float64Array(ECONOMY_SIZE);
		this.wood = new Float64Array(ECONOMY_SIZE);
		this.food = new Float64Array(ECONOMY_SIZE);
		this.fresh = new Float64Array(ECONOMY_SIZE);
		this.away = new Float64Array(ECONOMY_SIZE);
		this.rooms = new Float64Array(ECONOMY_SIZE);
		this.priceCoal = new Float64Array(ECONOMY_SIZE);
		this.priceGoods = new Float64Array(ECONOMY_SIZE);
		this.priceWood = new Float64Array(ECONOMY_SIZE);
		this.priceFood = new Float64Array(ECONOMY_SIZE);
		this.priceLabor = new Float64Array(ECONOMY_SIZE);
		this.priceHome = new Float64Array(ECONOMY_SIZE);
		this.priceRest = new Float64Array(ECONOMY_SIZE);
		this.nextPriceCoal = new Float64Array(ECONOMY_SIZE);
		this.nextPriceGoods = new Float64Array(ECONOMY_SIZE);
		this.nextPriceWood = new Float64Array(ECONOMY_SIZE);
		this.nextPriceFood = new Float64Array(ECONOMY_SIZE);
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
		const firmBuyers = (1 << ECONOMY_MINE) | (1 << ECONOMY_FACTORY) | (1 << ECONOMY_GOLD) | (1 << ECONOMY_SAWMILL) | (1 << ECONOMY_FARM);
		this.coalFlow = makeScratch((1 << ECONOMY_FACTORY) | (1 << ECONOMY_TOWN), 1, FLOW_RATE, PAY_COAL, ECONOMY_MINE);
		this.goodsFlow = makeScratch(1 << ECONOMY_TOWN, 1, FLOW_RATE, PAY_GOODS, ECONOMY_FACTORY);
		this.laborFlow = makeScratch(firmBuyers, 1, LABOR_FLOW_RATE, PAY_WAGE, 0, 0, true);
		this.depletedFlow = makeScratch(1 << ECONOMY_TOWN, 1, LABOR_FLOW_RATE, -1, 0, DEPLETED_SPREAD, true, true);
		this.depletedFlow.intent = new Float64Array(ECONOMY_SIZE);
		this.depletedFlow.deltaIntent = new Float64Array(ECONOMY_SIZE);
		this.woodFlow = makeScratch(1 << ECONOMY_TOWN, 1, FLOW_RATE, PAY_WOOD, ECONOMY_SAWMILL, 0, false, false, true);
		this.foodFlow = makeScratch(1 << ECONOMY_TOWN, 1, FLOW_RATE, PAY_FOOD, ECONOMY_FARM, 0, false, false, true);
		this.stocks = [this.coal, this.goods, this.labor, this.depleted, this.wood, this.food];
		this.flows = [this.coalFlow, this.goodsFlow, this.laborFlow, this.depletedFlow, this.woodFlow, this.foodFlow];
		this.optimizer = new ActorOptimizer(this);
		this.towns = new TownPolicy(this);
		this.money = new GoldMoney(this);
		this.workforce = new WorkerPolicy(this);
		this.land = new Land(this);
		this.farms = new LandFirms(this);
		this.settlements = new Settlements(this);
		this.harvest = new Harvest(this);
		this.decay = true;
		this.derived = true;
		this.suppression = true;
		this.reset();
	}

	pricesAt(item) {
		if (item === ITEM_COAL) return this.priceCoal;
		if (item === ITEM_GOODS) return this.priceGoods;
		if (item === ITEM_WOOD) return this.priceWood;
		if (item === ITEM_FOOD) return this.priceFood;
		if (item === ITEM_LABOR) return this.priceLabor;
		return this.priceHome;
	}

	get producedWood() { return this.farms.producedWood; }
	get producedFood() { return this.farms.producedFood; }

	unitCostAt(item, i) {
		const stock = this.stocks[item][i];
		return stock > 1e-9 ? this.flows[item].cost[i] / stock : 0;
	}

	workerGoldAt(i) {
		return this.laborFlow.gold[i] + this.depletedFlow.gold[i];
	}

	totalWorkers() {
		let sum = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) sum += this.fresh[i] + this.labor[i] + this.depleted[i];
		return sum;
	}

	reset() {
		this.ticks = 0;
		this.actors.fill(0);
		for (const [x, y] of REFERENCE_MINES) this.actors[economyIndex(x, y)] = ECONOMY_MINE;
		for (const [x, y] of REFERENCE_FACTORIES) this.actors[economyIndex(x, y)] = ECONOMY_FACTORY;
		for (const [x, y] of REFERENCE_TOWNS) this.actors[economyIndex(x, y)] = ECONOMY_TOWN;
		for (const [x, y] of REFERENCE_GOLD) this.actors[economyIndex(x, y)] = ECONOMY_GOLD;
		for (const [x, y] of REFERENCE_SAWMILLS) this.actors[economyIndex(x, y)] = ECONOMY_SAWMILL;
		for (const [x, y] of REFERENCE_FARMS) this.actors[economyIndex(x, y)] = ECONOMY_FARM;
		for (const field of [this.coal, this.goods, this.labor, this.depleted, this.wood, this.food, this.fresh, this.away, this.rooms, this.priceCoal, this.priceGoods, this.priceWood, this.priceFood, this.priceLabor, this.priceHome, this.priceRest, this.pop, this.scale, this.taxMult, this.satCoal, this.satGoods, this.workLoad, this.profit, this.earned]) field.fill(0);
		this.wealthClass.fill(0);
		this.vacantTicks.fill(0);
		for (const flow of this.flows) clearScratch(flow);
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (!this.actors[i]) continue;
			this.scale[i] = 1;
			if (this.actors[i] === ECONOMY_TOWN) {
				this.taxMult[i] = 1;
				this.wealthClass[i] = wealthClassFor(i);
			}
		}
		this.land.reset();
		this.farms.reset();
		this.settlements.reset();
		this.workforce.resetResidents();
		this.money.reset();
		this.harvest.reset();
		this.producedCoal = this.burnedCoal = this.producedGoods = this.consumedGoods = 0;
		this.suppliedLabor = this.workedLabor = this.emittedDepleted = this.restedDepleted = 0;
		this.coalRate = this.goodsRate = this.uptakeRate = 0;
	}

	setActor(i, kind) {
		if (kind && (this.actors[i] || this.land.terrain[i] === TERRAIN_WATER || this.farms.plotOwner[i])) return false;
		const prev = this.actors[i];
		if (!kind && prev) {
			if (prev === ECONOMY_TOWN) this.workforce.evictTown(i);
			this.money.release(i);
			this.pop[i] = this.rooms[i] = this.away[i] = this.scale[i] = this.taxMult[i] = this.satCoal[i] = this.satGoods[i] = this.workLoad[i] = this.profit[i] = 0;
			this.wealthClass[i] = 0;
			this.vacantTicks[i] = 0;
			for (const flow of this.flows) {
				if (!flow.paid) {
					flow.sell[i] = 0;
					if (flow.cost) flow.cost[i] = 0;
				}
			}
		}
		this.actors[i] = kind;
		this.farms.placed(i, kind);
		this.settlements.placed(i, kind);
		if (kind) {
			this.scale[i] = 1;
			this.workLoad[i] = 0;
		}
		if (kind === ECONOMY_TOWN) {
			this.taxMult[i] = 1;
			this.wealthClass[i] = wealthClassFor(i);
			this.vacantTicks[i] = 0;
			this.workforce.seedTown(i);
			this.money.seed(i);
		}
		this.harvest.placed(i, kind);
		return true;
	}

	clearTowns() {
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (this.actors[i] === ECONOMY_TOWN) this.setActor(i, 0);
		}
	}

	sellPrice(i) { return this.optimizer.sellPrice(i); }
	poolTarget(i) { return this.optimizer.poolTarget(i); }
	poolOccupancy(i) { return this.optimizer.poolOccupancy(i); }
	firmLaborPool(i) { return this.optimizer.firmLaborPool(i, this.optimizer.recipes[this.actors[i]]); }
	townWaitPool(i) { return this.towns.townWaitPool(i); }
	townGoodsTarget(i) { return this.towns.townGoodsTarget(i); }
	townCoalTarget(i) { return this.towns.townCoalTarget(i); }
	townTaxRate(i) { return this.towns.townTaxRate(i); }
	townRestTax(i) { return this.towns.townRestTax(i); }
	townGoodsBid(i) { return this.towns.townGoodsBid(i); }
	townCoalBid(i) { return this.towns.townCoalBid(i); }
	townWoodBid(i) { return this.towns.townWoodBid(i); }
	townFoodBid(i) { return this.towns.townFoodBid(i); }
	factoryCoalBid(i) { return this.optimizer.factoryCoalBid(i); }
	factoryLaborBid(i) { return this.optimizer.factoryLaborBid(i); }
	mineLaborBid(i) { return this.optimizer.mineLaborBid(i); }
	goldLaborBid(i) { return this.optimizer.goldLaborBid(i); }
	sawmillLaborBid(i) { return this.optimizer.sawmillLaborBid(i); }
	farmLaborBid(i) { return this.optimizer.farmLaborBid(i); }

	step() {
		this.earned.fill(0);
		for (const flow of this.flows) {
			flow.cap.fill(1);
			if (!flow.paid) flow.sell.fill(0);
			this.land.blockWater(flow.cap);
		}
		this.workforce.stepOut();
		this.updatePrices();
		const coalBefore = this.producedCoal, goodsBefore = this.producedGoods, eatBefore = this.consumedGoods;
		this.optimizer.stepActors();
		this.harvest.step();
		this.money.step();
		this.transport(this.coalFlow, this.coal, this.priceCoal);
		this.transport(this.goodsFlow, this.goods, this.priceGoods);
		this.transport(this.woodFlow, this.wood, this.priceWood);
		this.transport(this.foodFlow, this.food, this.priceFood);
		this.transport(this.laborFlow, this.labor, this.priceLabor);
		this.workforce.weighWallets();
		this.transport(this.depletedFlow, this.depleted, this.priceHome, this.priceRest);
		this.workforce.trackCommute();
		this.workforce.stepStill();
		this.workforce.stepLife();
		this.settlements.step();
		this.land.step();
		this.optimizer.adaptActors();
		this.coalRate = (this.producedCoal - coalBefore) / ECONOMY_DT;
		this.goodsRate = (this.producedGoods - goodsBefore) / ECONOMY_DT;
		this.uptakeRate = (this.consumedGoods - eatBefore) / ECONOMY_DT;
		this.ticks++;
	}

	updatePrices() {
		const { actors, optimizer, towns, workforce, priceCoal, priceGoods, priceWood, priceFood, priceLabor, priceHome, priceRest, nextPriceCoal, nextPriceGoods, nextPriceWood, nextPriceFood, nextPriceLabor, nextPriceHome, nextPriceRest } = this;
		const decay = this.decay ? PRICE_DECAY : 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = actors[i];
			let bCoal = -1, bGoods = -1, bWood = -1, bFood = -1, bLabor = -1, bHome = -1, bRest = -1;
			if (a === ECONOMY_TOWN) {
				bCoal = towns.townCoalBid(i);
				bGoods = towns.townGoodsBid(i);
				bWood = towns.townWoodBid(i);
				bFood = towns.townFoodBid(i);
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
			nextPriceWood[i] = stepBid(priceWood, i, priceWood[i], bWood, decay);
			nextPriceFood[i] = stepBid(priceFood, i, priceFood[i], bFood, decay);
			nextPriceLabor[i] = stepBid(priceLabor, i, priceLabor[i], bLabor, decay);
			nextPriceHome[i] = stepBid(priceHome, i, priceHome[i], bHome, decay);
			nextPriceRest[i] = stepBid(priceRest, i, priceRest[i], bRest, decay);
		}
		this.priceCoal = nextPriceCoal;
		this.nextPriceCoal = priceCoal;
		this.priceGoods = nextPriceGoods;
		this.nextPriceGoods = priceGoods;
		this.priceWood = nextPriceWood;
		this.nextPriceWood = priceWood;
		this.priceFood = nextPriceFood;
		this.nextPriceFood = priceFood;
		this.priceLabor = nextPriceLabor;
		this.nextPriceLabor = priceLabor;
		this.priceHome = nextPriceHome;
		this.nextPriceHome = priceHome;
		this.priceRest = nextPriceRest;
		this.nextPriceRest = priceRest;
		this.depletedFlow.alt = this.priceRest;
	}

	holdsAt(scratch, price, i) {
		if (!(scratch.buyers & (1 << this.actors[i]))) return false;
		if (scratch.spread === 0) return true;
		return scratch.cap[i] > 0 && !hasBetterNeighbor(scratch, price, i);
	}

	transport(scratch, stock, price, alt = null) {
		const { requests, room, receiving, delta, buyers, cap, cell, carriesGold, gold, deltaGold, intent, deltaIntent, paid, deltaPaid, owner } = scratch;
		scratch.alt = alt;
		scratch.still.fill(1);
		requests.fill(0);
		receiving.fill(0);
		delta.fill(0);
		if (carriesGold) deltaGold.fill(0);
		if (intent) deltaIntent.fill(0);
		if (paid) deltaPaid.fill(0);
		scratch.flowX.fill(0);
		scratch.flowY.fill(0);
		scratch.flowRate.fill(0);
		for (let i = 0; i < ECONOMY_SIZE; i++) room[i] = Math.max(0, cap[i] - stock[i]);
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (stock[i] > 1e-12 && !this.holdsAt(scratch, price, i)) this.planOutflow(scratch, stock, price, i);
		}
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (receiving[i] > 0) receiving[i] = Math.min(1, room[i] / receiving[i]);
		}
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (stock[i] > 1e-12 && !this.holdsAt(scratch, price, i)) this.acceptTransfers(scratch, stock, price, i);
		}
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const before = stock[i];
			const after = Math.min(cell, Math.max(0, before + delta[i]));
			stock[i] = after;
			if (intent) intent[i] = after > 1e-12 ? Math.min(1, Math.max(0, (intent[i] * before + deltaIntent[i]) / after)) : 0;
			if (carriesGold) {
				gold[i] = Math.max(0, gold[i] + deltaGold[i]);
				if (after <= 1e-12 && gold[i] > 0) {
					this.money.orphan(i, gold[i]);
					gold[i] = 0;
				}
			}
			let bought = after - before;
			if (paid) {
				const beforePaid = paid[i];
				const afterPaid = Math.min(after, Math.max(0, beforePaid + deltaPaid[i]));
				paid[i] = afterPaid;
				bought = afterPaid - beforePaid;
				if (afterPaid <= 1e-12) {
					paid[i] = 0;
					scratch.cost[i] = 0;
					scratch.sell[i] = 0;
					owner[i] = -1;
				}
			}
			if (bought > 0 && after > 1e-12 && scratch.payStream >= 0 && (buyers & (1 << this.actors[i]))) this.buyArrival(scratch, i, bought * price[i]);
			if (after <= 1e-12 && scratch.hasCost) scratch.cost[i] = 0;
		}
	}

	buyArrival(scratch, i, bill) {
		scratch.cost[i] += bill;
		if (scratch.payStream === PAY_WAGE) this.money.payOnEntry(i, bill);
		else this.money.bill(i, scratch.payStream, bill);
	}

	// Stock leaves a seller only when neighbor price clears its cost-basis sell floor.
	planOutflow(scratch, stock, price, i) {
		const { requests, room } = scratch;
		const base = i * DEGREE;
		const here = scoreAt(scratch, price, i, i);
		const floor = Math.max(here, scratch.sell[i]);
		let gx = 0, gy = 0, steepest = 0, steepestPull = 0;
		for (let k = 0; k < DEGREE; k++) {
			const to = NEIGHBORS[base + k];
			if (to < 0 || room[to] <= 0) continue;
			const dir = DIRECTIONS[k];
			const there = scoreAt(scratch, price, i, to);
			const pull = there > floor ? there - here : 0;
			const disperse = scratch.spread > 0 && stock[i] > stock[to] ? scratch.spread * (stock[i] - stock[to]) : 0;
			const slope = (pull + disperse) * dir.inv;
			if (slope <= 0) continue;
			requests[base + k] = slope;
			steepest = Math.max(steepest, slope);
			steepestPull = Math.max(steepestPull, pull * dir.inv);
			gx += dir.ux * slope;
			gy += dir.uy * slope;
		}
		scratch.still[i] = GRADIENT_KNEE / (steepestPull + GRADIENT_KNEE);
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

	// Companion worker gold and commercial cost-basis stock advect in exact proportion on each edge.
	acceptTransfers(scratch, stock, price, i) {
		const { requests, receiving, delta, carriesGold, gold, deltaGold, intent, deltaIntent, paid, deltaPaid, owner } = scratch;
		const base = i * DEGREE;
		const avail = stock[i];
		const goldHere = carriesGold ? gold[i] : 0;
		const paidHere = paid ? paid[i] : 0;
		let amountOut = 0, goldOut = 0, paidOut = 0, revenue = 0, vx = 0, vy = 0;
		for (let k = 0; k < DEGREE; k++) {
			const edge = base + k;
			if (!requests[edge]) continue;
			const to = NEIGHBORS[edge];
			const amount = requests[edge] * receiving[to];
			delta[to] += amount;
			amountOut += amount;
			if (intent) deltaIntent[to] += intent[i] * amount;
			if (goldHere > 0 && amount > 0) {
				const movedGold = goldHere * Math.min(1, amount / avail);
				deltaGold[to] += movedGold;
				goldOut += movedGold;
			}
			if (paidHere > 0 && amount > 0) {
				const movedPaid = paidHere * Math.min(1, amount / avail);
				deltaPaid[to] += movedPaid;
				paidOut += movedPaid;
			}
			revenue += amount * price[to];
			vx += DIRECTIONS[k].ux * amount;
			vy += DIRECTIONS[k].uy * amount;
		}
		delta[i] -= amountOut;
		if (intent) deltaIntent[i] -= intent[i] * amountOut;
		if (goldOut > 0) deltaGold[i] -= Math.min(goldHere, goldOut);
		if (paidOut > 0) deltaPaid[i] -= Math.min(paidHere, paidOut);
		if (scratch.hasCost && amountOut > 0) {
			if (paid) {
				if (paidOut > 0) {
					const cogs = scratch.cost[i] * Math.min(1, paidOut / paidHere);
					scratch.cost[i] = Math.max(0, scratch.cost[i] - cogs);
					const sellerCell = owner[i];
					if (sellerCell >= 0 && this.actors[sellerCell] === scratch.seller) {
						this.earned[sellerCell] += (revenue * Math.min(1, paidOut / amountOut) - cogs) / ECONOMY_DT;
					}
				}
			} else {
				const cogs = scratch.cost[i] * Math.min(1, amountOut / avail);
				scratch.cost[i] = Math.max(0, scratch.cost[i] - cogs);
				if (this.actors[i] === scratch.seller) this.earned[i] += (revenue - cogs) / ECONOMY_DT;
			}
		}
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

if (typeof module === 'object') module.exports = { PriceEconomy, economyIndex, setMapWrap };
