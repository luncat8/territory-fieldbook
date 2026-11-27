// Owns: commercial farm construction, exclusive farmland, paid crews, seasonal food output and sawmill forestry.
// Edit for: random clearing visits, humidity yield, food-demand staffing, sawmill felling pace and outside-range waste.
'use strict';

const FARM_RADIUS = 2;
const FARM_SEASON_SECONDS = 7;
const FARM_YIELD = 6;
const FARM_CLEAR_WORK = 0.25;
const FARM_BUILD_WOOD = 1;
const FARM_WASTE = 0.0004;
const SAWMILL_RADIUS = 2;
const SAWMILL_GATE = 0.1;
const SAWMILL_RATE = 0.36;
const SAWMILL_LABOR = 0.25;
const SAWMILL_SEARCH_WORK = 0.035;
const SAWMILL_FELL_WORK = 0.16;
const SAWMILL_MIN_FOREST = 0.08;
const SAWMILL_YARD_CAP = 1.6;
const WOOD_PER_FOREST = 1.15;

class FarmSystem {
	constructor(model) {
		this.model = model;
		this.plotOwner = new Int32Array(ECONOMY_SIZE);
		this.plots = new Uint8Array(ECONOMY_SIZE);
		this.clearWork = new Float64Array(ECONOMY_SIZE);
		this.buildWood = new Float64Array(ECONOMY_SIZE);
		this.clock = new Float64Array(ECONOMY_SIZE);
		this.crewTime = new Float64Array(ECONOMY_SIZE);
		this.cost = new Float64Array(ECONOMY_SIZE);
		this.waste = new Float64Array(ECONOMY_SIZE);
		this.sawAcc = new Float64Array(ECONOMY_SIZE);
		this.sawCost = new Float64Array(ECONOMY_SIZE);
	}

	reset() {
		for (const field of [this.plotOwner, this.plots, this.clearWork, this.buildWood, this.clock, this.crewTime, this.cost, this.waste, this.sawAcc, this.sawCost]) field.fill(0);
		this.seed = 731;
		this.harvests = 0;
	}

	random(n) {
		this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0;
		return Math.floor(this.seed / 4294967296 * n);
	}

	quality(i) {
		const land = this.model.land;
		if (land.terrain[i] === TERRAIN_WATER) return 0;
		const d = (land.moisture[i] - 0.6) / 0.3;
		return Math.max(0, 1 - d * d) * (1 - land.waste[i]);
	}

	legalPlot(i, farm) {
		const m = this.model;
		return (!m.actors[i] || i === farm) && !m.forage.plotOwner[i] && !this.plotOwner[i]
			&& m.land.terrain[i] !== TERRAIN_WATER && m.land.waste[i] < 0.2;
	}

	canSite(i) {
		const m = this.model;
		const cx = i % ECONOMY_WIDTH, cy = Math.floor(i / ECONOMY_WIDTH);
		let forest = 0, quality = 0, cells = 0;
		for (let y = cy - FARM_RADIUS, yEnd = cy + FARM_RADIUS; y <= yEnd; y++) {
			const wy = MAP_WRAP ? wrapY(y) : y;
			if (wy < 0 || wy >= ECONOMY_HEIGHT) continue;
			for (let x = cx - FARM_RADIUS, xEnd = cx + FARM_RADIUS; x <= xEnd; x++) {
				const wx = MAP_WRAP ? wrapX(x) : x;
				if (wx < 0 || wx >= ECONOMY_WIDTH) continue;
				const c = economyIndex(wx, wy);
				if (!this.legalPlot(c, i)) continue;
				forest += m.settlements.forest[c];
				quality += this.quality(c);
				cells++;
			}
		}
		return cells >= 3 && quality / cells >= 0.35 && (forest >= FARM_BUILD_WOOD || m.wood[i] >= FARM_BUILD_WOOD);
	}

	init(i) {
		this.model.founding.building[i] = 1;
		this.model.founding.buildProgress[i] = 0;
	}

	release(i) {
		for (let c = 0; c < ECONOMY_SIZE; c++) if (this.plotOwner[c] === i + 1) this.plotOwner[c] = 0;
		this.plots[i] = this.clearWork[i] = this.buildWood[i] = this.clock[i] = this.crewTime[i] = this.cost[i] = 0;
	}

	crewTarget(i) {
		const m = this.model;
		return Math.min(25, Math.max(1, Math.ceil(m.priceFood[i] / Math.max(1e-12, BASE_RATION_FEE * m.towns.walletMean() / WALLET_PRICE_REFERENCE) * 12)));
	}

