// Owns: P0 acceptance — note ledger identity, custody/compaction, town consent, credit switch and settings persistence.
// Edit for: currencies.js ledger rules, banks.syncIssuer policy and LabSettings field validation.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPTS = ['simulation.js', 'land.js', 'steering.js', 'forage.js', 'owners.js', 'gold.js', 'banks.js', 'currencies.js', 'goods.js', 'workforce.js', 'workers.js', 'worker-life.js', 'farms.js', 'actors.js', 'towns.js', 'settlement.js', 'founding.js', 'track.js'];
for (const file of SCRIPTS) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'settings.js'), 'utf8'), { filename: 'settings.js' });

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const conserved = m => near(m.money.total(), m.money.seeded + m.money.mined);

function stubStorage() {
	const map = new Map();
	return {
		getItem: k => (map.has(k) ? map.get(k) : null),
		setItem: (k, v) => map.set(k, String(v))
	};
}

test('a default scene runs gold-only: no issuer, no notes and identical conservation', () => {
	const m = new PriceEconomy();
	assert.equal(m.creditMoney, false);
	assert.equal(m.banks.noteIssuer(), -1);
	assert.equal(m.currencies.totalOutstanding(), 0);
	conserved(m);
});

test('chartering the issuer under credit money creates notes nowhere and the ledger balances at zero', () => {
	const m = new PriceEconomy();
	const gold = m.money.total();
	m.creditMoney = true;
	const k = m.banks.syncIssuer();
	assert.equal(k, -1, 'a bank-less scene cannot charter an issuer');
	assert.equal(m.banks.noteIssuer(), -1);
	m.banks.initializeScenario(6);
	m.banks.syncIssuer();
	assert.equal(m.banks.noteIssuer(), 0);
	near(m.currencies.issuers[0].issued, 0);
	assert.equal(m.currencies.totalOutstanding(), 0);
	near(m.money.total(), gold, 1e-9);
});

test('issuance into an owner account adds spendable notes without touching any gold bucket', () => {
	const m = new PriceEconomy(1, 5);
	m.creditMoney = true;
	const k = m.banks.syncIssuer();
	const cell = economyIndex(3, 13); // reference gold mine, a worker-owned facility
	const goldBefore = m.money.total();
	const cashBefore = m.money.cash(cell);
	m.currencies.issueToAccount(k, cell, 4);
	near(m.currencies.accountBalance(k, cell), 4);
	near(m.currencies.invariantError(k), 0);
	near(m.money.total(), goldBefore);
	near(m.money.cash(cell), cashBefore, 1e-12);
	near(m.banks.gold, 5, 1e-9); // reserve gold untouched by note issuance
});

test('note transfers between holders keep the ledger exact and bounded by the payer balance', () => {
	const m = new PriceEconomy(1, 5);
	m.creditMoney = true;
	const k = m.banks.syncIssuer();
	const mine = economyIndex(3, 13);
	m.currencies.issueToAccount(k, mine, 4);
	const w = 3;
	m.workers.count = Math.max(m.workers.count, w + 1);
	assert.equal(m.currencies.accountToWorker(k, mine, w, 10), 4); // a payer cannot spend notes it does not hold
	near(m.currencies.accountBalance(k, mine), 0);
	near(m.currencies.workerBalance(k, w), 4);
	const town = m.actors.indexOf(ECONOMY_TOWN);
	assert.equal(m.currencies.workerToAccount(k, w, town, 1.5), 1.5);
	near(m.currencies.accountBalance(k, town), 1.5);
	near(m.currencies.workerBalance(k, w), 2.5);
	near(m.currencies.invariantError(k), 0);
	m.currencies.accountToBank(k, town, 0.5);
	near(m.currencies.issuers[k].bankHeld, 0.5);
	near(m.currencies.invariantError(k), 0);
});

test('split divides note balances and despawn moves them to custody; compaction never duplicates notes', () => {
	const m = new PriceEconomy(1, 5);
	m.creditMoney = true;
	const k = m.banks.syncIssuer();
	const mine = economyIndex(3, 13);
	m.currencies.issueToAccount(k, mine, 12);
	const w = 2, last = m.workers.count - 1;
	m.currencies.accountToWorker(k, mine, w, 8);
	m.currencies.accountToWorker(k, mine, last, 4);
	const child = m.workers.count;
	m.workers.count++;
	m.currencies.splitWorker(w, child);
	near(m.currencies.workerBalance(k, w), 4);
	near(m.currencies.workerBalance(k, child), 4);
	near(m.currencies.invariantError(k), 0);
	const tailBalance = m.currencies.workerBalance(k, last);
	m.currencies.onWorkerRemoved(w, last); // the real compaction: w inherits the tail's columns, custody absorbs w
	m.workers.count--; // worker-life.remove shrinks the pool around the same indices
	near(m.currencies.custody[k], 4); // w held 4 after the split already divided the 8
	near(m.currencies.workerBalance(k, w), tailBalance);
	near(m.currencies.invariantError(k), 0);
	// Slot reuse at the compacted tail starts from zero, never from a stale balance.
	m.currencies.initWorker(last);
	near(m.currencies.workerBalance(k, last), 0);
});

