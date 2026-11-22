// Owns: regression checks for the optimizing price-diffusion economy, labor, towns and gold money.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const file of ['simulation.js', 'gold.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

const sum = (values) => values.reduce((total, value) => total + value, 0);
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);

function run(model, seconds) {
	for (let n = 0; n < Math.round(seconds / ECONOMY_DT); n++) model.step();
}

function checkLedger(model) {
	assert.ok(model.coal.every((value) => value >= 0 && value <= 1));
	assert.ok(model.goods.every((value) => value >= 0 && value <= 1));
	assert.ok(model.labor.every((value) => value >= 0 && value <= 1));
	assert.ok(model.priceCoal.every((value) => value >= 0));
	assert.ok(model.priceGoods.every((value) => value >= 0));
	assert.ok(model.priceLabor.every((value) => value >= 0));
	assert.ok(model.money.purse.every((value) => value >= 0));
	assert.ok(model.money.workerPurse.every((value) => value >= 0));
	closeTo(sum(model.coal), model.producedCoal - model.burnedCoal);
	closeTo(sum(model.goods), model.producedGoods - model.consumedGoods);
	closeTo(sum(model.labor), model.suppliedLabor - model.workedLabor);
	assert.ok(Math.abs(model.money.total() - model.money.seeded - model.money.mined) < 1e-7);
}

function clearedMap() {
	const model = new PriceEconomy();
	model.actors.fill(0);
	model.pop.fill(0);
	model.money.reset();
	return model;
}

test('the reference chain staffs mines and factories, delivering coal and goods to towns', () => {
	const model = new PriceEconomy();
	run(model, 10);
	assert.ok(model.workedLabor > 0.5);
	assert.ok(model.burnedCoal > 0.5);
	assert.ok(model.producedGoods > 0.5);
	assert.ok(model.consumedGoods > 0.5);
	assert.ok(model.uptakeRate > 0.15);
	checkLedger(model);
});

