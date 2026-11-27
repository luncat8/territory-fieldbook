// Owns: settlement tiers, forest stock, worker settle intent, the settler gather grid, young-town founding and forest build.
// Edit for: intent pace, founding threshold, forest-felling build and tier floors on rest, tax, bids and rooms.
'use strict';

const FOUND_RADIUS = 2;
const FOUND_REACH = 0.25;
const FOUND_SETTLERS = 3.2;
const INTENT_SECONDS = 3;
const FOUND_COOLDOWN_TICKS = 300;
const WOOD_TIER_CAP = 0.5;
const WOOD_PER_TIER = 5;
const BUILD_RATE = 0.35;
const TIER_RATE = 0.05;
const FOREST_REGROW = 0.004;
const TIER_REST_FLOOR = 0.35;
const TIER_TAX_FLOOR = 0.4;
const TIER_BID_FLOOR = 0.35;
const TIER_POP_FLOOR = 0.35;

class Settlements {
	constructor(model) {
		this.model = model;
		this.tier = new Float64Array(ECONOMY_SIZE);
		this.forest = new Float64Array(ECONOMY_SIZE);
		this.forestCap = new Float64Array(ECONOMY_SIZE);
		this.gather = new Float64Array(ECONOMY_SIZE);
		this.cellIntent = new Float64Array(ECONOMY_SIZE);
		this.intentStep = ECONOMY_DT / INTENT_SECONDS;
		this.regrowShare = 1 - Math.exp(-ECONOMY_DT * FOREST_REGROW);
		this.buildShare = 1 - Math.exp(-ECONOMY_DT * BUILD_RATE);
		this.seedForest();
	}

	seedForest() {
		this.forestCap.set(this.model.land.woodland);
	}

