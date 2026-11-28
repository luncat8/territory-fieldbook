// Owns: P1 credit-note tests — default-off safety, note issuance without gold, the M.4 repayment ring,
// write-off isolation, redemption suspension, the credit-stop gate and a reference run with credit on.
// Edit for: banks.js note policy, gold.js note-aware waterfalls or the credit switch semantics.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPTS = ['simulation.js', 'land.js', 'steering.js', 'forage.js', 'gold.js', 'owners.js', 'banks.js', 'goods.js', 'workforce.js', 'workers.js', 'worker-life.js', 'farms.js', 'actors.js', 'towns.js', 'settlement.js', 'founding.js', 'track.js', 'diagnostics.js'];
for (const file of SCRIPTS) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

function bareModel() {
	const m = new PriceEconomy();
	for (let i = 0; i < ECONOMY_SIZE; i++) if (m.actors[i]) m.setActor(i, 0);
	m.workers.reset();
	m.workerLife.reset();
	m.money.reset();
	m.goodsPool.reset();
	m.rebuildCellView();
	return m;
}

function run(m, seconds) {
	for (let n = 0; n < Math.round(seconds / ECONOMY_DT); n++) m.step();
}

const conserved = m => Math.abs(m.money.total() - (m.money.initial + m.money.mined));

// A borrower whose next-shift reserve is set by hand, so settleOwner runs the waterfall without the full tick.
function borrower(m, reserve) {
	const firm = economyIndex(10, 10);
	m.setActor(firm, ECONOMY_MINE);
	const o = m.owners.ownerAt(firm);
	m.owners.reserve[o] = reserve;
	return { firm, o };
}

// The note ledgers must always partition: every wallet's notes equal the bank's outstanding liability.
function noteIdentity(m) {
	assert.ok(Math.abs(m.bank.noteIssued - m.bank.noteRetired - m.bank.noteLiability) < 1e-9, 'issued − retired = liability');
	assert.ok(Math.abs(m.money.noteTotal() - m.bank.noteLiability) < 1e-9, 'every note is a bank liability');
}

test('credit is off by default; flipping the flag alone moves no wallet and an off run mints no notes', () => {
	const m = new PriceEconomy();
	assert.equal(m.creditOn, false, 'plan M.3 default');
	assert.equal(m.creditStop, false);
	const gold = m.money.total();
	const purse = Array.from(m.money.purse);
	const wallets = Array.from(m.workers.gold.slice(0, m.workers.count));
	const cash = Array.from(m.owners.cash.slice(0, m.owners.count));
	m.creditOn = true;
	assert.equal(m.money.total(), gold, 'enabling creates no gold');
	assert.equal(m.money.noteTotal(), 0, 'enabling creates no notes');
	for (let i = 0; i < purse.length; i++) assert.equal(m.money.purse[i], purse[i], 'town purse untouched');
	for (let w = 0; w < wallets.length; w++) assert.equal(m.workers.gold[w], wallets[w], 'worker wallet untouched');
	for (let o = 0; o < cash.length; o++) assert.equal(m.owners.cash[o], cash[o], 'owner cash untouched');
	m.creditOn = false;
	run(m, 30);
	assert.equal(m.bank.noteIssued, 0, 'no issuance while the switch is off');
	assert.equal(m.money.noteTotal(), 0, 'no notes exist while the switch is off');
	assert.equal(m.workers.totalNotes(), 0);
	noteIdentity(m);
});

test('a short owner borrows the bank\u2019s own notes: liability appears, gold and reserve do not move', () => {
	const m = bareModel();
	m.creditOn = true;
	m.money.fundBank(10);
	const { o } = borrower(m, 1);
	const goldBefore = m.money.total();
	const reserveBefore = m.bank.reserve;
	m.money.settleOwner(o);
	const loan = m.owners.notes[o];
	assert.ok(loan >= LOAN_MIN, 'note loan granted');
	assert.equal(m.bank.noteLoan[o], 1, 'loan booked as a note loan');
	assert.equal(m.bank.lent, 0, 'F1 gold books untouched');
	assert.ok(Math.abs(m.money.total() - goldBefore) < 1e-12, 'expansion adds notes, never gold');
	assert.ok(Math.abs(m.bank.reserve - reserveBefore) < 1e-12, 'issuance never touches the reserve');
	noteIdentity(m);
	const s = new EconomyDiagnostics(m).snapshot();
	assert.ok(Math.abs(s.noteOut - loan) < 1e-9, 'snapshot reports the liability');
	assert.ok(Math.abs(s.noteHeld - loan) < 1e-9, 'snapshot reports every holder');
	assert.equal(s.creditState, 'active');
});

