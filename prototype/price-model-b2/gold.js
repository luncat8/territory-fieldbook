// Owns: conserved gold — municipal & resident purses, carried worker wallets, bills, taxes and firm payouts.
// Edit for: starting gold calibration, wage-at-entry handoff, living/rest tax collection and payment streams.
'use strict';

// Fixed-price mode uses this reference; scenario funding does not.
const START_PRICE = 4;
const START_GOLD_PER_WORKER = 1;
const PURSE_SECONDS = 15;
const WORKER_SECONDS = 10;
const RESERVE_SECONDS = 4;
const GOLD_RATE = 0.4;
const GOLD_YIELD = GOLD_RATE / (SOURCE_RATE * GOLD_LABOR);
const START_TAX_PER_POP = START_PRICE / (INPUT_SHARE * (GOODS_COMFORT / TOWN_GOODS_NEED));
const ASK_LEVEL = 1;
const PAYOUT_RATE = 1;
const PAY_COAL = 0;
const PAY_GOODS = 1;
const PAY_WAGE = 2;
const PAY_WOOD = 3;
const PAY_FOOD = 4;

function makeStream(receiver) {
	return {
		receiver,
		coin: new Float64Array(ECONOMY_SIZE),
		owed: new Float64Array(ECONOMY_SIZE),
		ask: new Float64Array(ECONOMY_SIZE),
		nextAsk: new Float64Array(ECONOMY_SIZE),
		scratch: makeScratch(1 << receiver, Infinity, FLOW_RATE)
	};
}

// Gold is conserved across town vaults, resident purses, mobile worker wallets (laborGold/depletedGold)
// and seller payment streams. Firms hand wages directly into workers' carried wallets at the work cell.
class GoldMoney {
	constructor(model) {
		this.model = model;
		this.startGoldPerWorker = START_GOLD_PER_WORKER;
		this.purse = new Float64Array(ECONOMY_SIZE);
		this.workerPurse = new Float64Array(ECONOMY_SIZE);
		this.streams = [makeStream(ECONOMY_MINE), makeStream(ECONOMY_FACTORY), makeStream(ECONOMY_TOWN), makeStream(ECONOMY_SAWMILL), makeStream(ECONOMY_FARM)];
		this.inbound = new Int8Array(ECONOMY_FARM + 1).fill(-1);
		this.inbound[ECONOMY_MINE] = PAY_COAL;
		this.inbound[ECONOMY_FACTORY] = PAY_GOODS;
		this.inbound[ECONOMY_TOWN] = PAY_WAGE;
		this.inbound[ECONOMY_SAWMILL] = PAY_WOOD;
		this.inbound[ECONOMY_FARM] = PAY_FOOD;
		this.taxShare = (1 - REST_TAX_SHARE) * (1 - Math.exp(-ECONOMY_DT / WORKER_SECONDS));
		this.payoutShare = 1 - Math.exp(-ECONOMY_DT * PAYOUT_RATE);
	}

