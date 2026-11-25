// Owns: conserved gold — municipal & resident purses, worker wallets, Transport Company vault and trade-credit payables.
// Edit for: starting gold calibration, arrival split settlement, Transport Company carrier drip, wages and living taxes.
'use strict';

const START_PRICE = 4;
const PURSE_SECONDS = 15;
const WORKER_SECONDS = 10;
const RESERVE_SECONDS = 4;
const GOLD_RATE = 0.4;
const GOLD_YIELD = GOLD_RATE / (SOURCE_RATE * GOLD_LABOR);
const START_TAX_PER_POP = START_PRICE / (INPUT_SHARE * (GOODS_COMFORT / TOWN_GOODS_NEED));
const PAYOUT_RATE = 1;
const TRANSPORT_DRIP_RATE = 0.12;
const PAY_COAL = 0;
const PAY_GOODS = 1;
const PAY_WAGE = 2;
const PAYABLE_CAP = 256;

class GoldMoney {
	constructor(model) {
		this.model = model;
		this.purse = new Float64Array(ECONOMY_SIZE);
		this.workerPurse = new Float64Array(ECONOMY_SIZE);
		this.owedWage = new Float64Array(ECONOMY_SIZE);
		this.owedTransport = new Float64Array(ECONOMY_SIZE);
		this.owedGoods = new Float64Array(ECONOMY_SIZE);
		this.payBuyer = new Int32Array(PAYABLE_CAP);
		this.payOwnerIdx = new Int32Array(PAYABLE_CAP);
		this.payAmount = new Float64Array(PAYABLE_CAP);
		this.payCount = 0;
		this.wageClaims = [];
		this.transportVault = 0;
		this.transportEarned = 0;
		this.transportDrip = true;
		this.taxShare = (1 - REST_TAX_SHARE) * (1 - Math.exp(-ECONOMY_DT / WORKER_SECONDS));
		this.payoutShare = 1 - Math.exp(-ECONOMY_DT * PAYOUT_RATE);
		this.dripShare = 1 - Math.exp(-ECONOMY_DT * TRANSPORT_DRIP_RATE);
	}

	reset() {
		this.purse.fill(0);
		this.workerPurse.fill(0);
		this.owedWage.fill(0);
		this.owedTransport.fill(0);
		this.owedGoods.fill(0);
		this.payCount = 0;
		this.wageClaims.length = 0;
		this.transportVault = 0;
		this.transportEarned = 0;
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
		this.transportVault += this.purse[i] + this.workerPurse[i];
		this.purse[i] = 0;
		this.workerPurse[i] = 0;
		this.owedWage[i] = this.owedTransport[i] = this.owedGoods[i] = 0;
		for (let k = this.wageClaims.length - 1; k >= 0; k--) if (this.wageClaims[k].firm === i) this.wageClaims.splice(k, 1);
		let k = 0;
		while (k < this.payCount) {
			if (this.payBuyer[k] === i) this.removePayable(k);
			else k++;
		}
	}

	orphan(i, amount) {
		if (amount <= 0) return;
		if (this.model.actors[i] === ECONOMY_TOWN) this.workerPurse[i] += amount;
		else this.transportVault += amount;
	}

	dig(i, amount) {
		this.purse[i] += amount;
		this.mined += amount;
	}

	creditTransport(amount) {
		this.transportVault += amount;
		this.transportEarned += amount;
	}

	creditOwner(owner, amount) {
		if (amount <= 0) return;
		if (this.model.isProducer(owner)) this.purse[owner] += amount;
		else this.orphan(owner, amount);
	}

	addPayable(buyer, owner, amount) {
		if (amount <= 0) return;
		this.owedGoods[buyer] += amount;
		for (let k = 0; k < this.payCount; k++) {
			if (this.payBuyer[k] === buyer && this.payOwnerIdx[k] === owner) {
				this.payAmount[k] += amount;
				return;
			}
		}
		if (this.payCount >= PAYABLE_CAP) return;
		const k = this.payCount++;
		this.payBuyer[k] = buyer;
		this.payOwnerIdx[k] = owner;
		this.payAmount[k] = amount;
	}

