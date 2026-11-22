// Owns: regression checks for the price-diffusion economy.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
	PriceEconomy, ECONOMY_DT, ECONOMY_WIDTH, ECONOMY_HEIGHT, ECONOMY_MINE, ECONOMY_FACTORY, ECONOMY_TOWN,
	economyIndex, SOURCE_RATE, FACTORY_RATE, NEED_RATE, QUEUE_SECONDS, BID_MAX, PRICE_DECAY, PRICE_GATE, INPUT_SHARE
} = require('./simulation.js');

const sum = (values) => values.reduce((total, value) => total + value, 0);
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);

function run(model, seconds) {
	for (let n = 0; n < Math.round(seconds / ECONOMY_DT); n++) model.step();
}

function checkLedger(model) {
	assert.ok(model.coal.every((value) => value >= 0 && value <= 1));
	assert.ok(model.goods.every((value) => value >= 0 && value <= 1));
	assert.ok(model.priceCoal.every((value) => value >= 0 && value <= 6));
	assert.ok(model.priceGoods.every((value) => value >= 0 && value <= 6));
	closeTo(sum(model.coal), model.producedCoal - model.burnedCoal);
	closeTo(sum(model.goods), model.producedGoods - model.consumedGoods);
}

function clearedMap() {
	const model = new PriceEconomy();
	model.reset();
	model.actors.fill(0);
	return model;
}

test('the reference chain delivers coal to factories and goods to towns', () => {
	const model = new PriceEconomy();
	run(model, 10);
	assert.ok(model.burnedCoal > 0.5);
	assert.ok(model.producedGoods > 0.5);
	assert.ok(model.consumedGoods > 0.5);
	assert.ok(model.uptakeRate > 0.2);
	checkLedger(model);
});

test('there is no separate demand field: price is the steering field', () => {
	const model = new PriceEconomy();
	assert.equal(model.demand, undefined);
	assert.ok(model.priceCoal instanceof Float64Array);
	assert.ok(model.priceGoods instanceof Float64Array);
	run(model, 2);
	assert.ok(model.priceGoods.some((value) => value > 0.5));
	checkLedger(model);
});

test('price is depleted with distance: decay emulates transport cost', () => {
	const model = clearedMap();
	const town = economyIndex(24, 14);
	model.setActor(town, ECONOMY_TOWN);
	run(model, 6);
	assert.ok(model.priceGoods[town] > model.priceGoods[town + 5]);
	assert.ok(model.priceGoods[town + 5] > model.priceGoods[town + 10]);
	assert.ok(model.priceGoods[town + 10] > 0);

	const noDecay = clearedMap();
	noDecay.decay = false;
	noDecay.setActor(town, ECONOMY_TOWN);
	run(noDecay, 6);
	assert.ok(noDecay.priceGoods[town + 10] > model.priceGoods[town + 10]);
	checkLedger(model);
	checkLedger(noDecay);
});

test('a factory derives its coal bid from the goods price at its cell', () => {
	const model = clearedMap();
	const factory = economyIndex(24, 14);
	model.setActor(factory, ECONOMY_FACTORY);
	model.priceGoods[factory] = 3;
	const rich = model.factoryBid(factory);
	model.priceGoods[factory] = 0.5;
	const poor = model.factoryBid(factory);
	assert.ok(rich > poor);
	closeTo(rich, 3 * INPUT_SHARE);

	model.derived = false;
	model.priceGoods[factory] = 0.5;
	assert.ok(model.factoryBid(factory) > poor);
});

test('a factory that lacks nothing bids low: stock cools the derived bid', () => {
	const model = clearedMap();
	const factory = economyIndex(24, 14);
	model.setActor(factory, ECONOMY_FACTORY);
	model.priceGoods[factory] = 3;
	const empty = model.factoryBid(factory);
	model.coal[factory] = 0.5;
	const coalLoaded = model.factoryBid(factory);
	model.coal[factory] = 0;
	model.goods[factory] = 0.5;
	const goodsLoaded = model.factoryBid(factory);
	assert.ok(coalLoaded < empty);
	assert.ok(goodsLoaded < empty);
});

test('a flooded town cools its bid and recovers when stock is removed', () => {
	const model = clearedMap();
	const town = economyIndex(24, 14);
	model.setActor(town, ECONOMY_TOWN);
	const empty = model.townBid(town);
	model.goods[town] = 0.5;
	const loaded = model.townBid(town);
	assert.ok(loaded < empty);
	model.goods[town] = 0;
	closeTo(model.townBid(town), empty);
});

