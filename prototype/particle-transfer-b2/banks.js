// Owns: the capital-funded bank — F1 gold loans and F3 own-note credit (plan M.4), loan origination, simple-interest
// debt service, arrears, default, note redemption with a FIFO queue, suspension and the bank ledgers.
// Edit for: loan size, rate, term, grace period, lending refusal rules, note issuance/redemption policy; never physical production.
'use strict';

const LOAN_RATE = 0.002;
const LOAN_TERM_SECONDS = 90;
const LOAN_GRACE_SECONDS = 30;
const LOAN_COVER_SECONDS = 24;
const LOAN_MIN = 0.08;
const LOAN_SLACK_SECONDS = 4;
const LOAN_RETRY_SECONDS = 5;
// Redemption queue: a small growable FIFO of uncovered note-redemption demand (one slot grows only when busy).
const REDEEM_QUEUE_CAP = 8;
const REDEEM_OWNER = 0;
const REDEEM_WORKER = 1;
const REDEEM_TOWN = 2;

// Lends existing gold (F1) or — with the credit switch on — its own bounded notes matched by a loan asset (F3).
class GoldBank {
	constructor(model) {
		this.model = model;
		this.allocate(OWNER_CAP);
		this.qKind = new Uint8Array(REDEEM_QUEUE_CAP);
		this.qRef = new Int32Array(REDEEM_QUEUE_CAP);
		this.qAmt = new Float64Array(REDEEM_QUEUE_CAP);
		this.qCap = REDEEM_QUEUE_CAP;
		this.qCount = 0;
	}

	allocate(cap) {
		this.principal = growColumn(this.principal, Float64Array, cap);
		this.original = growColumn(this.original, Float64Array, cap);
		this.interestDue = growColumn(this.interestDue, Float64Array, cap);
		this.principalDue = growColumn(this.principalDue, Float64Array, cap);
		this.overdue = growColumn(this.overdue, Float64Array, cap);
		this.defaulted = growColumn(this.defaulted, Uint8Array, cap);
		this.retryAt = growColumn(this.retryAt, Float64Array, cap);
		// 1 while the owner's outstanding loan was originated in the bank's own notes (F3).
		this.noteLoan = growColumn(this.noteLoan, Uint8Array, cap);
	}

	reset() {
		for (const col of [this.principal, this.original, this.interestDue, this.principalDue, this.overdue, this.defaulted, this.retryAt, this.noteLoan]) col.fill(0);
		this.reserve = this.capital = 0;
		this.lent = this.repaid = this.interest = this.writtenOff = 0;
		this.loans = this.cleared = this.defaults = this.refusals = 0;
		this.noteLiability = this.noteIssued = this.noteRetired = 0;
		this.qCount = 0;
	}

	fund(amount) {
		this.reserve += amount;
		this.capital += amount;
		this.drainQueue();
	}

	loanAssets() {
		let sum = 0;
		for (let o = 1; o < this.model.owners.count; o++) sum += this.principal[o];
		return sum;
	}

	// Equity is reserve plus performing loans at book value less the notes still owed: origination books a loan
	// asset against a matching note liability (no equity change), interest in notes retires the liability into
	// earnings, and redemption settles liability with reserve one-for-one (plan M.4 F3).
	equity() {
		return this.reserve + this.loanAssets() - this.noteLiability;
	}

	eps() {
		const mEps = this.model.money ? this.model.money.eps() : 1e-12;
		return Math.max(mEps, this.capital * 1e-12);
	}

	// Reserve exhausted while notes are still outstanding: no new credit until gold returns (M.4). Computed
	// live, so the flag can never go stale after repayments refill the vault.
	isSuspended() {
		const eps = this.eps();
		return this.reserve <= eps && this.noteLiability > eps;
	}

	// The credit switch may only fall once every note is settled: no liability and no open note loan (M.3).
	notesSettled() {
		const eps = this.eps();
		if (this.noteLiability > eps) return false;
		for (let o = 1; o < OWNER_CAP; o++) if (this.noteLoan[o] && this.principal[o] > eps) return false;
		return true;
	}

