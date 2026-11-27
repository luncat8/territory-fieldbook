// Owns: grid geometry, diffused price/appeal fields, cell-view rebuild from particles and the canonical simulation tick.
// Edit for: tick order, field diffusion/decay constants, actor placement/removal and shared PriceEconomy queries.
'use strict';

const ECONOMY_WIDTH = 48;
const ECONOMY_HEIGHT = 28;
const ECONOMY_SIZE = ECONOMY_WIDTH * ECONOMY_HEIGHT;
const ECONOMY_DT = 1 / 60;
const ECONOMY_MINE = 1;
const ECONOMY_FACTORY = 2;
const ECONOMY_TOWN = 3;
const ECONOMY_GOLD = 4;
const ECONOMY_GARDEN = 5;
const ECONOMY_FARM = 6;
const ECONOMY_SAWMILL = 7;
const ITEM_COAL = 0;
const ITEM_GOODS = 1;
const ITEM_LABOR = 2;
const ITEM_DEPLETED = 3;
const ITEM_FOOD = 4;
const ITEM_WOOD = 5;
const GOODS_ITEMS = [ITEM_COAL, ITEM_GOODS, ITEM_FOOD, ITEM_WOOD];
const SOURCE_RATE = 0.34;
const FACTORY_RATE = 0.34;
const FACTORY_YIELD = 1;
const MINE_LABOR = 1.1;
const FACTORY_LABOR = 1.1;
const GOLD_LABOR = 1.1;
const GOLD_RATE = 0.4;
const GOLD_WOOD = 0.12;
const GOLD_START_WOOD = 0.6;
const START_PRICE = 4;
const INPUT_SHARE = 0.65;
const BUFFER_SECONDS = 1.8;
const SERVICE_SHARE = 1 - Math.exp(-ECONOMY_DT / 0.1);
const START_POP = 10;
const SEED_WORKERS_PER_TOWN = 12;
const POP_BASE = 2;
const POP_MAX = 24;
const POP_HEADROOM = 2;
const POP_RATE = 0.06;
const TOWN_COAL_NEED = 0.01;
const TOWN_GOODS_NEED = 0.034;
const NEED_RATE = START_POP * TOWN_GOODS_NEED;
const COAL_COMFORT = 0.2;
const GOODS_COMFORT = 0.8;
const SAT_RATE = 1.8;
const PROFIT_RATE = 1.4;
const PRICE_DIFFUSE = 15;
const PRICE_DECAY = 0.08;
const PRICE_GATE = 0.01;
const NEED_RESPONSE = 2;
const GRADIENT_KNEE = 0.006;
const DOCK_SLOPE = 0.0006;
const STEERING_BLEND = ECONOMY_DT / (0.18 + ECONOMY_DT);
const economyIndex = (x, y) => y * ECONOMY_WIDTH + x;

// Torus topology: wrapping X and Y gives every cell — rim and corner included — full 8-neighbour reach.
// Bounded edges reflect scans into the corners instead. `setMapWrap` swaps topology live; callers re-stamp
// land and rebuild the forage coarse table after the switch.
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

// Shortest-image delta across the torus so distances and steps never travel the long way round.
const torusDelta = (d, span) => MAP_WRAP ? (((d + span / 2) % span) + span) % span - span / 2 : d;

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
let NEIGHBORS = buildEconomyNeighbors();
const REFERENCE_MINES = [[7, 8], [22, 21], [39, 7]];
const REFERENCE_FACTORIES = [[13, 13], [33, 10]];
const REFERENCE_TOWNS = [[9, 20], [28, 12]];
const REFERENCE_GOLD = [[3, 13]];
const REFERENCE_GARDENS = [[19, 15]];
const REFERENCE_SAWMILLS = [[6, 6]];

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

// Swap topology live: rebuilds the shared neighbour table; callers re-stamp derived land and forage state.
function setMapWrap(wrap) {
	if (MAP_WRAP === wrap) return;
	MAP_WRAP = wrap;
	NEIGHBORS = buildEconomyNeighbors();
}

