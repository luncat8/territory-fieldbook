// Owns: land-working companies — sawmills felling random forest cells into wood and farms tilling plots for seasonal food harvests.
// Edit for: patch radius, felling/clearing visits, moisture crop yield, seasonal batch harvest and outside-range farm waste.
'use strict';

const SAWMILL_RADIUS = 2;
const SAWMILL_GATE = 0.1;
const SAWMILL_RATE = 0.36;
const SAWMILL_LABOR = 0.25;
const SAWMILL_SEARCH_WORK = 0.035;
const SAWMILL_FELL_WORK = 0.16;
const WOOD_PER_FOREST = 1.15;
const SAWMILL_MIN_FOREST = 0.08;
const SAWMILL_YARD_CAP = 1.6;
const SAWMILL_LITTER = 0.012;

const FARM_RADIUS = 2;
const FARM_GATE = 0.1;
const FARM_SEASON_SECONDS = 7;
const FARM_RATE = 0.34;
const FARM_LABOR = 0.25;
const FARM_CLEAR_WORK = 0.05;
const FARM_PLOT_WORK = 0.06;
const FARM_PLOT_YIELD = 0.38;
const FARM_MAX_PLOTS = 10;
const FARM_MAX_DISTURB = 0.2;
const FARM_WASTE = 0.015;
const FARM_MOIST_OPT = 0.6;
const FARM_MOIST_WIDTH = 0.38;

class LandFirms {
	constructor(model) {
		this.model = model;
		this.occBlend = 1 - Math.exp(-ECONOMY_DT * OCCUPANCY_RATE);
		this.plotOwner = new Int32Array(ECONOMY_SIZE);
		this.plots = new Uint8Array(ECONOMY_SIZE);
		this.workAcc = new Float64Array(ECONOMY_SIZE);
		this.workCost = new Float64Array(ECONOMY_SIZE);
		this.clearWork = new Float64Array(ECONOMY_SIZE);
		this.clock = new Float64Array(ECONOMY_SIZE);
		this.cropWork = new Float64Array(ECONOMY_SIZE);
		this.cropCost = new Float64Array(ECONOMY_SIZE);
		this.lastAsk = new Float64Array(ECONOMY_SIZE);
		this.reset();
	}

	reset() {
		for (const f of [this.plotOwner, this.plots, this.workAcc, this.workCost, this.clearWork, this.clock, this.cropWork, this.cropCost, this.lastAsk]) f.fill(0);
		this.seed = 0x51f2d39b;
		this.producedWood = this.producedFood = this.harvests = 0;
	}

