// Owns: stable owner and facility identities — shared owner cash, paid-in capital, wage liabilities, facility mapping, budgets and debt limits.
// Edit for: owner capacity, per-facility budget split and the fixed debt-limit policy.
'use strict';

const OWNER_CAP = 64;
const OWNER_NONE = 0;
const OWNER_DEBT_LIMIT = 6;

// Per-owner SoA columns grow by copy; owner ids index every column, so ids stay stable across growth.
function growColumn(old, Type, cap) {
	const next = new Type(cap);
	if (old) next.set(old);
	return next;
}

// One registry serves both presets: isolated owners are simply one facility per owner (plan M.1a).
class OwnerRegistry {
	constructor(model) {
		this.model = model;
		this.facilityOwner = new Int32Array(ECONOMY_SIZE);
		this.facilityId = new Int32Array(ECONOMY_SIZE);
		this.allocate(OWNER_CAP);
	}

	allocate(cap) {
		this.cash = growColumn(this.cash, Float64Array, cap);
		this.capital = growColumn(this.capital, Float64Array, cap);
		this.owed = growColumn(this.owed, Float64Array, cap);
		// Note balances (plan M.4 F3): the bank's own notes held by the owner, separate from gold cash.
		this.notes = growColumn(this.notes, Float64Array, cap);
		this.workerId = growColumn(this.workerId, Int32Array, cap);
		this.facilities = growColumn(this.facilities, Int32Array, cap);
		this.debtLimit = growColumn(this.debtLimit, Float64Array, cap);
		this.reserve = growColumn(this.reserve, Float64Array, cap);
		this.extracts = growColumn(this.extracts, Uint8Array, cap);
		this.cap = cap;
		if (this.model.bank) this.model.bank.allocate(cap);
	}

	reset() {
		this.facilityOwner.fill(OWNER_NONE);
		this.facilityId.fill(0);
		for (const col of [this.cash, this.capital, this.owed, this.notes, this.workerId, this.facilities, this.debtLimit, this.reserve, this.extracts]) col.fill(0);
		this.count = 1;
		this.nextFacility = 0;
	}

	// Owner 0 is the "none" sentinel so an Int32Array default never names a real payee.
	create(workerId) {
		if (this.count >= this.cap) this.allocate(this.cap * 2);
		const o = this.count++;
		this.workerId[o] = workerId;
		this.debtLimit[o] = OWNER_DEBT_LIMIT;
		return o;
	}

	ownerOfWorker(workerId) {
		if (workerId < 0) return OWNER_NONE;
		for (let o = 1; o < this.count; o++) if (this.workerId[o] === workerId) return o;
		return OWNER_NONE;
	}

	attach(cell, o) {
		this.facilityOwner[cell] = o;
		this.facilityId[cell] = ++this.nextFacility;
		this.facilities[o]++;
	}

	// The owner keeps cash, wage claims and debt; only the facility link ends.
	detach(cell) {
		const o = this.facilityOwner[cell];
		if (o) this.facilities[o]--;
		this.facilityOwner[cell] = OWNER_NONE;
		this.facilityId[cell] = 0;
	}

	ownerAt(cell) {
		return this.facilityOwner[cell];
	}

	// Bounded per-facility share of the shared purse: a portfolio never bids its full cash at every site.
	// Includes held notes (M.4 F3) so a note-paying owner can still size wages and admission bids; gold-only
	// views use goldAt so the stock overlay never counts notes as gold.
	budgetAt(cell) {
		const o = this.facilityOwner[cell];
		return o ? (this.cash[o] + this.notes[o]) / Math.max(1, this.facilities[o]) : 0;
	}

	goldAt(cell) {
		const o = this.facilityOwner[cell];
		return o ? this.cash[o] / Math.max(1, this.facilities[o]) : 0;
	}

	owedAt(cell) {
		const o = this.facilityOwner[cell];
		return o ? this.owed[o] / Math.max(1, this.facilities[o]) : 0;
	}

	debtHeadroom(o) {
		const scale = this.model.money ? this.model.money.unitScale() : 1;
		return Math.max(0, this.debtLimit[o] * scale - this.model.bank.principal[o]);
	}

	totalCash() {
		let sum = 0;
		for (let o = 1; o < this.count; o++) sum += this.cash[o];
		return sum;
	}

	totalNotes() {
		let sum = 0;
		for (let o = 1; o < this.count; o++) sum += this.notes[o];
		return sum;
	}

	totalOwed() {
		let sum = 0;
		for (let o = 1; o < this.count; o++) sum += this.owed[o];
		return sum;
	}
}

if (typeof module === 'object') module.exports = { OwnerRegistry, growColumn, OWNER_NONE, OWNER_DEBT_LIMIT };
