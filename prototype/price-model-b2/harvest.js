// Owns: settlement harvesting & stores — idle residents forage wild food/wood, while towns also buy from farms and sawmills.
// Edit for: household forage pace, town food/wood targets, consumption and hunger threshold.
'use strict';

const HARVEST_RADIUS = 3;
const HARVEST_STRIDE = 20;
const HARVEST_RATE = 0.8;
const FOOD_PER_WORK = 2;
const WOOD_PER_WORK = 1.5;
const FOOD_NEED = 0.008;
const FOOD_BUFFER = 5;
const WOOD_USE = 0.002;
const WOOD_BUFFER = 6;
const WOOD_PER_POP = 0.2;
const WILD_REGROW = 0.05;
const HUNGRY_SAT = 0.35;
const FOOD_BID_VALUE = 0.32;
const WOOD_BID_VALUE = 0.14;
const YOUNG_PULL = 0.05;

class Harvest {
	constructor(model) {
		this.model = model;
		this.wood = model.wood;
		this.food = model.food;
		this.woodFlow = model.woodFlow;
		this.foodFlow = model.foodFlow;
		this.wild = new Float64Array(ECONOMY_SIZE);
		this.satFood = new Float64Array(ECONOMY_SIZE);
		this.satWood = new Float64Array(ECONOMY_SIZE);
		this.satBlend = 1 - Math.exp(-ECONOMY_DT * SAT_RATE);
		this.workShare = 1 - Math.exp(-ECONOMY_DT * HARVEST_STRIDE * HARVEST_RATE);
		this.regrowShare = 1 - Math.exp(-ECONOMY_DT * HARVEST_STRIDE * WILD_REGROW);
	}

	get priceWood() { return this.model.priceWood; }
	get priceFood() { return this.model.priceFood; }

