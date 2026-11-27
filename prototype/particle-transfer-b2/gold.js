// Owns: scenario gold and timber origin, mined gold, stable-owner FIFO wage claims and transport/custody accounts.
// Edit for: starting capital allocation, timber reserve and settlement; prices never depend on the scenario gold setting.
'use strict';

const PURSE_SECONDS = 15;
const INITIAL_GOLD_PER_WORKER = 1;
const INITIAL_WALLET_SHARE = 0.5;
const WAGE_CLAIM_CAP = 128;
const VAULT_DRIP_RATE = 0.35;
const TRANSPORT_T0 = 0;
const TRANSPORT_T1 = 1;
const GOLD_TIMBER = 1.5;

class GoldMoney {
	constructor(model) {
		this.model = model;
		this.claimOwner = new Int32Array(WAGE_CLAIM_CAP);
		this.claimWorkerId = new Int32Array(WAGE_CLAIM_CAP);
		this.claimAmount = new Float64Array(WAGE_CLAIM_CAP);
		this.claimCap = WAGE_CLAIM_CAP;
		this.startTaxPerPop = START_PRICE / (INPUT_SHARE * (GOODS_COMFORT / TOWN_GOODS_NEED));
		this.dripShare = 1 - Math.exp(-ECONOMY_DT * VAULT_DRIP_RATE);
		this.transportPreset = TRANSPORT_T0;
	}

