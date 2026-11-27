// Owns: the M.7 end-to-end gate — the first scenario (G1+O2+D1+G2+B0/P1) driven through the real tick loop.
// Edit for: scenario steps, gate thresholds and ledger checks; unit-level slices live in their own suites.
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
		assert.ok(e <= 1e-9, `note identity broken for issuer ${k}: ${e}`);
	}
};

const GOLD_CELL = economyIndex(3, 13);
const MILL_CELL = economyIndex(6, 6);
const LOAN_NOTES = 4;
const SCENARIO_SECONDS = 150;

// One consenting town next to the borrower closes the note circuit: workers spend note wages on rest and rations.
// Consent is the engine's own predicate — rich towns insist on gold, so candidates that refuse notes are undone.
function consentingTownNear(m, cx, cy) {
	for (let r = 1; r <= 3; r++) {
		for (let dy = -r; dy <= r; dy++) {
			for (let dx = -r; dx <= r; dx++) {
				const i = economyIndex(wrapX(cx + dx), wrapY(cy + dy));
				if (m.actors[i] || m.land.terrain[i] === TERRAIN_WATER || !m.setActor(i, ECONOMY_TOWN)) continue;
				if (m.currencies.townAccepts(0, i)) return i;
				m.setActor(i, 0);
			}
		}
	}
	return -1;
}

test('end-to-end gate: gold origin, worker-owner founding, wood chain, gold loan and a note loan through one scene', () => {
	const m = new PriceEconomy(1, 6);
	m.creditMoney = true;
	m.banks.syncIssuer();

	// G1: scenario capital allocated once, placement mints nothing.
	near(m.money.seeded, m.workers.totalAmount() * 1);
	const beforePlacement = m.money.total();
	const town = consentingTownNear(m, 6, 6);
	assert.ok(town >= 0, 'a consenting town site exists near the borrower');
	near(m.money.total(), beforePlacement);
	conserved(m);

	// O2/P1: bounded note issuance to the sawmill's worker owner — new spendable notes, no gold moved.
	const totalBeforeLoan = m.money.total();
	assert.equal(m.banks.requestNoteLoan(MILL_CELL, LOAN_NOTES).ok, true);
	near(m.money.total(), totalBeforeLoan, 1e-12);
	assert.equal(m.banks.requestNoteLoan(MILL_CELL, LOAN_NOTES + 1).ok, false, 'the project cap bounds issuance');
	assert.equal(m.banks.requestNoteLoan(town, 1).ok, false, 'towns cannot borrow');

	// B0: an explicit gold loan to the mine owner; bank reserves drop by the principal, nothing mints.
	const goldLoan = m.banks.requestLoan(GOLD_CELL, 3);
	assert.equal(goldLoan.ok, true, goldLoan.message);
	near(m.banks.gold, 3, 1e-9);

	// Run the reference chain with the money engine live; ledgers stay exact throughout.
	const ticks = Math.round(SCENARIO_SECONDS / ECONOMY_DT);
	for (let t = 0; t < ticks; t++) {
		m.step();
		if (t % 600 === 0) {
			conserved(m);
			noteIdentity(m);
			near(m.workers.seededWorkers + m.workers.births - m.workerLife.deaths, m.workers.totalAmount(), 1e-9);
			near(m.workers.seededTired + m.workedLabor - m.restedDepleted - m.workerLife.removedTired, m.workers.totalTired());
		}
	}

	// G2: the mine pays worked wages out of extraction; D1: demand-gated transport moves wood to buyers.
	assert.ok(m.money.mined > 0, 'the gold mine extracts gold');
	assert.ok(m.money.wages > 0, 'workers are paid');
	assert.ok(m.producedWood > 0 && m.consumedWood > 0, 'sawmill wood reaches buyers through the traded chain');
	assert.ok(m.workers.count > 0 && m.workerLife.deaths === 0, 'the fed scene keeps everyone alive');

	// P1: the note circuit closed — wages in notes, consenting-town fees in notes, redemption retired notes.
	assert.ok(m.money.wageNotes > 0, 'the borrower pays entry wages in its notes');
	assert.ok(m.money.taxNotes + m.money.rationNotes > 0, 'the consenting town accepts note fees');
	assert.ok(m.currencies.issuers[0].retired > 0, 'notes were redeemed and retired');
	assert.ok(m.banks.noteInterest + m.banks.noteInterestGold > 0, 'interest accrued on the note loan');

	// B0/P1: every note gram of debt is accounted: repaid in notes, funded by gold, written down or in arrears.
	const loan = m.banks.loans.find(l => l.notes && l.principal === LOAN_NOTES);
	assert.ok(loan, 'the note loan is in the book');
	near(m.banks.noteRepaid + m.banks.noteRepaidGold + m.banks.noteWrittenDown + m.banks.noteArrearsAmount(), LOAN_NOTES, 1e-6);
	const goldLoanRecord = m.banks.loans.find(l => !l.notes && l.principal === 3);
	assert.ok(goldLoanRecord, 'the gold loan is in the book');
	near(m.banks.repaid + m.banks.writtenDown + m.banks.arrearsAmount(), 3, 1e-6);

	// Bank book identity: reserve gold + receivables − circulating note liabilities.
	for (let k = 0; k < m.banks.loans.length; k++) {
		const l = m.banks.loans[k];
		const account = m.owners.accounts[l.owner];
		if (l.notes) near(account.noteLoanDebt + (l.defaulted ? 0 : 0), l.outstanding + (l.defaulted ? 0 : 0), 1e-6);
	}
	conserved(m);
	noteIdentity(m);
});