test('the M.4 ring: wages in notes, ration bought with notes, notes return to the borrower and settle the loan', () => {
	const m = bareModel();
	m.creditOn = true;
	m.money.fundBank(10);
	const { firm, o } = borrower(m, 1);
	m.money.settleOwner(o);
	const loan = m.owners.notes[o];
	assert.ok(loan >= LOAN_MIN);

	// O pays the shift wage in notes (budget draws notes first).
	const w = m.workers.spawn(10.5, 10.5, WORKER_STILL, 0, 0, 0, true);
	const paid = m.money.payEntryWage(firm, w, loan / 2);
	assert.ok(paid > 0, 'wage paid from the note purse');
	assert.ok(m.workers.notes[w] > 0, 'the hire holds notes');
	noteIdentity(m);

	// The worker buys a ration at a town: notes flow worker → town. The town needs a seeded food price,
	// because bareModel never runs the market that normally diffuses one.
	const town = economyIndex(20, 20);
	m.setActor(town, ECONOMY_TOWN);
	m.food[town] = 10;
	m.priceFood[town] = 1;
	const before = m.workers.notes[w];
	const bought = m.towns.buyRation(town, w);
	assert.ok(bought > 0, 'ration bought');
	assert.ok(m.workers.notes[w] < before, 'the ration cost notes');
	assert.ok(m.money.notePurse[town] > 0, 'the town holds the notes');
	noteIdentity(m);

	// Goods admission returns the town's notes to O (debit draws notes first, creditOwner splits).
	const n = m.money.debit(town, m.money.notePurse[town]);
	assert.ok(n > 0, 'admission paid in notes');
	m.money.creditOwner(o, 0, n);
	assert.ok(m.owners.notes[o] > 0, 'notes returned to the borrower');
	noteIdentity(m);

	// Dig revenue tops up the purse so the ring can run off; settlement then clears principal in notes-first splits.
	m.money.dig(firm, 10);
	const goldBefore = m.money.total();
	for (let step = 0; step < (LOAN_TERM_SECONDS + 5) / ECONOMY_DT && m.bank.principal[o] > 0; step++) {
		m.money.settleOwner(o);
		assert.ok(Math.abs(m.money.total() - goldBefore) < 1e-12, `gold untouched by settlement at step ${step}`);
	}
	assert.equal(m.bank.principal[o], 0, 'note loan repaid in full');
	assert.equal(m.bank.cleared, 1);
	assert.ok(m.bank.noteRetired > 0, 'repayment retired the bank\u2019s own notes');
	noteIdentity(m);
	assert.ok(conserved(m) < 1e-9);
});

test('a note loan paid out entirely as wages defaults on schedule and leaves worker notes and liability untouched', () => {
	const m = bareModel();
	m.creditOn = true;
	m.money.fundBank(10);
	const { firm, o } = borrower(m, 1);
	m.money.settleOwner(o);
	const asset = m.bank.principal[o];
	assert.ok(asset >= LOAN_MIN);
	const w = m.workers.spawn(10.5, 10.5, WORKER_STILL, 0, 0, 1, true);
	m.money.payEntryWage(firm, w, m.owners.notes[o]);
	assert.ok(m.workers.notes[w] > 0, 'the wage landed as notes');
	assert.equal(m.owners.notes[o], 0, 'borrower drained');
	const held = m.workers.notes[w];
	const liability = m.bank.noteLiability;
	const gold = m.money.total();
	for (let n = 0; n < (LOAN_GRACE_SECONDS + 10) / ECONOMY_DT && !m.bank.defaulted[o]; n++) m.money.settleOwner(o);
	assert.equal(m.bank.defaulted[o], 1, 'defaulted after the grace period');
	assert.equal(m.bank.defaults, 1);
	assert.ok(Math.abs(m.bank.writtenOff - asset) < 1e-12, 'the loan asset is written down');
	assert.equal(m.workers.notes[w], held, 'circulating notes survive the default');
	assert.equal(m.bank.noteLiability, liability, 'the bank still owes every outstanding note');
	assert.ok(Math.abs(m.money.total() - gold) < 1e-12, 'default moves no gold');
	noteIdentity(m);
	assert.ok(conserved(m) < 1e-12);
});