	syncActors() {
		const { actors } = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const owner = this.plotOwner[i] - 1;
			if (owner >= 0 && actors[owner] !== ECONOMY_FARM) this.plotOwner[i] = 0;
		}
	}

	placed(i, kind) {
		if (kind) return;
		this.release(i);
		this.workAcc[i] = this.workCost[i] = this.clearWork[i] = this.clock[i] = this.cropWork[i] = this.cropCost[i] = this.lastAsk[i] = 0;
	}

	release(i) {
		for (let c = 0; c < ECONOMY_SIZE; c++) {
			if (this.plotOwner[c] === i + 1) this.plotOwner[c] = 0;
		}
		this.plots[i] = 0;
	}

	rand(n) {
		this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
		return Math.floor((this.seed / 4294967296) * n);
	}

	askAt(i) {
		const m = this.model, flow = m.actors[i] === ECONOMY_SAWMILL ? m.woodFlow : m.foodFlow;
		return flow.sell[i] > 0 ? flow.sell[i] : this.lastAsk[i];
	}

	// Patch saturation cools hire bids when uncollected stock fills the yard or a sawmill has felled its patch.
	sellRoom(i, actor) {
		const m = this.model;
		if (!m.suppression) return 1;
		if (actor === ECONOMY_SAWMILL) {
			const cover = this.forestShare(i);
			if (cover <= 0.02) return 0;
			return Math.min(1, cover * 2.5) * Math.max(0, 1 - this.patchPaid(i, m.woodFlow, SAWMILL_RADIUS) / SAWMILL_YARD_CAP);
		}
		const cap = Math.max(0.6, this.wantPlots(i) * FARM_PLOT_YIELD * 0.85);
		return Math.max(0, 1 - this.patchPaid(i, m.foodFlow, FARM_RADIUS) / cap);
	}

	patchPaid(i, flow, radius) {
		const cx = i % ECONOMY_WIDTH, cy = Math.floor(i / ECONOMY_WIDTH);
		let sum = 0;
		for (let y = Math.max(0, cy - radius); y <= Math.min(ECONOMY_HEIGHT - 1, cy + radius); y++) {
			for (let x = Math.max(0, cx - radius); x <= Math.min(ECONOMY_WIDTH - 1, cx + radius); x++) sum += flow.paid[economyIndex(x, y)];
		}
		return sum;
	}

	forestShare(i) {
		const { forest } = this.model.settlements;
		const cx = i % ECONOMY_WIDTH, cy = Math.floor(i / ECONOMY_WIDTH);
		let sum = 0, cells = 0;
		for (let y = Math.max(0, cy - SAWMILL_RADIUS); y <= Math.min(ECONOMY_HEIGHT - 1, cy + SAWMILL_RADIUS); y++) {
			for (let x = Math.max(0, cx - SAWMILL_RADIUS); x <= Math.min(ECONOMY_WIDTH - 1, cx + SAWMILL_RADIUS); x++) {
				sum += forest[economyIndex(x, y)];
				cells++;
			}
		}
		return cells > 0 ? sum / cells : 0;
	}

	quality(c) {
		const { land } = this.model, t = land.terrain[c];
		if (t === TERRAIN_WATER || t === TERRAIN_SWAMP || t === TERRAIN_DESERT) return 0;
		const d = (land.moisture[c] - FARM_MOIST_OPT) / FARM_MOIST_WIDTH;
		return Math.max(0, 1 - d * d) * (1 - land.waste[c]) * (1 - land.litter[c]);
	}

	wantPlots(i) {
		const m = this.model;
		const price = m.derived ? m.priceFood[i] : START_PRICE;
		const scale = m.scale[i] || 1;
		return Math.min(FARM_MAX_PLOTS, Math.max(1, Math.round((1 + (price / START_PRICE) * 5) * scale)));
	}

	// Consumes shift labor into depleted workers with carried pocket gold, returning [usedLabor, usedCost].
	workShift(i, maxWork) {
		const m = this.model;
		const avail = m.labor[i];
		const used = Math.min(maxWork, avail, 1 - m.depleted[i]);
		if (used <= 1e-12) return 0;
		const ratio = Math.min(1, used / avail);
		const usedCost = m.laborFlow.cost[i] * ratio;
		const carriedGold = m.laborFlow.gold[i] * ratio;
		m.labor[i] = Math.max(0, avail - used);
		m.laborFlow.cost[i] = m.labor[i] > 1e-12 ? Math.max(0, m.laborFlow.cost[i] - usedCost) : 0;
		m.laborFlow.gold[i] = Math.max(0, m.laborFlow.gold[i] - carriedGold);
		m.depletedFlow.gold[i] += carriedGold;
		if (m.labor[i] <= 1e-12 && m.laborFlow.gold[i] > 0) {
			m.depletedFlow.gold[i] += m.laborFlow.gold[i];
			m.laborFlow.gold[i] = 0;
		}
		m.workedLabor += used;
		m.depleted[i] += used;
		m.emittedDepleted += used;
		this.lastShiftCost = usedCost;
		return used;
	}

	updateLaborCap(i, recipe) {
		const m = this.model, opt = m.optimizer;
		opt.firmBids(i, recipe);
		const stock = m.labor[i];
		const target = opt.firmLaborPool(i, recipe);
		const canBuy = opt.bidOut[0] > 0 && m.priceLabor[i] <= opt.maxOut[0];
		m.laborFlow.cap[i] = canBuy ? Math.max(stock, target) : stock;
	}

	placePaid(flow, stock, c, owner, made, cost, gate) {
		stock[c] += made;
		flow.paid[c] += made;
		flow.cost[c] += cost;
		flow.owner[c] = owner;
		const unitCost = flow.paid[c] > 1e-9 ? flow.cost[c] / flow.paid[c] : 0;
		const ask = this.model.derived ? Math.max(gate, unitCost * (1 + SELL_MARGIN)) : gate;
		flow.sell[c] = Math.max(flow.sell[c], ask);
		this.lastAsk[owner] = flow.sell[c];
	}

	// Sawmills pick one random cell per search visit; a miss costs the search, a hit fells the cell's forest into wood.
	stepSawmill(i, recipe) {
		const m = this.model;
		const scale = m.scale[i] || 1;
		const canCut = m.priceWood[i] > SAWMILL_GATE && this.sellRoom(i, ECONOMY_SAWMILL) > 0.02;
		const used = canCut ? this.workShift(i, SAWMILL_RATE * SAWMILL_LABOR * scale * ECONOMY_DT) : 0;
		if (used > 0) {
			this.workAcc[i] += used;
			this.workCost[i] += this.lastShiftCost;
			if (this.workAcc[i] >= SAWMILL_SEARCH_WORK) this.fellVisit(i);
		}
		m.workLoad[i] += this.occBlend * (used / ECONOMY_DT - m.workLoad[i]);
		this.updateLaborCap(i, recipe);
	}

	fellVisit(i) {
		const m = this.model;
		this.workAcc[i] -= SAWMILL_SEARCH_WORK;
		const span = 2 * SAWMILL_RADIUS + 1;
		const x = i % ECONOMY_WIDTH + this.rand(span) - SAWMILL_RADIUS;
		const y = Math.floor(i / ECONOMY_WIDTH) + this.rand(span) - SAWMILL_RADIUS;
		if (x < 0 || y < 0 || x >= ECONOMY_WIDTH || y >= ECONOMY_HEIGHT) return;
		const c = economyIndex(x, y);
		if (m.land.terrain[c] === TERRAIN_WATER || (m.actors[c] && c !== i) || this.plotOwner[c]) return;
		const cover = m.settlements.forest[c];
		if (cover < SAWMILL_MIN_FOREST || m.wood[c] > 0.9 || m.priceWood[c] <= SAWMILL_GATE) return;
		const felled = Math.min(cover, (1 - m.wood[c]) / WOOD_PER_FOREST);
		if (felled <= 1e-9) return;
		const made = felled * WOOD_PER_FOREST;
		m.settlements.forest[c] -= felled;
		this.workAcc[i] -= felled * SAWMILL_FELL_WORK;
		const cost = this.workCost[i];
		this.workCost[i] = 0;
		this.placePaid(m.woodFlow, m.wood, c, i, made, cost, SAWMILL_GATE);
		m.harvest.harvestedWood += made;
		this.producedWood += made;
		m.land.addLitter(c, made * SAWMILL_LITTER);
	}

	// Farms clear plots up to food-demand staffing and always harvest their tended field every FARM_SEASON_SECONDS.
	stepFarm(i, recipe) {
		const m = this.model;
		const goalPlots = this.wantPlots(i);
		const activePlots = Math.max(1, Math.max(this.plots[i], Math.min(goalPlots, this.plots[i] + 1)));
		const maxWork = (activePlots * FARM_PLOT_WORK / FARM_SEASON_SECONDS) * ECONOMY_DT * 1.35;
		const used = this.workShift(i, maxWork);
		if (used > 0) {
			const tendNeed = (this.plots[i] * FARM_PLOT_WORK / FARM_SEASON_SECONDS) * ECONOMY_DT;
			const tendWork = Math.min(used, Math.max(0, tendNeed));
			const extra = used - tendWork;
			const extraShare = used > 0 ? extra / used : 0;
			this.cropWork[i] += tendWork + (this.plots[i] >= goalPlots ? extra : 0);
			this.cropCost[i] += this.lastShiftCost * (this.plots[i] >= goalPlots ? 1 : 1 - extraShare);
			if (this.plots[i] < goalPlots && extra > 0) {
				this.clearWork[i] += extra;
				this.workCost[i] += this.lastShiftCost * extraShare;
				while (this.clearWork[i] >= FARM_CLEAR_WORK && this.plots[i] < goalPlots) {
					this.clearWork[i] -= FARM_CLEAR_WORK;
					this.clearVisit(i);
				}
			}
		}
		this.clock[i] += ECONOMY_DT;
		if (this.clock[i] >= FARM_SEASON_SECONDS) this.harvestSeason(i);
		m.workLoad[i] += this.occBlend * (used / ECONOMY_DT - m.workLoad[i]);
		this.updateLaborCap(i, recipe);
	}

	legalPlot(c) {
		const m = this.model, t = m.land.terrain[c];
		if (t === TERRAIN_WATER || t === TERRAIN_SWAMP || t === TERRAIN_DESERT) return false;
		return !m.actors[c] && !this.plotOwner[c] && m.land.waste[c] + m.land.litter[c] < FARM_MAX_DISTURB;
	}

	// Clearing a farm plot never deletes forest to nothing: felled trees turn into wood on that cell.
	clearVisit(i) {
		const m = this.model;
		const span = 2 * FARM_RADIUS + 1;
		const x = i % ECONOMY_WIDTH + this.rand(span) - FARM_RADIUS;
		const y = Math.floor(i / ECONOMY_WIDTH) + this.rand(span) - FARM_RADIUS;
		if (x < 0 || y < 0 || x >= ECONOMY_WIDTH || y >= ECONOMY_HEIGHT) return;
		const c = economyIndex(x, y);
		if (!this.legalPlot(c)) return;
		const felled = m.settlements.forest[c];
		if (felled > 1e-9) {
			const made = Math.min(1 - m.wood[c], felled * WOOD_PER_FOREST);
			m.settlements.forest[c] = 0;
			if (made > 1e-9) {
				m.wood[c] += made;
				m.harvest.harvestedWood += made;
			}
		}
		this.cropCost[i] += this.workCost[i];
		this.workCost[i] = 0;
		this.plotOwner[c] = i + 1;
		this.plots[i]++;
	}

	harvestSeason(i) {
		const m = this.model;
		this.clock[i] -= FARM_SEASON_SECONDS;
		const count = this.plots[i];
		const tended = count > 0 ? Math.min(1, this.cropWork[i] / (count * FARM_PLOT_WORK)) : 0;
		const seasonCost = this.cropCost[i];
		this.cropWork[i] = 0;
		if (count <= 0 || tended <= 1e-9) return;

		const cx = i % ECONOMY_WIDTH, cy = Math.floor(i / ECONOMY_WIDTH);
		let potential = 0;
		for (let y = Math.max(0, cy - FARM_RADIUS); y <= Math.min(ECONOMY_HEIGHT - 1, cy + FARM_RADIUS); y++) {
			for (let x = Math.max(0, cx - FARM_RADIUS); x <= Math.min(ECONOMY_WIDTH - 1, cx + FARM_RADIUS); x++) {
				const c = economyIndex(x, y);
				if (this.plotOwner[c] === i + 1) potential += Math.min(1 - m.food[c], FARM_PLOT_YIELD * this.quality(c) * tended);
			}
		}
		if (potential <= 1e-9) return;
		this.cropCost[i] = 0;
		let totalFood = 0;
		for (let y = Math.max(0, cy - FARM_RADIUS); y <= Math.min(ECONOMY_HEIGHT - 1, cy + FARM_RADIUS); y++) {
			for (let x = Math.max(0, cx - FARM_RADIUS); x <= Math.min(ECONOMY_WIDTH - 1, cx + FARM_RADIUS); x++) {
				const c = economyIndex(x, y);
				if (this.plotOwner[c] !== i + 1) continue;
				const made = Math.min(1 - m.food[c], FARM_PLOT_YIELD * this.quality(c) * tended);
				if (made <= 1e-9) continue;
				this.placePaid(m.foodFlow, m.food, c, i, made, seasonCost * (made / potential), FARM_GATE);
				totalFood += made;
			}
		}
		if (totalFood <= 0) return;
		m.harvest.harvestedFood += totalFood;
		this.producedFood += totalFood;
		this.harvests++;
		this.pushRingWaste(i, totalFood * FARM_WASTE);
	}

	// Farm waste lands on one random walkable cell just outside its 5x5 range (Chebyshev distance 3).
	pushRingWaste(i, amount) {
		const cx = i % ECONOMY_WIDTH, cy = Math.floor(i / ECONOMY_WIDTH);
		const ring = FARM_RADIUS + 1;
		let chosen = -1, seen = 0;
		for (let dy = -ring; dy <= ring; dy++) {
			for (let dx = -ring; dx <= ring; dx++) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
				const x = cx + dx, y = cy + dy;
				if (x < 0 || y < 0 || x >= ECONOMY_WIDTH || y >= ECONOMY_HEIGHT) continue;
				const c = economyIndex(x, y);
				if (this.model.land.terrain[c] === TERRAIN_WATER) continue;
				if (this.rand(++seen) === 0) chosen = c;
			}
		}
		if (chosen >= 0) this.model.land.addLitter(chosen, amount);
	}
}

if (typeof module === 'object') module.exports = { LandFirms, SAWMILL_RADIUS, FARM_RADIUS, FARM_SEASON_SECONDS };