class PriceEconomy {
	constructor() {
		this.actors = new Uint8Array(ECONOMY_SIZE);
		this.coal = new Float64Array(ECONOMY_SIZE);
		this.goods = new Float64Array(ECONOMY_SIZE);
		this.labor = new Float64Array(ECONOMY_SIZE);
		this.depleted = new Float64Array(ECONOMY_SIZE);
		this.pop = new Float64Array(ECONOMY_SIZE);
		this.rooms = new Float64Array(ECONOMY_SIZE);
		this.roomCount = new Float64Array(ECONOMY_SIZE);
		this.waitCount = new Float64Array(ECONOMY_SIZE);
		this.poolCount = new Float64Array(ECONOMY_SIZE);
		this.shiftCount = new Float64Array(ECONOMY_SIZE);
		this.shiftAvail = new Float64Array(ECONOMY_SIZE);
		this.stillFresh = new Float64Array(ECONOMY_SIZE);
		this.stillDep = new Float64Array(ECONOMY_SIZE);
		this.forageCount = new Float64Array(ECONOMY_SIZE);
		this.workerGold = new Float64Array(ECONOMY_SIZE);
		this.localWealth = new Float64Array(ECONOMY_SIZE);
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
		this.scale = new Float64Array(ECONOMY_SIZE);
		this.taxMult = new Float64Array(ECONOMY_SIZE);
		this.wealthClass = new Uint8Array(ECONOMY_SIZE);
		this.vacantTicks = new Float64Array(ECONOMY_SIZE);
		this.satCoal = new Float64Array(ECONOMY_SIZE);
		this.satGoods = new Float64Array(ECONOMY_SIZE);
		this.workLoad = new Float64Array(ECONOMY_SIZE);
		this.shiftLabor = new Float64Array(ECONOMY_SIZE);
		this.profit = new Float64Array(ECONOMY_SIZE);
		this.earned = new Float64Array(ECONOMY_SIZE);
		this.food = new Float64Array(ECONOMY_SIZE);
		this.wood = new Float64Array(ECONOMY_SIZE);
		this.priceFood = new Float64Array(ECONOMY_SIZE);
		this.nextPriceFood = new Float64Array(ECONOMY_SIZE);
		this.priceWood = new Float64Array(ECONOMY_SIZE);
		this.nextPriceWood = new Float64Array(ECONOMY_SIZE);
		this.stocks = [this.coal, this.goods, this.labor, this.depleted, this.food, this.wood];
		this.decay = true;
		this.derived = true;
		this.suppression = true;
		this.land = new Land(this);
		this.steering = new Steering(this);
		this.forage = new ForageSystem(this);
		this.money = new GoldMoney(this);
		this.bank = new GoldBank(this);
		this.owners = new OwnerRegistry(this);
		this.scenario = { goldPerWorker: START_GOLD_PER_WORKER, shares: START_SHARES };
		this.goodsPool = new GoodsPool(this);
		this.workers = new WorkerPool(this);
		this.workerLife = new WorkerLife(this);
		this.farms = new FarmSystem(this);
		this.workforce = new WorkerPolicy(this);
		this.optimizer = new ActorOptimizer(this);
		this.towns = new TownRules(this);
		this.settlements = new Settlements(this);
		this.founding = new FirmFounding(this);
		this.tracker = new WorkerTracker(this);
		this.reset();
	}

	pricesAt(item) {
		return item === ITEM_FOOD ? this.priceFood : item === ITEM_COAL ? this.priceCoal : item === ITEM_GOODS ? this.priceGoods : item === ITEM_LABOR ? this.priceLabor : item === ITEM_WOOD ? this.priceWood : this.priceHome;
	}

	unitCostAt(item, i) {
		const stock = this.stocks[item][i];
		return stock > 1e-9 ? this.goodsPool.stockCost[item][i] / stock : 0;
	}

	workerGoldAt(i) {
		return this.workerGold[i];
	}

