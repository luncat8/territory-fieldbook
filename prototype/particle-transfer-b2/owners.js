// Owns: stable owner/facility identities, worker proprietors, owner-level debt limits and shared gold spending envelopes.
// Edit for: portfolio allocation, capital transfers and facility ownership; physical stock stays at the site.
'use strict';

const OWNER_DEBT_LIMIT = 10;

class OwnerAccounts {
	constructor(model) {
		this.model = model;
		this.cell = new Int32Array(ECONOMY_SIZE);
		this.budget = new Float64Array(ECONOMY_SIZE);
		this.accounts = [null];
		this.facilities = [null];
	}

	reset() {
		this.cell.fill(0);
		this.budget.fill(0);
		this.accounts.length = this.facilities.length = 1;
	}

	create(workerId = -1, municipal = false) {
		const id = this.accounts.length;
		this.accounts.push({ workerId, municipal, cash: 0, wageDebt: 0, loanDebt: 0, debtLimit: municipal ? 0 : OWNER_DEBT_LIMIT, sites: 0 });
		return id;
	}

	ownerAt(cell) {
		return this.facilities[this.cell[cell]]?.owner || 0;
	}

	accountAt(cell) {
		return this.accounts[this.ownerAt(cell)];
	}

	workerOwner(workerId) {
		for (let id = 1; id < this.accounts.length; id++) {
			const a = this.accounts[id];
			if (!a.municipal && workerId > 0 && a.workerId === workerId) return id;
		}
		return this.create(workerId);
	}

	found(cell, workerId = -1) {
		if (this.cell[cell]) return this.cell[cell];
		const municipal = this.model.actors[cell] === ECONOMY_TOWN;
		const owner = municipal ? this.create(-1, true) : this.workerOwner(workerId);
		const id = this.facilities.length;
		this.facilities.push({ owner, cell });
		this.cell[cell] = id;
		this.accounts[owner].sites++;
		this.allocate();
		return id;
	}

	release(cell) {
		const id = this.cell[cell];
		if (!id) return;
		const f = this.facilities[id];
		this.accounts[f.owner].sites--;
		f.cell = -1;
		this.cell[cell] = 0;
		this.budget[cell] = 0;
	}

	allocate() {
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = this.accountAt(i);
			this.budget[i] = a ? a.cash / a.sites : 0;
		}
	}

	available(cell) {
		const a = this.accountAt(cell);
		return a ? Math.min(a.cash, this.budget[cell]) : 0;
	}

	spend(cell, amount) {
		const paid = Math.min(Math.max(0, amount), this.available(cell));
		if (!paid) return 0;
		this.accountAt(cell).cash -= paid;
		this.budget[cell] -= paid;
		return paid;
	}

	invest(worker, cell, amount) {
		const { workers } = this.model, a = this.accountAt(cell);
		if (!a || a.workerId !== workers.id[worker] || amount <= 0) return 0;
		const paid = Math.min(workers.gold[worker], amount);
		workers.gold[worker] -= paid;
		a.cash += paid;
		this.budget[cell] += paid / a.sites;
		this.model.tracker.expense(worker, paid, cell);
		return paid;
	}

	buyFacility(cell, worker, price) {
		const { workers } = this.model, f = this.facilities[this.cell[cell]];
		if (!f || price < 0 || !Number.isFinite(price) || workers.gold[worker] < price || worker < 0 || worker >= workers.count) return false;
		const seller = this.accounts[f.owner];
		const buyer = this.workerOwner(workers.id[worker]);
		if (buyer === f.owner || seller.municipal) return false;
		workers.gold[worker] -= price;
		this.model.tracker.expense(worker, price, cell);
		seller.cash += price;
		seller.sites--;
		f.owner = buyer;
		this.accounts[buyer].sites++;
		this.allocate();
		return true;
	}

	total() {
		let total = 0;
		for (let id = 1; id < this.accounts.length; id++) total += this.accounts[id].cash;
		return total;
	}
}

if (typeof module === 'object') module.exports = { OwnerAccounts, OWNER_DEBT_LIMIT };