test('end-to-end gate: reserve exhaustion suspends the bank and notes stop being spendable', () => {
	const m = new PriceEconomy(0, 0.001);
	for (let i = 0; i < ECONOMY_SIZE; i++) if (m.actors[i] && m.actors[i] !== ECONOMY_TOWN && m.actors[i] !== ECONOMY_GOLD) m.setActor(i, 0);
	m.workers.reset();
	m.workerLife.reset();
	m.money.reset();
	m.goodsPool.reset();
	m.rebuildCellView();
	m.creditMoney = true;
	m.banks.syncIssuer();
	// The strip leaves the gold mine owned, so the mine owner plays the borrower.
	const owner = m.owners.ownerAt(GOLD_CELL);
	m.money.payOwner(owner, 0.001);
	m.money.seeded += 0.001;
	m.owners.allocate();
	m.banks.fundFrom(owner, 0.001);
	assert.equal(m.banks.requestNoteLoan(GOLD_CELL, 1).ok, true);
	// The worker checks in from inside the town: the consenting town takes the note fee on admission.
	const town = consentingTownNear(m, 3, 13);
	assert.ok(town >= 0, 'a consenting town site exists near the mine');
	const w = m.workers.spawn((town % ECONOMY_WIDTH) + 0.5, Math.floor(town / ECONOMY_WIDTH) + 0.5, WORKER_STILL, 0, 0, FOOD_BAG, true);
	// Two notes: the rest fee is 1.05 x tired, so one note cannot cover check-in.
	m.currencies.issuers[0].issued += 2;
	m.currencies.workerNotes[0][w] = 2;
	m.workers.tired[w] = 1;
	assert.equal(m.workers.tryAdmitTown(w, town), true, 'the consenting town takes the note fee');
	assert.ok(m.currencies.accountBalance(0, town) > 0);
	const result = m.banks.redeemNotes(town, m.currencies.accountBalance(0, town) + 10);
	assert.ok(result.unmet > 0, 'redemption demand beyond reserves goes unmet');
	assert.equal(m.banks.suspended, true, 'exhausted reserves suspend the bank visibly');
	assert.equal(m.banks.notesSpendable(), false, 'suspended notes are not spendable');
	assert.equal(m.banks.requestNoteLoan(GOLD_CELL, 1).ok, false, 'no new credit while suspended');
	const before = m.money.total();
	m.money.payOwner(owner, 3);
	m.money.seeded += 3;
	m.banks.fundFrom(owner, 3);
	m.banks.step();
	assert.equal(m.banks.suspended, false, 'funding ends the suspension');
	assert.equal(m.banks.notesSpendable(), true);
	conserved(m);
	noteIdentity(m);
});
