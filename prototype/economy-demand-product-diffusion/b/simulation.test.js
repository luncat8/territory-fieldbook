// Owns: regression checks for the standalone diffusion economy.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
	DiffusionEconomy, ECONOMY_DT, ECONOMY_WIDTH, ECONOMY_HEIGHT, ECONOMY_SOURCE,
	ECONOMY_CONSUMER, economyIndex, SOURCE_RATE, UPTAKE_RATE, QUEUE_SECONDS
} = require('./simulation.js');

const sum = (values) => values.reduce((total, value) => total + value, 0);
const sourceCount = model => model.actors.filter(kind => kind === ECONOMY_SOURCE).length;
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
		closeTo(model.produced, sourceCount(model) * SOURCE_RATE * 10);
		for (let i = 0; i < model.actors.length; i++) {
			if (model.actors[i] !== ECONOMY_CONSUMER) continue;
			assert.ok(model.stockDelta[i] > 0, `no arrivals at consumer ${i}`);
				assert.ok(model.stock[i] > 0 && model.stock[i] <= UPTAKE_RATE * model.demand[i] * QUEUE_SECONDS);
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
		closeTo(model.produced, sourceCount(model) * SOURCE_RATE * 5);
		if (fill === 0) assert.ok(model.demand.every((demand) => demand === 0));
		else assert.ok(model.demand[model.actors.indexOf(ECONOMY_SOURCE)] < fill);
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
	assert.ok(model.flowX[0] > 0);
	closeTo(model.flowX[0], model.flowY[0]);
	closeTo(model.flowRate[0] * ECONOMY_DT, model.stock[diagonal]);
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
	closeTo(model.stock[cell], 0);
	assert.ok(model.demand[cell] > 0.99);
});


test('an oversupplied consumer reserves a short queue; rejected stock stays in the ledger', () => {
	const model = clearedMap(0);
	const cell = economyIndex(10, 10);
	model.setActor(cell, ECONOMY_CONSUMER);
	for (let dy = -1; dy <= 1; dy++) {
		for (let dx = -1; dx <= 1; dx++) {
			if (dx || dy) model.setActor(economyIndex(10 + dx, 10 + dy), ECONOMY_SOURCE);
		}
	}
	let peakQueue = 0;
	for (let tick = 0; tick < 900; tick++) {
		const consumed = model.consumed;
		model.step();
		const intake = UPTAKE_RATE * model.demand[cell];
		assert.ok(model.consumed - consumed <= intake * ECONOMY_DT + 1e-10);
		assert.ok(model.stock[cell] <= intake * QUEUE_SECONDS + 1e-10);
		peakQueue = Math.max(peakQueue, model.stock[cell]);
	}
	assert.ok(peakQueue > 0.1, 'the queue absorbed a burst rather than instantly deleting the delivery');
	assert.ok(model.consumed > 5);
	assert.ok(sum(model.stock) - model.stock[cell] > 5, 'excess supply was retained upstream');
	checkLedger(model);
});

test('opposing uphill routes split stock; filtered steering cannot keep sending to a former peak', () => {
	const model = clearedMap(0.2);
	const i = economyIndex(9, 9);
	model.stock[i] = 0.8;
	model.demand[i - 1] = model.demand[i + 1] = 0.9;
	model.transportStock();
	assert.ok(model.stock[i - 1] > 0);
	closeTo(model.stock[i - 1], model.stock[i + 1]);
	closeTo(model.flowX[i], 0);
	model.demand[i - 1] = 0.1;
	model.transportStock();
	assert.ok(model.flowX[i] > 0);
	model.demand[i + 1] = 0.1;
	model.demand[i - 1] = 0.9;
	model.transportStock();
	assert.ok(model.flowX[i] < 0);
	closeTo(sum(model.stock), 0.8);
});

test('demand spreads to neighbors with a delay and fades gradually after an edit', () => {
	const model = clearedMap(0);
	const cell = economyIndex(20, 10);
	model.setActor(cell, ECONOMY_CONSUMER);
	model.step();
	assert.ok(model.demand[cell] > 0 && model.demand[cell] < 0.05);
	assert.equal(model.demand[cell + 1], 0);
	run(model, 2);
	assert.ok(model.demand[cell] > model.demand[cell + 1]);
	assert.ok(model.demand[cell + 1] > model.demand[cell + 5]);
	assert.ok(model.demand[cell + 5] > model.demand[cell + 10]);
	const peak = model.demand[cell];
	model.clearConsumers();
	model.step();
	assert.ok(model.demand[cell] < peak && model.demand[cell] > 0);
});

