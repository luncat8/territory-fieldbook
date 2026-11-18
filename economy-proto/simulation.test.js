// Owns: regression checks for the standalone diffusion economy.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
	DiffusionEconomy, ECONOMY_DT, ECONOMY_WIDTH, ECONOMY_HEIGHT, ECONOMY_SOURCE,
	ECONOMY_CONSUMER, economyIndex, SOURCE_RATE, UPTAKE_RATE
} = require('./simulation.js');

const sum = (values) => values.reduce((total, value) => total + value, 0);
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);

function run(model, seconds) {
	for (let n = 0; n < Math.round(seconds / ECONOMY_DT); n++) model.step();
}

function checkLedger(model) {
	assert.ok(model.stock.every((value) => value >= 0 && value <= 1));
	assert.ok(model.demand.every((value) => value >= 0 && value <= 1));
	closeTo(sum(model.stock), model.produced - model.consumed);
}

function clearedMap(fill) {
	const model = new DiffusionEconomy();
	model.reset(fill);
	model.actors.fill(0);
	return model;
}

for (const fill of [0, 0.5]) {
	test(`the ${fill} preset starts uniform and delivers to consumers`, () => {
		const model = new DiffusionEconomy();
		run(model, 3);
		model.reset(fill);
		assert.equal(model.ticks, 0);
		assert.equal(model.consumed, 0);
		assert.ok(model.stock.every((value) => value === 0));
		assert.ok(model.demand.every((value) => value === fill));

		run(model, 2);
		const firstDelivery = model.consumed;
		assert.ok(firstDelivery > 0.1);
		run(model, 8);
		assert.ok(model.consumed - firstDelivery > 4);
		assert.ok(model.uptakeRate > 0.65);
		closeTo(model.produced, 2 * SOURCE_RATE * 10);
		for (let i = 0; i < model.actors.length; i++) {
			if (model.actors[i] !== ECONOMY_CONSUMER) continue;
			assert.ok(model.flowTo.includes(i), `no incoming flow at consumer ${i}`);
			assert.ok(model.stock[i] < 0.03);
		}
		checkLedger(model);
	});

	test(`resource pressure spreads stock without consumers from the ${fill} preset`, () => {
		const model = new DiffusionEconomy();
		model.reset(fill);
		model.clearConsumers();
		run(model, 5);
		assert.ok(model.stock.every((stock, i) => model.actors[i] === ECONOMY_SOURCE || stock === 0));
		assert.ok(model.demand.every((demand) => demand === fill));

		model.reset(fill);
		model.clearConsumers();
		model.pressure = true;
		run(model, 5);
		const outsideSources = model.stock.filter((_, i) => model.actors[i] !== ECONOMY_SOURCE);
		assert.ok(sum(outsideSources) > 2);
		assert.equal(model.consumed, 0);
		closeTo(model.produced, 2 * SOURCE_RATE * 5);
		if (fill === 0) assert.ok(model.demand.every((demand) => demand === 0));
		else assert.ok(model.demand[economyIndex(5, 12)] < fill);
		checkLedger(model);
	});
}

test('a distant consumer pulls stock from the opposite corner', () => {
	const model = clearedMap(0.5);
	model.setActor(economyIndex(0, 0), ECONOMY_SOURCE);
	model.setActor(economyIndex(ECONOMY_WIDTH - 1, ECONOMY_HEIGHT - 1), ECONOMY_CONSUMER);
	run(model, 45);
	assert.ok(model.consumed > 5);
	assert.ok(model.uptakeRate > 0.31);
	checkLedger(model);
});

test('transport uses the real uphill diagonal and does not move into flat or lower cells', () => {
	const model = clearedMap(0.2);
	const diagonal = economyIndex(1, 1);
	model.stock[0] = 0.8;
	model.demand[1] = 0.15;
	model.demand[diagonal] = 0.20001;
	model.transportStock();
	assert.ok(model.stock[diagonal] > 0);
	assert.equal(model.flowTo[0], diagonal);
	assert.equal(model.stock[1], 0);
	assert.equal(model.stock[economyIndex(0, 1)], 0);
	closeTo(sum(model.stock), 0.8);
});

test('converging transfers cannot overflow a nearly full destination or drop stock', () => {
	const model = clearedMap(0.2);
	const peak = economyIndex(5, 5);
	model.demand[peak] = 0.9;
	model.stock[peak] = 0.99;
	model.stock[peak - 1] = 0.8;
	model.stock[peak + 1] = 0.8;
	model.transportStock();
	closeTo(model.stock[peak], 1);
	closeTo(model.stock[peak - 1], 0.795);
	closeTo(model.stock[peak + 1], 0.795);
	closeTo(sum(model.stock), 2.59);
});

test('only the consumer cell uses stock, at a bounded rate proportional to local demand', () => {
	const cell = economyIndex(8, 8);
	const nearby = economyIndex(10, 8);
	for (const fill of [0.25, 0.75]) {
		const model = clearedMap(fill);
		model.setActor(cell, ECONOMY_CONSUMER);
		model.stock[cell] = 0.5;
		model.stock[nearby] = 0.5;
		model.step();
		const expected = UPTAKE_RATE * model.demand[cell] * ECONOMY_DT;
		closeTo(model.consumed, expected);
		closeTo(model.stock[cell], 0.5 - expected);
		assert.equal(model.stock[nearby], 0.5);
		assert.ok(model.stock[cell] > 0.48);
	}
});

test('consumer demand relaxes downward gradually when stock is on hand', () => {
	const model = clearedMap(0.5);
	const cell = economyIndex(8, 8);
	model.setActor(cell, ECONOMY_CONSUMER);
	model.demand[cell] = 1;
	model.stock[cell] = 0.9;
	model.step();
	assert.ok(model.demand[cell] < 1 && model.demand[cell] > 0.98);
	run(model, 4);
	assert.equal(model.stock[cell], 0);
	assert.ok(model.demand[cell] > 0.99);
});
