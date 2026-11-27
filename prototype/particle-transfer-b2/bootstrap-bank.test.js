// Owns: G2/B0/T1 acceptance — mine timber, wood outage, bank charter/lending/limits/default and transport/custody split.
// Edit for: scenario grant sizes, loan terms and drip policy in gold.js/banks.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPTS = ['simulation.js', 'land.js', 'steering.js', 'forage.js', 'owners.js', 'gold.js', 'banks.js', 'goods.js', 'workforce.js', 'workers.js', 'worker-life.js', 'farms.js', 'actors.js', 'towns.js', 'settlement.js', 'founding.js', 'track.js'];
for (const file of SCRIPTS) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const conserved = m => near(m.money.total(), m.money.seeded + m.money.mined);

function bare() {
	const m = new PriceEconomy(0);
	for (let i = 0; i < ECONOMY_SIZE; i++) if (m.actors[i]) m.setActor(i, 0);
	m.workers.reset();
	m.money.reset();
	m.goodsPool.reset();
	m.rebuildCellView();
	return m;
}

function emptyCell(m) {
	return m.actors.findIndex((a, i) => !a && !m.farms.plotOwner[i] && !m.forage.plotOwner[i] && m.land.terrain[i] !== TERRAIN_WATER);
}

test('scenario init records one timber reserve per gold mine; placement grants neither gold nor wood', () => {
	const m = new PriceEconomy(0);
	const gold = economyIndex(3, 13);
	near(m.wood[gold], GOLD_TIMBER);
	near(m.seededTimber, GOLD_TIMBER);
	near(m.money.seeded, 0);
	const cell = emptyCell(m);
	const total = m.money.total(), timber = m.seededTimber;
	assert.equal(m.setActor(cell, ECONOMY_GOLD), true);
	near(m.wood[cell], 0);
	near(m.seededTimber, timber);
	near(m.money.total(), total);
	conserved(m);
});

test('gold output pauses without timber, resumes on resupply and counts the wood as consumed', () => {
	const m = bare(), cell = economyIndex(20, 14);
	m.setActor(cell, ECONOMY_GOLD);
	m.shiftAvail[cell] = 1;
	const recipe = m.optimizer.recipes[ECONOMY_GOLD];
	m.optimizer.stepFirm(cell, recipe);
	near(m.money.mined, 0);
	near(m.wood[cell], 0);
	m.money.seedTimber(cell, 0.5);
	m.optimizer.stepFirm(cell, recipe);
	assert.ok(m.money.mined > 0, 'timber must unlock extraction');
	assert.ok(m.wood[cell] < 0.5, 'the batch must consume delivered timber');
	assert.ok(m.consumedWood > 0, 'wood use joins the real-asset ledger');
	const mined = m.money.mined;
	m.wood[cell] = 0;
	m.optimizer.stepFirm(cell, recipe);
	near(m.money.mined, mined, 1e-12);
	conserved(m);
});

test('a funded gold mine pays mined gold for a delivered wood shipment, booking the input purchase', () => {
	const m = bare(), mine = economyIndex(20, 14), mill = economyIndex(22, 14);
	m.setActor(mine, ECONOMY_GOLD);
	m.setActor(mill, ECONOMY_SAWMILL);
	m.money.dig(mine, 5);
	m.owners.allocate();
	m.priceWood[mine] = 2;
	m.goodsPool.cap[ITEM_WOOD][mine] = 1;
	assert.equal(m.goodsPool.emit(ITEM_WOOD, mine, 0.5, 0.4, mill), true);
	m.goodsPool.arriving[0] = 1;
	m.goodsPool.admitKind(ITEM_WOOD);
	near(m.wood[mine], 0.5);
	near(m.money.cash(mine), 4);
	near(m.owners.accountAt(mill).cash, 1);
	near(m.money.inputs, 1);
	conserved(m);
});

test('bank capital transfers owner gold; lending obeys the debt limit and refuses empty or missing banks', () => {
	const m = new PriceEconomy(1, 6);
	assert.equal(m.banks.exists, true);
	near(m.banks.gold, 6);
	conserved(m);
	const cell = economyIndex(3, 13);
	let r = m.banks.requestLoan(cell, 4);
	assert.equal(r.ok, true, r.message);
	near(m.banks.gold, 2);
	assert.ok(m.money.cash(cell) > 3.9, 'borrowed gold is spendable immediately');
	r = m.banks.requestLoan(cell, 7);
	assert.equal(r.ok, false);
	assert.match(r.message, /Debt limit/);
	m.banks.gold = 0;
	r = m.banks.requestLoan(cell, 1);
	assert.match(r.message, /Empty bank/);
	const noBank = new PriceEconomy(1, 0);
	r = noBank.banks.requestLoan(cell, 1);
	assert.match(r.message, /No gold bank/);
	m.banks.gold = 2;
	r = m.banks.requestLoan(economyIndex(9, 20), 1);
	assert.match(r.message, /Select a firm/);
	conserved(m);
});