	reset() {
		this.model.owners.reset();
		this.claimCount = 0;
		this.transport = 0;
		this.custody = 0;
		this.redistributed = 0;
		this.inputs = 0;
		this.seeded = this.mined = this.wages = this.taxes = this.transportEarned = 0;
		this.mineRate = this.wageRate = this.taxRate = 0;
		this.lastMined = this.lastWages = this.lastTaxes = 0;
		this.initialized = false;
		const { actors } = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (actors[i] && actors[i] !== ECONOMY_GARDEN) this.model.owners.found(i);
		}
	}

	initializeScenario(goldPerWorker) {
		if (this.initialized) return false;
		this.initialized = true;
		const { workers, owners, actors } = this.model;
		const capital = workers.totalAmount() * goldPerWorker;
		this.seeded += capital;
		for (let w = 0; w < workers.count; w++) workers.gold[w] += workers.amount[w] * goldPerWorker * INITIAL_WALLET_SHARE;
		const count = owners.accounts.length - 1;
		if (!count) this.custody += capital * (1 - INITIAL_WALLET_SHARE);
		for (let id = 1; id <= count; id++) {
			const a = owners.accounts[id];
			a.cash += capital * (1 - INITIAL_WALLET_SHARE) / count;
			if (!a.municipal && workers.count) a.workerId = workers.id[(id - 1) % workers.count];
		}
		owners.allocate();
		// Scenario timber is a recorded real asset, not gold: it bridges the first shift until purchases use mined gold.
		for (let i = 0; i < ECONOMY_SIZE; i++) if (actors[i] === ECONOMY_GOLD) this.seedTimber(i, GOLD_TIMBER);
		return true;
	}

	seedWorker(gold) {
		this.seeded += gold;
	}

	// Timber is a real asset: its grant counter lives beside produced/consumed wood so erase/spoilage keeps the ledger exact.
	seedTimber(cell, amount) {
		if (!(amount > 0)) return 0;
		this.model.seededTimber += amount;
		this.model.wood[cell] += amount;
		return amount;
	}

	cash(i) { return this.model.owners.available(i); }
	wageDebt(i) { return this.model.owners.accountAt(i)?.wageDebt || 0; }
	spend(i, amount) { return this.model.owners.spend(i, amount); }

	release(i) {
		this.model.owners.release(i);
	}

	growClaims() {
		const cap = Math.max(16, this.claimCap * 2);
		const owner = new Int32Array(cap), worker = new Int32Array(cap), amount = new Float64Array(cap);
		owner.set(this.claimOwner);
		worker.set(this.claimWorkerId);
		amount.set(this.claimAmount);
		this.claimOwner = owner;
		this.claimWorkerId = worker;
		this.claimAmount = amount;
		this.claimCap = cap;
	}

	dropClaim(k) {
		const last = --this.claimCount;
		for (let j = k; j < last; j++) {
			this.claimOwner[j] = this.claimOwner[j + 1];
			this.claimWorkerId[j] = this.claimWorkerId[j + 1];
			this.claimAmount[j] = this.claimAmount[j + 1];
		}
	}

	dig(i, amount) {
		this.model.owners.accountAt(i).cash += amount;
		this.model.owners.budget[i] += amount;
		this.mined += amount;
	}

	creditCool(i, budget) {
		return 1 + this.wageDebt(i) / Math.max(1e-12, budget);
	}

	townCool(i, budget) {
		const cash = this.cash(i);
		if (cash <= 1e-12) return Infinity;
		return Math.max(1, budget / cash) * this.creditCool(i, budget);
	}

	payEntryWage(cell, worker, bill) {
		if (bill <= 0) return 0;
		const { workers, owners } = this.model;
		const account = owners.accountAt(cell);
		if (account.wageDebt > 0) this.settleOwner(owners.ownerAt(cell));
		const paid = this.spend(cell, bill);
		workers.gold[worker] += paid;
		if (paid > 0) this.model.tracker.income(worker, paid, workers.cell[worker]);
		this.wages += paid;
		const owed = bill - paid;
		if (owed > 1e-15) {
			const owner = owners.ownerAt(cell);
			owners.accounts[owner].wageDebt += owed;
			this.addWageClaim(owner, workers.id[worker], owed);
		}
		return paid;
	}

	addWageClaim(owner, workerId, amount) {
		for (let k = 0; k < this.claimCount; k++) {
			if (this.claimOwner[k] !== owner || this.claimWorkerId[k] !== workerId) continue;
			this.claimAmount[k] += amount;
			return;
		}
		if (this.claimCount >= this.claimCap) this.growClaims();
		const k = this.claimCount++;
		this.claimOwner[k] = owner;
		this.claimWorkerId[k] = workerId;
		this.claimAmount[k] = amount;
	}

	unpaidWages(workerId) {
		let total = 0;
		for (let k = 0; k < this.claimCount; k++) if (this.claimWorkerId[k] === workerId) total += this.claimAmount[k];
		return total;
	}

	settleOwner(owner) {
		const { workers, owners } = this.model, account = owners.accounts[owner];
		for (let k = 0; k < this.claimCount && account.cash > 0;) {
			if (this.claimOwner[k] !== owner) { k++; continue; }
			const pay = Math.min(account.cash, this.claimAmount[k]);
			const w = workers.indexOfId(this.claimWorkerId[k]);
			if (w >= 0) {
				workers.gold[w] += pay;
				this.model.tracker.income(w, pay, workers.cell[w]);
			} else this.custody += pay; // Unclaimed estates hold in custody: it never funds towns or the company.
			account.cash -= pay;
			account.wageDebt = Math.max(0, account.wageDebt - pay);
			this.claimAmount[k] -= pay;
			this.wages += pay;
			if (this.claimAmount[k] <= 1e-15) this.dropClaim(k);
			else k++;
		}
	}

	settleFirm(i) {
		this.settleOwner(this.model.owners.ownerAt(i));
	}

	payTransport(amount) {
		if (amount <= 0) return;
		this.transport += amount;
		this.transportEarned += amount;
	}

	payOwner(owner, amount) {
		if (amount > 0) this.model.owners.accounts[owner].cash += amount;
	}

	payTown(cell, amount) {
		if (amount <= 0) return;
		this.model.owners.accountAt(cell).cash += amount;
		this.taxes += amount;
		this.model.towns.recordRevenue(cell, amount);
	}

	held(i) {
		const a = this.model.owners.accountAt(i);
		return (a ? a.cash / a.sites : 0) + this.model.workerGold[i];
	}
	total() { return this.transport + this.custody + this.model.banks.gold + this.model.workers.totalGold() + this.model.owners.total(); }

	step() {
		const { actors, pop, owners, banks } = this.model;
		const mined = this.lastMined, wages = this.lastWages, taxes = this.lastTaxes;
		for (let id = 1; id < owners.accounts.length; id++) this.settleOwner(id);
		banks.step();
		// T0 redistributes only Transport Company earnings; custody is never town funding.
		let townWeight = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) if (actors[i] === ECONOMY_TOWN) townWeight += Math.max(1, pop[i]);
		if (this.transportPreset === TRANSPORT_T0 && townWeight > 0 && this.transport > 0) {
			const drip = this.transport * this.dripShare;
			this.transport -= drip;
			this.redistributed += drip;
			for (let i = 0; i < ECONOMY_SIZE; i++) {
				if (actors[i] === ECONOMY_TOWN) owners.accountAt(i).cash += drip * Math.max(1, pop[i]) / townWeight;
			}
		}
		this.mineRate = (this.mined - mined) / ECONOMY_DT;
		this.wageRate = (this.wages - wages) / ECONOMY_DT;
		this.taxRate = (this.taxes - taxes) / ECONOMY_DT;
		this.lastMined = this.mined;
		this.lastWages = this.wages;
		this.lastTaxes = this.taxes;
	}
}

if (typeof module === 'object') module.exports = { GoldMoney, INITIAL_GOLD_PER_WORKER, GOLD_TIMBER, TRANSPORT_T0, TRANSPORT_T1 };
