// Owns: gold-bank charter, fixed-rate project loans, owner debt limits, arrears/default and the bank ledger.
// Edit for: loan terms, grace and charter funding; note issuance, redemption and FX stay out until the credit slices.
'use strict';

const LOAN_RATE = 0.001; // simple interest per simulation second on outstanding principal
const LOAN_TERM_SECONDS = 120;
const LOAN_GRACE_SECONDS = 30;
const NOTE_PROJECT_LIMIT = 4; // fixed exposure cap per note loan: a conservative repayment budget, not a growth forecast
const NOTE_REDEEM_RATE = 0.5; // bounded fraction of town note holdings offered for redemption per second

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
		this.noteOriginated = 0;
		this.noteRepaid = 0;
		this.noteRepaidGold = 0;
		this.noteInterest = 0;
		this.noteInterestGold = 0;
		this.noteDefaults = 0;
		this.noteWrittenDown = 0;
		this.noteArrears = 0;
		this.redemptionQueue = 0;
		this.suspended = false;
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

	// One bank, one issuer. A chartered bank under credit money registers its note ledger; off means no paper.
	syncIssuer() {
		if (this.exists && this.model.creditMoney && !this.model.currencies.issuers.length) this.model.currencies.charter('Bank notes');
		return this.noteIssuer();
	}

	noteIssuer() {
		return this.model.currencies.issuers.length ? 0 : -1;
	}

	// One owner debt limit spans both denominations: gold loans and note loans share the headroom.
	headroom(account) {
		return Math.max(0, account.debtLimit - account.loanDebt - account.noteLoanDebt);
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

	notesSpendable() {
		return this.exists && !this.suspended && this.noteIssuer() >= 0;
	}

	// Model B origination: new spendable notes, never gold. Bounded by the shared debt limit and a fixed project cap.
	requestNoteLoan(cell, amount) {
		const { owners, ticks, currencies } = this.model;
		if (!this.exists) return { ok: false, message: 'No bank in this scene: fund a bank first, then enable credit money.' };
		if (!this.model.creditMoney) return { ok: false, message: 'Credit money is off: enable it to let the bank issue notes.' };
		if (this.suspended) return { ok: false, message: 'Bank suspended: reserves cannot cover redemption, so no new credit is issued.' };
		if (!Number.isFinite(amount) || !(amount > 0)) return { ok: false, message: 'Loan amount must be a positive number.' };
		const owner = owners.ownerAt(cell);
		const account = owner > 0 ? owners.accounts[owner] : null;
		if (!account || account.municipal) return { ok: false, message: 'Select a firm cell: towns cannot borrow.' };
		const k = this.syncIssuer();
		if (!(k >= 0)) return { ok: false, message: 'No note issuer available.' };
		const room = Math.min(this.headroom(account), NOTE_PROJECT_LIMIT);
		if (amount > room + 1e-12) return { ok: false, message: `Note loan capped at ${room.toFixed(2)} n: debt headroom ${this.headroom(account).toFixed(2)} g and project limit ${NOTE_PROJECT_LIMIT} n.` };
		currencies.issueToAccount(k, cell, amount);
		account.noteLoanDebt += amount;
		this.noteOriginated += amount;
		this.loans.push({
			owner,
			principal: amount,
			outstanding: amount,
			interestDue: 0,
			matureTick: ticks + Math.round(LOAN_TERM_SECONDS / ECONOMY_DT),
			defaulted: false,
			notes: true,
			cell
		});
		return { ok: true, message: `Note loan ${amount.toFixed(2)} n to owner #${owner}: new notes, no gold moved; simple ${LOAN_RATE} n/n·s, term ${LOAN_TERM_SECONDS} s.` };
	}

	// Redemption destroys notes and pays reserve gold to the redeemer at parity; an unmet request suspends the bank visibly.
	redeemNotes(cell, amount) {
		const { currencies, owners } = this.model;
		const k = this.noteIssuer();
		if (!(k >= 0)) return { ok: false, paid: 0, unmet: 0, message: 'No note issuer: credit money is off or no bank is chartered.' };
		const want = currencies.accountBalance(k, cell);
		const payable = Math.min(Math.max(0, amount), want, this.gold);
		if (payable > 1e-15) {
			const retired = currencies.retireAccount(k, cell, payable);
			this.gold -= retired;
			owners.accountAt(cell).cash += retired;
		}
		const unmet = Math.max(0, Math.min(amount, want) - payable);
		if (unmet > 1e-9) {
			this.redemptionQueue += unmet;
			this.suspended = true;
		}
		return { ok: payable > 0 || unmet <= 0, paid: payable, unmet, message: unmet > 1e-9 ? `Redemption short by ${unmet.toFixed(2)} n: reserves exhausted, bank suspended.` : `Redeemed ${payable.toFixed(2)} notes for gold.` };
	}

	// Interest in notes becomes bank-held earnings; gold-funded interest is tracked separately, never mingled.
	collectNoteInterest(loan, account, k) {
		const { currencies } = this.model;
		if (!(loan.interestDue > 0)) return;
		const inNotes = currencies.ownerToBank(k, loan.owner, loan.interestDue);
		if (inNotes > 0) {
			loan.interestDue -= inNotes;
			this.noteInterest += inNotes;
		}
		const fromGold = Math.min(account.cash, loan.interestDue);
		if (fromGold > 0) {
			account.cash -= fromGold;
			this.gold += fromGold;
			loan.interestDue -= fromGold;
			this.noteInterestGold += fromGold;
		}
	}

	// Principal in notes retires them; a gold shortfall executes a funded exchange leg (buy notes at parity, repay at once).
	collectNotePrincipal(loan, account, k) {
		const { currencies } = this.model;
		const inNotes = currencies.ownerRetire(k, loan.owner, loan.outstanding);
		loan.outstanding -= inNotes;
		account.noteLoanDebt -= inNotes;
		this.noteRepaid += inNotes;
		const fromGold = Math.min(account.cash, loan.outstanding);
		if (fromGold > 0) {
			// Funded exchange: the borrower's gold buys notes at parity and retires the loan at once.
			const created = currencies.ownerIssue(k, loan.owner, fromGold);
			const settled = created > 0 ? currencies.ownerRetire(k, loan.owner, created) : 0;
			if (settled > 0) {
				account.cash -= settled;
				this.gold += settled;
				loan.outstanding -= settled;
				account.noteLoanDebt -= settled;
				this.noteRepaidGold += settled;
			}
		}
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
	// Note loans settle in their own denomination first; only a shortfall executes a funded gold exchange.
	step() {
		if (!this.exists) return;
		const { owners, ticks, actors, currencies } = this.model;
		const issuer = this.noteIssuer();
		// Towns redeem note income at the parity bid while reserves allow; unmet redemption demand suspends the bank.
		this.redemptionQueue = 0;
		if (issuer >= 0) {
			const dripShare = 1 - Math.exp(-ECONOMY_DT * NOTE_REDEEM_RATE);
			for (let i = 0; i < ECONOMY_SIZE; i++) {
				if (actors[i] !== ECONOMY_TOWN || currencies.accountBalance(issuer, i) <= 1e-9) continue;
				this.redeemNotes(i, currencies.accountBalance(issuer, i) * dripShare);
			}
		}
		this.suspended = this.redemptionQueue > 1e-9;
		for (let k = 0; k < this.loans.length; k++) {
			const loan = this.loans[k];
			const account = owners.accounts[loan.owner];
			if (!account) continue;
			if (loan.outstanding > 1e-12) loan.interestDue += loan.outstanding * LOAN_RATE * ECONOMY_DT;
			if (loan.notes) {
				if (!(issuer >= 0)) continue;
				this.collectNoteInterest(loan, account, issuer);
				if (loan.outstanding <= 1e-12 || ticks < loan.matureTick) continue;
				this.collectNotePrincipal(loan, account, issuer);
				if (loan.outstanding <= 1e-12) {
					loan.outstanding = 0;
					continue;
				}
				if (ticks >= loan.matureTick + Math.round(LOAN_GRACE_SECONDS / ECONOMY_DT)) {
					// Write-down hits bank equity only: the note holders keep their notes.
					account.noteLoanDebt = Math.max(0, account.noteLoanDebt - loan.outstanding);
					this.noteWrittenDown += loan.outstanding;
					this.noteDefaults++;
					loan.outstanding = 0;
					loan.interestDue = 0;
					loan.defaulted = true;
				}
				continue;
			}
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

	noteArrearsAmount() {
		const { ticks } = this.model;
		let sum = 0;
		for (let k = 0; k < this.loans.length; k++) {
			const loan = this.loans[k];
			if (loan.notes && !loan.defaulted && loan.outstanding > 1e-12 && ticks >= loan.matureTick) sum += loan.outstanding;
		}
		return sum;
	}

	arrearsAmount() {
		const { ticks } = this.model;
		let sum = 0;
		for (let k = 0; k < this.loans.length; k++) {
			const loan = this.loans[k];
			if (!loan.notes && !loan.defaulted && loan.outstanding > 1e-12 && ticks >= loan.matureTick) sum += loan.outstanding;
		}
		return sum;
	}

	// Book identity: reserve gold + gold-loan principal = transferred capital + interest earned − write-downs.
	// Note loans net to zero in a solvent book: the receivable offsets the issued notes still outstanding.
	equity() {
		let outstanding = 0;
		for (let k = 0; k < this.loans.length; k++) outstanding += this.loans[k].outstanding;
		return this.gold + outstanding - this.noteLiabilities();
	}

	noteLiabilities() {
		const issuer = this.noteIssuer();
		if (!(issuer >= 0)) return 0;
		const cur = this.model.currencies.issuers[issuer];
		return Math.max(0, cur.issued - cur.retired - cur.bankHeld);
	}
}

if (typeof module === 'object') module.exports = { GoldBank, LOAN_RATE, LOAN_TERM_SECONDS, LOAN_GRACE_SECONDS, NOTE_PROJECT_LIMIT, NOTE_REDEEM_RATE };
