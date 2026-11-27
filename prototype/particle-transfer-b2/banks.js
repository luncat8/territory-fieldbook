// Owns: gold-bank charter, fixed-rate project loans, owner debt limits, arrears/default and the bank ledger.
// Edit for: loan terms, grace and charter funding; note issuance, redemption and FX stay out until the credit slices.
'use strict';

const LOAN_RATE = 0.001; // simple interest per simulation second on outstanding principal
const LOAN_TERM_SECONDS = 120;
const LOAN_GRACE_SECONDS = 30;

class GoldBank {
	constructor(model) {
		this.model = model;
		this.reset();
	}

	reset() {
		this.exists = false;
		this.gold = 0;
		this.funded = 0;
		this.originated = 0;
		this.repaid = 0;
		this.interestPaid = 0;
		this.defaults = 0;
		this.writtenDown = 0;
		this.loans = [];
	}

	// Scene charter: bank capital is transferred from existing firm owners, never minted.
	initializeScenario(want) {
		if (!(want > 0)) return false;
		this.exists = true;
		const { owners } = this.model;
		let pool = 0;
		for (let id = 1; id < owners.accounts.length; id++) {
			const account = owners.accounts[id];
			if (!account.municipal) pool += account.cash;
		}
		if (pool <= 0) return true; // chartered but empty: lending must refuse
		const take = Math.min(want, pool);
		for (let id = 1; id < owners.accounts.length; id++) {
			const account = owners.accounts[id];
			if (account.municipal) continue;
			const share = account.cash * (take / pool);
			account.cash -= share;
			this.gold += share;
		}
		this.funded = this.gold;
		owners.allocate();
		return true;
	}

	fundFrom(ownerId, amount) {
		const account = this.model.owners.accounts[ownerId];
		if (!account || !(amount > 0)) return 0;
		const paid = Math.min(account.cash, amount);
		if (paid <= 0) return 0;
		account.cash -= paid;
		this.gold += paid;
		this.funded += paid;
		this.exists = true;
		this.model.owners.allocate();
		return paid;
	}

	headroom(account) {
		return Math.max(0, account.debtLimit - account.loanDebt);
	}

	requestLoan(cell, amount) {
		const { owners, ticks } = this.model;
		if (!this.exists) return { ok: false, message: 'No gold bank in this scene: set bank capital and reset.' };
		if (!Number.isFinite(amount) || !(amount > 0)) return { ok: false, message: 'Loan amount must be a positive number.' };
		const owner = owners.ownerAt(cell);
		const account = owner > 0 ? owners.accounts[owner] : null;
		if (!account || account.municipal) return { ok: false, message: 'Select a firm cell: towns cannot borrow.' };
		if (!(this.gold > 0)) return { ok: false, message: `Empty bank: 0 g reserves cannot fund a ${amount.toFixed(2)} g loan.` };
		const room = this.headroom(account);
		if (amount > room + 1e-12) return { ok: false, message: `Debt limit: ${room.toFixed(2)} g headroom of ${account.debtLimit.toFixed(2)} g for owner #${owner}.` };
		this.gold -= amount;
		account.cash += amount;
		account.loanDebt += amount;
		this.originated += amount;
		this.loans.push({
			owner,
			principal: amount,
			outstanding: amount,
			interestDue: 0,
			matureTick: ticks + Math.round(LOAN_TERM_SECONDS / ECONOMY_DT),
			defaulted: false
		});
		owners.allocate();
		return { ok: true, message: `Loan ${amount.toFixed(2)} g to owner #${owner}: simple ${LOAN_RATE} g/g·s, term ${LOAN_TERM_SECONDS} s, grace ${LOAN_GRACE_SECONDS} s.` };
	}

	collectInterest(loan, account) {
		if (!(loan.interestDue > 0) || !account || !(account.cash > 0)) return;
		const pay = Math.min(account.cash, loan.interestDue);
		account.cash -= pay;
		loan.interestDue -= pay;
		this.gold += pay;
		this.interestPaid += pay;
	}

	// Waterfall runs after wage-claim settlement: due interest, then principal at maturity, then grace default.
	step() {
		if (!this.exists) return;
		const { owners, ticks } = this.model;
		for (let k = 0; k < this.loans.length; k++) {
			const loan = this.loans[k];
			const account = owners.accounts[loan.owner];
			if (!account) continue;
			if (loan.outstanding > 1e-12) loan.interestDue += loan.outstanding * LOAN_RATE * ECONOMY_DT;
			this.collectInterest(loan, account);
			if (loan.outstanding <= 1e-12 || ticks < loan.matureTick) continue;
			const pay = Math.min(account.cash, loan.outstanding);
			if (pay > 0) {
				account.cash -= pay;
				loan.outstanding -= pay;
				account.loanDebt -= pay;
				this.gold += pay;
				this.repaid += pay;
			}
			if (loan.outstanding <= 1e-12) {
				loan.outstanding = 0;
				continue;
			}
			if (ticks >= loan.matureTick + Math.round(LOAN_GRACE_SECONDS / ECONOMY_DT)) {
				// Write-down hits bank equity only: other wage claims and note holders stay whole.
				account.loanDebt -= loan.outstanding;
				this.writtenDown += loan.outstanding;
				this.defaults++;
				loan.outstanding = 0;
				loan.interestDue = 0;
				loan.defaulted = true;
			}
		}
	}

	arrearsAmount() {
		const { ticks } = this.model;
		let sum = 0;
		for (let k = 0; k < this.loans.length; k++) {
			const loan = this.loans[k];
			if (!loan.defaulted && loan.outstanding > 1e-12 && ticks >= loan.matureTick) sum += loan.outstanding;
		}
		return sum;
	}

	// Book identity: reserve gold + outstanding principal = transferred capital + interest earned − write-downs.
	equity() {
		let outstanding = 0;
		for (let k = 0; k < this.loans.length; k++) outstanding += this.loans[k].outstanding;
		return this.gold + outstanding;
	}
}

if (typeof module === 'object') module.exports = { GoldBank, LOAN_RATE, LOAN_TERM_SECONDS, LOAN_GRACE_SECONDS };