	reset() {
		const { actors } = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) this.tier[i] = actors[i] === ECONOMY_TOWN ? 1 : 0;
		this.forest.set(this.forestCap);
		this.gather.fill(0);
		this.cellIntent.fill(0);
		this.model.land.refresh();
		this.ticks = this.founded = this.felled = 0;
		this.lastFound = -FOUND_COOLDOWN_TICKS;
		this.bestSite = -1;
		this.bestScore = FOUND_SETTLERS;
		this.pledged = false;
	}

	placed(i, kind) {
		this.tier[i] = kind === ECONOMY_TOWN ? 1 : 0;
		this.model.land.refresh();
	}

	isYoungTown(i) {
		return this.model.actors[i] === ECONOMY_TOWN && this.tier[i] < WOOD_TIER_CAP;
	}

	tierLerp(i, floor) { return floor + (1 - floor) * this.tier[i]; }
	restFactor(i) { return this.tierLerp(i, TIER_REST_FLOOR) * this.model.land.rest[i]; }
	taxFactor(i) { return this.tierLerp(i, TIER_TAX_FLOOR); }
	bidFactor(i) { return this.tierLerp(i, TIER_BID_FLOOR); }
	popCap(i) { return POP_MAX * this.tierLerp(i, TIER_POP_FLOOR); }

	step() {
		const m = this.model, { workers, forage } = m;
		const open = ++this.ticks - this.lastFound >= FOUND_COOLDOWN_TICKS;
		if (this.pledged) this.gather.fill(0);
		this.cellIntent.fill(0);
		this.bestSite = -1;
		this.bestScore = FOUND_SETTLERS;
		this.pledged = false;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (!forage.plotOwner[i] && !m.farms.plotOwner[i]) this.forest[i] += this.regrowShare * (this.forestCap[i] - this.forest[i]);
			if (m.actors[i] === ECONOMY_TOWN && this.tier[i] < 1) this.growTier(i);
		}
		for (let w = 0; w < workers.count; w++) {
			const c = workers.cell[w];
			const eligible = workers.state[w] === WORKER_STILL && workers.tired[w] > 1e-4 && !m.actors[c];
			const reach = m.priceHome[c] + m.priceRest[c];
			const goal = eligible ? Math.max(0, 1 - reach / FOUND_REACH) : 0;
			workers.intent[w] = Math.min(1, Math.max(0, workers.intent[w] + this.intentStep * (2 * goal - 1)));
			if (workers.intent[w] > this.cellIntent[c]) this.cellIntent[c] = workers.intent[w];
			if (eligible && workers.intent[w] >= 1 && open) this.pledge(c, workers.amount[w]);
		}
		if (this.bestSite >= 0) this.foundTown(this.bestSite);
	}

	pledge(i, amount) {
		const { actors, land } = this.model;
		const cx = i % ECONOMY_WIDTH, cy = Math.floor(i / ECONOMY_WIDTH);
		this.pledged = true;
		for (let y = cy - FOUND_RADIUS, yEnd = cy + FOUND_RADIUS; y <= yEnd; y++) {
			const wy = MAP_WRAP ? wrapY(y) : y;
			if (wy < 0 || wy >= ECONOMY_HEIGHT) continue;
			for (let x = cx - FOUND_RADIUS, xEnd = cx + FOUND_RADIUS; x <= xEnd; x++) {
				const wx = MAP_WRAP ? wrapX(x) : x;
				if (wx < 0 || wx >= ECONOMY_WIDTH) continue;
				const n = economyIndex(wx, wy);
				this.gather[n] += amount;
				const score = this.gather[n] * land.site[n];
				if (actors[n] || this.model.farms.plotOwner[n] || this.model.forage.plotOwner[n] || score <= this.bestScore) continue;
				this.bestScore = score;
				this.bestSite = n;
			}
		}
	}

	growTier(i) {
		if (this.tier[i] < WOOD_TIER_CAP) {
			this.buildFromForest(i);
			return;
		}
		const goal = WOOD_TIER_CAP + (1 - WOOD_TIER_CAP) * this.model.workforce.comfortAt(i);
		if (goal > this.tier[i]) this.tier[i] = Math.min(1, this.tier[i] + ECONOMY_DT * TIER_RATE * (goal - this.tier[i]));
	}

	// Resting occupants and idle town workers fell surrounding woodland into the young town's first half-tier.
	buildFromForest(i) {
		const m = this.model;
		const builders = m.roomCount[i] * 0.45 + m.stillFresh[i];
		if (builders <= 1e-6) return;
		const availWood = this.sumAround(this.forest, i);
		const wood = Math.min(builders * this.buildShare, availWood, (WOOD_TIER_CAP - this.tier[i]) * WOOD_PER_TIER);
		if (wood <= 1e-12) return;
		this.fellAround(i, wood);
		this.tier[i] = Math.min(WOOD_TIER_CAP, this.tier[i] + wood / WOOD_PER_TIER);
		this.felled += wood;
	}

	sumAround(field, i) {
		const cx = i % ECONOMY_WIDTH, cy = Math.floor(i / ECONOMY_WIDTH);
		let total = 0;
		for (let y = cy - FOUND_RADIUS, yEnd = cy + FOUND_RADIUS; y <= yEnd; y++) {
			const wy = MAP_WRAP ? wrapY(y) : y;
			if (wy < 0 || wy >= ECONOMY_HEIGHT) continue;
			for (let x = cx - FOUND_RADIUS, xEnd = cx + FOUND_RADIUS; x <= xEnd; x++) {
				const wx = MAP_WRAP ? wrapX(x) : x;
				if (wx < 0 || wx >= ECONOMY_WIDTH) continue;
				total += field[economyIndex(wx, wy)];
			}
		}
		return total;
	}

	fellAround(i, wood) {
		const total = this.sumAround(this.forest, i);
		if (total <= 1e-12) return;
		const share = Math.min(1, wood / total);
		const cx = i % ECONOMY_WIDTH, cy = Math.floor(i / ECONOMY_WIDTH);
		for (let y = cy - FOUND_RADIUS, yEnd = cy + FOUND_RADIUS; y <= yEnd; y++) {
			const wy = MAP_WRAP ? wrapY(y) : y;
			if (wy < 0 || wy >= ECONOMY_HEIGHT) continue;
			for (let x = cx - FOUND_RADIUS, xEnd = cx + FOUND_RADIUS; x <= xEnd; x++) {
				const wx = MAP_WRAP ? wrapX(x) : x;
				if (wx < 0 || wx >= ECONOMY_WIDTH) continue;
				this.forest[economyIndex(wx, wy)] *= 1 - share;
			}
		}
	}

	// Founding creates rooms, not occupants: nearby workers must walk in and buy rest normally.
	foundTown(c) {
		const m = this.model, { workers } = m;
		const cx = c % ECONOMY_WIDTH, cy = Math.floor(c / ECONOMY_WIDTH);
		let settlers = 0, wealthSum = 0;
		for (let w = 0; w < workers.count; w++) {
			if (workers.state[w] !== WORKER_STILL) continue;
			const wc = workers.cell[w];
			if (m.actors[wc]) continue;
			const wx = wc % ECONOMY_WIDTH, wy = Math.floor(wc / ECONOMY_WIDTH);
			const dx = Math.abs(torusDelta(wx - cx, ECONOMY_WIDTH)), dy = Math.abs(torusDelta(wy - cy, ECONOMY_HEIGHT));
			if (dx <= FOUND_RADIUS && dy <= FOUND_RADIUS) {
				settlers += workers.amount[w];
				wealthSum += workers.gold[w];
			}
		}
		m.actors[c] = ECONOMY_TOWN;
		this.tier[c] = 0;
		m.scale[c] = m.taxMult[c] = 1;
		m.wealthClass[c] = wealthClassFor(c);
		m.vacantTicks[c] = 0;
		m.satCoal[c] = m.satGoods[c] = m.workLoad[c] = m.profit[c] = 0;
		m.towns.initTown(c);
		if (settlers > 0) m.localWealth[c] = Math.max(0.5, wealthSum / settlers);
		m.rooms[c] = Math.min(this.popCap(c), Math.max(POP_BASE, settlers + 2));
		this.lastFound = this.ticks;
		m.land.refresh();
		this.founded++;
	}
}

if (typeof module === 'object') module.exports = { Settlements, WOOD_TIER_CAP, FOUND_RADIUS };
