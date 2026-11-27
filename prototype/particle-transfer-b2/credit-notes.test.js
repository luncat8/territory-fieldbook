// Owns: P1 acceptance — credit origination without gold, note wages, consenting-town tender, redemption,
// suspension, repayment (notes and gold-funded exchange) and default write-downs per plan-gold-and-paper-money M.7.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPTS = ['simulation.js', 'land.js', 'steering.js', 'forage.js', 'owners.js', 'gold.js', 'banks.js', 'currencies.js', 'goods.js', 'workforce.js', 'workers.js', 'worker-life.js', 'farms.js', 'actors.js', 'towns.js', 'settlement.js', 'founding.js', 'track.js'];
for (const file of SCRIPTS) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const conserved = m => near(m.money.total(), m.money.seeded + m.money.mined);
const noteIdentity = m => {
	for (let k = 0; k < m.currencies.issuers.length; k++) {
		const e = m.currencies.invariantError(k);
		assert.ok(e <= 1e-9, `note identity broken: ${e}`);
	}
};

const GOLD_CELL = economyIndex(3, 13); // reference gold mine: a worker-owned firm facility
const MED_TOWN = economyIndex(28, 12);
const RICH_TOWN = economyIndex(9, 20);

function banked(goldPerWorker = 0, bankCapital = 6) {
	const m = new PriceEconomy(goldPerWorker, bankCapital);
	for (let i = 0; i < ECONOMY_SIZE; i++) if (m.actors[i] && m.actors[i] !== ECONOMY_TOWN && m.actors[i] !== ECONOMY_GOLD) m.setActor(i, 0);
	m.workers.reset();
	m.workerLife.reset();
	m.money.reset();
	m.goodsPool.reset();
	m.rebuildCellView();
	if (bankCapital > 0) {
		// Explicit scenario capital through an owner account, then a charter transfer: no placement minting.
		const owner = m.owners.ownerAt(GOLD_CELL);
		m.money.payOwner(owner, bankCapital);
		m.money.seeded += bankCapital;
		m.owners.allocate();
		assert.ok(m.banks.fundFrom(owner, bankCapital) > 0);
	}
	m.creditMoney = true;
	m.banks.syncIssuer();
	return m;
}

function workerAt(m, cell, gold = 0, notes = 0) {
	const w = m.workers.spawn(Math.floor(cell % ECONOMY_WIDTH) + 0.5, Math.floor(cell / ECONOMY_WIDTH) + 0.5, WORKER_STILL, 0, gold, FOOD_BAG, true);
	if (notes > 0) {
		m.currencies.issuers[0].issued += notes;
		m.currencies.workerNotes[0][w] = notes;
	}
	return w;
}

test('origination issues spendable notes without creating or moving a single gram of gold', () => {
	const m = banked();
	const goldBefore = m.money.total();
	const r = m.banks.requestNoteLoan(GOLD_CELL, 4);
	assert.equal(r.ok, true, r.message);
	near(m.currencies.accountBalance(0, GOLD_CELL), 4);
	near(m.owners.accountAt(GOLD_CELL).noteLoanDebt, 4);
	near(m.money.total(), goldBefore, 1e-12);
	assert.equal(m.banks.gold, 6);
	noteIdentity(m);
	conserved(m);
});

test('note lending is bounded by the shared debt limit and a fixed project cap and refuses towns', () => {
	const m = banked();
	assert.equal(m.banks.requestNoteLoan(MED_TOWN, 2).ok, false, 'towns cannot borrow');
	m.creditMoney = false;
	assert.equal(m.banks.requestNoteLoan(GOLD_CELL, 2).ok, false, 'credit money off blocks issuance');
	m.creditMoney = true;
	assert.equal(m.banks.requestNoteLoan(GOLD_CELL, NOTE_PROJECT_LIMIT + 1).ok, false, 'the project cap bounds a single loan');
	assert.equal(m.banks.requestNoteLoan(GOLD_CELL, 11).ok, false, 'the owner debt limit bounds issuance');
	const r = m.banks.requestNoteLoan(GOLD_CELL, 4);
	assert.equal(r.ok, true, r.message);
	assert.equal(m.banks.requestNoteLoan(GOLD_CELL, 7).ok, false, 'headroom counts note debt like gold debt');
	near(m.owners.accountAt(GOLD_CELL).noteLoanDebt + m.owners.accountAt(GOLD_CELL).loanDebt, 4);
	noteIdentity(m);
});

test('note wages spend the borrower notes before gold, and wage counters never mix denominations', () => {
	const m = banked();
	assert.equal(m.banks.requestNoteLoan(GOLD_CELL, 3).ok, true);
	m.money.payOwner(m.owners.ownerAt(GOLD_CELL), 5);
	m.money.seeded += 5;
	m.owners.allocate();
	const w = workerAt(m, GOLD_CELL);
	const paid = m.money.payEntryWage(GOLD_CELL, w, 2);
	near(paid, 2);
	near(m.currencies.workerBalance(0, w), 2); // notes are the employer tender of first resort
	near(m.owners.accountAt(GOLD_CELL).cash, 5); // gold stays untouched while notes cover the bill
	near(m.money.wageNotes, 2);
	near(m.money.wages, 0);
	noteIdentity(m);
	conserved(m);
});

