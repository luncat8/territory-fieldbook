// Owns: closed-economy redenomination invariance, zero-gold safety and default 1 g/worker health tests for Particle Transfer B2.
// Edit for: GoldMoney.unitScale, nominal floor/epsilon audits, haulage scaling or default scenario seeding.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MODULES = [
	'simulation.js', 'land.js', 'steering.js', 'forage.js', 'gold.js', 'owners.js', 'banks.js', 'goods.js',
	'workforce.js', 'workers.js', 'worker-life.js', 'farms.js', 'actors.js', 'towns.js', 'settlement.js', 'founding.js', 'track.js'
];
for (const file of MODULES) {
	vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });
}

function runClosed(goldPerWorker, ticks) {
	const m = new PriceEconomy();
	m.scenario.goldPerWorker = goldPerWorker;
	m.reset();
	for (let i = 0; i < ECONOMY_SIZE; i++) if (m.actors[i] === ECONOMY_GOLD) m.setActor(i, 0);
	for (let t = 0; t < ticks; t++) m.step();
	return m;
}

function relClose(a, b, tol, label) {
	const denom = Math.max(1e-12, Math.abs(b));
	assert.ok(Math.abs(a - b) / denom <= tol, `${label}: ${a} vs ${b} (rel ${Math.abs(a - b) / denom})`);
}

test('closed-economy real quantities and normalized money flows are invariant across 12 orders of magnitude', () => {
	const ticks = 2100;
	const ref = runClosed(1, ticks);
	assert.ok(ref.producedCoal > 10);
	assert.ok(ref.producedGoods > 5);
	assert.ok(ref.consumedGoods > 3);
	assert.ok(ref.producedWood > 2);
	assert.ok(ref.workedLabor > 40);
	for (const gpw of [1e-6, 0.5, 2, 14, 1e6]) {
		const m = runClosed(gpw, ticks);
		relClose(m.producedCoal, ref.producedCoal, 1e-10, `coal @ ${gpw}`);
		relClose(m.producedGoods, ref.producedGoods, 1e-10, `goods @ ${gpw}`);
		relClose(m.consumedGoods, ref.consumedGoods, 1e-10, `eaten @ ${gpw}`);
		relClose(m.producedWood, ref.producedWood, 1e-10, `wood @ ${gpw}`);
		relClose(m.producedFood, ref.producedFood, 1e-10, `food @ ${gpw}`);
		relClose(m.workedLabor, ref.workedLabor, 1e-10, `labor @ ${gpw}`);
		relClose(m.money.wages / gpw, ref.money.wages, 1e-10, `wages/gpw @ ${gpw}`);
		relClose(m.money.taxes / gpw, ref.money.taxes, 1e-10, `taxes/gpw @ ${gpw}`);
		relClose(m.money.total(), m.money.initial, 1e-12, `gold conservation @ ${gpw}`);
	}
});

test('zero-gold closed economy mints no gold, produces no NaNs and keeps workers alive by foraging', () => {
	const m = new PriceEconomy();
	m.scenario.goldPerWorker = 0;
	m.reset();
	for (let i = 0; i < ECONOMY_SIZE; i++) if (m.actors[i] === ECONOMY_GOLD) m.setActor(i, 0);
	for (let w = 0; w < m.workers.count; w++) m.workers.food[w] = 0.25;
	for (let t = 0; t < 1500; t++) m.step();
	assert.equal(m.money.initial, 0);
	assert.equal(m.money.mined, 0);
	assert.equal(m.money.total(), 0);
	assert.equal(m.workerLife.deaths, 0);
	assert.ok(m.workers.forageEntries > 0);
	assert.ok(m.forage.wildPicked + m.forage.gardenFed > 0);
	for (const field of [m.priceCoal, m.priceGoods, m.priceFood, m.priceWood, m.priceLabor, m.priceHome, m.priceRest]) {
		for (let i = 0; i < ECONOMY_SIZE; i++) assert.ok(Number.isFinite(field[i]));
	}
});

test('default 1 g/worker open economy sustains all 4 commodity chains, births and zero defaults', () => {
	const m = new PriceEconomy();
	for (let t = 0; t < 7200; t++) m.step();
	assert.ok(m.producedCoal > 25 && m.burnedCoal > 20);
	assert.ok(m.producedGoods > 15 && m.consumedGoods > 12);
	assert.ok(m.producedFood > 30 && m.consumedFood > 20);
	assert.ok(m.producedWood > 8 && m.consumedWood > 6);
	assert.ok(m.workers.births > 0);
	assert.equal(m.workerLife.deaths, 0);
	assert.equal(m.bank.defaults, 0);
	assert.equal(m.bank.refusals, 0);
	relClose(m.money.total(), m.money.initial + m.money.mined, 1e-12, 'open gold conservation');
});
