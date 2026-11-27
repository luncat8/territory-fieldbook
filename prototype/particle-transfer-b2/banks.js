// Owns: the capital-funded gold bank (F1) — loan origination, simple-interest debt service, arrears, default and bank ledgers.
// Edit for: loan size, rate, term, grace period and the lending refusal rules; never physical production or note issuance.
'use strict';

const LOAN_RATE = 0.002;
const LOAN_TERM_SECONDS = 90;
const LOAN_GRACE_SECONDS = 30;
const LOAN_COVER_SECONDS = 24;
const LOAN_MIN = 0.25;
const LOAN_SLACK_SECONDS = 4;
const LOAN_RETRY_SECONDS = 5;

// Lends only existing gold: origination moves reserve to the borrower, repayment moves it back (plan M.4 F1).
class GoldBank {
	constructor(model) {
		this.model = model;
		this.allocate(OWNER_CAP);
	}

	allocate(cap) {
		this.principal = growColumn(this.principal, Float64Array, cap);
		this.original = growColumn(this.original, Float64Array, cap);
		this.interestDue = growColumn(this.interestDue, Float64Array, cap);
		this.principalDue = growColumn(this.principalDue, Float64Array, cap);
		this.overdue = growColumn(this.overdue, Float64Array, cap);
		this.defaulted = growColumn(this.defaulted, Uint8Array, cap);
		this.retryAt = growColumn(this.retryAt, Float64Array, cap);
	}

	reset() {
		for (const col of [this.principal, this.original, this.interestDue, this.principalDue, this.overdue, this.defaulted, this.retryAt]) col.fill(0);
		this.reserve = this.capital = 0;
		this.lent = this.repaid = this.interest = this.writtenOff = 0;
		this.loans = this.cleared = this.defaults = this.refusals = 0;
	}

	fund(amount) {
		this.reserve += amount;
		this.capital += amount;
	}

	loanAssets() {
		let sum = 0;
		for (let o = 1; o < this.model.owners.count; o++) sum += this.principal[o];
		return sum;
	}

	// No liabilities without notes: equity is reserve plus performing loans at book value.
	equity() {
		return this.reserve + this.loanAssets();
	}

	// Sized to cover the owner's operating cost for LOAN_COVER_SECONDS, capped by debt headroom and actual reserve.
	request(o, costRate) {
		const now = this.model.ticks * ECONOMY_DT;
		if (this.defaulted[o] || this.principal[o] > 1e-9 || now < this.retryAt[o]) return 0;
		const owners = this.model.owners;
		const amount = Math.min(costRate * LOAN_COVER_SECONDS, owners.debtHeadroom(o));
		if (amount < LOAN_MIN || amount > this.reserve) {
			this.refusals++;
			this.retryAt[o] = now + LOAN_RETRY_SECONDS;
			return 0;
		}
		this.reserve -= amount;
		owners.cash[o] += amount;
		this.principal[o] = this.original[o] = amount;
		this.interestDue[o] = this.principalDue[o] = this.overdue[o] = 0;
		this.lent += amount;
		this.loans++;
		return amount;
	}

	// Accrues one tick of interest and installment, pays interest before principal, and defaults after the grace period.
	service(o, spendable) {
		if (this.principal[o] <= 1e-12) return 0;
		const owners = this.model.owners;
		const installment = this.original[o] / LOAN_TERM_SECONDS;
		this.interestDue[o] += this.principal[o] * LOAN_RATE * ECONOMY_DT;
		this.principalDue[o] = Math.min(this.principal[o], this.principalDue[o] + installment * ECONOMY_DT);
		let budget = Math.min(Math.max(0, spendable), owners.cash[o]);
		const interest = Math.min(budget, this.interestDue[o]);
		budget -= interest;
		const principal = Math.min(budget, this.principalDue[o]);
		const paid = interest + principal;
		owners.cash[o] -= paid;
		this.reserve += paid;
		this.interestDue[o] -= interest;
		this.principalDue[o] -= principal;
		this.principal[o] -= principal;
		this.interest += interest;
		this.repaid += principal;
		if (this.principal[o] <= 1e-12) {
			this.repaid += this.principal[o];
			this.principal[o] = this.principalDue[o] = 0;
			this.interestDue[o] = 0;
			this.overdue[o] = 0;
			this.cleared++;
			return paid;
		}
		const slack = (installment + this.principal[o] * LOAN_RATE) * LOAN_SLACK_SECONDS;
		this.overdue[o] = this.interestDue[o] + this.principalDue[o] > slack ? this.overdue[o] + ECONOMY_DT : 0;
		if (this.overdue[o] >= LOAN_GRACE_SECONDS) this.writeOff(o);
		return paid;
	}

	// Default writes down the loan asset; the borrower's cash, wage claims and other holders stay untouched.
	writeOff(o) {
		this.writtenOff += this.principal[o];
		this.principal[o] = this.principalDue[o] = this.interestDue[o] = this.overdue[o] = 0;
		this.defaulted[o] = 1;
		this.defaults++;
	}
}

if (typeof module === 'object') module.exports = { GoldBank, LOAN_RATE, LOAN_TERM_SECONDS, LOAN_GRACE_SECONDS, LOAN_MIN };
