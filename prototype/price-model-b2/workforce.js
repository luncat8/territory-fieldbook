// Owns: engine-agnostic worker rules — wallet-weighted home score over rest quality and value fields, still-worker shelter rest.
// Edit for: pareto home weighting and idle rest speed. Cells apply them per cell; a particle engine applies them per carrier.
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

	// A town that wants to shrink below its people has no room to offer; a full town at its goal still does.
	shelterAt(i) {
		const m = this.model;
		const comfort = this.comfortAt(i);
		const housing = Math.min(1, m.optimizer.townGoalPop(i, comfort) / m.pop[i]);
		return (BASE_SHELTER + (1 - BASE_SHELTER) * comfort) * housing * m.settlements.restFactor(i);
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
		const { depleted, depletedFlow, priceHome, priceRest } = this.model;
		const { mix, gold } = depletedFlow;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			mix[i] = walletWeight(gold[i], depleted[i], this.refFee);
			this.view[i] = 0.5 * (priceHome[i] + priceRest[i]);
		}
	}

	// Still workers rest slowly wherever they stand — the shelter floor, far slower than paid town rest — so a
	// worker no town reaches never strands.
	stepStill() {
		for (let i = 0; i < ECONOMY_SIZE; i++) this.restStill(i);
	}

	// Rest at a firm re-enters its pool, so the entry wage is paid like any arrival.
	restStill(i) {
		const m = this.model;
		const { depleted, labor, depletedFlow, laborFlow, actors } = m;
		const dep = depleted[i];
		if (dep <= 1e-12) return;
		const rested = Math.min(dep * this.restShare * depletedFlow.still[i], 1 - labor[i]);
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

if (typeof module === 'object') module.exports = { WorkerPolicy, walletWeight };
