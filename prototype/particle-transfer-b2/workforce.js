// Owns: wallet-weighted pareto home score (value vs rest quality) and land-scaled shelter rest rate.
// Edit for: pareto wallet curve, free-space comfort lift and shelter floor pace.
'use strict';

const BASE_SHELTER = 0.15;
const HOME_FEE_TRIPS = 2;
const IDLE_RATE = 0.045;
const SPACE_COMFORT = 0.25;

function walletWeight(gold, amount, refFee) {
	if (amount <= 1e-12) return 0.5;
	const perWorker = gold / amount;
	return perWorker / (perWorker + refFee * HOME_FEE_TRIPS);
}

class WorkerPolicy {
	constructor(model) {
		this.model = model;
		this.restShare = 1 - Math.exp(-ECONOMY_DT * IDLE_RATE);
	}

	comfortAt(i) {
		const m = this.model;
		return COAL_COMFORT * m.satCoal[i] + GOODS_COMFORT * m.satGoods[i];
	}

	// Uncrowded rooms lift rest comfort so rich towns holding spare capacity rest guests faster.
	restComfort(i) {
		const m = this.model;
		const cap = m.rooms[i];
		const housingFree = cap > 1e-9 ? Math.max(0, (cap - m.pop[i]) / cap) : 0;
		return Math.min(1, this.comfortAt(i) + SPACE_COMFORT * housingFree);
	}

	shelterAt(i) {
		const m = this.model;
		return (BASE_SHELTER + (1 - BASE_SHELTER) * this.restComfort(i)) * m.settlements.restFactor(i);
	}

	homeRestBid(i) {
		const m = this.model;
		if (m.rooms[i] <= 0) return 0;
		return START_PRICE * this.shelterAt(i) / m.towns.crowdMult(i);
	}

	homeValueBid(i) {
		const m = this.model;
		if (m.rooms[i] <= 0) return 0;
		return START_PRICE * this.shelterAt(i) * BASE_REST_FEE / Math.max(1e-6, m.towns.restTax(i));
	}

	homeScore(i, weight) {
		return (1 - weight) * this.homeValueBid(i) + weight * this.homeRestBid(i);
	}
}

if (typeof module === 'object') module.exports = { WorkerPolicy, walletWeight, SPACE_COMFORT };
