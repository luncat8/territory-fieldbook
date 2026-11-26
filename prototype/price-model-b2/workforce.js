// Owns: self-moving resident workers — Pareto home scoring, roadside shelter, doorway step-out, commute tracking, splitting and starvation.
// Edit for: pareto home weighting, idle rest speed, resident seeding/eviction, split gates or prolonged-hunger despawn.
'use strict';

const BASE_SHELTER = 0.15;
const EVICT_REACH = 3;
const HOME_FEE_TRIPS = 2;
const IDLE_RATE = 0.03;
const SPLIT_COMFORT = 0.35;
const SPLIT_FOOD = 0.65;
const SPLIT_GOLD_FLOOR = 0.5;
const SPLIT_RATE = 0.055;
const STARVE_SECONDS = 25;
const STARVE_RATE = 0.025;

// The wallet picks the worker's point on the rest/price pareto front: broke workers chase rest per gold,
// funded workers chase rest quality. Linear in both fields, so one weight per carrier scores every town.
function walletWeight(gold, amount, refFee) {
	if (amount <= 1e-12) return 0.5;
	const perWorker = gold / amount;
	return perWorker / (perWorker + refFee * HOME_FEE_TRIPS);
}

class WorkerPolicy {
	constructor(model) {
		this.model = model;
		this.refFee = (START_TAX_PER_POP / LABOR_PER_POP) * REST_TAX_SHARE;
		this.restShare = 1 - Math.exp(-ECONOMY_DT * IDLE_RATE);
		this.view = new Float64Array(ECONOMY_SIZE);
		this.hungerTicks = new Float64Array(ECONOMY_SIZE);
	}