	reset() {
		this.tracker.reset();
		this.actors.fill(0);
		for (const [x, y] of REFERENCE_MINES) this.actors[economyIndex(x, y)] = ECONOMY_MINE;
		for (const [x, y] of REFERENCE_FACTORIES) this.actors[economyIndex(x, y)] = ECONOMY_FACTORY;
		for (const [x, y] of REFERENCE_TOWNS) this.actors[economyIndex(x, y)] = ECONOMY_TOWN;
		for (const [x, y] of REFERENCE_GOLD) this.actors[economyIndex(x, y)] = ECONOMY_GOLD;
		for (const [x, y] of REFERENCE_GARDENS) this.actors[economyIndex(x, y)] = ECONOMY_GARDEN;
		for (const [x, y] of REFERENCE_SAWMILLS) this.actors[economyIndex(x, y)] = ECONOMY_SAWMILL;
		for (const field of [this.coal, this.goods, this.labor, this.depleted, this.pop, this.rooms, this.priceCoal, this.priceGoods, this.priceLabor, this.priceHome, this.priceRest, this.scale, this.taxMult, this.vacantTicks, this.satCoal, this.satGoods, this.workLoad, this.shiftLabor, this.profit, this.earned, this.localWealth]) field.fill(0);
		this.wealthClass.fill(0);
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = this.actors[i];
			if (!a) continue;
			this.scale[i] = 1;
			if (a === ECONOMY_TOWN) {
				this.rooms[i] = START_POP;
				this.taxMult[i] = 1;
				this.wealthClass[i] = wealthClassFor(i);
			}
		}
		this.farms.reset();
		this.land.seedTerrain();
		this.land.refresh();
		this.settlements.seedForest();
		this.settlements.reset();
		this.forage.reset();
		this.workerLife.reset();
		this.food.fill(0);
		this.wood.fill(0);
		this.priceFood.fill(0);
		this.nextPriceFood.fill(0);
		this.priceWood.fill(0);
		this.nextPriceWood.fill(0);
		this.producedFood = this.consumedFood = 0;
		this.goodsPool.reset();
		this.workers.reset();
		this.towns.reset();
		this.founding.reset();
		this.owners.reset();
		this.money.reset();
		this.workers.seedReference();
		this.ticks = this.producedCoal = this.burnedCoal = this.producedGoods = this.consumedGoods = 0;
		this.workedLabor = this.restedDepleted = 0;
		this.coalRate = this.goodsRate = this.uptakeRate = 0;
		this.producedWood = this.consumedWood = this.seededWood = 0;
		this.founding.assignReferenceOwners();
		this.seedTimber();
		this.money.fundScenario(this.scenario.goldPerWorker, this.scenario.shares);
		this.rebuildCellView();
		this.land.refresh();
		this.forage.warm();
	}

	// Gold mines open with a small recorded timber reserve (a real asset, not gold) so the first shift can extract.
	seedTimber() {
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (this.actors[i] !== ECONOMY_GOLD) continue;
			this.wood[i] += GOLD_START_WOOD;
			this.seededWood += GOLD_START_WOOD;
		}
	}

	setActor(i, kind) {
		if (kind && (this.actors[i] || this.forage.plotOwner[i] || this.farms.plotOwner[i] || this.land.terrain[i] === TERRAIN_WATER)) return false;
		if (!kind && this.actors[i]) {
			const prev = this.actors[i];
			if (prev === ECONOMY_GARDEN) this.forage.releasePlots(i);
			if (prev === ECONOMY_FARM) this.farms.release(i);
			this.workers.evictCell(i);
			this.goodsPool.flushOwner(i);
			this.money.releaseTown(i);
			this.owners.detach(i);
			this.coal[i] = this.goods[i] = this.food[i] = this.wood[i] = 0;
			this.goodsPool.stockCost[ITEM_FOOD][i] = 0;
			this.goodsPool.stockCost[0][i] = this.goodsPool.stockCost[1][i] = 0;
			this.goodsPool.stockCost[ITEM_WOOD][i] = 0;
			this.rooms[i] = this.scale[i] = this.taxMult[i] = this.satCoal[i] = this.satGoods[i] = this.workLoad[i] = this.profit[i] = 0;
			this.towns.clearTown(i);
			this.founding.clearSite(i);
			this.wealthClass[i] = 0;
			this.vacantTicks[i] = 0;
		}
		this.actors[i] = kind;
		this.settlements.placed(i, kind);
		if (kind) {
			this.scale[i] = 1;
			this.workLoad[i] = 0;
		}
		if (kind === ECONOMY_TOWN) {
			this.rooms[i] = START_POP;
			this.taxMult[i] = 1;
			this.wealthClass[i] = wealthClassFor(i);
			this.vacantTicks[i] = 0;
			this.localWealth[i] = WALLET_REFERENCE;
			this.towns.initTown(i);
		} else if (kind === ECONOMY_GARDEN) {
			this.forage.claimPlots(i);
		} else if (kind) {
			this.founding.assignOwner(i);
			if (kind === ECONOMY_FARM) this.farms.init(i);
		}
		this.rebuildCellView();
		return true;
	}

	clearTowns() {
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (this.actors[i] === ECONOMY_TOWN) this.setActor(i, 0);
		}
	}

	// Rebuilds per-cell aggregates from worker particles so B2 rules read the exact state without writing it.
	rebuildCellView() {
		this.labor.fill(0);
		this.depleted.fill(0);
		this.pop.fill(0);
		this.roomCount.fill(0);
		this.waitCount.fill(0);
		this.poolCount.fill(0);
		this.shiftCount.fill(0);
		this.shiftAvail.fill(0);
		this.stillFresh.fill(0);
		this.stillDep.fill(0);
		this.forageCount.fill(0);
		this.workerGold.fill(0);
		this.workers.accumulateView();
	}

	sellPrice(i) { return this.optimizer.sellPrice(i); }
	poolTarget(i) { return this.optimizer.poolTarget(i); }
	poolOccupancy(i) { return this.optimizer.poolOccupancy(i); }
	townGoodsTarget(i) { return this.towns.goodsTarget(i); }
	townCoalTarget(i) { return this.towns.coalTarget(i); }
	townTaxRate(i) { return this.towns.taxRate(i); }
	townRestTax(i) { return this.towns.restTax(i); }
	townGoodsBid(i) { return this.towns.goodsBid(i); }
	townCoalBid(i) { return this.towns.coalBid(i); }
	townBid(i) { return this.towns.goodsBid(i); }
	townWoodBid(i) { return this.towns.woodBid(i); }
	factoryCoalBid(i) { return this.optimizer.factoryCoalBid(i); }
	factoryLaborBid(i) { return this.optimizer.factoryLaborBid(i); }
	factoryBid(i) { return this.optimizer.factoryCoalBid(i); }
	mineLaborBid(i) { return this.optimizer.mineLaborBid(i); }
	goldLaborBid(i) { return this.optimizer.goldLaborBid(i); }
	sawmillLaborBid(i) { return this.optimizer.sawmillLaborBid(i); }

	step() {
		this.earned.fill(0);
		this.rebuildCellView();
		this.updatePrices();
		this.forage.step();
		const coalBefore = this.producedCoal, goodsBefore = this.producedGoods, eatBefore = this.consumedGoods;
		this.optimizer.stepFirms();
		this.towns.stepTowns();
		this.goodsPool.step();
		this.farms.step();
		this.workers.step();
		this.workerLife.step();
		this.rebuildCellView();
		this.settlements.step();
		this.founding.step();
		this.money.step();
		this.optimizer.adaptFirms();
		this.towns.adaptTowns();
		this.rebuildCellView();
		this.coalRate = (this.producedCoal - coalBefore) / ECONOMY_DT;
		this.goodsRate = (this.producedGoods - goodsBefore) / ECONOMY_DT;
		this.uptakeRate = (this.consumedGoods - eatBefore) / ECONOMY_DT;
		this.ticks++;
	}

	updatePrices() {
		const { actors, optimizer, towns, workforce, founding, priceCoal, priceGoods, priceLabor, priceHome, priceRest, priceWood, nextPriceCoal, nextPriceGoods, nextPriceLabor, nextPriceHome, nextPriceRest, nextPriceWood } = this;
		const decay = this.decay ? PRICE_DECAY : 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = actors[i];
			let bCoal = -1, bGoods = -1, bLabor = -1, bHome = -1, bRest = -1, bFood = -1, bWood = -1;
			if (a === ECONOMY_TOWN) {
				bCoal = towns.coalBid(i);
				bGoods = towns.goodsBid(i);
				bFood = towns.foodBid(i);
				bHome = workforce.homeValueBid(i);
				bRest = workforce.homeRestBid(i);
				bWood = towns.woodBid(i);
			} else if (a === ECONOMY_FARM) {
				bLabor = this.farms.wageBid(i);
				bWood = this.farms.woodBid(i);
			} else if (a && a !== ECONOMY_GARDEN && !founding.isBuilding(i)) {
				const recipe = optimizer.recipes[a];
				optimizer.firmBids(i, recipe);
				for (let m = 0; m < recipe.inputs.length; m++) {
					const item = recipe.inputs[m].item;
					if (item === ITEM_COAL) bCoal = optimizer.bidOut[m];
					else if (item === ITEM_LABOR) bLabor = optimizer.bidOut[m];
					else if (item === ITEM_WOOD) bWood = optimizer.bidOut[m];
				}
			}
			this.nextPriceFood[i] = stepBid(this.priceFood, i, this.priceFood[i], bFood, decay);
			nextPriceCoal[i] = stepBid(priceCoal, i, priceCoal[i], bCoal, decay);
			nextPriceGoods[i] = stepBid(priceGoods, i, priceGoods[i], bGoods, decay);
			nextPriceLabor[i] = stepBid(priceLabor, i, priceLabor[i], bLabor, decay);
			nextPriceHome[i] = stepBid(priceHome, i, priceHome[i], bHome, decay);
			nextPriceRest[i] = stepBid(priceRest, i, priceRest[i], bRest, decay);
			nextPriceWood[i] = stepBid(priceWood, i, priceWood[i], bWood, decay);
		}
		const foodSwap = this.priceFood;
		this.priceFood = this.nextPriceFood;
		this.nextPriceFood = foodSwap;
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
		this.priceWood = nextPriceWood;
		this.nextPriceWood = priceWood;
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
