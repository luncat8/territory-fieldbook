// Owns: owner, bank and M.7 first-scenario tests — worker-owner portfolios, gold loans, repayment, default and the 1 g/worker loop.
// Edit for: owners.js / banks.js policy changes, the gold mine's wood input and the end-to-end gold → sawmill → loan gate.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPTS = ['simulation.js', 'land.js', 'steering.js', 'forage.js', 'gold.js', 'owners.js', 'banks.js', 'goods.js', 'workforce.js', 'workers.js', 'worker-life.js', 'farms.js', 'actors.js', 'towns.js', 'settlement.js', 'founding.js', 'track.js'];
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

test('an owner short of its next-shift reserve borrows existing gold and repays principal plus interest', () => {
	const m = bareModel();
	m.money.fundBank(10);
	const { firm, o } = borrower(m, 1);
	m.money.settleOwner(o);
	const loan = m.bank.principal[o];
	assert.ok(loan >= LOAN_MIN, 'loan granted');
	assert.ok(m.owners.cash[o] > loan - 0.1, 'proceeds land in owner cash');
	assert.ok(Math.abs(m.owners.cash[o] + m.bank.reserve - 10) < 1e-12, 'lent from the reserve, not minted');
	assert.ok(conserved(m) < 1e-12);
	m.money.dig(firm, 20);
	for (let n = 0; n < (LOAN_TERM_SECONDS + 5) / ECONOMY_DT && m.bank.principal[o] > 0; n++) m.money.settleOwner(o);
	assert.equal(m.bank.principal[o], 0);
	assert.equal(m.bank.cleared, 1, 'loan repaid in full');
	assert.ok(Math.abs(m.bank.repaid - m.bank.lent) < 1e-9, 'principal returns to the reserve');
	assert.ok(m.bank.interest > 0, 'simple interest is paid');
	assert.ok(Math.abs(m.bank.reserve - (10 + m.bank.interest)) < 1e-9, 'interest is a transfer into bank equity');
	assert.ok(conserved(m) < 1e-9);
});

test('missed installments past the grace period default and write off only the bank asset', () => {
	const m = bareModel();
	m.money.fundBank(10);
	const { o } = borrower(m, 1);
	m.money.settleOwner(o);
	const loan = m.bank.principal[o];
	const w = m.workers.spawn(10.5, 10.5, WORKER_STILL, 0, 0, 1, true);
	m.workers.gold[w] += m.owners.cash[o];
	m.owners.cash[o] = 0;
	const total = m.money.total();
	for (let n = 0; n < (LOAN_GRACE_SECONDS + 10) / ECONOMY_DT && !m.bank.defaulted[o]; n++) m.money.settleOwner(o);
	assert.equal(m.bank.defaulted[o], 1);
	assert.equal(m.bank.defaults, 1);
	assert.ok(Math.abs(m.bank.writtenOff - loan) < 1e-12, 'unpaid principal leaves bank equity');
	assert.ok(Math.abs(m.money.total() - total) < 1e-12, 'default moves no gold');
	m.money.settleOwner(o);
	assert.equal(m.bank.principal[o], 0, 'a defaulted owner gets no new loan');
	assert.ok(conserved(m) < 1e-12);
});

test('loan size respects the owner debt limit and the bank\'s actual reserve', () => {
	const m = bareModel();
	m.money.fundBank(0.1);
	const { o } = borrower(m, 1);
	assert.equal(m.bank.request(o, 1), 0, 'bank cannot lend gold it does not hold');
	assert.equal(m.bank.refusals, 1);
	m.money.fundBank(20);
	assert.equal(m.bank.request(o, 1), 0, 'retry backoff after a refusal');
	m.bank.retryAt[o] = 0;
	const granted = m.bank.request(o, 10);
	assert.ok(Math.abs(granted - OWNER_DEBT_LIMIT) < 1e-12, 'capped by the owner debt limit');
	assert.ok(conserved(m) < 1e-12);
});

test('a placed firm is owned by a nearby worker and his second firm shares one purse and debt', () => {
	const m = bareModel();
	const w = m.workers.spawn(11.5, 10.5, WORKER_STILL, 0, 0, 1, true);
	const a = economyIndex(10, 10), b = economyIndex(12, 10);
	m.setActor(a, ECONOMY_MINE);
	m.setActor(b, ECONOMY_FACTORY);
	const o = m.owners.ownerAt(a);
	assert.ok(o > 0);
	assert.equal(m.owners.workerId[o], m.workers.id[w], 'the founder is a worker');
	assert.equal(m.owners.ownerAt(b), o, 'second facility joins the same owner');
	assert.equal(m.owners.facilities[o], 2);
	assert.equal(m.money.total(), 0, 'placement mints nothing');
	m.money.fund(a, 4);
	assert.ok(Math.abs(m.owners.budgetAt(b) - 2) < 1e-12, 'each site sees a bounded share of the shared cash');
	m.setActor(a, 0);
	assert.equal(m.owners.facilities[o], 1);
	assert.ok(Math.abs(m.owners.budgetAt(b) - 4) < 1e-12, 'erasing a site keeps the owner cash');
	assert.ok(conserved(m) < 1e-12);
});

test('the gold mine extracts only while it holds delivered wood', () => {
	const m = new PriceEconomy();
	let gold = -1;
	for (let i = 0; i < ECONOMY_SIZE; i++) if (m.actors[i] === ECONOMY_GOLD) gold = i;
	for (let i = 0; i < ECONOMY_SIZE; i++) if (m.actors[i] === ECONOMY_SAWMILL || m.actors[i] === ECONOMY_FARM) m.setActor(i, 0);
	m.founding.scanAndFound = () => {};
	m.seededWood -= m.wood[gold];
	m.wood[gold] = 0;
	run(m, 15);
	assert.equal(m.money.mined, 0, 'no wood, no gold');
	m.wood[gold] = 1;
	m.seededWood += 1;
	run(m, 15);
	assert.ok(m.money.mined > 1, `delivered wood restarts extraction, mined ${m.money.mined}`);
	assert.ok(m.consumedWood > 0);
	assert.ok(conserved(m) < 1e-7);
});

test('M.7 first scenario: 1 g/worker start, gold mine pays from own gold, sawmill loan is repaid', () => {
	const m = new PriceEconomy();
	assert.equal(m.scenario.goldPerWorker, START_GOLD_PER_WORKER);
	assert.ok(Math.abs(m.money.initial - START_GOLD_PER_WORKER * m.workers.count) < 1e-9, 'starting gold recorded once');
	run(m, 110);
	assert.ok(conserved(m) < 1e-7);
	assert.ok(m.money.mined > 40, `expected gold extraction, mined ${m.money.mined}`);
	assert.ok(m.consumedWood > m.seededWood, 'wood beyond the starting timber was delivered and used');
	assert.ok(m.bank.lent > 0, 'some owner borrowed');
	assert.ok(m.bank.cleared >= 1, 'at least one productive loan repaid in full');
	let founded = 0;
	for (let o = 1; o < m.owners.count; o++) if (m.owners.workerId[o] > 0) founded++;
	assert.ok(founded >= 4, 'every owner is a worker');
	assert.equal(m.workerLife.deaths, 0, 'no starvation in the opening');
});