test('worker-life split and starvation carry notes through the real lifecycle hooks', () => {
	const m = new PriceEconomy(1, 5);
	m.creditMoney = true;
	m.banks.syncIssuer();
	const k = 0;
	const mine = economyIndex(3, 13);
	m.currencies.issueToAccount(k, mine, 10);
	const w = m.workers.count - 1;
	m.currencies.accountToWorker(k, mine, w, 6);
	m.workers.gold[w] = 32;
	m.workers.food[w] = FOOD_BAG;
	m.workers.tired[w] = 0;
	m.workerLife.needs[w] = 1;
	m.workerLife.splitAge[w] = WORKER_SPLIT_SECONDS;
	const before = m.workers.count;
	m.workerLife.step();
	assert.equal(m.workers.count, before + 1, 'the worker must split');
	const notes = m.currencies.workerBalance(k, w) + m.currencies.workerBalance(k, m.workers.count - 1);
	near(notes, 6); // split shares notes like gold and food
	near(m.currencies.invariantError(k), 0);
	const outstanding = m.currencies.totalOutstanding();
	const last = m.workers.count - 1;
	m.workerLife.remove(last);
	near(m.currencies.custody[k], m.currencies.workerBalance(k, w), 1e-12);
	near(m.currencies.totalOutstanding(), outstanding); // custody keeps removed notes outstanding
});

test('town consent is deterministic: cheap and med take notes, rich insists on gold and clearing unstamps', () => {
	const m = new PriceEconomy();
	m.creditMoney = true;
	m.banks.initializeScenario(4);
	m.banks.syncIssuer();
	const k = m.banks.noteIssuer();
	let sawRich = false, sawOpen = false;
	for (let i = 0; i < ECONOMY_SIZE; i++) {
		if (m.actors[i] !== ECONOMY_TOWN) continue;
		if (m.wealthClass[i] === WEALTH_RICH) {
			assert.equal(m.currencies.townAccepts(k, i), false, 'rich towns must decline notes');
			sawRich = true;
		} else {
			assert.equal(m.currencies.townAccepts(k, i), true, 'cheap and med towns consent to notes');
			sawOpen = true;
		}
	}
	assert.ok(sawRich && sawOpen, 'the reference scene must contain both policies');
	m.currencies.unstampTown(m.actors.indexOf(ECONOMY_TOWN));
});

test('unchecking credit money stops new issuance but never erases outstanding notes', () => {
	const m = new PriceEconomy(1, 5);
	m.creditMoney = true;
	m.banks.syncIssuer();
	const mine = economyIndex(3, 13);
	const k = m.banks.noteIssuer();
	m.currencies.issueToAccount(k, mine, 4);
	m.creditMoney = false;
	assert.equal(m.banks.noteIssuer(), 0, 'the issuer survives');
	near(m.currencies.totalOutstanding(), 4);
	near(m.currencies.accountBalance(k, mine), 4);
});

test('settings persist across a fake reload and tolerate missing or broken storage', () => {
	const defaults = new LabSettings(null);
	assert.deepEqual(defaults.data, { goldPerWorker: 1, bankCapital: 0, transportPreset: 0, creditMoney: false });
	const storage = stubStorage();
	const first = new LabSettings(storage);
	first.data.goldPerWorker = 2.5;
	first.data.bankCapital = 6;
	first.data.transportPreset = 1;
	first.data.creditMoney = true;
	assert.equal(first.save(), true);
	const reloaded = new LabSettings(storage);
	assert.deepEqual(reloaded.data, first.data);
	const broken = new LabSettings({ getItem: () => '{not json', setItem: () => {} });
	assert.deepEqual(broken.data, defaults.data, 'malformed storage falls back to defaults');
	const refusing = new LabSettings({ getItem: () => null, setItem: () => { throw new Error('quota'); } });
	assert.equal(refusing.save(), false, 'storage failure must not stop the lab');
});

test('settings import accepts sane values only and ignores malformed ones', () => {
	const s = new LabSettings(null);
	assert.equal(s.import('{"goldPerWorker":3,"bankCapital":4,"transportPreset":1,"creditMoney":true}'), true);
	assert.deepEqual(s.data, { goldPerWorker: 3, bankCapital: 4, transportPreset: 1, creditMoney: true });
	assert.equal(s.import('{"goldPerWorker":-5,"bankCapital":"x","creditMoney":"yes"}'), true);
	assert.deepEqual(s.data, { goldPerWorker: 3, bankCapital: 4, transportPreset: 1, creditMoney: true }, 'negative, non-numeric and non-boolean values are ignored');
	assert.equal(s.import('not json'), false);
});