test('consenting med towns take note fees and rations; rich towns insist on gold', () => {
	const m = banked();
	const w = workerAt(m, MED_TOWN, 0, 3);
	m.workers.tired[w] = 0.5;
	assert.equal(m.workers.tryAdmitTown(w, RICH_TOWN), false, 'a note-only worker cannot check into a rich town');
	assert.equal(m.workers.tryAdmitTown(w, MED_TOWN), true, 'a consenting town takes the note fee');
	assert.ok(m.currencies.accountBalance(0, MED_TOWN) > 0, 'the town account received notes');
	near(m.currencies.workerBalance(0, w), 3 - m.currencies.accountBalance(0, MED_TOWN));
	assert.ok(m.money.taxNotes > 0, 'note fees are counted separately from gold taxes');
	const r = workerAt(m, MED_TOWN, 0, 0);
	m.workers.tired[r] = 0.2;
	assert.equal(m.workers.tryAdmitTown(r, MED_TOWN), false, 'a worker with neither gold nor notes cannot check in');
	noteIdentity(m);
});

test('town redemption converts notes to reserve gold; exhausted reserves suspend the bank visibly', () => {
	const m = banked(0, 0.001);
	assert.equal(m.banks.requestNoteLoan(GOLD_CELL, 2).ok, true);
	const w = workerAt(m, MED_TOWN, 0, 2);
	m.workers.tired[w] = 1;
	assert.equal(m.workers.tryAdmitTown(w, MED_TOWN), true);
	const held = m.currencies.accountBalance(0, MED_TOWN);
	assert.ok(held > 0, 'the town holds the fee notes');
	m.banks.step();
	assert.ok(m.banks.gold < 2, 'redemption paid reserve gold out');
	near(m.currencies.accountBalance(0, MED_TOWN) + m.currencies.issuers[0].retired, held, 1e-9);
	const result = m.banks.redeemNotes(MED_TOWN, m.currencies.accountBalance(0, MED_TOWN) + 50);
	assert.ok(result.unmet > 0, 'a demand beyond reserves goes unmet');
	assert.equal(m.banks.suspended, true, 'exhausted reserves suspend the bank');
	assert.ok(m.banks.redemptionQueue > 0, 'the queue is visible');
	assert.equal(m.banks.notesSpendable(), false, 'suspended notes are not spendable');
	assert.equal(m.banks.requestNoteLoan(GOLD_CELL, 1).ok, false, 'suspension blocks new credit');
	noteIdentity(m);
});

test('funding a suspended bank restores redemption and spendability; settlement never mints', () => {
	const m = banked(0, 0.001);
	assert.equal(m.banks.requestNoteLoan(GOLD_CELL, 1).ok, true);
	const w = workerAt(m, MED_TOWN, 0, 2);
	m.workers.tired[w] = 1;
	assert.equal(m.workers.tryAdmitTown(w, MED_TOWN), true);
	m.banks.redeemNotes(MED_TOWN, m.currencies.accountBalance(0, MED_TOWN) + 10);
	assert.equal(m.banks.suspended, true);
	const gold = m.money.total();
	const owner = m.owners.accounts[m.owners.ownerAt(GOLD_CELL)];
	owner.cash = 3; // an explicit capital transfer by hand
	m.money.seeded += 3;
	m.banks.fundFrom(m.owners.ownerAt(GOLD_CELL), 3);
	near(m.money.total(), gold + 3);
	m.banks.step();
	assert.equal(m.banks.suspended, false, 'reserves cover redemption again');
	assert.equal(m.banks.notesSpendable(), true);
	noteIdentity(m);
	conserved(m);
});

