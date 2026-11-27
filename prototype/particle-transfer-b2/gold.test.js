// Owns: gold.js rule tests — wage claims (SoA booking at zero-cash entry, FIFO settlement to the original hire, custody fallback) and the T0/T1 transport/custody drip.
// Edit for: payEntryWage/settleOwner/claim flows, dripToTowns and WAGE_CLAIM_CAP behaviour.
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

const conserved = m => Math.abs(m.money.total() - (m.money.initial + m.money.mined));
const owed = (m, cell) => m.owners.owed[m.owners.ownerAt(cell)];
const settle = (m, cell) => m.money.settleOwner(m.owners.ownerAt(cell));
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !== ${b}`);
const dryCell = m => m.actors.findIndex((a, i) => !a && m.land.terrain[i] !== TERRAIN_WATER);

test('a zero-cash owner books the unpaid entry wage on the original worker', () => {
	const m = bareModel(), firm = economyIndex(10, 10);
	m.setActor(firm, ECONOMY_MINE);
	const w = m.workers.spawn(10.5, 10.5, WORKER_FIRM_POOL, 0, 0, 1, true);
	const bill = 3;
	const paid = m.money.payEntryWage(firm, w, bill);
	assert.equal(paid, 0, 'no cash at a founding firm');
	assert.equal(m.workers.gold[w], 0, 'wallet untouched without cash');
	assert.ok(Math.abs(owed(m, firm) - bill) < 1e-12);
	assert.ok(Math.abs(m.money.unpaidWages(m.workers.id[w]) - bill) < 1e-12, 'claim is on the hire');
	assert.equal(m.money.claimCount, 1);
	assert.ok(conserved(m) < 1e-12, 'the claim is a liability, not minted gold');
});

test('later owner cash settles the claim to the original hire even when a different worker stands on site', () => {
	const m = bareModel(), firm = economyIndex(10, 10);
	m.setActor(firm, ECONOMY_MINE);
	const original = m.workers.spawn(10.5, 10.5, WORKER_SHIFT, 0, 0, 1, true);
	const stranger = m.workers.spawn(10.5, 10.5, WORKER_SHIFT, 0, 0, 1, true);
	m.money.payEntryWage(firm, original, 4);
	assert.equal(m.money.unpaidWages(m.workers.id[original]), 4);
	m.money.dig(firm, 2.5);
	settle(m, firm);
	assert.ok(Math.abs(m.workers.gold[original] - 2.5) < 1e-12, 'original hire credited');
	assert.equal(m.workers.gold[stranger], 0, 'stranger on site gets nothing');
	assert.ok(Math.abs(m.money.unpaidWages(m.workers.id[original]) - 1.5) < 1e-12, 'remainder stays claimed');
	assert.ok(Math.abs(owed(m, firm) - 1.5) < 1e-12, 'owner liability mirrors its claims');
	assert.ok(conserved(m) < 1e-12, 'settlement moves gold, never mints it');
	m.money.dig(firm, 5);
	settle(m, firm);
	assert.ok(Math.abs(m.workers.gold[original] - 4) < 1e-12, 'claim paid in full');
	assert.equal(m.money.unpaidWages(m.workers.id[original]), 0);
	assert.equal(owed(m, firm), 0);
	assert.equal(m.money.claimCount, 0);
	assert.ok(conserved(m) < 1e-12);
});

test('a despawned hire\'s settled claim falls to custody and an erased facility leaves the owner liable', () => {
	const m = bareModel(), firm = economyIndex(10, 10);
	m.setActor(firm, ECONOMY_MINE);
	const w = m.workers.spawn(10.5, 10.5, WORKER_SHIFT, 0, 1, 1, true);
	m.money.recordFunding(1);
	const id = m.workers.id[w];
	m.money.payEntryWage(firm, w, 2);
	// Despawn: wallet gold already falls to custody in WorkerLife.remove.
	m.workerLife.remove(w);
	assert.equal(m.workers.indexOfId(id), -1);
	const before = m.money.total();
	m.money.dig(firm, 3);
	settle(m, firm);
	assert.equal(m.money.unpaidWages(id), 0, 'dead claim settled');
	assert.ok(Math.abs(m.money.total() - (before + 3)) < 1e-12, 'custody keeps the dug gold in the system');
	assert.ok(conserved(m) < 1e-12);
	// Claims are owner debts (plan M.1a): erasing the facility neither forgives them nor mints or loses gold.
	const w2 = m.workers.spawn(10.5, 10.5, WORKER_SHIFT, 0, 0, 1, true);
	const o = m.owners.ownerAt(firm);
	const debt = 1.25 - m.money.payEntryWage(firm, w2, 1.25);
	assert.ok(debt > 0.1, 'leftover cash covers only part of the second bill');
	assert.equal(m.money.claimCount, 1);
	const beforeRelease = m.money.total();
	m.setActor(firm, 0);
	assert.equal(m.owners.ownerAt(firm), 0, 'facility link dropped');
	assert.equal(m.money.claimCount, 1, 'owner still owes the hire');
	assert.ok(Math.abs(m.owners.owed[o] - debt) < 1e-12);
	assert.ok(Math.abs(m.money.total() - beforeRelease) < 1e-12);
	m.money.creditOwner(o, 2);
	m.money.recordFunding(2);
	m.money.settleOwner(o);
	assert.ok(Math.abs(m.workers.gold[m.workers.indexOfId(m.workers.id[w2])] - 1.25) < 1e-12, 'later owner cash still pays the claim');
	assert.ok(conserved(m) < 1e-12);
});

test('the claim table grows past its initial cap without losing an entitlement', () => {
	const m = bareModel(), firm = economyIndex(10, 10);
	m.setActor(firm, ECONOMY_MINE);
	const N = WAGE_CLAIM_CAP + 1;
	for (let n = 0; n < N; n++) {
		const w = m.workers.spawn(10.5 + (n % 4) * 0.1, 10.5, WORKER_SHIFT, 0, 0, 1, true);
		m.money.payEntryWage(firm, w, 1);
	}
	assert.equal(m.money.claimCount, N, 'every claim is stored, none dropped at the cap');
	assert.ok(m.money.claimCap >= N, 'the table grew to hold every claim');
	assert.ok(Math.abs(owed(m, firm) - N) < 1e-12);
	let unpaid = 0;
	for (let w = 0; w < N; w++) unpaid += m.money.unpaidWages(m.workers.id[w]);
	assert.ok(Math.abs(unpaid - N) < 1e-12, 'all entitlements are represented');
	m.money.dig(firm, N);
	settle(m, firm);
	for (let w = 0; w < N; w++) {
		assert.ok(Math.abs(m.workers.gold[w] - 1) < 1e-12, `worker ${w} paid in full`);
	}
	assert.equal(m.money.custody, 0, 'no entitlement fell to custody');
	assert.equal(owed(m, firm), 0);
	assert.equal(m.money.claimCount, 0);
	assert.ok(conserved(m) < 1e-12);
});

test('settlement pays wage claims in FIFO order', () => {
	const m = bareModel(), firm = economyIndex(10, 10);
	m.setActor(firm, ECONOMY_MINE);
	const ws = [], ids = [];
	for (let n = 0; n < 3; n++) {
		const w = m.workers.spawn(10.5 + n * 0.1, 10.5, WORKER_SHIFT, 0, 0, 1, true);
		ws.push(w);
		ids.push(m.workers.id[w]);
		m.money.payEntryWage(firm, w, 1);
	}
	m.money.dig(firm, 2);
	settle(m, firm);
	assert.ok(Math.abs(m.workers.gold[ws[0]] - 1) < 1e-12, 'first hire paid first');
	assert.ok(Math.abs(m.workers.gold[ws[1]] - 1) < 1e-12, 'second hire paid before the third');
	assert.equal(m.workers.gold[ws[2]], 0, 'third hire waits for the remaining debt');
	assert.equal(m.money.unpaidWages(ids[0]), 0);
	assert.equal(m.money.unpaidWages(ids[2]), 1);
	assert.ok(Math.abs(owed(m, firm) - 1) < 1e-12);
	assert.equal(m.money.claimCount, 1);
	assert.equal(m.money.claimWorkerId[0], ids[2], 'the surviving claim is the oldest unpaid one');
	assert.ok(conserved(m) < 1e-12);
	m.money.dig(firm, 1);
	settle(m, firm);
	assert.ok(Math.abs(m.workers.gold[ws[2]] - 1) < 1e-12, 'the deferred hire is paid after the rest');
	assert.equal(m.money.claimCount, 0);
	assert.ok(conserved(m) < 1e-12);
});

test('T0 drips transport and custody to towns by population; T1 retains transport while custody still escheats', () => {
	const m = bareModel();
	const small = dryCell(m);
	m.setActor(small, ECONOMY_TOWN);
	const large = dryCell(m);
	m.setActor(large, ECONOMY_TOWN);
	m.pop[small] = 1;
	m.pop[large] = 3;
	assert.equal(m.money.transportPreset, 'T0', 'the documented default preset');
	const share = m.money.dripShare;
	m.money.payTransport(1);
	m.money.custody = 0.5;
	const total = m.money.total();
	m.money.dripToTowns();
	near(m.money.purse[small], 1.5 * share / 4);
	near(m.money.purse[large], 3 * 1.5 * share / 4);
	near(m.money.transport, 1 - share);
	near(m.money.custody, 0.5 * (1 - share));
	near(m.money.total(), total);
	m.money.transportPreset = 'T1';
	m.money.payTransport(1);
	m.money.custody = 0.5;
	const held = m.money.transport;
	const totalT1 = m.money.total();
	m.money.dripToTowns();
	near(m.money.transport, held);
	near(m.money.custody, 0.5 * (1 - share));
	near(m.money.total(), totalT1);
});
