// Owns: conserved gold — municipal & resident purses, carried worker wallets, bills, taxes and firm payouts.
// Edit for: starting gold calibration, worker wage handoff, living/rest tax collection and payment streams.
'use strict';

const START_PRICE = 4;
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
		this.purse = new Float64Array(ECONOMY_SIZE);
		this.workerPurse = new Float64Array(ECONOMY_SIZE);
		this.streams = [makeStream(ECONOMY_MINE), makeStream(ECONOMY_FACTORY), makeStream(ECONOMY_TOWN)];
		this.inbound = new Int8Array(ECONOMY_GOLD + 1).fill(-1);
		this.inbound[ECONOMY_MINE] = PAY_COAL;
		this.inbound[ECONOMY_FACTORY] = PAY_GOODS;
		this.inbound[ECONOMY_TOWN] = PAY_WAGE;
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
	}

	seed(i) {
		const workerGold = START_POP * START_TAX_PER_POP * WORKER_SECONDS;
		const townGold = START_POP * START_TAX_PER_POP * INPUT_SHARE * PURSE_SECONDS;
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
		const [coal, goods, wage] = this.streams;
		return coal.owed[i] + goods.owed[i] + wage.owed[i];
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

	// Firms pay wages directly into the pockets of workers on site; orphan back-pay uses remittance coin.
	payWorkers(i, amount) {
		if (amount <= 0) return;
		const m = this.model;
		if (m.depleted[i] > 1e-12) m.depletedFlow.gold[i] += amount;
		else if (m.labor[i] > 1e-12) m.laborFlow.gold[i] += amount;
		else this.streams[PAY_WAGE].coin[i] += amount;
		this.wages += amount;
	}

	// Settled residents pay ongoing living tax in proportion to supplied comfort; surplus above the
	// municipal reserve circulates back to residents only in healthy, moderate-tax towns.
	collectTax(i, comfort) {
		const m = this.model;
		const mult = m.derived ? (m.taxMult[i] || 1) : 1;
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
		const [coal, goods, wage] = this.streams;
		return this.purse[i] + this.workerPurse[i] + this.model.workerGoldAt(i) + coal.coin[i] + goods.coin[i] + wage.coin[i];
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
		const { priceCoal, priceLabor, scale } = this.model;
		const unitRate = (actor === ECONOMY_FACTORY ? FACTORY_RATE : SOURCE_RATE) * (scale[i] || 1);
		const costRate = actor === ECONOMY_FACTORY
			? (priceCoal[i] / FACTORY_YIELD + priceLabor[i] * FACTORY_LABOR) * unitRate
			: priceLabor[i] * unitRate * (actor === ECONOMY_GOLD ? GOLD_LABOR : MINE_LABOR);
		const payout = Math.max(0, this.purse[i] - costRate * RESERVE_SECONDS) * this.payoutShare;
		this.purse[i] -= payout;
		this.payWorkers(i, payout);
	}
}

if (typeof module === 'object') module.exports = { GoldMoney };