	reset() {
		for (const field of [this.wood, this.food, this.priceWood, this.priceFood, this.satFood, this.satWood]) field.fill(0);
		clearScratch(this.woodFlow);
		clearScratch(this.foodFlow);
		this.wild.set(this.model.land.foodCap);
		this.seed = 0x6d2b79f5;
		this.ticks = 0;
		this.seededWood = this.seededFood = this.harvestedWood = this.harvestedFood = 0;
		this.eatenFood = this.usedWood = this.builtWood = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (this.model.actors[i] === ECONOMY_TOWN) this.placed(i, ECONOMY_TOWN);
		}
	}

	// A placed town arrives built and stocked, like its seeded gold; a founded one starts with empty stores.
	placed(i, kind) {
		this.satFood[i] = this.satWood[i] = kind === ECONOMY_TOWN ? 1 : 0;
		if (kind !== ECONOMY_TOWN) return;
		const food = Math.max(0, this.foodTarget(i) - this.food[i]), wood = Math.max(0, this.woodTarget(i) - this.wood[i]);
		this.food[i] += food;
		this.wood[i] += wood;
		this.seededFood += food;
		this.seededWood += wood;
	}

	founded(i) {
		this.satFood[i] = this.satWood[i] = 1;
	}

	foodTarget(i) {
		const m = this.model;
		const pop = Math.max(m.pop[i], m.settlements.isYoungTown(i) ? m.rooms[i] : 0);
		return Math.min(1, pop * FOOD_NEED * FOOD_BUFFER);
	}

	// A young town wants a full cell of wood for its first build; a built one keeps upkeep plus one growth step.
	woodTarget(i) {
		const m = this.model;
		if (m.settlements.isYoungTown(i)) return 1;
		const pop = Math.max(m.pop[i], m.rooms[i]);
		const grow = m.rooms[i] < m.settlements.popCap(i) - 0.5 ? WOOD_PER_POP * POP_HEADROOM : 0;
		return Math.min(1, pop * WOOD_USE * WOOD_BUFFER + grow);
	}

	needFood(i) {
		const target = this.foodTarget(i);
		return target > 0 ? Math.max(0, 1 - this.food[i] / target) : 0;
	}

	needWood(i) {
		const target = this.woodTarget(i);
		return target > 0 ? Math.max(0, 1 - this.wood[i] / target) : 0;
	}

	hungry(i) {
		return this.satFood[i] < HUNGRY_SAT;
	}

	// Growth and construction draw from the town's wood stock and expense any purchased book cost.
	takeWood(i, amount) {
		const avail = this.wood[i];
		const granted = Math.min(amount, avail);
		if (granted <= 0) return 0;
		const ratio = Math.min(1, granted / avail);
		const cost = this.woodFlow.cost[i] * ratio;
		this.wood[i] = Math.max(0, avail - granted);
		this.woodFlow.paid[i] = this.wood[i] > 1e-12 ? Math.max(0, this.woodFlow.paid[i] * (1 - ratio)) : 0;
		this.woodFlow.cost[i] = this.wood[i] > 1e-12 ? Math.max(0, this.woodFlow.cost[i] - cost) : 0;
		this.model.earned[i] -= cost / ECONOMY_DT;
		this.builtWood += granted;
		return granted;
	}

	step() {
		const m = this.model;
		const picking = ++this.ticks % HARVEST_STRIDE === 0;
		if (picking) this.regrow();
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (m.actors[i] !== ECONOMY_TOWN) continue;
			this.useStores(i);
			if (picking) this.harvestFor(i);
		}
	}

	useStores(i) {
		const m = this.model;
		const wantFood = m.pop[i] * FOOD_NEED * ECONOMY_DT, wantWood = m.pop[i] * WOOD_USE * ECONOMY_DT;
		const foodAvail = this.food[i], woodAvail = this.wood[i];
		const ate = Math.min(foodAvail * SERVICE_SHARE, wantFood);
		const burned = Math.min(woodAvail * SERVICE_SHARE, wantWood);
		const foodRatio = foodAvail > 0 ? Math.min(1, ate / foodAvail) : 0;
		const woodRatio = woodAvail > 0 ? Math.min(1, burned / woodAvail) : 0;
		const foodCost = this.foodFlow.cost[i] * foodRatio;
		const woodCost = this.woodFlow.cost[i] * woodRatio;
		this.food[i] = Math.max(0, foodAvail - ate);
		this.wood[i] = Math.max(0, woodAvail - burned);
		this.foodFlow.paid[i] = this.food[i] > 1e-12 ? Math.max(0, this.foodFlow.paid[i] * (1 - foodRatio)) : 0;
		this.woodFlow.paid[i] = this.wood[i] > 1e-12 ? Math.max(0, this.woodFlow.paid[i] * (1 - woodRatio)) : 0;
		this.foodFlow.cost[i] = this.food[i] > 1e-12 ? Math.max(0, this.foodFlow.cost[i] - foodCost) : 0;
		this.woodFlow.cost[i] = this.wood[i] > 1e-12 ? Math.max(0, this.woodFlow.cost[i] - woodCost) : 0;
		m.earned[i] -= (foodCost + woodCost) / ECONOMY_DT;
		this.eatenFood += ate;
		this.usedWood += burned;
		m.land.dispose(i, ate, USE_FOOD);
		m.land.dispose(i, burned, USE_WOOD);
		this.satFood[i] += this.satBlend * ((wantFood > 0 ? ate / wantFood : 1) - this.satFood[i]);
		this.satWood[i] += this.satBlend * ((wantWood > 0 ? burned / wantWood : 1) - this.satWood[i]);
		const tax = m.towns.townTaxRate(i);
		const ceiling = m.settlements.bidFactor(i) * 0.96;
		const maxFood = m.derived ? (FOOD_BID_VALUE / FOOD_NEED) * tax * ceiling : Infinity;
		const maxWood = m.derived ? (WOOD_BID_VALUE / WOOD_USE) * tax * ceiling : Infinity;
		const young = m.settlements.isYoungTown(i);
		const canFood = this.needFood(i) > 0 && (young || (m.towns.townFoodBid(i) > 0 && m.priceFood[i] <= maxFood));
		const canWood = this.needWood(i) > 0 && (young || (m.towns.townWoodBid(i) > 0 && m.priceWood[i] <= maxWood));
		this.foodFlow.cap[i] = canFood ? Math.max(this.food[i], this.foodTarget(i)) : this.food[i];
		this.woodFlow.cap[i] = canWood ? Math.max(this.wood[i], this.woodTarget(i)) : this.wood[i];
	}

	regrow() {
		const { wild } = this;
		const { foodCap } = this.model.land;
		for (let i = 0; i < ECONOMY_SIZE; i++) wild[i] += this.regrowShare * (foodCap[i] - wild[i]);
	}

	// Still residents with no job pull forage wild food and wood onto nearby cells (paid = 0) without deleting workers.
	harvestFor(i) {
		const m = this.model;
		const needFood = this.needFood(i), needWood = this.needWood(i);
		const want = Math.max(needFood, needWood);
		const work = m.labor[i] * m.laborFlow.still[i] * this.workShare * want;
		if (work <= 1e-9) return;
		const c = this.pick(i);
		if (c < 0) return;
		const foodShare = needFood / (needFood + needWood);
		const food = Math.max(0, Math.min(this.wild[c], work * foodShare * FOOD_PER_WORK, 1 - this.food[c]));
		const wood = Math.max(0, Math.min(m.settlements.forest[c], work * (1 - foodShare) * WOOD_PER_WORK, 1 - this.wood[c]));
		if (food <= 1e-12 && wood <= 1e-12) return;
		this.wild[c] -= food;
		this.food[c] += food;
		m.settlements.forest[c] -= wood;
		this.wood[c] += wood;
		this.harvestedFood += food;
		this.harvestedWood += wood;
	}

	pick(i) {
		const m = this.model;
		const span = 2 * HARVEST_RADIUS + 1;
		this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
		const x = i % ECONOMY_WIDTH + (this.seed >>> 16) % span - HARVEST_RADIUS;
		const y = Math.floor(i / ECONOMY_WIDTH) + (this.seed & 0xffff) % span - HARVEST_RADIUS;
		const c = wrapCell(x, y);
		if (c < 0) return -1;
		if (m.land.terrain[c] === TERRAIN_WATER || (m.actors[c] && c !== i) || m.farms.plotOwner[c]) return -1;
		return c;
	}
}

if (typeof module === 'object') module.exports = { Harvest, FOOD_NEED, WOOD_USE, WOOD_PER_POP };