test('pressure can release a stalled source without resetting the zero field', () => {
	const model = clearedMap(0);
	model.setActor(0, ECONOMY_SOURCE);
	run(model, 4);
	closeTo(model.stock[0], 1);
	closeTo(model.produced, 1);
	assert.equal(model.productionRate, 0);
	model.pressure = true;
	run(model, 3);
	assert.ok(sum(model.stock) - model.stock[0] > 0.5);
	assert.ok(model.demand.every(d => d === 0));
	assert.equal(model.consumed, 0);
	checkLedger(model);
	model.reset(0.5);
	assert.ok(model.pressure);
	assert.equal(model.produced, 0);
	assert.equal(model.consumed, 0);
	assert.ok(model.flowRate.every(rate => rate === 0));
	checkLedger(model);
});

test('new arrivals survive their arrival tick, and small shipments drain in proportion to demand', () => {
	const model = clearedMap(0);
	model.setActor(1, ECONOMY_CONSUMER);
	model.stock[0] = 0.5;
	model.step();
	assert.ok(model.stock[1] > 0);
	assert.equal(model.consumed, 0);
	let scaledDrain = 0;
	for (const fill of [0.25, 0.75]) {
		const sample = clearedMap(fill);
		sample.setActor(0, ECONOMY_CONSUMER);
		sample.stock[0] = 0.002;
		sample.step();
		assert.ok(sample.consumed > 0 && sample.stock[0] > 0);
		const drain = sample.consumed / sample.demand[0];
		if (scaledDrain) closeTo(drain, scaledDrain);
		scaledDrain = drain;
		closeTo(sample.consumed + sample.stock[0], 0.002);
	}
});

// Catchment feedback: the optional mode that reads the ring around a consumer.
function catchModel(catchment) {
	const model = clearedMap(0.5);
	model.pressure = true;
	model.catchment = catchment;
	model.setActor(economyIndex(19, 5), ECONOMY_CONSUMER);
	return model;
}

test('catchment feedback cools a consumer from stock in its ring, not only its own cell', () => {
	const queueOnly = catchModel(false);
	const catchment = catchModel(true);
	for (const model of [queueOnly, catchment]) for (const [x, y] of [[19, 6], [18, 5], [20, 5], [19, 4]]) model.setActor(economyIndex(x, y), ECONOMY_SOURCE);
	run(queueOnly, 20);
	run(catchment, 20);
	const cell = economyIndex(19, 5);
	assert.ok(catchment.demand[cell] < queueOnly.demand[cell] - 0.1);
	closeTo(sum(catchment.stock), catchment.produced - catchment.consumed);
	checkLedger(catchment);
});

test('catchment weighting falls with distance and covers in-map cells only', () => {
	const model = catchModel(true);
	const cell = economyIndex(19, 5);
	model.stock.fill(0);
	model.stock[cell] = 1;
	const own = model.catchmentMean(cell);
	model.stock[cell] = 0;
	model.stock[economyIndex(23, 5)] = 1;
	const far = model.catchmentMean(cell);
	assert.ok(own > far && far > 0);
	model.stock.fill(0);
	model.stock[economyIndex(19, 9)] = 1;
	closeTo(model.catchmentMean(cell), far);
	const corner = economyIndex(0, 0);
	model.stock.fill(0);
	model.stock[corner] = 1;
	assert.ok(model.catchmentMean(corner) > 0 && model.catchmentMean(corner) <= 1);
});

test('a well-fed settlement recovers demand after its stock is removed', () => {
	const model = catchModel(true);
	for (const [x, y] of [[19, 6], [18, 5], [20, 5], [19, 4]]) model.setActor(economyIndex(x, y), ECONOMY_SOURCE);
	run(model, 20);
	const cell = economyIndex(19, 5);
	const loaded = model.demand[cell];
	for (let i = 0; i < model.actors.length; i++) if (model.actors[i] === ECONOMY_SOURCE) model.actors[i] = 0;
	run(model, 30);
	assert.ok(model.demand[cell] > loaded + 0.05);
	checkLedger(model);
});
