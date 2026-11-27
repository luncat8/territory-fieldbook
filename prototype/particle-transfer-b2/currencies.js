// Owns: paper-note issuer registry, per-issuer worker/owner balances, town consent and the note ledger identity.
// Edit for: issuer policy and denomination settlement primitives; gold stays in gold.js/banks.js, loans in banks.js.
'use strict';

const CURRENCY_CAP = 2;

class Currencies {
	constructor(model) {
		this.model = model;
		this.issuers = []; // { id, name, issued, retired, bankHeld } — issued - retired = every outstanding balance
		this.workerNotes = []; // per issuer Float64Array(MAX_WORKERS), columns move with the worker pool
		this.accountNotes = []; // per issuer Float64Array indexed by owner account id, grown with the registry
		this.custody = []; // per issuer scalar: despawned workers' notes, spent by nothing
		this.accept = []; // per issuer Uint8Array(ECONOMY_SIZE): consenting town cells
	}

	reset() {
		this.issuers.length = 0;
		this.workerNotes.length = 0;
		this.accountNotes.length = 0;
		this.custody.length = 0;
		this.accept.length = 0;
	}

	charter(name) {
		if (this.issuers.length >= CURRENCY_CAP) return -1;
		const k = this.issuers.length;
		this.issuers.push({ id: k, name, issued: 0, retired: 0, bankHeld: 0 });
		this.workerNotes.push(new Float64Array(MAX_WORKERS));
		this.accountNotes.push(new Float64Array(1));
		this.custody.push(0);
		this.accept.push(new Uint8Array(ECONOMY_SIZE));
		const { actors } = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) if (actors[i] === ECONOMY_TOWN) this.stampTown(i);
		return k;
	}

	// Consent is deterministic per cell, not universal: cheap and med towns take notes, rich towns insist on gold.
	stampTown(i) {
		if (this.model.wealthClass[i] === WEALTH_RICH) return;
		for (const flags of this.accept) flags[i] = 1;
	}

	unstampTown(i) {
		for (const flags of this.accept) flags[i] = 0;
	}

	townAccepts(k, i) {
		return this.accept[k] && this.accept[k][i] === 1;
	}

	ensureAccounts() {
		const need = this.model.owners.accounts.length;
		for (let k = 0; k < this.accountNotes.length; k++) {
			if (this.accountNotes[k].length >= need) continue;
			const grown = new Float64Array(Math.max(need, this.accountNotes[k].length * 2));
			grown.set(this.accountNotes[k]);
			this.accountNotes[k] = grown;
		}
	}

	// Origination: new note liabilities into an owner account. Adds no gold anywhere.
	issueToAccount(k, cell, amount) {
		if (!(amount > 0)) return 0;
		this.ensureAccounts();
		this.issuers[k].issued += amount;
		this.accountNotes[k][this.model.owners.ownerAt(cell)] += amount;
		return amount;
	}

	accountBalance(k, cell) {
		this.ensureAccounts();
		return this.accountNotes[k][this.model.owners.ownerAt(cell)];
	}

	workerBalance(k, w) {
		return this.workerNotes[k][w];
	}

	// Employer pays a worker in notes; a transfer between holders leaves the note ledger untouched.
	accountToWorker(k, cell, w, amount) {
		const paid = Math.min(Math.max(0, amount), this.accountBalance(k, cell));
		if (!(paid > 0)) return 0;
		this.accountNotes[k][this.model.owners.ownerAt(cell)] -= paid;
		this.workerNotes[k][w] += paid;
		return paid;
	}

	// Worker buys rest/rations in notes at a consenting town; a transfer between holders.
	workerToAccount(k, w, cell, amount) {
		const paid = Math.min(Math.max(0, amount), this.workerNotes[k][w]);
		if (!(paid > 0)) return 0;
		this.workerNotes[k][w] -= paid;
		this.accountNotes[k][this.model.owners.ownerAt(cell)] += paid;
		return paid;
	}

	// Holder hands notes back to the issuer: the notes are destroyed, bank-held earnings are a different bucket.
	retireAccount(k, cell, amount) {
		const paid = Math.min(Math.max(0, amount), this.accountBalance(k, cell));
		if (!(paid > 0)) return 0;
		this.accountNotes[k][this.model.owners.ownerAt(cell)] -= paid;
		this.issuers[k].retired += paid;
		return paid;
	}

	// Interest paid in notes becomes the bank's own holding; it stays an outstanding liability.
	accountToBank(k, cell, amount) {
		const paid = Math.min(Math.max(0, amount), this.accountBalance(k, cell));
		if (!(paid > 0)) return 0;
		this.accountNotes[k][this.model.owners.ownerAt(cell)] -= paid;
		this.issuers[k].bankHeld += paid;
		return paid;
	}

	splitWorker(w, child) {
		for (let k = 0; k < this.issuers.length; k++) {
			const col = this.workerNotes[k];
			col[child] = col[w] / 2;
			col[w] /= 2;
		}
	}

	// Compacted slots keep stale tail values; every spawn must start from a zero note balance.
	initWorker(w) {
		for (let k = 0; k < this.issuers.length; k++) this.workerNotes[k][w] = 0;
	}

	// A despawned worker's notes stay outstanding in custody until a declared policy claims them.
	onWorkerRemoved(w, last) {
		for (let k = 0; k < this.issuers.length; k++) {
			const col = this.workerNotes[k];
			this.custody[k] += col[w];
			col[w] = col[last];
		}
	}

	heldSum(k) {
		let sum = this.custody[k] + this.issuers[k].bankHeld;
		for (let w = 0; w < this.model.workers.count; w++) sum += this.workerNotes[k][w];
		for (let id = 1; id < this.model.owners.accounts.length; id++) sum += this.accountNotes[k][id];
		return sum;
	}

	invariantError(k) {
		return Math.abs(this.issuers[k].issued - this.issuers[k].retired - this.heldSum(k));
	}

	totalOutstanding() {
		let sum = 0;
		for (let k = 0; k < this.issuers.length; k++) sum += this.issuers[k].issued - this.issuers[k].retired;
		return sum;
	}
}

if (typeof module === 'object') module.exports = { Currencies, CURRENCY_CAP };