test('redemption drains the reserve, queues the rest, suspends new credit and resumes when gold returns', () => {
	const m = bareModel();
	m.creditOn = true;
	m.money.fundBank(0.5);
	const { firm, o } = borrower(m, 1.5);
	m.money.settleOwner(o);
	const loan = m.owners.notes[o];
	assert.ok(loan > 0.5, 'holder covers the first redemption slice');

	const first = m.bank.redeemOwner(o, 999);
	assert.ok(Math.abs(first.fill - 0.5) < 1e-12, 'reserve fully drained at par');
	assert.ok(Math.abs(first.queued - (loan - 0.5)) < 1e-12, 'uncovered demand queues with the holder');
	assert.ok(m.bank.reserve <= m.bank.eps(), 'reserve empty');
	assert.equal(m.bank.isSuspended(), true, 'suspension visible while notes are out');
	noteIdentity(m);

	// A fresh owner cannot get credit while suspended; the refusal is counted. Find a second buildable
	// cell rather than assuming a fixed coordinate is inside the map and free of water or plots.
	let firm2 = -1;
	for (let i = 0; i < ECONOMY_SIZE && firm2 < 0; i++) {
		if (i === economyIndex(10, 10) || m.actors[i]) continue;
		if (m.setActor(i, ECONOMY_MINE)) firm2 = i;
	}
	assert.ok(firm2 >= 0, 'second firm placed');
	const o2 = m.owners.ownerAt(firm2);
	assert.notEqual(o2, o);
	assert.equal(m.bank.request(o2, 1), 0, 'issuance refused while suspended');
	assert.equal(m.bank.refusals, 1);

	// Further redemption with an empty reserve only queues.
	const second = m.bank.redeemOwner(o, 1);
	assert.equal(second.fill, 0);
	assert.ok(second.queued > 0, 'demand queues behind the run');
	assert.ok(m.bank.queuedNotes() > 0);
	noteIdentity(m);

	// Gold returns: the queue drains, suspension lifts and issuance works again.
	m.money.fundBank(10);
	assert.equal(m.bank.isSuspended(), false, 'suspension lifts once the reserve is back');
	assert.ok(m.bank.queuedNotes() <= m.bank.eps(), 'queue drained or voided against spent notes');
	noteIdentity(m);
	const granted = m.bank.request(o2, 1);
	assert.ok(granted > 0, 'issuance resumes after the run clears');
	noteIdentity(m);
	assert.ok(conserved(m) < 1e-12);
});

test('the credit switch only falls once every note is settled', () => {
	const m = bareModel();
	m.creditOn = true;
	m.money.fundBank(10);
	const { firm, o } = borrower(m, 1);
	m.money.settleOwner(o);
	assert.equal(m.bank.notesSettled(), false, 'an open note loan blocks the stop');

	m.money.dig(firm, 10);
	for (let n = 0; n < (LOAN_TERM_SECONDS + 5) / ECONOMY_DT && m.bank.principal[o] > 0; n++) m.money.settleOwner(o);
	assert.equal(m.bank.principal[o], 0, 'loan cleared');
	assert.equal(m.bank.noteLiability, 0, 'borrower repaid in notes; nothing else holds any');
	assert.equal(m.owners.notes[o], 0);
	assert.equal(m.bank.notesSettled(), true, 'settled: the switch may fall');
	noteIdentity(m);
});

test('the reference economy with credit on keeps both ledgers exact for 150 s', () => {
	const m = new PriceEconomy();
	m.creditOn = true;
	let engaged = false;
	for (let t = 0; t < 150; t += 10) {
		run(m, 10);
		assert.ok(conserved(m) < 1e-6, `gold identity at ${t}s`);
		noteIdentity(m);
		assert.ok(Number.isFinite(m.money.total()) && Number.isFinite(m.money.noteTotal()), `finite ledgers at ${t}s`);
		if (m.bank.noteIssued > 0) engaged = true;
	}
	assert.ok(engaged, 'owners actually borrowed notes during the run');
});
