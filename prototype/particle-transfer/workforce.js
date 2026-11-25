// Owns: engine-agnostic worker rules — wallet-weighted home score over rest quality and value fields, still-worker shelter rest.
// Edit for: pareto home weighting and idle rest speed (scaled by land.js rest). Cells apply them per cell; a particle engine applies them per carrier.
'use strict';

const BASE_SHELTER = 0.15;
const HOME_FEE_TRIPS = 2;
const IDLE_RATE = 0.03;

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
	}

	comfortAt(i) {
		const m = this.model;
		return COAL_COMFORT * m.satCoal[i] + GOODS_COMFORT * m.satGoods[i];
	}

	// Rest comfort blends resource comfort with a free-space lift: an uncrowded town rests workers better
	// (draft: "add some increment to comfort in case of free space in town").
	restComfort(i) {
		const m = this.model;
		const cap = m.settlements.popCap(i);
		const housingFree = cap > 1e-9 ? Math.max(0, (cap - m.pop[i]) / cap) : 0;
		return Math.min(1, this.comfortAt(i) + SPACE_COMFORT * housingFree);
	}

	// A town keeps its room by taxing: full housing still offers a rest floor (tax handles crowding) and empty
	// housing opens the door. This replaces the old "town wants to shrink, offers less room" premise.
	shelterAt(i) {
		const m = this.model;
		const comfort = this.restComfort(i);
		return (BASE_SHELTER + (1 - BASE_SHELTER) * comfort) * m.settlements.restFactor(i);
	}

	// Quality axis: how well a worker recovers here — comfort, tier and wait-pool crowding, ignoring tax.
	homeRestBid(i) {
		const m = this.model;
		if (m.pop[i] <= 0) return 0;
		return START_PRICE * this.shelterAt(i) / m.optimizer.townCrowdMult(i);
	}

	// Value axis: recovery per gold of actual living tax, so crowding and inflated purses repel through price
	// and an unsupplied town is no bargain at any tax.
	homeValueBid(i) {
		const m = this.model;
		if (m.pop[i] <= 0) return 0;
		return START_PRICE * this.shelterAt(i) * START_TAX_PER_POP / Math.max(1e-6, m.optimizer.townRestTax(i));
	}

	homeScore(i, weight) {
		return (1 - weight) * this.homeValueBid(i) + weight * this.homeRestBid(i);
	}

	weighWallets() {
		const m = this.model;
		const { depleted, depletedFlow, laborFlow, priceHome, priceRest, priceLabor } = m;
		const { mix, gold } = depletedFlow;
		const steer = m.workers.steer;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			mix[i] = walletWeight(gold[i], depleted[i], this.refFee);
			this.view[i] = 0.5 * (priceHome[i] + priceRest[i]);
			// Stillness from the local uphill slope: flat fields rest in place, steep fields walk.
			depletedFlow.still[i] = steer.sampleGradient(priceHome, priceRest, mix[i], i, -Infinity)
				? GRADIENT_KNEE / (steer.grad[2] + GRADIENT_KNEE) : 1;
			laborFlow.still[i] = steer.sampleGradient(priceLabor, null, 0, i, -Infinity)
				? GRADIENT_KNEE / (steer.grad[2] + GRADIENT_KNEE) : 1;
		}
	}

	// Still workers rest slowly wherever they stand — the shelter floor, far slower than paid town rest — so a
	// worker no town reaches never strands. The land sets the pace: meadow rests best, desert and wasteland worst.
	stepStill() {
		for (let i = 0; i < ECONOMY_SIZE; i++) this.restStill(i);
	}

	// Funded town guests use paid service; broke guests and slow workers outside towns get the shelter floor.
	restStill(i) {
		const m = this.model;
		if (m.depleted[i] <= 1e-12) return;
		const budget = Math.min((m.depleted[i] + m.labor[i]) * this.restShare * m.depletedFlow.still[i] * m.land.rest[i], 1 - m.labor[i]);
		m.workers.restAt(i, budget, 0, true);
	}

}

if (typeof module === 'object') module.exports = { WorkerPolicy, walletWeight };
