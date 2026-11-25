// Owns: commercial farm construction, exclusive farmland, paid crews and seasonal food output.
// Edit for: random clearing visits, humidity yield, food-demand staffing and outside-range waste.
'use strict';

const FARM_RADIUS = 2;
const FARM_SEASON_SECONDS = 7;
const FARM_YIELD = 6;
const FARM_CLEAR_WORK = 0.25;
const FARM_BUILD_WOOD = 1;
const FARM_MIN_PRICE = 0.12;
const FARM_WASTE = 0.0004;

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
	}

	reset() {
		for (const field of [this.plotOwner, this.plots, this.clearWork, this.buildWood, this.clock, this.crewTime, this.cost, this.waste]) field.fill(0);
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
		for (let y = Math.max(0, cy - FARM_RADIUS); y <= Math.min(ECONOMY_HEIGHT - 1, cy + FARM_RADIUS); y++) {
			for (let x = Math.max(0, cx - FARM_RADIUS); x <= Math.min(ECONOMY_WIDTH - 1, cx + FARM_RADIUS); x++) {
				const c = economyIndex(x, y);
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
		return Math.min(25, Math.max(1, Math.ceil(m.priceFood[i] / BASE_RATION_FEE * 12)));
	}

	wageBid(i) {
		const m = this.model;
		const presence = m.shiftCount[i] + m.poolCount[i];
		const room = Math.max(0, 1 - presence / (this.crewTarget(i) + 1));
		const cool = m.money.creditCool(i, Math.max(1, m.priceFood[i] * FARM_YIELD));
		return m.priceFood[i] * FARM_YIELD / (FARM_SEASON_SECONDS * WORK_RATE) * INPUT_SHARE * room / cool;
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
			m.wood[i] -= wood;
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
		if (x < 0 || y < 0 || x >= ECONOMY_WIDTH || y >= ECONOMY_HEIGHT) return;
		const c = economyIndex(x, y);
		if (!this.legalPlot(c, i)) return;
		m.wood[i] += m.settlements.forest[c];
		m.settlements.felled += m.settlements.forest[c];
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
		for (let y = Math.max(0, cy - FARM_RADIUS); y <= Math.min(ECONOMY_HEIGHT - 1, cy + FARM_RADIUS); y++) {
			for (let x = Math.max(0, cx - FARM_RADIUS); x <= Math.min(ECONOMY_WIDTH - 1, cx + FARM_RADIUS); x++) {
				const c = economyIndex(x, y);
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
		// Reservoir sampling keeps edge farms on-map without exempting neighboring farmland.
		let chosen = -1, count = 0;
		for (let dy = -3; dy <= 3; dy++) {
			for (let dx = -3; dx <= 3; dx++) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== 3) continue;
				const x = cx + dx, y = cy + dy;
				if (x < 0 || y < 0 || x >= ECONOMY_WIDTH || y >= ECONOMY_HEIGHT) continue;
				if (this.random(++count) === 0) chosen = economyIndex(x, y);
			}
		}
		if (chosen < 0) return;
		this.waste[chosen] = Math.min(1, this.waste[chosen] + amount);
		this.model.land.refresh();
	}
}

if (typeof module === 'object') module.exports = { FarmSystem, FARM_SEASON_SECONDS, FARM_YIELD };
