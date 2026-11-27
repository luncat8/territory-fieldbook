// Owns: conserved gold — municipal & firm purses, worker wallets, the Transport Company vault and town drip.
// Edit for: starting gold calibration, entry-wage prepayment, firm surplus bonuses and Transport Company drip.
'use strict';

const PURSE_SECONDS = 15;
const RESERVE_SECONDS = 4;
const SEED_WORKER_GOLD = 8;
const SEED_FIRM_GOLD = 12;
const VAULT_DRIP_RATE = 0.35;
const SURPLUS_PAYOUT_RATE = 0.8;
const WAGE_CLAIM_CAP = 128;

class GoldMoney {
	constructor(model) {
		this.model = model;
		this.purse = new Float64Array(ECONOMY_SIZE);
		this.owedWage = new Float64Array(ECONOMY_SIZE);
		// SoA FIFO of unpaid entry wages: debt belongs to the original hire even after he walks away.
		this.claimFirm = new Int32Array(WAGE_CLAIM_CAP);
		this.claimWorkerId = new Int32Array(WAGE_CLAIM_CAP);
		this.claimAmount = new Float64Array(WAGE_CLAIM_CAP);
		this.claimCap = WAGE_CLAIM_CAP;
		this.claimCount = 0;
		this.vault = 0;
		this.startTaxPerPop = START_PRICE / (INPUT_SHARE * (GOODS_COMFORT / TOWN_GOODS_NEED));
		this.dripShare = 1 - Math.exp(-ECONOMY_DT * VAULT_DRIP_RATE);
		this.payoutShare = 1 - Math.exp(-ECONOMY_DT * SURPLUS_PAYOUT_RATE);
	}