test('the derived bid never exceeds the margin the output price covers', () => {
	const model = clearedMap();
	const factory = economyIndex(24, 14);
	model.setActor(factory, ECONOMY_FACTORY);
	for (const output of [0.2, 1, 3, 5]) {
		model.priceGoods[factory] = output;
		assert.ok(model.factoryBid(factory) <= output * INPUT_SHARE + 1e-12);
		assert.ok(model.factoryBid(factory) <= BID_MAX);
	}
});

test('a mine beyond the price gate idles until a buyer bids within reach', () => {
	const model = clearedMap();
	model.setActor(economyIndex(2, 2), ECONOMY_MINE);
	run(model, 3);
	assert.equal(model.producedCoal, 0);
	assert.ok(model.priceCoal.every((value) => value <= PRICE_GATE));

	const chain = clearedMap();
	chain.setActor(economyIndex(10, 10), ECONOMY_MINE);
	chain.setActor(economyIndex(12, 10), ECONOMY_FACTORY);
	chain.setActor(economyIndex(14, 10), ECONOMY_TOWN);
	run(chain, 8);
	assert.ok(chain.producedCoal > 0.5);
	assert.ok(chain.consumedGoods > 0.2);
	checkLedger(chain);
});

test('without a town the chain halts: no goods price, no coal bid, no trade', () => {
	const model = clearedMap();
	model.setActor(economyIndex(10, 10), ECONOMY_MINE);
	model.setActor(economyIndex(12, 10), ECONOMY_FACTORY);
	run(model, 5);
	assert.equal(model.consumedGoods, 0);
	assert.equal(model.producedGoods, 0);
	checkLedger(model);
});

test('transport climbs the price gradient and ignores flat or lower cells', () => {
	const model = clearedMap();
	const diagonal = economyIndex(1, 1);
	model.coal[0] = 0.8;
	model.priceCoal[0] = 0.2;
	model.priceCoal[1] = 0.15;
	model.priceCoal[diagonal] = 0.20001;
	model.transport(model.coalFlow, model.coal, model.priceCoal);
	assert.ok(model.coal[diagonal] > 0);
	assert.ok(model.coalFlow.flowX[0] > 0);
	closeTo(model.coalFlow.flowX[0], model.coalFlow.flowY[0]);
	closeTo(model.coalFlow.flowRate[0] * ECONOMY_DT, model.coal[diagonal]);
	assert.equal(model.coal[1], 0);
	assert.equal(model.coal[economyIndex(0, 1)], 0);
	closeTo(sum(model.coal), 0.8);
});

test('converging transfers cannot overflow a nearly full destination or drop stock', () => {
	const model = clearedMap();
	const peak = economyIndex(5, 5);
	model.priceCoal[peak] = 3;
	model.coal[peak] = 0.99;
	model.coal[peak - 1] = 0.8;
	model.coal[peak + 1] = 0.8;
	model.transport(model.coalFlow, model.coal, model.priceCoal);
	closeTo(model.coal[peak], 1);
	closeTo(model.coal[peak - 1], 0.795);
	closeTo(model.coal[peak + 1], 0.795);
	closeTo(sum(model.coal), 2.59);
});

test('only the buyer cell uses stock, at a bounded rate', () => {
	const cell = economyIndex(8, 8);
	const nearby = economyIndex(10, 8);
	const model = clearedMap();
	model.setActor(cell, ECONOMY_TOWN);
	model.goods[cell] = 0.5;
	model.goods[nearby] = 0.5;
	model.step();
	assert.ok(model.consumedGoods > 0 && model.consumedGoods <= NEED_RATE * ECONOMY_DT + 1e-12);
	assert.ok(model.goods[cell] < 0.5);
	assert.equal(model.goods[nearby], 0.5);
});

test('a distant mine feeds a town through a factory', () => {
	const model = clearedMap();
	model.setActor(economyIndex(0, 0), ECONOMY_MINE);
	model.setActor(economyIndex(12, 7), ECONOMY_FACTORY);
	model.setActor(economyIndex(24, 14), ECONOMY_TOWN);
	model.decay = false;
	run(model, 60);
	assert.ok(model.consumedGoods > 2);
	checkLedger(model);
});

test('new arrivals survive their arrival tick', () => {
	const model = clearedMap();
	model.setActor(1, ECONOMY_TOWN);
	model.goods[0] = 0.5;
	model.step();
	assert.ok(model.goods[1] > 0);
	assert.equal(model.consumedGoods, 0);
});