	wageBid(i) {
		const m = this.model;
		const presence = m.shiftCount[i] + m.poolCount[i];
		const room = Math.max(0, 1 - presence / (this.crewTarget(i) + 1));
		const cool = m.money.creditCool(i, Math.max(1e-12, m.priceFood[i] * FARM_YIELD));
		return Math.min(m.money.cash(i) / this.crewTarget(i), m.priceFood[i] * FARM_YIELD / (FARM_SEASON_SECONDS * WORK_RATE) * INPUT_SHARE * room / cool);
	}

	// Farms bid for construction wood only while their founding build is unfinished; cooling follows wage discipline.
	woodBid(i) {
		const m = this.model;
		const need = Math.max(0, FARM_BUILD_WOOD - this.buildWood[i]);
		if (need <= 0 || !m.founding.isBuilding(i)) return 0;
		const cool = m.money.creditCool(i, Math.max(1e-12, m.priceFood[i] * FARM_YIELD));
		return Math.min(m.money.cash(i) / FARM_BUILD_WOOD, optimalBid(m.derived ? m.priceFood[i] * FARM_YIELD / FARM_BUILD_WOOD : START_PRICE, m.wood[i] + m.goodsPool.buyerQueue[ITEM_WOOD][i], FARM_BUILD_WOOD, cool, m.suppression, INPUT_SHARE));
	}

	forestShare(i) {
		return this.model.settlements.sumAround(this.model.settlements.forest, i) / 25;
	}

	// 0..1 room for sawmill hiring/scale: full room at ~40% forest cover, gone at 2%.
	forestRoom(i) {
		return Math.min(1, this.forestShare(i) * 2.5);
	}

	// Sawmill shifts accumulate paid work; each search budget sends one random felling visit whose output enters the yard.
	stepSawmill(i, recipe) {
		const m = this.model;
		const scale = m.scale[i] || 1;
		const outCap = Math.max(0.35, recipe.rate * scale * BUFFER_SECONDS * 1.5);
		const canCut = m.goodsPool.count < MAX_GOODS_PARTICLES && m.priceWood[i] > (m.derived ? 0 : recipe.gate) && m.goodsPool.spawnAmount[recipe.outItem][i] < outCap && this.forestShare(i) > 0.02;
		const used = canCut ? Math.min(m.shiftAvail[i], recipe.rate * SAWMILL_LABOR * scale * ECONOMY_DT) : 0;
		if (used > 0) {
			const onSiteFresh = Math.max(used, m.labor[i]);
			const share = onSiteFresh > 0 ? Math.min(1, used / onSiteFresh) : 1;
			const wageSlice = m.optimizer.laborCost[i] * share;
			m.optimizer.laborCost[i] = Math.max(0, m.optimizer.laborCost[i] - wageSlice);
			this.sawCost[i] += wageSlice;
			m.workers.applyShiftWork(i, used);
			this.sawAcc[i] += used;
			if (this.sawAcc[i] >= SAWMILL_SEARCH_WORK) this.fellVisit(i);
		}
		m.workLoad[i] += m.optimizer.occBlend * (used / ECONOMY_DT - m.workLoad[i]);
		const yard = m.goodsPool.spawnAmount[recipe.outItem][i];
		const unitCost = yard > 1e-9 ? m.goodsPool.spawnCost[recipe.outItem][i] / yard : 0;
		m.goodsPool.sellFloor[recipe.outItem][i] = m.derived ? unitCost * (1 + SELL_MARGIN) : recipe.gate;
	}

	// Harvest location is physical; the stable mill owner remains the payee.
	fellVisit(i) {
		const m = this.model;
		this.sawAcc[i] -= SAWMILL_SEARCH_WORK;
		const c = wrapCell(i % ECONOMY_WIDTH + this.random(5) - SAWMILL_RADIUS, Math.floor(i / ECONOMY_WIDTH) + this.random(5) - SAWMILL_RADIUS);
		if (c < 0) return;
		if (m.land.terrain[c] === TERRAIN_WATER || (m.actors[c] && c !== i) || m.farms.plotOwner[c] || m.forage.plotOwner[c]) return;
		const cover = m.settlements.forest[c];
		if (cover < SAWMILL_MIN_FOREST || m.goodsPool.count >= MAX_GOODS_PARTICLES) return;
		const felled = Math.min(cover, SAWMILL_YARD_CAP / WOOD_PER_FOREST);
		const made = felled * WOOD_PER_FOREST;
		m.settlements.forest[c] -= felled;
		m.settlements.felled += felled;
		this.sawAcc[i] -= felled * SAWMILL_FELL_WORK;
		const cost = this.sawCost[i];
		this.sawCost[i] = 0;
		m.goodsPool.emit(ITEM_WOOD, c, made, cost, i);
		m.producedWood += made;
	}