test('mature note loans repay principal in notes first, then through a funded gold exchange', () => {
	const m = banked(0, 6);
	assert.equal(m.banks.requestNoteLoan(GOLD_CELL, 4).ok, true);
	const loan = m.banks.loans[0];
	const account = m.owners.accountAt(GOLD_CELL);
	const spent = workerAt(m, GOLD_CELL);
	m.currencies.ownerToWorker(0, m.owners.ownerAt(GOLD_CELL), spent, 4); // the borrower spent the notes on wages
	account.cash = 0;
	loan.matureTick = m.ticks; // due now
	m.banks.step();
	near(m.banks.noteRepaid, 0, 1e-12);
	near(m.banks.noteRepaidGold, 0, 1e-12);
	near(loan.outstanding, 4); // no cash and no notes: arrears instead of invented money
	assert.ok(m.banks.noteArrearsAmount() > 0);
	// Notes on hand settle the principal in the contracted denomination.
	account.noteLoanDebt = 4;
	loan.outstanding = 4;
	loan.matureTick = m.ticks;
	m.currencies.ownerIssue(0, m.owners.ownerAt(GOLD_CELL), 4 + loan.interestDue + 4 * LOAN_RATE * ECONOMY_DT); // principal plus the interest slices that accrue while settling
	m.banks.step();
	near(m.banks.noteRepaid, 4);
	near(loan.outstanding, 0, 1e-12);
	near(account.noteLoanDebt, 0, 1e-12);
	near(account.cash, 0);
	noteIdentity(m);
	conserved(m);
	// A gold shortfall funds the exchange: gold moves to reserves, notes are created and retired at once.
	const goldBefore = m.money.total();
	m.banks.requestNoteLoan(GOLD_CELL, 2);
	const loan2 = m.banks.loans[1];
	const spender = workerAt(m, GOLD_CELL);
	m.currencies.ownerToWorker(0, m.owners.ownerAt(GOLD_CELL), spender, 2); // the borrower spent loan2's notes on wages
	loan2.matureTick = m.ticks;
	account.cash = 3;
	m.money.seeded += 3;
	m.banks.step();
	near(m.banks.noteRepaidGold, 2); // gold covers the note shortfall through the parity exchange
	near(loan2.outstanding, 0, 1e-12);
	near(m.banks.gold, 8, 1e-3); // reserves gained the funded exchange gold
	near(m.money.total(), goldBefore + 3, 1e-9); // the explicit 3 g grant joins circulation; the exchange itself moves no net gold
	noteIdentity(m);
	conserved(m);
});

test('note interest is paid from notes into bank earnings and from gold into reserves, never minted', () => {
	const m = banked(0, 6);
	assert.equal(m.banks.requestNoteLoan(GOLD_CELL, 2).ok, true);
	const account = m.owners.accountAt(GOLD_CELL);
	account.cash = 0;
	const ticks = Math.round(60 / ECONOMY_DT);
	for (let t = 0; t < ticks; t++) m.banks.step();
	const due = m.banks.loans[0].interestDue;
	near(due + m.banks.noteInterest + m.banks.noteInterestGold, 2 * 0.001 * 60, 1e-9); // accrued interest is either paid or still due
	near(account.cash, 0);
	conserved(m);
});

test('defaulted note loans write down bank equity and leave every holder whole', () => {
	const m = banked(0, 6);
	assert.equal(m.banks.requestNoteLoan(GOLD_CELL, 4).ok, true);
	const w = workerAt(m, MED_TOWN, 0, 0);
	m.currencies.ownerToWorker(0, m.owners.ownerAt(GOLD_CELL), w, 4); // wages in notes, the borrower spent them
	const account = m.owners.accountAt(GOLD_CELL);
	account.cash = 0;
	const loan = m.banks.loans[0];
	loan.matureTick = m.ticks;
	const equityBefore = m.banks.equity();
	for (let t = 0; t < Math.round(LOAN_GRACE_SECONDS / ECONOMY_DT) + 1; t++) { m.ticks++; m.banks.step(); }
	assert.equal(loan.defaulted, true);
	near(m.banks.noteDefaults, 1);
	near(m.banks.noteWrittenDown, 4);
	near(m.banks.equity(), equityBefore - 4, 1e-9); // the write-down hits bank equity only
	near(m.currencies.workerBalance(0, w), 4); // holders keep their notes through the default
	near(account.noteLoanDebt, 0, 1e-12);
	noteIdentity(m);
	conserved(m);
});

test('credit money toggles: enabling creates nothing, unchecking with outstanding notes keeps settlement', () => {
	const m = banked();
	const goldBefore = m.money.total();
	m.creditMoney = false;
	m.banks.syncIssuer();
	assert.equal(m.currencies.totalOutstanding(), 0, 'enabling then disabling with no loans creates nothing');
	near(m.money.total(), goldBefore, 1e-12);
	m.creditMoney = true;
	assert.equal(m.banks.requestNoteLoan(GOLD_CELL, 4).ok, true);
	m.creditMoney = false; // stop new issuance, keep settlement
	assert.equal(m.banks.requestNoteLoan(GOLD_CELL, 1).ok, false);
	assert.equal(m.banks.notesSpendable(), true, 'existing notes stay spendable');
	const account = m.owners.accountAt(GOLD_CELL);
	account.cash = 0;
	const spender = workerAt(m, GOLD_CELL);
	m.currencies.ownerToWorker(0, m.owners.ownerAt(GOLD_CELL), spender, 4); // wages: the borrower spent its notes
	const loan = m.banks.loans[0];
	loan.matureTick = m.ticks;
	m.currencies.ownerIssue(0, m.owners.ownerAt(GOLD_CELL), 4 + loan.interestDue + 4 * LOAN_RATE * ECONOMY_DT); // principal plus the interest slices that accrue while settling
	m.banks.step();
	near(m.banks.noteRepaid, 4); // repayment settles in the contracted denomination while issuance is stopped
	near(account.noteLoanDebt, 0, 1e-12);
	near(m.currencies.issuers[0].issued - m.currencies.issuers[0].retired, m.currencies.heldSum(0), 1e-9);
	assert.ok(m.currencies.totalOutstanding() > 0, 'circulating wage notes survive; the loan, not the currency, retires');
	noteIdentity(m);
	conserved(m);
});
