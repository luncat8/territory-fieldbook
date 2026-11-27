// owns: independent scenario-gold funding and adaptive main-game gold-price regressions
// run: node --test experiments/mape_gold_seed.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function engine() {
	const context = vm.createContext({});
	vm.runInContext(`
		const world = { size: 9, n: 81, terrain: new Uint8Array(81) };
		const TERRAIN = { WATER: 2 };
		const mape = { pop: new Float64Array(81), money: new Float64Array(81) };
		const mapeMoney = {};
		function mapeIsSettlement(i) { return i === 40; }
		mape.pop[40] = 10;
	`, context);
	vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'map-money-gold.js'), 'utf8'), context);
	vm.runInContext('mapeGoldPrepare();', context);
	return code => vm.runInContext(code, context);
}

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-14, Math.abs(expected) * 1e-10), `${actual} != ${expected}`);

test('default scenario gold is one gram per population unit, reset does not accumulate it', () => {
	const run = engine();
	run('mapeGoldFinishSetup();');
	close(run('mapeGoldTotal()'), 10);
	close(run('mapeMoney.initial'), 10);
	run('mapeGoldFinishSetup();');
	close(run('mapeGoldTotal()'), 10);
	assert.equal(run('mapeGold.priceGoods.some(p => p !== 0)'), false);
});

test('scenario amounts change balances and emergent bids, never a preset price', () => {
	const run = engine();
	let unitBid;
	for (const amount of [1, 0.5, 2, 1e-6, 1e6, 0]) {
		run(`mapeGoldFinishSetup(${amount});`);
		close(run('mapeGoldTotal()'), 10 * amount);
		const bid = run('mapeGoldTownGoodsBid(40)');
		if (amount === 1) unitBid = bid;
		close(bid, unitBid * amount);
		run('for (let t = 0; t < 360; t++) mapeGoldUpdatePrices();');
		assert.equal(run('mapeGold.priceGoods.every(p => Number.isFinite(p) && p >= 0)'), true);
		if (amount > 0) assert.ok(run('mapeGold.priceGoods[40]') > 0);
		else close(run('mapeGold.priceGoods[40]'), 0);
	}
});

test('prices respond downwards after a contraction in current holdings', () => {
	const run = engine();
	run('mapeGoldFinishSetup(); for (let t = 0; t < 360; t++) mapeGoldUpdatePrices();');
	const before = run('mapeGold.priceGoods[40]');
	run('mapeGold.workerPurse[40] *= 0.1; mapeGold.purse[40] *= 0.1; for (let t = 0; t < 1800; t++) mapeGoldUpdatePrices();');
	assert.ok(run('mapeGold.priceGoods[40]') < before * 0.2);
});


test('main-game ticks conserve the independent scenario seed at half, one and two grams', () => {
	const context = vm.createContext({});
	const root = path.join(__dirname, '..');
	const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
	for (const [, file] of html.matchAll(/<script src="([^"]+)"><\/script>/g)) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
	for (const amount of [0.5, 1, 2]) {
		vm.runInContext(`main.setup(20261117); mapeGoldFinishSetup(${amount}); for (let t = 0; t < 100; t++) main.step(SIM_STEP_SEC);`, context);
		assert.ok(Math.abs(vm.runInContext('mapeMoneyResidual()', context)) < 1e-7);
		assert.equal(vm.runInContext('mapeGold.priceGoods.every(p => Number.isFinite(p) && p >= 0)', context), true);
	}
});