	step() {
		const m = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (m.actors[i] !== ECONOMY_FARM) continue;
			const work = m.shiftAvail[i];
			if (work > 0) {
				const share = Math.min(1, work / Math.max(work, m.labor[i]));
				const cost = m.optimizer.laborCost[i] * share;
				m.optimizer.laborCost[i] -= cost;
				this.cost[i] += cost;
				m.workers.applyShiftWork(i, work);
				this.clearWork[i] += work;
				while (this.clearWork[i] >= FARM_CLEAR_WORK) {
					this.clearWork[i] -= FARM_CLEAR_WORK;
					if (this.plots[i] < this.crewTarget(i)) this.clearVisit(i);
				}
			}
			const wood = Math.min(m.wood[i], Math.max(0, FARM_BUILD_WOOD - this.buildWood[i]));
			m.goodsPool.cap[ITEM_WOOD][i] = this.woodBid(i) > 0 ? Math.max(m.wood[i], FARM_BUILD_WOOD) : m.wood[i];
			if (wood > 0) {
				const old = m.wood[i];
				const costBuf = m.goodsPool.stockCost[ITEM_WOOD];
				m.wood[i] = Math.max(0, old - wood);
				costBuf[i] = m.wood[i] > 1e-12 ? Math.max(0, costBuf[i] * (m.wood[i] / old)) : 0;
				m.consumedWood += wood;
			}
			this.buildWood[i] += wood;
			m.founding.buildProgress[i] = Math.min(1, this.buildWood[i] / FARM_BUILD_WOOD);
			if (m.founding.isBuilding(i)) {
				if (this.buildWood[i] < FARM_BUILD_WOOD || this.plots[i] === 0) continue;
				m.founding.building[i] = 0;
				m.founding.completed++;
			}
			this.crewTime[i] += work / WORK_RATE;
			this.clock[i] += ECONOMY_DT;
			if (this.clock[i] >= FARM_SEASON_SECONDS) this.harvest(i);
		}
	}

	clearVisit(i) {
		const m = this.model;
		const x = i % ECONOMY_WIDTH + this.random(5) - FARM_RADIUS;
		const y = Math.floor(i / ECONOMY_WIDTH) + this.random(5) - FARM_RADIUS;
		const c = wrapCell(x, y);
		if (c < 0) return;
		if (!this.legalPlot(c, i)) return;
		m.wood[i] += m.settlements.forest[c];
		m.settlements.felled += m.settlements.forest[c];
		m.producedWood += m.settlements.forest[c];
		m.settlements.forest[c] = 0;
		this.plotOwner[c] = i + 1;
		this.plots[i]++;
	}

	harvest(i) {
		const m = this.model;
		const crew = Math.min(this.plots[i], this.crewTime[i] / FARM_SEASON_SECONDS);
		const share = this.plots[i] ? crew / this.plots[i] : 0;
		const cx = i % ECONOMY_WIDTH, cy = Math.floor(i / ECONOMY_WIDTH);
		let food = 0;
		for (let y = cy - FARM_RADIUS, yEnd = cy + FARM_RADIUS; y <= yEnd; y++) {
			const wy = MAP_WRAP ? wrapY(y) : y;
			if (wy < 0 || wy >= ECONOMY_HEIGHT) continue;
			for (let x = cx - FARM_RADIUS, xEnd = cx + FARM_RADIUS; x <= xEnd; x++) {
				const wx = MAP_WRAP ? wrapX(x) : x;
				if (wx < 0 || wx >= ECONOMY_WIDTH) continue;
				const c = economyIndex(wx, wy);
				if (this.plotOwner[c] === i + 1) food += FARM_YIELD * this.quality(c) * share;
			}
		}
		if (food > 0) {
			m.goodsPool.produce(ITEM_FOOD, i, food, this.cost[i]);
			m.producedFood += food;
			this.cost[i] = 0;
			this.pushWaste(i, food * FARM_WASTE);
			this.harvests++;
		}
		this.clock[i] -= FARM_SEASON_SECONDS;
		this.crewTime[i] = 0;
	}

	pushWaste(i, amount) {
		const cx = i % ECONOMY_WIDTH, cy = Math.floor(i / ECONOMY_WIDTH);
		// Reservoir sampling keeps edge farms on-map (wrapping on a torus) without exempting neighboring farmland.
		let chosen = -1, count = 0;
		for (let dy = -3; dy <= 3; dy++) {
			for (let dx = -3; dx <= 3; dx++) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== 3) continue;
				const c = wrapCell(cx + dx, cy + dy);
				if (c < 0) continue;
				if (this.random(++count) === 0) chosen = c;
			}
		}
		if (chosen < 0) return;
		this.waste[chosen] = Math.min(1, this.waste[chosen] + amount);
		this.model.land.refresh();
	}
}

if (typeof module === 'object') module.exports = { FarmSystem, FARM_SEASON_SECONDS, FARM_YIELD };