	// Sized to cover the owner's operating cost for LOAN_COVER_SECONDS, capped by debt headroom; a gold loan
	// (F1) additionally cannot exceed the actual reserve, while note issuance (F3) is never reserve-bounded.
	request(o, costRate) {
		const now = this.model.ticks * ECONOMY_DT, eps = this.eps();
		if (this.defaulted[o] || this.principal[o] > eps || now < this.retryAt[o]) return 0;
		if (this.isSuspended()) {
			this.refusals++;
			return 0;
		}
		const owners = this.model.owners;
		const minLoan = LOAN_MIN * (this.model.money ? this.model.money.unitScale() : 1);
		const amount = Math.min(costRate * LOAN_COVER_SECONDS, owners.debtHeadroom(o));
		const useNotes = this.model.creditOn && !this.model.creditStop;
		if (amount <= eps || amount < minLoan || (!useNotes && amount > this.reserve)) {
			if (amount >= minLoan && !useNotes) {
				this.refusals++;
				this.retryAt[o] = now + LOAN_RETRY_SECONDS;
			}
			return 0;
		}
		if (useNotes) {
			// F3: the notes are the bank's own liability, so expansion adds notes and never gold (M.4/M.7 P1).
			owners.notes[o] += amount;
			this.noteLiability += amount;
			this.noteIssued += amount;
			this.principal[o] = this.original[o] = amount;
			this.interestDue[o] = this.principalDue[o] = this.overdue[o] = 0;
			this.noteLoan[o] = 1;
			this.loans++;
			return amount;
		}
		this.reserve -= amount;
		owners.cash[o] += amount;
		this.principal[o] = this.original[o] = amount;
		this.interestDue[o] = this.principalDue[o] = this.overdue[o] = 0;
		this.noteLoan[o] = 0;
		this.lent += amount;
		this.loans++;
		return amount;
	}

	// Accrues one tick of interest and installment, pays interest before principal, and defaults after the grace
	// period. A note loan retires the bank's own notes first and tops up in gold above the wage reserve.
	service(o, spendable) {
		const eps = this.eps();
		if (this.principal[o] <= eps) return 0;
		const owners = this.model.owners;
		const installment = this.original[o] / LOAN_TERM_SECONDS;
		this.interestDue[o] += this.principal[o] * LOAN_RATE * ECONOMY_DT;
		this.principalDue[o] = Math.min(this.principal[o], this.principalDue[o] + installment * ECONOMY_DT);
		const purse = this.noteLoan[o] ? owners.cash[o] + owners.notes[o] : owners.cash[o];
		let budget = Math.min(Math.max(0, spendable), purse);
		const interest = Math.min(budget, this.interestDue[o]);
		budget -= interest;
		const principal = Math.min(budget, this.principalDue[o]);
		const paid = interest + principal;
		const notePaid = this.noteLoan[o] ? Math.min(paid, owners.notes[o]) : 0;
		const goldPaid = paid - notePaid;
		owners.notes[o] -= notePaid;
		owners.cash[o] -= goldPaid;
		this.noteLiability -= notePaid;
		this.noteRetired += notePaid;
		this.reserve += goldPaid;
		this.interestDue[o] -= interest;
		this.principalDue[o] -= principal;
		this.principal[o] -= principal;
		this.interest += interest;
		// lent/repaid stay the F1 gold books; note flows live in noteIssued/noteRetired (never mixed).
		if (!this.noteLoan[o]) this.repaid += principal;
		if (goldPaid > eps) this.drainQueue();
		if (this.principal[o] <= eps) {
			if (!this.noteLoan[o]) this.repaid += this.principal[o];
			this.principal[o] = this.principalDue[o] = 0;
			this.interestDue[o] = 0;
			this.overdue[o] = 0;
			this.noteLoan[o] = 0;
			this.cleared++;
			return paid;
		}
		const slack = (installment + this.principal[o] * LOAN_RATE) * LOAN_SLACK_SECONDS;
		this.overdue[o] = this.interestDue[o] + this.principalDue[o] > slack ? this.overdue[o] + ECONOMY_DT : 0;
		if (this.overdue[o] >= LOAN_GRACE_SECONDS) this.writeOff(o);
		return paid;
	}

	// Default writes down the loan asset only; the borrower's cash, wage claims, its own notes and every other
	// holder's notes stay untouched — a run must not be able to erase circulating money (plan M.4).
	writeOff(o) {
		this.writtenOff += this.principal[o];
		this.principal[o] = this.principalDue[o] = this.interestDue[o] = this.overdue[o] = 0;
		this.noteLoan[o] = 0;
		this.defaulted[o] = 1;
		this.defaults++;
	}

