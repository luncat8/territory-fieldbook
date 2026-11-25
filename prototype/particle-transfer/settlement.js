// Owns: settlement tiers, forest stock, worker settle intent, the settler gather grid, young-town founding and tier growth.
// Edit for: intent pace, founding threshold, forest-felling build, tier effects on rest, tax, bids and housing. Spacing: land.js.
'use strict';

const FOUND_RADIUS = 2;
const FOUND_REACH = 0.25;
const FOUND_SETTLERS = 0.35;
const INTENT_SECONDS = 3;
const FOUND_COOLDOWN_TICKS = 300;
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
		this.gather = new Float64Array(ECONOMY_SIZE);
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

	// A "young town" is a settlement still in construction (tier below WOOD_TIER_CAP). It can gather resources
	// itself — felling nearby forest — instead of buying them, which is why founding does not mint gold.
	isYoungTown(i) {
		return this.model.actors[i] === ECONOMY_TOWN && this.tier[i] < WOOD_TIER_CAP;
	}

	tierLerp(i, floor) { return floor + (1 - floor) * this.tier[i]; }
	restFactor(i) { return this.tierLerp(i, TIER_REST_FLOOR) * this.model.land.rest[i]; }
	taxFactor(i) { return this.tierLerp(i, TIER_TAX_FLOOR); }
	bidFactor(i) { return this.tierLerp(i, TIER_BID_FLOOR); }
	popCap(i) { return POP_MAX * this.tierLerp(i, TIER_POP_FLOOR); }

	// Ready settlers write their count into the gather grid as they decide, so founding never rescans the map.
	step() {
		const m = this.model;
		const open = ++this.ticks - this.lastFound >= FOUND_COOLDOWN_TICKS;
		if (this.pledged) this.gather.fill(0);
		this.bestSite = -1;
		this.bestScore = FOUND_SETTLERS;
		this.pledged = false;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			this.forest[i] += this.regrowShare * (this.forestCap[i] - this.forest[i]);
			if (m.actors[i] === ECONOMY_TOWN && this.tier[i] < 1) this.growTier(i);
			if (m.depleted[i] > 1e-12 && this.decide(i) && open) this.pledge(i);
		}
		if (this.bestSite >= 0) this.foundTown(this.bestSite);
	}

	// A tired worker makes up its mind to settle over INTENT_SECONDS of standing still beyond every town's reach,
	// and forgets at the same pace once it moves or a home signal reaches it. Intent is carried with the worker.
	decide(i) {
		const flow = this.model.depletedFlow;
		flow.intent[i] = this.nextIntent(flow.intent[i], flow.still[i], i);
		return flow.intent[i] >= 1;
	}

	nextIntent(intent, still, i) {
		const m = this.model;
		const reach = m.priceHome[i] + m.priceRest[i];
		const goal = m.actors[i] ? 0 : still * Math.max(0, 1 - reach / FOUND_REACH);
		return Math.min(1, Math.max(0, intent + this.intentStep * (2 * goal - 1)));
	}

	// Each written cell's count only grows within a tick, so the best site is tracked at write time.
	// Score is settlers times site quality: wasteland, desert and other towns' land need more settlers.
	pledge(i) {
		const { actors, depleted, land } = this.model;
		const cx = i % ECONOMY_WIDTH, cy = Math.floor(i / ECONOMY_WIDTH);
		this.pledged = true;
		for (let y = Math.max(0, cy - FOUND_RADIUS); y <= Math.min(ECONOMY_HEIGHT - 1, cy + FOUND_RADIUS); y++) {
			for (let x = Math.max(0, cx - FOUND_RADIUS); x <= Math.min(ECONOMY_WIDTH - 1, cx + FOUND_RADIUS); x++) {
				const n = economyIndex(x, y);
				this.gather[n] += depleted[i];
				const score = this.gather[n] * land.site[n];
				if (actors[n] || score <= this.bestScore) continue;
				this.bestScore = score;
				this.bestSite = n;
			}
		}
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
		const idle = Math.min(m.labor[i] * m.laborFlow.still[i] * this.buildShare, 1 - m.depleted[i]);
		const wood = Math.min(idle * WOOD_PER_WORK, this.sumAround(this.forest, i));
		if (wood <= 1e-12) return;
		const used = wood / WOOD_PER_WORK;
		const gold = m.laborFlow.gold[i] * (used / m.labor[i]);
		this.fellAround(i, wood);
		// The felling shift carries personal gold to the tired pool wallet-weighted, like any firm shift.
		const movedGold = m.workers.moveWorkGold(i, gold);
		m.labor[i] -= used;
		m.laborFlow.gold[i] = Math.max(0, m.laborFlow.gold[i] - movedGold);
		if (m.labor[i] <= 1e-12) {
			const free = Math.max(0, m.laborFlow.gold[i] - m.workers.dockedGold(STATE_FRESH, i));
			m.depletedFlow.gold[i] += free;
			m.laborFlow.gold[i] -= free;
		}
		m.depleted[i] += used;
		m.depletedFlow.gold[i] += movedGold;
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
				workers += m.labor[n];
				// Parked unemployed workers join the new town with their wallets, stock and shift-claim backing
				// before the founding grant claims the leftover pool gold; those that do not fit stay parked.
				m.workers.relocateDocked(n, c);
				if (n !== c) this.gatherLabor(n, c);
				// Whoever stayed parked cashes his shift claims now, so the grant never confiscates their backing.
				m.workers.cashClaims(n);
			settled += m.depleted[n];
			savings += m.depletedFlow.gold[n];
			m.depleted[n] = 0;
			m.depletedFlow.gold[n] = 0;
			m.depletedFlow.intent[n] = 0;
			}
		}
		settled += m.workers.absorbNear(cx, cy, FOUND_RADIUS);
		savings += m.workers.absorbedGold;
		m.restedDepleted += settled;
		m.actors[c] = ECONOMY_TOWN;
		m.scale[c] = m.taxMult[c] = 1;
		m.wealthClass[c] = wealthClassFor(c);
		m.vacantTicks[c] = 0;
		this.tier[c] = 0;
		m.pop[c] = Math.min(this.popCap(c), Math.max(POP_BASE, (settled + workers) * SETTLER_POP));
		m.satCoal[c] = m.satGoods[c] = m.workLoad[c] = m.profit[c] = 0;
		m.money.workerPurse[c] += savings;
		this.lastFound = this.ticks;
		m.land.refresh();
		this.founded++;
	}

	gatherLabor(from, to) {
		const m = this.model;
		const moved = Math.min(m.labor[from], 1 - m.labor[to]);
		if (moved <= 0) return;
		const all = moved >= m.labor[from];
		// Docked workers keep their wallets parked at the source cell, so only the pool gold beyond their
		// backing may be gathered into the new town.
		const parked = m.workers.dockedGold(STATE_FRESH, from);
		let gold = all ? Math.max(0, m.laborFlow.gold[from] - parked)
			: Math.min(m.laborFlow.gold[from] * (moved / m.labor[from]), Math.max(0, m.laborFlow.gold[from] - parked));
		m.labor[from] = all ? 0 : m.labor[from] - moved;
		m.laborFlow.gold[from] = Math.max(0, m.laborFlow.gold[from] - gold);
		m.labor[to] += moved;
		m.laborFlow.gold[to] += gold;
	}
}

if (typeof module === 'object') module.exports = { Settlements };