	removePayable(k) {
		const last = --this.payCount;
		if (k === last) return;
		this.payBuyer[k] = this.payBuyer[last];
		this.payOwnerIdx[k] = this.payOwnerIdx[last];
		this.payAmount[k] = this.payAmount[last];
	}

	// Arrival split: buyer pays cash up to purse, credits Transport Company first and owner second; cold-start shortfall enters owed.
	payArrival(buyer, owner, transportFee, factoryRevenue) {
		const bill = transportFee + factoryRevenue;
		if (bill <= 0) return;
		const cash = Math.min(this.purse[buyer], bill);
		this.purse[buyer] -= cash;
		const cashTransport = cash === bill ? transportFee : cash * (transportFee / bill);
		const cashOwner = cash - cashTransport;
		if (cashTransport > 0) this.creditTransport(cashTransport);
		if (cashOwner > 0) this.creditOwner(owner, cashOwner);
		const unpaidTransport = transportFee - cashTransport;
		const unpaidOwner = factoryRevenue - cashOwner;
		if (unpaidTransport > 1e-15) this.owedTransport[buyer] += unpaidTransport;
		if (unpaidOwner > 1e-15) this.addPayable(buyer, owner, unpaidOwner);
	}

	bill(i, stream, amount) {
		if (amount <= 0) return;
		if (stream === PAY_WAGE) this.owedWage[i] += amount;
		else this.owedTransport[i] += amount;
	}

	owedAt(i) {
		return this.owedWage[i] + this.owedTransport[i] + this.owedGoods[i];
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

	payRestTax(i, restTax) {
		this.purse[i] += restTax;
		this.taxes += restTax;
	}

	payOnEntry(i, amount, workerId = 0) {
		const pay = Math.min(amount, this.purse[i]);
		this.purse[i] -= pay;
		this.model.laborFlow.gold[i] += pay;
		this.wages += pay;
		const owed = amount - pay;
		this.owedWage[i] += owed;
		if (workerId && owed > 0) this.addWageClaim(i, workerId, owed);
		return pay;
	}

	addWageClaim(firm, worker, amount) {
		for (let k = 0; k < this.wageClaims.length; k++) {
			const claim = this.wageClaims[k];
			if (claim.firm !== firm || claim.worker !== worker) continue;
			claim.amount += amount;
			return;
		}
		this.wageClaims.push({ firm, worker, amount });
	}

	unpaidWages(worker) {
		let total = 0;
		for (let k = 0; k < this.wageClaims.length; k++) if (this.wageClaims[k].worker === worker) total += this.wageClaims[k].amount;
		return total;
	}

	// Wage debt belongs to the original hire, even after he has walked to a different cell.
	payWageClaims(i, budget) {
		const workers = this.model.workers;
		let left = budget;
		for (let k = 0; k < this.wageClaims.length && left > 0;) {
			const claim = this.wageClaims[k];
			if (claim.firm !== i) { k++; continue; }
			const pay = Math.min(left, claim.amount);
			const p = workers.byWid(claim.worker);
			if (p >= 0) {
				workers.creditWallet(p, pay);
				workers.noteWallet(p, pay, STATE_FRESH, i);
			} else this.orphan(i, pay);
			claim.amount -= pay;
			left -= pay;
			if (claim.amount <= 0) this.wageClaims.splice(k, 1);
			else k++;
		}
		this.wages += budget - left;
		if (left > 0) this.payWorkers(i, left);
	}

	payWorkers(i, amount) {
		if (amount <= 0) return;
		const m = this.model;
		const paid = m.workers.payIncome(i, amount);
		const left = amount - paid;
		const onSite = m.labor[i] + m.depleted[i];
		if (onSite > 1e-12) {
			const toDepleted = left * (m.depleted[i] / onSite);
			m.depletedFlow.gold[i] += toDepleted;
			m.laborFlow.gold[i] += left - toDepleted;
		} else this.transportVault += left;
		this.wages += amount;
	}

	collectTax(i, comfort) {
		const m = this.model;
		const mult = m.derived ? m.optimizer.townEffectiveMult(i) : 1;
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
		return this.purse[i] + this.workerPurse[i] + this.model.workerGoldAt(i);
	}

	total() {
		let sum = this.transportVault + this.model.workers.goldTotal();
		for (let i = 0; i < ECONOMY_SIZE; i++) sum += this.held(i);
		return sum;
	}

	step() {
		const { actors } = this.model;
		const mined = this.mined, wages = this.wages, taxes = this.taxes;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (actors[i]) this.settle(i, actors[i]);
		}
		if (this.transportDrip) this.dripTransport();
		this.mineRate = (this.mined - mined) / ECONOMY_DT;
		this.wageRate = (this.wages - wages) / ECONOMY_DT;
		this.taxRate = (this.taxes - taxes) / ECONOMY_DT;
	}