	resetResidents() {
		const m = this.model;
		m.fresh.fill(0);
		m.away.fill(0);
		m.rooms.fill(0);
		m.pop.fill(0);
		this.hungerTicks.fill(0);
		m.seededWorkers = m.splitWorkers = m.starvedWorkers = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (m.actors[i] === ECONOMY_TOWN) this.seedTown(i);
		}
	}

	seedTown(i) {
		const m = this.model;
		const rooms = Math.min(m.settlements.popCap(i), START_POP);
		const workers = rooms * WORKER_PER_POP;
		m.rooms[i] = rooms;
		m.fresh[i] += workers;
		m.seededWorkers += workers;
		m.away[i] = 0;
		m.pop[i] = rooms;
		this.hungerTicks[i] = 0;
	}

	// Erasing a town never deletes its residents: housed fresh workers spill out tired with their savings onto
	// nearby land, ring by ring, never teleported across the map.
	evictTown(i) {
		const m = this.model;
		const total = m.fresh[i], purse = m.money.workerPurse[i];
		m.fresh[i] = m.away[i] = m.rooms[i] = m.pop[i] = 0;
		this.hungerTicks[i] = 0;
		if (total <= 1e-12) return;
		const cx = i % ECONOMY_WIDTH, cy = Math.floor(i / ECONOMY_WIDTH);
		const goldPer = purse / total;
		let spill = total;
		for (let r = 0; r <= EVICT_REACH && spill > 1e-12; r++) {
			for (let dy = -r; dy <= r; dy++) {
				for (let dx = -r; dx <= r; dx++) {
					if (Math.max(Math.abs(dx), Math.abs(dy)) === r) spill -= this.spillAt(cx + dx, cy + dy, spill, goldPer);
				}
			}
		}
		if (spill > 1e-12) m.starvedWorkers += spill;
		m.money.workerPurse[i] = Math.max(0, purse - (total - spill) * goldPer);
	}

	spillAt(x, y, spill, goldPer) {
		const m = this.model;
		if (spill <= 1e-12 || x < 0 || y < 0 || x >= ECONOMY_WIDTH || y >= ECONOMY_HEIGHT) return 0;
		const c = economyIndex(x, y);
		if (m.land.terrain[c] === TERRAIN_WATER) return 0;
		const take = Math.min(spill, 1 - m.depleted[c]);
		if (take <= 1e-12) return 0;
		m.depleted[c] += take;
		m.emittedDepleted += take;
		m.depletedFlow.gold[c] += take * goldPer;
		return take;
	}

	// Fresh residents step from town rooms onto the doorway at shift pace so transport moves them up priceLabor on their own.
	stepOut() {
		const m = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (m.fresh[i] <= 1e-12) continue;
			if (m.actors[i] !== ECONOMY_TOWN) {
				m.starvedWorkers += m.fresh[i];
				m.fresh[i] = 0;
				continue;
			}
			const size = Math.max(m.pop[i], m.rooms[i]);
			const workerGold = m.money.workerPurse[i] + m.workerGoldAt(i);
			const afford = workerGold / (workerGold + size * 0.25);
			const doorCap = Math.min(1, Math.max(0.22, size * LABOR_PER_POP * BUFFER_SECONDS));
			const pace = (m.labor[i] < 0.18 && m.laborFlow.still[i] > 0.9
				? 0.25
				: Math.max(0.03, size * LABOR_PER_POP * (0.06 + 0.94 * afford))) * ECONOMY_DT;
			const moved = Math.min(m.fresh[i], Math.max(0, doorCap - m.labor[i]), pace);
			if (moved <= 1e-12) continue;
			m.fresh[i] -= moved;
			m.labor[i] += moved;
			m.suppliedLabor += moved;
		}
	}

	onSiteWorkers(i) {
		const m = this.model;
		return m.fresh[i] + m.labor[i] + m.depleted[i];
	}

	// Tracks commuters who walked out of each town minus tired/fresh workers who walked back, bounded by workers off-town.
	trackCommute() {
		const m = this.model;
		const { actors, away, laborFlow, depletedFlow } = m;
		let claimed = 0, offTown = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (actors[i] === ECONOMY_TOWN) {
				away[i] = Math.max(0, away[i] - laborFlow.delta[i] - Math.max(0, depletedFlow.delta[i]));
				claimed += away[i];
			} else {
				away[i] = 0;
				offTown += m.labor[i] + m.depleted[i];
			}
		}
		if (claimed > offTown && claimed > 1e-12) {
			const scale = offTown / claimed;
			for (let i = 0; i < ECONOMY_SIZE; i++) {
				if (actors[i] === ECONOMY_TOWN) away[i] *= scale;
			}
		}
		this.derivePop();
	}

	derivePop() {
		const m = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			m.pop[i] = m.actors[i] === ECONOMY_TOWN ? (this.onSiteWorkers(i) + m.away[i]) / WORKER_PER_POP : 0;
		}
	}

	// Workers own their lifecycle: fed comfortable workers with savings split into open rooms; prolonged hunger despawns.
	stepLife() {
		const m = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (m.actors[i] !== ECONOMY_TOWN) {
				this.hungerTicks[i] = 0;
				continue;
			}
			if (m.harvest.hungry(i)) this.hungerTicks[i] += ECONOMY_DT;
			else this.hungerTicks[i] = Math.max(0, this.hungerTicks[i] - ECONOMY_DT * 2);

			if (this.hungerTicks[i] >= STARVE_SECONDS) {
				this.starveAt(i);
				continue;
			}
			const comfort = this.comfortAt(i);
			if (comfort < SPLIT_COMFORT || m.harvest.satFood[i] < SPLIT_FOOD) continue;
			const roomFree = m.rooms[i] - m.pop[i];
			if (roomFree <= 1e-6) continue;
			const savings = (m.money.workerPurse[i] + m.workerGoldAt(i)) / Math.max(1, m.pop[i]);
			const afford = Math.min(1, savings / SPLIT_GOLD_FLOOR);
			if (afford <= 1e-4) continue;
			const split = roomFree * WORKER_PER_POP * SPLIT_RATE * comfort * afford * ECONOMY_DT;
			m.fresh[i] += split;
			m.splitWorkers += split;
		}
		this.stepOut();
		this.derivePop();
	}

	starveAt(i) {
		const m = this.model;
		const onSite = this.onSiteWorkers(i);
		if (onSite <= 1e-9) return;
		let loss = Math.min(onSite, onSite * STARVE_RATE * ECONOMY_DT);
		const fromFresh = Math.min(m.fresh[i], loss);
		m.fresh[i] -= fromFresh;
		loss -= fromFresh;
		if (loss > 1e-12 && m.depleted[i] > 0) {
			const take = Math.min(m.depleted[i], loss);
			const gold = m.depletedFlow.gold[i] * (take / m.depleted[i]);
			m.depleted[i] -= take;
			m.restedDepleted += take;
			m.depletedFlow.gold[i] = Math.max(0, m.depletedFlow.gold[i] - gold);
			m.money.orphan(i, gold);
			loss -= take;
		}
		if (loss > 1e-12 && m.labor[i] > 0) {
			const take = Math.min(m.labor[i], loss);
			const ratio = take / m.labor[i];
			const gold = m.laborFlow.gold[i] * ratio;
			m.labor[i] -= take;
			m.workedLabor += take;
			m.laborFlow.cost[i] = Math.max(0, m.laborFlow.cost[i] * (1 - ratio));
			m.laborFlow.gold[i] = Math.max(0, m.laborFlow.gold[i] - gold);
			m.money.orphan(i, gold);
			loss -= take;
		}
		const died = onSite - this.onSiteWorkers(i);
		if (died > 0) {
			m.starvedWorkers += died;
			const purseDrop = m.money.workerPurse[i] * Math.min(1, died / Math.max(died, onSite + m.away[i]));
			m.money.workerPurse[i] = Math.max(0, m.money.workerPurse[i] - purseDrop);
			m.money.orphan(i, purseDrop);
		}
	}

	comfortAt(i) {
		const m = this.model;
		return COAL_COMFORT * m.satCoal[i] + GOODS_COMFORT * m.satGoods[i];
	}

	restComfort(i) {
		const m = this.model;
		const cap = m.settlements.popCap(i);
		const housingFree = cap > 1e-9 ? Math.max(0, (cap - m.pop[i]) / cap) : 0;
		return Math.min(1, this.comfortAt(i) + SPACE_COMFORT * housingFree);
	}

	shelterAt(i) {
		const m = this.model;
		const comfort = this.restComfort(i);
		return (BASE_SHELTER + (1 - BASE_SHELTER) * comfort) * m.settlements.restFactor(i);
	}

	homeRestBid(i) {
		const m = this.model;
		if (m.rooms[i] <= 0 && m.pop[i] <= 0) return 0;
		return START_PRICE * this.shelterAt(i) / m.towns.townCrowdMult(i);
	}

	homeValueBid(i) {
		const m = this.model;
		if (m.rooms[i] <= 0 && m.pop[i] <= 0) return 0;
		return START_PRICE * this.shelterAt(i) * START_TAX_PER_POP / Math.max(1e-6, m.towns.townRestTax(i));
	}

	homeScore(i, weight) {
		return (1 - weight) * this.homeValueBid(i) + weight * this.homeRestBid(i);
	}

	weighWallets() {
		const { depleted, depletedFlow, priceHome, priceRest } = this.model;
		const { mix, gold } = depletedFlow;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			mix[i] = walletWeight(gold[i], depleted[i], this.refFee);
			this.view[i] = 0.5 * (priceHome[i] + priceRest[i]);
		}
	}

	stepStill() {
		for (let i = 0; i < ECONOMY_SIZE; i++) this.restStill(i);
	}

	restStill(i) {
		const m = this.model;
		const { depleted, labor, depletedFlow, laborFlow, actors } = m;
		const dep = depleted[i];
		if (dep <= 1e-12) return;
		const rested = Math.min(dep * this.restShare * depletedFlow.still[i] * m.land.rest[i], 1 - labor[i]);
		if (rested <= 1e-12) return;
		const all = rested >= dep - 1e-12;
		const gold = all ? depletedFlow.gold[i] : depletedFlow.gold[i] * (rested / dep);
		depleted[i] = all ? 0 : dep - rested;
		depletedFlow.gold[i] = all ? 0 : depletedFlow.gold[i] - gold;
		laborFlow.gold[i] += gold;
		labor[i] += rested;
		m.restedDepleted += rested;
		m.suppliedLabor += rested;
		if (laborFlow.buyers & (1 << actors[i])) m.buyArrival(laborFlow, i, rested * m.priceLabor[i]);
	}
}

if (typeof module === 'object') module.exports = { WorkerPolicy, walletWeight, STARVE_SECONDS };