	reset() {
		this.purse.fill(0);
		this.owedWage.fill(0);
		this.claimCount = 0;
		this.vault = 0;
		this.seeded = this.mined = this.wages = this.taxes = this.transportEarned = 0;
		this.mineRate = this.wageRate = this.taxRate = 0;
		const { actors } = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = actors[i];
			if (a === ECONOMY_TOWN) this.seedTown(i);
			else if (a && a !== ECONOMY_GARDEN) this.seedFirm(i);
		}
	}

	seedTown(i) {
		const townGold = START_POP * this.startTaxPerPop * INPUT_SHARE * PURSE_SECONDS;
		this.purse[i] += townGold;
		this.seeded += townGold;
	}

	seedFirm(i) {
		this.purse[i] += SEED_FIRM_GOLD;
		this.seeded += SEED_FIRM_GOLD;
	}

	seedWorker(gold) {
		this.seeded += gold;
	}

	release(i) {
		this.vault += this.purse[i];
		this.purse[i] = 0;
		this.owedWage[i] = 0;
		// Erasing a firm forgives its wage promises: they were liabilities, never minted gold.
		this.removeClaimsFor(i);
	}

	// Grows the SoA claim table in place; a fixed cap that silently drops an entry would lose a
	// worker's entitlement while `owedWage` still carried the debt.
	growClaims() {
		const cap = Math.max(16, this.claimCap * 2);
		const firm = new Int32Array(cap), worker = new Int32Array(cap), amount = new Float64Array(cap);
		firm.set(this.claimFirm);
		worker.set(this.claimWorkerId);
		amount.set(this.claimAmount);
		this.claimFirm = firm;
		this.claimWorkerId = worker;
		this.claimAmount = amount;
		this.claimCap = cap;
	}

	// Drops every claim for a firm, compacting the table while preserving the survivors' FIFO order.
	removeClaimsFor(firm) {
		let w = 0;
		for (let k = 0; k < this.claimCount; k++) {
			if (this.claimFirm[k] === firm) continue;
			this.claimFirm[w] = this.claimFirm[k];
			this.claimWorkerId[w] = this.claimWorkerId[k];
			this.claimAmount[w] = this.claimAmount[k];
			w++;
		}
		this.claimCount = w;
	}

	// Removes the claim at k, shifting later entries down so settlement keeps FIFO order.
	dropClaim(k) {
		const last = --this.claimCount;
		for (let j = k; j < last; j++) {
			this.claimFirm[j] = this.claimFirm[j + 1];
			this.claimWorkerId[j] = this.claimWorkerId[j + 1];
			this.claimAmount[j] = this.claimAmount[j + 1];
		}
	}

	dig(i, amount) {
		this.purse[i] += amount;
		this.mined += amount;
	}

	creditCool(i, budget) {
		return 1 + this.owedWage[i] / (budget + 1e-9);
	}

	townCool(i, budget) {
		const cash = this.purse[i];
		if (cash <= 1e-9) return Infinity;
		return (cash >= budget ? 1 : budget / cash) * this.creditCool(i, budget);
	}

	// Prepays the shift at pool entry from the firm purse; a zero-purse newly founded firm books the
	// shortfall as an SoA wage claim on the original worker, settled from later firm cash.
	payEntryWage(firmCell, workerIdx, bill) {
		if (bill <= 0) return 0;
		const paid = Math.min(bill, this.purse[firmCell]);
		this.purse[firmCell] -= paid;
		this.model.workers.gold[workerIdx] += paid;
		if (paid > 0) this.model.tracker.income(workerIdx, paid, this.model.workers.cell[workerIdx]);
		this.wages += paid;
		const owed = bill - paid;
		if (owed > 1e-15) {
			this.owedWage[firmCell] += owed;
			this.addWageClaim(firmCell, this.model.workers.id[workerIdx], owed);
		}
		if (this.purse[firmCell] < 1e-14) this.purse[firmCell] = 0;
		return paid;
	}

	addWageClaim(firm, workerId, amount) {
		for (let k = 0; k < this.claimCount; k++) {
			if (this.claimFirm[k] !== firm || this.claimWorkerId[k] !== workerId) continue;
			this.claimAmount[k] += amount;
			return;
		}
		if (this.claimCount >= this.claimCap) this.growClaims();
		const k = this.claimCount++;
		this.claimFirm[k] = firm;
		this.claimWorkerId[k] = workerId;
		this.claimAmount[k] = amount;
	}

	unpaidWages(workerId) {
		let total = 0;
		for (let k = 0; k < this.claimCount; k++) if (this.claimWorkerId[k] === workerId) total += this.claimAmount[k];
		return total;
	}

	// Pays a firm's wage claims FIFO to the original hires; despawned workers' shares fall to the vault.
	payWageClaims(firm, budget) {
		const workers = this.model.workers;
		let left = budget;
		for (let k = 0; k < this.claimCount && left > 1e-15;) {
			if (this.claimFirm[k] !== firm) { k++; continue; }
			const pay = Math.min(left, this.claimAmount[k]);
			const w = workers.indexOfId(this.claimWorkerId[k]);
			if (w >= 0) {
				workers.gold[w] += pay;
				this.model.tracker.income(w, pay, workers.cell[w]);
			} else this.vault += pay;
			this.claimAmount[k] -= pay;
			left -= pay;
			if (this.claimAmount[k] <= 1e-15) this.dropClaim(k);
			else k++;
		}
		// The purse already debited the whole budget; unclaimable fp dust keeps the books exact via the vault.
		if (left > 0) this.vault += left;
	}

	payTransport(amount) {
		if (amount <= 0) return;
		this.vault += amount;
		this.transportEarned += amount;
	}

	payOwner(ownerCell, amount) {
		if (amount <= 0) return;
		const a = this.model.actors[ownerCell];
		if (a && a !== ECONOMY_TOWN && a !== ECONOMY_GARDEN) this.purse[ownerCell] += amount;
		else this.vault += amount;
	}

	payTown(townCell, amount) {
		if (amount <= 0) return;
		this.purse[townCell] += amount;
		this.taxes += amount;
		this.model.towns.recordRevenue(townCell, amount);
	}

	held(i) {
		return this.purse[i] + this.model.workerGold[i];
	}

	total() {
		let sum = this.vault + this.model.workers.totalGold();
		for (let i = 0; i < ECONOMY_SIZE; i++) sum += this.purse[i];
		return sum;
	}

	step() {
		const { actors, pop } = this.model;
		const mined = this.mined, wages = this.wages, taxes = this.taxes;
		let townWeight = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = actors[i];
			if (!a || a === ECONOMY_GARDEN) continue;
			if (a === ECONOMY_TOWN) {
				townWeight += Math.max(1, pop[i]);
				continue;
			}
			this.settleFirm(i, a);
		}
		if (townWeight > 0 && this.vault > 1e-9) {
			const drip = this.vault * this.dripShare;
			this.vault -= drip;
			for (let i = 0; i < ECONOMY_SIZE; i++) {
				if (actors[i] === ECONOMY_TOWN) this.purse[i] += drip * (Math.max(1, pop[i]) / townWeight);
			}
		}
		this.mineRate = (this.mined - mined) / ECONOMY_DT;
		this.wageRate = (this.wages - wages) / ECONOMY_DT;
		this.taxRate = (this.taxes - taxes) / ECONOMY_DT;
	}

	settleFirm(i, actor) {
		const { workers, priceCoal, priceLabor, scale } = this.model;
		if (this.owedWage[i] > 1e-12 && this.purse[i] > 1e-12) {
			const pay = Math.min(this.purse[i], this.owedWage[i]);
			this.purse[i] -= pay;
			this.owedWage[i] -= pay;
			if (this.purse[i] < 1e-14) this.purse[i] = 0;
			this.payWageClaims(i, pay);
			this.wages += pay;
		}
		if (!workers.hasOnSite(i)) return;
		const unitRate = actor === ECONOMY_FARM ? this.model.farms.crewTarget(i) * WORK_RATE
			: (actor === ECONOMY_FACTORY ? FACTORY_RATE : SOURCE_RATE) * (scale[i] || 1);
		const costRate = actor === ECONOMY_FARM ? priceLabor[i] * unitRate : actor === ECONOMY_FACTORY
			? (priceCoal[i] / FACTORY_YIELD + priceLabor[i] * FACTORY_LABOR) * unitRate
			: priceLabor[i] * unitRate * (actor === ECONOMY_GOLD ? GOLD_LABOR : MINE_LABOR);
		const surplus = Math.max(0, this.purse[i] - costRate * RESERVE_SECONDS) * this.payoutShare;
		if (surplus <= 1e-9) return;
		this.purse[i] -= surplus;
		workers.payOnSite(i, surplus);
		this.wages += surplus;
	}
}

if (typeof module === 'object') module.exports = { GoldMoney, SEED_WORKER_GOLD };