	// Carrier dividends/wages return gently to active town households so closed maps never hoard gold in the vault.
	dripTransport() {
		if (this.transportVault <= 1e-12) return;
		const { actors, pop } = this.model;
		let totalPop = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (actors[i] === ECONOMY_TOWN) totalPop += pop[i];
		}
		if (totalPop <= 1e-9) return;
		const budget = this.transportVault * this.dripShare;
		let paid = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (actors[i] !== ECONOMY_TOWN || pop[i] <= 0) continue;
			const share = Math.min(this.transportVault - paid, budget * (pop[i] / totalPop));
			this.workerPurse[i] += share;
			paid += share;
		}
		this.transportVault -= paid;
	}

	settle(i, actor) {
		const owed = this.owedAt(i);
		if (owed > 0 && this.purse[i] > 0) {
			const share = Math.min(1, this.purse[i] / owed);
			if (this.owedWage[i] > 0 && this.purse[i] > 0) {
				const pay = Math.min(this.purse[i], share >= 1 ? this.owedWage[i] : this.owedWage[i] * share);
				this.purse[i] -= pay;
				this.owedWage[i] = Math.max(0, this.owedWage[i] - pay);
				this.settled += pay;
				this.payWageClaims(i, pay);
			}
			if (this.owedTransport[i] > 0 && this.purse[i] > 0) {
				const pay = Math.min(this.purse[i], share >= 1 ? this.owedTransport[i] : this.owedTransport[i] * share);
				this.purse[i] -= pay;
				this.owedTransport[i] = Math.max(0, this.owedTransport[i] - pay);
				this.settled += pay;
				this.creditTransport(pay);
			}
			if (this.owedGoods[i] > 0 && this.purse[i] > 0) this.settlePayables(i, share);
		}
		if (actor !== ECONOMY_TOWN) this.payFirmSurplus(i, actor);
	}

	settlePayables(buyer, share) {
		let k = 0;
		while (k < this.payCount) {
			if (this.payBuyer[k] !== buyer) {
				k++;
				continue;
			}
			const amt = this.payAmount[k];
			const pay = Math.min(this.purse[buyer], share >= 1 ? amt : amt * share);
			this.purse[buyer] -= pay;
			this.owedGoods[buyer] = Math.max(0, this.owedGoods[buyer] - pay);
			this.settled += pay;
			this.creditOwner(this.payOwnerIdx[k], pay);
			if (amt - pay <= 1e-14) {
				this.owedGoods[buyer] = Math.max(0, this.owedGoods[buyer] - (amt - pay));
				this.removePayable(k);
			} else {
				this.payAmount[k] = amt - pay;
				k++;
			}
		}
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
