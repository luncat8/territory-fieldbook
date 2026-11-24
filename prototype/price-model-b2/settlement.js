// Owns: settlement tiers, forest stock, still-worker tally, young-town founding and tier growth.
// Edit for: founding threshold and spacing, forest-felling build, tier effects on rest, tax, bids and housing.
'use strict';

const FOUND_RADIUS = 2;
const FOUND_TOWN_GAP = 5;
const FOUND_REACH = 0.25;
const FOUND_STILL = 0.35;
const STILL_SECONDS = 2;
const SETTLE_SCAN_TICKS = 300;
const SETTLER_POP = 0.2 / LABOR_PER_POP;
const WOOD_TIER_CAP = 0.5;
const WOOD_PER_TIER = 6;
const WOOD_PER_WORK = 1;
const BUILD_RATE = 0.15;
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
		this.still = new Float64Array(ECONOMY_SIZE);
		this.stillBlend = 1 - Math.exp(-ECONOMY_DT / STILL_SECONDS);
		this.regrowShare = 1 - Math.exp(-ECONOMY_DT * FOREST_REGROW);
		this.buildShare = 1 - Math.exp(-ECONOMY_DT * BUILD_RATE);
		this.seedForest();
	}

	// Fixed smooth woodland pattern, so every reset and test sees the same forest.
	seedForest() {
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const x = i % ECONOMY_WIDTH, y = Math.floor(i / ECONOMY_WIDTH);
			const wave = 0.5 + 0.4 * Math.sin(x * 0.42 + 1.3) * Math.cos(y * 0.57 - 0.4) + 0.2 * Math.sin((x + y) * 0.21);
			this.forestCap[i] = Math.min(1, Math.max(0, wave));
		}
	}

	reset() {
		const { actors } = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) this.tier[i] = actors[i] === ECONOMY_TOWN ? 1 : 0;
		this.forest.set(this.forestCap);
		this.still.fill(0);
		this.ticks = this.founded = this.felled = 0;
	}

	placed(i, kind) {
		this.tier[i] = kind === ECONOMY_TOWN ? 1 : 0;
	}

	// A "young town" is a settlement still in construction (tier below WOOD_TIER_CAP). It can gather resources
	// itself — felling nearby forest — instead of buying them, which is why founding does not mint gold.
	isYoungTown(i) {
		return this.model.actors[i] === ECONOMY_TOWN && this.tier[i] < WOOD_TIER_CAP;
	}

	tierLerp(i, floor) { return floor + (1 - floor) * this.tier[i]; }
	restFactor(i) { return this.tierLerp(i, TIER_REST_FLOOR); }
	taxFactor(i) { return this.tierLerp(i, TIER_TAX_FLOOR); }
	bidFactor(i) { return this.tierLerp(i, TIER_BID_FLOOR); }
	popCap(i) { return POP_MAX * this.tierLerp(i, TIER_POP_FLOOR); }

	step() {
		const m = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = m.actors[i];
			const goal = a ? 0 : m.depleted[i] * m.depletedFlow.still[i];
			this.still[i] += this.stillBlend * (goal - this.still[i]);
			this.forest[i] += this.regrowShare * (this.forestCap[i] - this.forest[i]);
			if (a === ECONOMY_TOWN && this.tier[i] < 1) this.growTier(i);
		}
		if (++this.ticks % SETTLE_SCAN_TICKS === 0) this.scanFounding();
	}

	// Wood raises a young town to the cap; beyond it only bought comfort (goods, coal) lifts the tier. Tiers never decay.
	growTier(i) {
		if (this.tier[i] < WOOD_TIER_CAP) {
			this.buildFromForest(i);
			return;
		}
		const goal = WOOD_TIER_CAP + (1 - WOOD_TIER_CAP) * this.model.workforce.comfortAt(i);
		if (goal > this.tier[i]) this.tier[i] = Math.min(1, this.tier[i] + ECONOMY_DT * TIER_RATE * (goal - this.tier[i]));
	}

	// Like a sawmill site, a young town builds from its own forest with its own idle residents:
	// still labor at home fells the surrounding wood and returns tired.
	buildFromForest(i) {
		const m = this.model;
		const idle = m.labor[i] * m.laborFlow.still[i];
		const wood = Math.min(idle * this.buildShare * WOOD_PER_WORK, this.sumAround(this.forest, i));
		if (wood <= 1e-12) return;
		const used = Math.min(wood / WOOD_PER_WORK, 1 - m.depleted[i]);
		const gold = m.laborFlow.gold[i] * (used / m.labor[i]);
		this.fellAround(i, wood);
		m.labor[i] -= used;
		m.laborFlow.gold[i] -= gold;
		if (m.labor[i] <= 1e-12) {
			m.depletedFlow.gold[i] += m.laborFlow.gold[i];
			m.laborFlow.gold[i] = 0;
		}
		m.depleted[i] += used;
		m.depletedFlow.gold[i] += gold;
		m.workedLabor += used;
		m.emittedDepleted += used;
		this.tier[i] = Math.min(WOOD_TIER_CAP, this.tier[i] + wood / WOOD_PER_TIER);
		this.felled += wood;
	}

	sumAround(field, i) {
		const cx = i % ECONOMY_WIDTH, cy = Math.floor(i / ECONOMY_WIDTH);
		let total = 0;
		for (let y = Math.max(0, cy - FOUND_RADIUS); y <= Math.min(ECONOMY_HEIGHT - 1, cy + FOUND_RADIUS); y++) {
			for (let x = Math.max(0, cx - FOUND_RADIUS); x <= Math.min(ECONOMY_WIDTH - 1, cx + FOUND_RADIUS); x++) total += field[economyIndex(x, y)];
		}
		return total;
	}

	fellAround(i, wood) {
		const share = wood / this.sumAround(this.forest, i);
		const cx = i % ECONOMY_WIDTH, cy = Math.floor(i / ECONOMY_WIDTH);
		for (let y = Math.max(0, cy - FOUND_RADIUS); y <= Math.min(ECONOMY_HEIGHT - 1, cy + FOUND_RADIUS); y++) {
			for (let x = Math.max(0, cx - FOUND_RADIUS); x <= Math.min(ECONOMY_WIDTH - 1, cx + FOUND_RADIUS); x++) this.forest[economyIndex(x, y)] *= 1 - share;
		}
	}

	townNear(i) {
		const { actors } = this.model;
		const cx = i % ECONOMY_WIDTH, cy = Math.floor(i / ECONOMY_WIDTH);
		for (let y = Math.max(0, cy - FOUND_TOWN_GAP); y <= Math.min(ECONOMY_HEIGHT - 1, cy + FOUND_TOWN_GAP); y++) {
			for (let x = Math.max(0, cx - FOUND_TOWN_GAP); x <= Math.min(ECONOMY_WIDTH - 1, cx + FOUND_TOWN_GAP); x++) {
				if (actors[economyIndex(x, y)] === ECONOMY_TOWN) return true;
			}
		}
		return false;
	}

	// Enough tired workers standing still in one area found a settlement (town) once no town signal reaches them;
	// the home fields measure reach, so the rule is the same for cells and particles. Fresh labor queueing at a full
	// firm is waiting for work, not homeless, so only depleted counts.
	scanFounding() {
		const { actors, priceHome, priceRest } = this.model;
		let best = -1, bestSum = FOUND_STILL;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (actors[i] || this.still[i] <= 1e-4 || priceHome[i] + priceRest[i] > FOUND_REACH) continue;
			const sum = this.sumAround(this.still, i);
			if (sum > bestSum && !this.townNear(i)) {
				best = i;
				bestSum = sum;
			}
		}
		if (best >= 0) this.foundTown(best);
	}

	// The gathered workers become residents and bring their savings; no vault gold is minted, so the young
	// town starts broke and lives on tax from the wages its residents earn. It carries on with the wealth class
	// of its founding cell.
	foundTown(c) {
		const m = this.model;
		const cx = c % ECONOMY_WIDTH, cy = Math.floor(c / ECONOMY_WIDTH);
		let settled = 0, savings = 0, workers = 0;
		for (let y = Math.max(0, cy - FOUND_RADIUS); y <= Math.min(ECONOMY_HEIGHT - 1, cy + FOUND_RADIUS); y++) {
			for (let x = Math.max(0, cx - FOUND_RADIUS); x <= Math.min(ECONOMY_WIDTH - 1, cx + FOUND_RADIUS); x++) {
				const n = economyIndex(x, y);
				if (m.actors[n]) continue;
				settled += m.depleted[n];
				savings += m.depletedFlow.gold[n];
				m.depleted[n] = 0;
				m.depletedFlow.gold[n] = 0;
				workers += m.labor[n];
				if (n !== c) this.gatherLabor(n, c);
			}
		}
		m.restedDepleted += settled;
		m.actors[c] = ECONOMY_TOWN;
		m.scale[c] = m.taxMult[c] = 1;
		m.wealthClass[c] = wealthClassFor(c);
		m.vacantTicks[c] = 0;
		this.tier[c] = 0;
		m.pop[c] = Math.min(this.popCap(c), Math.max(POP_BASE, (settled + workers) * SETTLER_POP));
		m.satCoal[c] = m.satGoods[c] = m.workLoad[c] = m.profit[c] = 0;
		m.money.workerPurse[c] += savings;
		this.still[c] = 0;
		this.founded++;
	}

	gatherLabor(from, to) {
		const m = this.model;
		const moved = Math.min(m.labor[from], 1 - m.labor[to]);
		if (moved <= 0) return;
		const all = moved >= m.labor[from];
		const gold = all ? m.laborFlow.gold[from] : m.laborFlow.gold[from] * (moved / m.labor[from]);
		m.labor[from] = all ? 0 : m.labor[from] - moved;
		m.laborFlow.gold[from] = all ? 0 : m.laborFlow.gold[from] - gold;
		m.labor[to] += moved;
		m.laborFlow.gold[to] += gold;
	}
}

if (typeof module === 'object') module.exports = { Settlements };