	reset() {
		this.purse.fill(0);
		this.workerPurse.fill(0);
		for (const stream of this.streams) {
			stream.coin.fill(0);
			stream.owed.fill(0);
			stream.ask.fill(0);
			clearScratch(stream.scratch);
		}
		this.seeded = this.mined = this.settled = this.wages = this.taxes = 0;
		this.mineRate = this.wageRate = this.taxRate = 0;
		const { actors } = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (actors[i] === ECONOMY_TOWN) this.seed(i);
		}
		if (this.model.ticks === 0) {
			if (this.model.workforce) this.model.workforce.resetResidents();
			if (this.model.farms) this.model.farms.syncActors();
		}
	}

	seed(i) {
		const total = START_POP * this.startGoldPerWorker;
		const workerGold = total * WORKER_SECONDS / (WORKER_SECONDS + INPUT_SHARE * PURSE_SECONDS);
		const townGold = total - workerGold;
		this.workerPurse[i] += workerGold;
		this.purse[i] += townGold;
		this.seeded += workerGold + townGold;
	}

	release(i) {
		this.streams[PAY_WAGE].coin[i] += this.purse[i] + this.workerPurse[i];
		this.purse[i] = 0;
		this.workerPurse[i] = 0;
		for (const stream of this.streams) stream.owed[i] = 0;
	}

	orphan(i, amount) {
		if (amount <= 0) return;
		if (this.model.actors[i] === ECONOMY_TOWN) this.workerPurse[i] += amount;
		else this.streams[PAY_WAGE].coin[i] += amount;
	}

	dig(i, amount) {
		this.purse[i] += amount;
		this.mined += amount;
	}

	bill(i, stream, amount) {
		this.streams[stream].owed[i] += amount;
	}

	owedAt(i) {
		let sum = 0;
		for (let k = 0; k < this.streams.length; k++) sum += this.streams[k].owed[i];
		return sum;
	}

	spendable(i) {
		return Math.max(0, this.purse[i] - this.owedAt(i));
	}

	creditCool(i, budget) {
		return 1 + this.owedAt(i) / (budget + 1e-9);
	}

	townCool(i, budget) {
		const spend = this.spendable(i);
		if (spend <= 0) return Infinity;
		return (spend >= budget ? 1 : budget / spend) * this.creditCool(i, budget);
	}

	taxPerPop(i) {
		const m = this.model;
		const mult = m.derived ? (m.taxMult[i] || 1) : 1;
		const workerGold = this.workerPurse[i] + m.workerGoldAt(i);
		return (workerGold / WORKER_SECONDS) * mult / Math.max(1, m.pop[i]);
	}

	payRestTax(i, restTax, netSavings) {
		this.purse[i] += restTax;
		this.taxes += restTax;
		this.workerPurse[i] += netSavings;
	}

	// The wage is fixed when a worker sits into the firm pool: paid at once into the arriving wallet so later
	// overflow cannot cut its pay; an empty purse leaves the remainder owed as back-pay.
	payOnEntry(i, amount) {
		const pay = Math.min(amount, this.purse[i]);
		this.purse[i] -= pay;
		this.model.laborFlow.gold[i] += pay;
		this.wages += pay;
		this.streams[PAY_WAGE].owed[i] += amount - pay;
	}

	// Back-pay splits proportionally across on-site pool and shift-finished workers; orphan back-pay uses coin.
	payWorkers(i, amount) {
		if (amount <= 0) return;
		const m = this.model;
		const onSite = m.labor[i] + m.depleted[i];
		if (onSite > 1e-12) {
			const toDepleted = amount * (m.depleted[i] / onSite);
			m.depletedFlow.gold[i] += toDepleted;
			m.laborFlow.gold[i] += amount - toDepleted;
		} else {
			this.streams[PAY_WAGE].coin[i] += amount;
		}
		this.wages += amount;
	}

	// Settled residents pay ongoing living tax in proportion to supplied comfort and wait-pool crowding;
	// surplus above the municipal reserve circulates back to residents only in healthy, uncrowded towns.
	collectTax(i, comfort) {
		const m = this.model;
		const mult = m.derived ? m.towns.townEffectiveMult(i) : 1;
		const share = Math.min(0.5, this.taxShare * mult);
		const taxPaid = this.workerPurse[i] * share * comfort;
		this.workerPurse[i] -= taxPaid;
		this.purse[i] += taxPaid;
		this.taxes += taxPaid;
		const workerGold = this.workerPurse[i] + m.workerGoldAt(i);
		const reserve = INPUT_SHARE * (workerGold / WORKER_SECONDS) * mult * PURSE_SECONDS;
		const civic = (comfort > 0.4 && mult <= 1.1 ? comfort : 0) * Math.max(0, this.purse[i] - reserve) * this.payoutShare;
		this.purse[i] -= civic;
		this.workerPurse[i] += civic;
		return taxPaid / ECONOMY_DT;
	}

	held(i) {
		let coins = 0;
		for (let k = 0; k < this.streams.length; k++) coins += this.streams[k].coin[i];
		return this.purse[i] + this.workerPurse[i] + this.model.workerGoldAt(i) + coins;
	}

	total() {
		let sum = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) sum += this.held(i);
		return sum;
	}

	step() {
		this.updateAsks();
		const { actors } = this.model;
		const mined = this.mined, wages = this.wages, taxes = this.taxes;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (actors[i]) this.settle(i, actors[i]);
		}
		for (const stream of this.streams) this.model.transport(stream.scratch, stream.coin, stream.ask);
		this.mineRate = (this.mined - mined) / ECONOMY_DT;
		this.wageRate = (this.wages - wages) / ECONOMY_DT;
		this.taxRate = (this.taxes - taxes) / ECONOMY_DT;
	}

	updateAsks() {
		const { actors, pop, taxMult, derived } = this.model;
		const decay = this.model.decay ? PRICE_DECAY : 0;
		for (const stream of this.streams) {
			const { ask, nextAsk, receiver } = stream;
			for (let i = 0; i < ECONOMY_SIZE; i++) {
				const tax = derived ? (taxMult[i] || 1) : 1;
				const level = actors[i] === receiver ? (receiver === ECONOMY_TOWN ? ASK_LEVEL * (pop[i] / START_POP) / tax : ASK_LEVEL) : -1;
				nextAsk[i] = stepBid(ask, i, ask[i], level, decay);
			}
			stream.ask = nextAsk;
			stream.nextAsk = ask;
		}
	}

	settle(i, actor) {
		const { purse, workerPurse, streams } = this;
		const inbound = this.inbound[actor];
		if (inbound >= 0) {
			if (actor === ECONOMY_TOWN) workerPurse[i] += streams[inbound].coin[i];
			else purse[i] += streams[inbound].coin[i];
			streams[inbound].coin[i] = 0;
		}
		const owed = this.owedAt(i);
		if (owed > 0 && purse[i] > 0) {
			const share = Math.min(1, purse[i] / owed);
			for (let k = 0; k < streams.length; k++) {
				const pay = streams[k].owed[i] * share;
				purse[i] -= pay;
				streams[k].owed[i] -= pay;
				this.settled += pay;
				if (k === PAY_WAGE) this.payWorkers(i, pay);
				else streams[k].coin[i] += pay;
			}
			if (purse[i] < 1e-14) purse[i] = 0;
		}
		if (actor !== ECONOMY_TOWN) this.payFirmSurplus(i, actor);
	}

	payFirmSurplus(i, actor) {
		const m = this.model, recipe = m.optimizer.recipes[actor];
		if (!recipe) return;
		const unitRate = recipe.rate * (m.scale[i] || 1);
		let costRate = 0;
		for (let k = 0; k < recipe.inputs.length; k++) {
			const inp = recipe.inputs[k];
			costRate += m.pricesAt(inp.item)[i] * inp.need * unitRate;
		}
		const payout = Math.max(0, this.purse[i] - costRate * RESERVE_SECONDS) * this.payoutShare;
		this.purse[i] -= payout;
		this.payWorkers(i, payout);
	}
}

if (typeof module === 'object') module.exports = { GoldMoney };
