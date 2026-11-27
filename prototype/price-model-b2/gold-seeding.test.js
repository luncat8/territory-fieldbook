// Owns: independent scenario funding and low-gold adaptive-price regressions for the cell lab.
// Edit for: scenario gold amounts, allocation, zero-gold safety and adaptive rest fees.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const file of ['simulation.js', 'actors.js', 'towns.js', 'gold.js', 'workforce.js', 'land.js', 'farms.js', 'settlement.js', 'harvest.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < Math.max(1e-10, Math.abs(expected) * 1e-9), `${actual} != ${expected}`);

test('default and alternative scenario amounts seed gold independently of reference prices', () => {
	const model = new PriceEconomy();
	const town = economyIndex(9, 20);
	assert.equal(model.money.startGoldPerWorker, 1);
	close(model.money.seeded, REFERENCE_TOWNS.length * START_POP);
	const bid = model.townGoodsBid(town), fee = model.townRestTax(town);
	for (const amount of [0.5, 2, 1e-6, 1e6, 0]) {
		model.money.startGoldPerWorker = amount;
		model.reset();
		close(model.money.seeded, REFERENCE_TOWNS.length * START_POP * amount);
		close(model.money.total(), model.money.seeded);
		close(model.townGoodsBid(town), bid * amount);
		close(model.townRestTax(town), fee * amount);
		assert.equal(model.priceGoods.some(p => p !== 0), false);
	}
});

test('half, one and two grams sustain real trades with finite prices and conserved gold', () => {
	for (const amount of [0.5, 1, 2]) {
		const model = new PriceEconomy();
		model.money.startGoldPerWorker = amount;
		model.reset();
		// No new gold: this checks circulation, not a rescue by ongoing extraction.
		model.setActor(economyIndex(3, 13), 0);
		for (let n = 0; n < 30 / ECONOMY_DT; n++) model.step();
		assert.ok(model.producedGoods > 0 && model.consumedGoods > 0, `no goods trade at ${amount} g`);
		assert.ok(model.money.wages > 0 && model.money.taxes > 0, `no circulation at ${amount} g`);
		assert.equal(model.money.mined, 0);
		close(model.money.total(), model.money.seeded);
		for (const field of [model.priceCoal, model.priceGoods, model.priceLabor]) assert.ok(field.every(p => Number.isFinite(p) && p >= 0));
	}
});