test('loan service collects simple interest then principal; the bank equity identity holds', () => {
	const m = bare(), cell = economyIndex(20, 14);
	m.setActor(cell, ECONOMY_GOLD);
	m.money.seedWorker(10); // recorded scenario capital, then an explicit owner transfer funds the bank
	m.money.payOwner(m.owners.ownerAt(cell), 10);
	m.banks.fundFrom(m.owners.ownerAt(cell), 10);
	assert.equal(m.banks.requestLoan(cell, 4).ok, true);
	near(m.banks.gold, 6);
	const loan = m.banks.loans[0];
	loan.matureTick = m.ticks + 60;
	for (let n = 0; n < 60; n++) {
		m.money.dig(cell, 0.2);
		m.ticks++;
		m.money.step();
	}
	assert.ok(m.banks.interestPaid > 0, 'fixed simple interest accrues and is collected');
	near(loan.outstanding, 0);
	near(m.owners.accounts[loan.owner].loanDebt, 0);
	near(m.banks.gold, 10 + m.banks.interestPaid);
	near(m.banks.equity(), m.banks.funded + m.banks.interestPaid - m.banks.writtenDown);
	conserved(m);
});

test('wage arrears settle before debt service, and a default writes down without erasing wage claims', () => {
	const m = bare(), cell = economyIndex(20, 14);
	m.setActor(cell, ECONOMY_GOLD);
	const w = m.workers.spawn(20.5, 14.5, WORKER_SHIFT, 0, 0, 1, true);
	m.money.payEntryWage(cell, w, 3);
	assert.equal(m.money.unpaidWages(m.workers.id[w]), 3, 'zero-cash firm books the claim');
	m.money.seedWorker(10);
	m.money.payOwner(m.owners.ownerAt(cell), 10);
	m.banks.fundFrom(m.owners.ownerAt(cell), 10);
	assert.equal(m.banks.requestLoan(cell, 4).ok, true);
	const loan = m.banks.loans[0];
	loan.matureTick = m.ticks;
	const bankBefore = m.banks.gold;
	m.ticks++;
	m.money.step();
	near(m.workers.gold[w], 3, 1e-6, 'senior wages are paid first');
	assert.ok(m.banks.gold > bankBefore + 0.9 && m.banks.gold < bankBefore + 1.01, 'debt service takes the remainder');
	near(loan.outstanding, 3, 1e-3); // one tick of interest shifts the cash left for principal
	assert.equal(m.money.unpaidWages(m.workers.id[w]), 0);
	conserved(m);

	const other = economyIndex(24, 14);
	m.setActor(other, ECONOMY_MINE);
	assert.equal(m.banks.requestLoan(other, 4).ok, true);
	const owner = m.owners.ownerAt(other);
	const w2 = m.workers.spawn(24.5, 14.5, WORKER_SHIFT, 0, 0, 1, true);
	near(m.money.payEntryWage(other, w2, 4), 4);
	const w3 = m.workers.spawn(24.6, 14.5, WORKER_SHIFT, 0, 0, 1, true);
	m.money.payEntryWage(other, w3, 1);
	const loan2 = m.banks.loans[1];
	loan2.matureTick = m.ticks;
	m.ticks += Math.round(LOAN_GRACE_SECONDS / ECONOMY_DT) + 1;
	m.money.step();
	assert.equal(loan2.defaulted, true, 'grace expiry writes the loan down');
	near(m.owners.accounts[owner].loanDebt, 0);
	assert.ok(m.banks.writtenDown >= 4);
	assert.ok(m.banks.defaults >= 1);
	assert.equal(m.money.unpaidWages(m.workers.id[w3]), 1, 'default erases no wage claim');
	near(m.banks.equity(), m.banks.funded + m.banks.interestPaid - m.banks.writtenDown);
	conserved(m);
});

test('T0 drips only transport earnings to towns; T1 retains them and custody never funds anyone', () => {
	const m = new PriceEconomy(1);
	const town = economyIndex(9, 20);
	m.money.seedWorker(10);
	m.money.payOwner(m.owners.ownerAt(town), 10);
	m.owners.allocate();
	near(m.owners.spend(town, 4), 4); // a buyer pays a haul fee...
	m.money.payTransport(4); // ...which admission splits into the company account
	const w = m.workers.spawn(20.5, 14.5, WORKER_STILL, 0, 2, 1, true);
	m.money.seedWorker(2);
	m.workerLife.remove(w);
	near(m.money.custody, 2);
	const townCash = m.owners.accountAt(town).cash;
	m.money.step();
	assert.ok(m.money.transport < 4, 'T0 redistributes transport fees');
	assert.ok(m.money.redistributed > 0);
	near(m.money.custody, 2);
	assert.ok(m.owners.accountAt(town).cash > townCash, 'towns receive the T0 drip');
	m.money.transportPreset = TRANSPORT_T1;
	near(m.owners.spend(town, 3), 3);
	m.money.payTransport(3);
	const held = m.money.transport;
	m.money.step();
	near(m.money.transport, held, 1e-12);
	conserved(m);
});

test('a banked reference scene conserves gold over a minute and receives loan interest', () => {
	const m = new PriceEconomy(1, 6);
	assert.equal(m.banks.requestLoan(economyIndex(3, 13), 4).ok, true);
	for (let n = 0; n < Math.round(60 / ECONOMY_DT); n++) {
		m.step();
		if (n % 600 === 0) conserved(m);
	}
	assert.ok(m.banks.interestPaid > 0.05, `interest collected: ${m.banks.interestPaid}`);
	conserved(m);
});
