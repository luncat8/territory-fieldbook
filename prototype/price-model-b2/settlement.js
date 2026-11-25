// Owns: settlement tiers, forest stock, worker settle intent, the settler gather grid, young-town founding and tier growth.
// Edit for: intent pace, founding threshold, wood-built first tier, tier effects on rest, tax, bids and housing. Harvest: harvest.js.
'use strict';

const FOUND_RADIUS = 2;
const FOUND_REACH = 0.25;
const FOUND_SETTLERS = 0.35;
const INTENT_SECONDS = 3;
const FOUND_COOLDOWN_TICKS = 300;
const SETTLER_POP = 0.2 / LABOR_PER_POP;
const WOOD_TIER_CAP = 0.5;
const WOOD_PER_TIER = 6;
const BUILD_WOOD_RATE = 0.1;
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
		this.ticks = this.founded = 0;
		this.lastFound = -FOUND_COOLDOWN_TICKS;
		this.bestSite = -1;
		this.bestScore = FOUND_SETTLERS;
		this.pledged = false;
	}

	placed(i, kind) {
		this.tier[i] = kind === ECONOMY_TOWN ? 1 : 0;
		this.model.land.refresh();
	}

	// A "young town" is a settlement still in construction (tier below WOOD_TIER_CAP). It gathers its own wood
	// (harvest.js) instead of buying it, which is why founding does not mint gold.
	isYoungTown(i) {
		return this.model.actors[i] === ECONOMY_TOWN && this.tier[i] < WOOD_TIER_CAP;
	}

	tierLerp(i, floor) { return floor + (1 - floor) * this.tier[i]; }
	restFactor(i) { return this.tierLerp(i, TIER_REST_FLOOR) * this.model.land.rest[i]; }
	taxFactor(i) { return this.tierLerp(i, TIER_TAX_FLOOR); }
	bidFactor(i) { return this.tierLerp(i, TIER_BID_FLOOR); }
	popCap(i) { return POP_MAX * this.tierLerp(i, TIER_POP_FLOOR) * this.model.land.housing(i); }

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
		const m = this.model, intent = m.depletedFlow.intent;
		const reach = m.priceHome[i] + m.priceRest[i];
		const goal = m.actors[i] ? 0 : m.depletedFlow.still[i] * Math.max(0, 1 - reach / FOUND_REACH);
		intent[i] = Math.min(1, Math.max(0, intent[i] + this.intentStep * (2 * goal - 1)));
		return intent[i] >= 1;
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

	// Harvested wood raises a young town to the cap; beyond it only bought comfort (goods, coal) lifts the tier. Tiers never decay.
	growTier(i) {
		if (this.tier[i] < WOOD_TIER_CAP) {
			const wood = this.model.harvest.takeWood(i, BUILD_WOOD_RATE * ECONOMY_DT);
			this.tier[i] = Math.min(WOOD_TIER_CAP, this.tier[i] + wood / WOOD_PER_TIER);
			return;
		}
		const goal = WOOD_TIER_CAP + (1 - WOOD_TIER_CAP) * this.model.workforce.comfortAt(i);
		if (goal > this.tier[i]) this.tier[i] = Math.min(1, this.tier[i] + ECONOMY_DT * TIER_RATE * (goal - this.tier[i]));
	}

	// The gathered tired settlers become residents and bring their savings; no vault gold is minted, so the young
	// town starts broke and lives on tax. Fresh labor nearby is not theirs to move: it stays and walks on its own.
	foundTown(c) {
		const m = this.model;
		const cx = c % ECONOMY_WIDTH, cy = Math.floor(c / ECONOMY_WIDTH);
		let settled = 0, savings = 0;
		for (let y = Math.max(0, cy - FOUND_RADIUS); y <= Math.min(ECONOMY_HEIGHT - 1, cy + FOUND_RADIUS); y++) {
			for (let x = Math.max(0, cx - FOUND_RADIUS); x <= Math.min(ECONOMY_WIDTH - 1, cx + FOUND_RADIUS); x++) {
				const n = economyIndex(x, y);
				if (m.actors[n]) continue;
				settled += m.depleted[n];
				savings += m.depletedFlow.gold[n];
				m.depleted[n] = 0;
				m.depletedFlow.gold[n] = 0;
			}
		}
		m.restedDepleted += settled;
		m.actors[c] = ECONOMY_TOWN;
		m.scale[c] = m.taxMult[c] = 1;
		m.wealthClass[c] = wealthClassFor(c);
		m.vacantTicks[c] = 0;
		this.tier[c] = 0;
		m.pop[c] = Math.min(this.popCap(c), Math.max(POP_BASE, settled * SETTLER_POP));
		m.satCoal[c] = m.satGoods[c] = m.workLoad[c] = m.profit[c] = 0;
		m.money.workerPurse[c] += savings;
		m.harvest.founded(c);
		this.lastFound = this.ticks;
		m.land.refresh();
		this.founded++;
	}
}

if (typeof module === 'object') module.exports = { Settlements };