test('there is no separate demand field: price and wage are the steering fields', () => {
	const model = new PriceEconomy();
	assert.equal(model.demand, undefined);
	assert.ok(model.priceCoal instanceof Float64Array);
	assert.ok(model.priceGoods instanceof Float64Array);
	assert.ok(model.priceLabor instanceof Float64Array);
	run(model, 2);
	assert.ok(model.priceGoods.some((value) => value > 0.5));
	assert.ok(model.priceLabor.some((value) => value > 0.05));
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

test('a factory derives coal and wage bids from output price less the complementary input cost', () => {
	const model = clearedMap();
	const factory = economyIndex(24, 14);
	model.setActor(factory, ECONOMY_FACTORY);
	model.priceGoods[factory] = 3;
	const cheapLabor = model.factoryCoalBid(factory);
	model.priceLabor[factory] = 4;
	const dearLabor = model.factoryCoalBid(factory);
	assert.ok(cheapLabor > dearLabor);
	closeTo(cheapLabor, 3 * INPUT_SHARE);

	model.priceLabor[factory] = 0;
	model.derived = false;
	model.priceGoods[factory] = 0.5;
	closeTo(model.factoryCoalBid(factory), START_PRICE * INPUT_SHARE);
});

test('stock on hand cools bids all the way to zero once finite buffers are full', () => {
	const model = clearedMap();
	const factory = economyIndex(24, 14);
	model.setActor(factory, ECONOMY_FACTORY);
	model.priceGoods[factory] = 3;
	const empty = model.factoryCoalBid(factory);
	model.coal[factory] = FACTORY_RATE * BUFFER_SECONDS * 0.5;
	assert.ok(model.factoryCoalBid(factory) < empty);
	model.coal[factory] = FACTORY_RATE * BUFFER_SECONDS;
	assert.equal(model.factoryCoalBid(factory), 0);
	model.coal[factory] = 0;
	model.goods[factory] = FACTORY_RATE * BUFFER_SECONDS;
	assert.equal(model.factoryCoalBid(factory), 0);
});

test('a town needs only finite coal even when coal is free at price 0', () => {
	const stocked = clearedMap();
	const town = economyIndex(24, 14);
	stocked.setActor(town, ECONOMY_TOWN);
	stocked.coal[town] = 0.95;
	for (let k = 0; k < DEGREE; k++) stocked.coal[NEIGHBORS[town * DEGREE + k]] = 0.8;
	stocked.producedCoal = sum(stocked.coal);
	assert.equal(stocked.priceCoal[town], 0);
	assert.equal(stocked.townCoalBid(town), 0);
	run(stocked, 6);
	assert.equal(stocked.townCoalBid(town), 0);
	assert.equal(stocked.coal[town + 1], 0.8);
	checkLedger(stocked);

	const empty = clearedMap();
	empty.setActor(town, ECONOMY_TOWN);
	for (let k = 0; k < DEGREE; k++) empty.coal[NEIGHBORS[town * DEGREE + k]] = 0.8;
	const freeAround = sum(empty.coal);
	empty.producedCoal = freeAround;
	run(empty, 10);
	assert.ok(empty.burnedCoal < START_POP * TOWN_COAL_NEED * 10 + 1e-6);
	assert.ok(sum(empty.coal) - empty.coal[town] > freeAround - 1.2);
	checkLedger(empty);
});

test('a flooded town drops its goods bid to zero and recovers when stock is eaten', () => {
	const model = clearedMap();
	const town = economyIndex(24, 14);
	model.setActor(town, ECONOMY_TOWN);
	const empty = model.townGoodsBid(town);
	model.goods[town] = 0.8;
	assert.equal(model.townGoodsBid(town), 0);
	model.goods[town] = 0;
	closeTo(model.townGoodsBid(town), empty);
});

test('the derived factory bids never exceed the margin the output price covers', () => {
	const model = clearedMap();
	const factory = economyIndex(24, 14);
	model.setActor(factory, ECONOMY_FACTORY);
	for (const output of [0.2, 1, 3, 5]) {
		model.priceGoods[factory] = output;
		assert.ok(model.factoryCoalBid(factory) <= output * INPUT_SHARE + 1e-12);
	}
});

test('a mine beyond reach idles until a buyer and workers connect the chain', () => {
	const model = clearedMap();
	model.setActor(economyIndex(2, 2), ECONOMY_MINE);
	run(model, 3);
	assert.equal(model.producedCoal, 0);
	assert.ok(model.priceCoal.every((value) => value <= PRICE_GATE));

	const chain = clearedMap();
	chain.setActor(economyIndex(10, 10), ECONOMY_MINE);
	chain.setActor(economyIndex(12, 10), ECONOMY_FACTORY);
	chain.setActor(economyIndex(14, 10), ECONOMY_TOWN);
	run(chain, 10);
	assert.ok(chain.producedCoal > 0.5);
	assert.ok(chain.consumedGoods > 0.2);
	checkLedger(chain);
});

test('without a town the chain halts: no goods price, no workers, no trade', () => {
	const model = clearedMap();
	model.setActor(economyIndex(10, 10), ECONOMY_MINE);
	model.setActor(economyIndex(12, 10), ECONOMY_FACTORY);
	run(model, 5);
	assert.equal(model.workedLabor, 0);
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

test('only the buyer cell uses stock, bounded by its population need', () => {
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

test('gold is conserved across mining, wages, taxes and actor edits', () => {
	const model = new PriceEconomy();
	run(model, 20);
	model.setActor(economyIndex(13, 13), 0);
	model.setActor(economyIndex(40, 20), ECONOMY_TOWN);
	run(model, 10);
	model.clearTowns();
	run(model, 5);
	assert.ok(model.money.mined > 0);
	checkLedger(model);
});

test('a new town bids the starting price and does not overbid an extra vault without taxpayer income', () => {
	const model = clearedMap();
	const town = economyIndex(24, 14);
	model.setActor(town, ECONOMY_TOWN);
	closeTo(model.townGoodsBid(town), START_PRICE);

	model.money.purse[town] *= 10;
	closeTo(model.townGoodsBid(town), START_PRICE);
});

test('prices have no ceiling: richer workers paying higher taxes scale optimal bids proportionally', () => {
	const model = clearedMap();
	const town = economyIndex(24, 14);
	model.setActor(town, ECONOMY_TOWN);
	model.money.workerPurse[town] *= 10;
	model.money.purse[town] *= 10;
	closeTo(model.townGoodsBid(town), START_PRICE * 10);
	run(model, 8);
	assert.ok(model.priceGoods[town] > 15);
});

test('factories pay workers, workers pay taxes in town, and both factories and towns make profit', () => {
	const model = new PriceEconomy();
	model.setActor(economyIndex(3, 13), 0);
	const town = economyIndex(9, 20);
	const factory = economyIndex(13, 13);
	const mine = economyIndex(7, 8);
	run(model, 45);
	assert.equal(model.money.mined, 0);
	assert.ok(model.money.wages > 20);
	assert.ok(model.money.taxes > 20);
	assert.ok(model.profit[factory] > 0.05);
	assert.ok(model.profit[mine] > 0.005);
	assert.ok(model.profit[town] > 0.2);
	assert.ok(model.pop[town] > START_POP + 3);
	checkLedger(model);
});

test('an isolated town with no supplies collects zero taxes, earns zero profit and loses population', () => {
	const model = clearedMap();
	const lonely = economyIndex(24, 14);
	model.setActor(lonely, ECONOMY_TOWN);
	run(model, 30);
	assert.equal(model.money.taxes, 0);
	assert.equal(model.profit[lonely], 0);
	assert.ok(model.pop[lonely] < START_POP * 0.5);
	checkLedger(model);
});

test('a gold mine hires workers only with a town in reach and pays them wages', () => {
	const lonely = clearedMap();
	lonely.setActor(economyIndex(2, 2), ECONOMY_GOLD);
	run(lonely, 5);
	assert.equal(lonely.money.mined, 0);

	const model = clearedMap();
	const town = economyIndex(10, 10);
	model.setActor(economyIndex(4, 10), ECONOMY_GOLD);
	model.setActor(town, ECONOMY_TOWN);
	run(model, 20);
	assert.ok(model.money.mined > 4);
	assert.ok(model.money.wages > 3);
	assert.ok(model.money.held(town) > model.money.seeded + 0.4 * model.money.mined);
	checkLedger(model);
});

test('a broke town treasury bids nothing and the chain halts', () => {
	const model = clearedMap();
	const town = economyIndex(14, 10);
	model.setActor(economyIndex(10, 10), ECONOMY_MINE);
	model.setActor(economyIndex(12, 10), ECONOMY_FACTORY);
	model.setActor(town, ECONOMY_TOWN);
	model.money.purse[town] = 0;
	model.money.workerPurse[town] = 0;
	model.money.seeded = 0;
	run(model, 6);
	assert.equal(model.townGoodsBid(town), 0);
	assert.equal(model.townCoalBid(town), 0);
	assert.equal(model.producedCoal, 0);
	assert.equal(model.consumedGoods, 0);
	checkLedger(model);
});

test('unpaid bills cool the factory bid', () => {
	const model = clearedMap();
	const factory = economyIndex(24, 14);
	model.setActor(factory, ECONOMY_FACTORY);
	model.priceGoods[factory] = 3;
	const solvent = model.factoryCoalBid(factory);
	model.money.bill(factory, PAY_COAL, 5);
	assert.ok(model.factoryCoalBid(factory) < solvent);
});

test('a supplied town attracts more population and earns more profit than an unsupplied rival, without blocking factory coal bids', () => {
	const model = clearedMap();
	const mine = economyIndex(10, 14);
	const betweenTown = economyIndex(12, 14);
	const factory = economyIndex(14, 14);
	const idleTown = economyIndex(40, 14);
	model.setActor(mine, ECONOMY_MINE);
	model.setActor(betweenTown, ECONOMY_TOWN);
	model.setActor(factory, ECONOMY_FACTORY);
	model.setActor(idleTown, ECONOMY_TOWN);
	run(model, 40);
	assert.ok(model.producedGoods > 5);
	assert.ok(model.pop[betweenTown] > model.pop[idleTown] + 6);
	assert.ok(model.profit[betweenTown] > model.profit[idleTown] + 0.2);
	checkLedger(model);
});

test('mined gold inflates prices around the gold mine while distant towns stay steadier', () => {
	const model = new PriceEconomy();
	const near = economyIndex(9, 20);
	const far = economyIndex(28, 12);
	run(model, 140);
	assert.ok(model.priceGoods[near] > START_PRICE);
	assert.ok(model.priceGoods[near] > model.priceGoods[far] * 1.5);
	checkLedger(model);
});
