// Owns: settlement harvesting — idle residents pick random nearby cells for wild food and wood, harvested stock on the map,
// the town wood/food pull fields, food and wood upkeep, growth wood and hunger. Edit for: harvest pace, needs and buffers.
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

class Harvest {
	constructor(model) {
		this.model = model;
		this.wood = new Float64Array(ECONOMY_SIZE);
		this.food = new Float64Array(ECONOMY_SIZE);
		this.wild = new Float64Array(ECONOMY_SIZE);
		this.priceWood = new Float64Array(ECONOMY_SIZE);
		this.priceFood = new Float64Array(ECONOMY_SIZE);
		this.nextPriceWood = new Float64Array(ECONOMY_SIZE);
		this.nextPriceFood = new Float64Array(ECONOMY_SIZE);
		this.satFood = new Float64Array(ECONOMY_SIZE);
		this.satWood = new Float64Array(ECONOMY_SIZE);
		this.woodFlow = makeScratch(1 << ECONOMY_TOWN, 1, FLOW_RATE);
		this.foodFlow = makeScratch(1 << ECONOMY_TOWN, 1, FLOW_RATE);
		this.satBlend = 1 - Math.exp(-ECONOMY_DT * SAT_RATE);
		this.workShare = 1 - Math.exp(-ECONOMY_DT * HARVEST_STRIDE * HARVEST_RATE);
		this.regrowShare = 1 - Math.exp(-ECONOMY_DT * HARVEST_STRIDE * WILD_REGROW);
	}

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
		return Math.min(1, this.model.pop[i] * FOOD_NEED * FOOD_BUFFER);
	}

	// A young town wants a full cell of wood for its first build; a built one keeps upkeep plus one growth step.
	woodTarget(i) {
		const m = this.model;
		if (m.settlements.isYoungTown(i)) return 1;
		const grow = m.pop[i] < m.settlements.popCap(i) - 0.5 ? WOOD_PER_POP * POP_HEADROOM : 0;
		return Math.min(1, m.pop[i] * WOOD_USE * WOOD_BUFFER + grow);
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

	// Growth and construction draw from the town's own wood stock; returns what was granted.
	takeWood(i, amount) {
		const granted = Math.min(amount, this.wood[i]);
		if (granted <= 0) return 0;
		this.wood[i] -= granted;
		this.builtWood += granted;
		return granted;
	}

	// The pull fields are town need, not gold: harvested stock has no seller and is never billed.
	updatePrices() {
		const { actors } = this.model;
		const { priceWood, priceFood, nextPriceWood, nextPriceFood } = this;
		const decay = this.model.decay ? PRICE_DECAY : 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const town = actors[i] === ECONOMY_TOWN;
			nextPriceWood[i] = stepBid(priceWood, i, priceWood[i], town ? START_PRICE * this.needWood(i) : -1, decay);
			nextPriceFood[i] = stepBid(priceFood, i, priceFood[i], town ? START_PRICE * this.needFood(i) : -1, decay);
		}
		this.priceWood = nextPriceWood;
		this.nextPriceWood = priceWood;
		this.priceFood = nextPriceFood;
		this.nextPriceFood = priceFood;
	}

	step() {
		const m = this.model;
		this.woodFlow.cap.fill(1);
		this.foodFlow.cap.fill(1);
		m.land.blockWater(this.woodFlow.cap);
		m.land.blockWater(this.foodFlow.cap);
		const picking = ++this.ticks % HARVEST_STRIDE === 0;
		if (picking) this.regrow();
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (m.actors[i] !== ECONOMY_TOWN) continue;
			this.useStores(i);
			if (picking) this.harvestFor(i);
		}
	}

	transport() {
		const m = this.model;
		m.transport(this.woodFlow, this.wood, this.priceWood);
		m.transport(this.foodFlow, this.food, this.priceFood);
	}

	useStores(i) {
		const m = this.model;
		const wantFood = m.pop[i] * FOOD_NEED * ECONOMY_DT, wantWood = m.pop[i] * WOOD_USE * ECONOMY_DT;
		const ate = Math.min(this.food[i] * SERVICE_SHARE, wantFood);
		const burned = Math.min(this.wood[i] * SERVICE_SHARE, wantWood);
		this.food[i] -= ate;
		this.wood[i] -= burned;
		this.eatenFood += ate;
		this.usedWood += burned;
		m.land.dispose(i, ate, USE_FOOD);
		m.land.dispose(i, burned, USE_WOOD);
		this.satFood[i] += this.satBlend * ((wantFood > 0 ? ate / wantFood : 1) - this.satFood[i]);
		this.satWood[i] += this.satBlend * ((wantWood > 0 ? burned / wantWood : 1) - this.satWood[i]);
		this.woodFlow.cap[i] = this.needWood(i) > 0 ? Math.max(this.wood[i], this.woodTarget(i)) : this.wood[i];
		this.foodFlow.cap[i] = this.needFood(i) > 0 ? Math.max(this.food[i], this.foodTarget(i)) : this.food[i];
	}

	regrow() {
		const { wild } = this;
		const { foodCap } = this.model.land;
		for (let i = 0; i < ECONOMY_SIZE; i++) wild[i] += this.regrowShare * (foodCap[i] - wild[i]);
	}

	// Only residents with no job pull work the land, and only while stores are short, so harvesting never
	// competes with firms. The harvest lands on the picked cell and walks home along the pull field.
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
		const used = food / FOOD_PER_WORK + wood / WOOD_PER_WORK;
		if (used <= 1e-12) return;
		this.wild[c] -= food;
		this.food[c] += food;
		m.settlements.forest[c] -= wood;
		this.wood[c] += wood;
		this.harvestedFood += food;
		this.harvestedWood += wood;
		this.spend(i, used);
	}

	pick(i) {
		const m = this.model;
		const span = 2 * HARVEST_RADIUS + 1;
		this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
		const x = i % ECONOMY_WIDTH + (this.seed >>> 16) % span - HARVEST_RADIUS;
		const y = Math.floor(i / ECONOMY_WIDTH) + (this.seed & 0xffff) % span - HARVEST_RADIUS;
		if (x < 0 || y < 0 || x >= ECONOMY_WIDTH || y >= ECONOMY_HEIGHT) return -1;
		const c = economyIndex(x, y);
		if (m.land.terrain[c] === TERRAIN_WATER || (m.actors[c] && c !== i)) return -1;
		return c;
	}

	// Harvest is household work: it spends fresh residents' time at home and never queues for paid rest,
	// since charging rent to recover from unpaid work for one's own town drains resident purses.
	spend(i, used) {
		const m = this.model;
		const moved = Math.min(used, m.labor[i]);
		const all = moved >= m.labor[i] - 1e-12;
		const gold = all ? m.laborFlow.gold[i] : m.laborFlow.gold[i] * (moved / m.labor[i]);
		m.labor[i] = all ? 0 : m.labor[i] - moved;
		m.laborFlow.gold[i] = all ? 0 : m.laborFlow.gold[i] - gold;
		m.money.workerPurse[i] += gold;
		m.workedLabor += moved;
	}
}

if (typeof module === 'object') module.exports = { Harvest };