	heldNotes(kind, ref) {
		const m = this.model;
		if (kind === REDEEM_OWNER) return m.owners.notes[ref];
		if (kind === REDEEM_WORKER) return m.workers.notes[ref];
		return m.money.notePurse[ref];
	}

	takeNotes(kind, ref, amount) {
		const m = this.model;
		if (kind === REDEEM_OWNER) m.owners.notes[ref] -= amount;
		else if (kind === REDEEM_WORKER) m.workers.notes[ref] -= amount;
		else m.money.notePurse[ref] -= amount;
	}

	creditGold(kind, ref, amount) {
		const m = this.model;
		if (kind === REDEEM_OWNER) m.owners.cash[ref] += amount;
		else if (kind === REDEEM_WORKER) m.workers.gold[ref] += amount;
		else m.money.purse[ref] += amount;
	}

	// Redemption window (M.4): holders swap notes for gold at par from the reserve. Uncovered demand queues
	// FIFO; once the reserve is empty the queue keeps the outstanding claim visible and new credit is suspended.
	// Returns { fill, queued } — the queued notes stay with their holder until gold returns.
	redeem(kind, ref, amt) {
		const eps = this.eps();
		const held = this.heldNotes(kind, ref);
		const want = Math.min(amt, held);
		if (want <= eps) return { fill: 0, queued: 0 };
		const fill = Math.min(want, this.reserve);
		if (fill > eps) {
			this.takeNotes(kind, ref, fill);
			this.creditGold(kind, ref, fill);
			this.reserve -= fill;
			this.noteLiability -= fill;
			this.noteRetired += fill;
		}
		const queued = want - fill;
		if (queued > eps) this.pushQueue(kind, ref, queued);
		return { fill, queued };
	}

	redeemOwner(o, amt) { return this.redeem(REDEEM_OWNER, o, amt); }
	redeemWorker(w, amt) { return this.redeem(REDEEM_WORKER, w, amt); }
	redeemTown(i, amt) { return this.redeem(REDEEM_TOWN, i, amt); }

	pushQueue(kind, ref, amount) {
		if (this.qCount === this.qCap) this.growQueue();
		const k = this.qCount++;
		this.qKind[k] = kind;
		this.qRef[k] = ref;
		this.qAmt[k] = amount;
	}

	growQueue() {
		const cap = this.qCap * 2;
		const kind = new Uint8Array(cap), ref = new Int32Array(cap), amt = new Float64Array(cap);
		kind.set(this.qKind);
		ref.set(this.qRef);
		amt.set(this.qAmt);
		this.qKind = kind;
		this.qRef = ref;
		this.qAmt = amt;
		this.qCap = cap;
	}

	popQueue() {
		this.qCount--;
		for (let k = 0; k < this.qCount; k++) {
			this.qKind[k] = this.qKind[k + 1];
			this.qRef[k] = this.qRef[k + 1];
			this.qAmt[k] = this.qAmt[k + 1];
		}
	}

	queuedNotes() {
		let sum = 0;
		for (let k = 0; k < this.qCount; k++) sum += this.qAmt[k];
		return sum;
	}

	// Fills queued redemption demand from gold that returns to the reserve (debt service or fresh funding).
	// A holder who has since spent the notes voids that slice of the queue — the claim is the notes themselves.
	drainQueue() {
		const eps = this.eps();
		while (this.qCount > 0 && this.reserve > eps) {
			const kind = this.qKind[0], ref = this.qRef[0];
			const held = this.heldNotes(kind, ref);
			if (held <= eps) {
				this.popQueue();
				continue;
			}
			const take = Math.min(this.qAmt[0], held, this.reserve);
			this.takeNotes(kind, ref, take);
			this.creditGold(kind, ref, take);
			this.reserve -= take;
			this.noteLiability -= take;
			this.noteRetired += take;
			this.qAmt[0] -= take;
			if (this.qAmt[0] <= eps) this.popQueue();
		}
	}
}

if (typeof module === 'object') module.exports = { GoldBank, LOAN_RATE, LOAN_TERM_SECONDS, LOAN_GRACE_SECONDS, LOAN_MIN, REDEEM_OWNER, REDEEM_WORKER, REDEEM_TOWN };
