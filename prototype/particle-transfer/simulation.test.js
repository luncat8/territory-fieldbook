// Owns: economic, worker-pool, wealth-class tax and land/settlement regression checks over the particle-goods engine.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const file of ['simulation.js', 'steering.js', 'particles.js', 'actors.js', 'gold.js', 'workforce.js', 'land.js', 'settlement.js']) {
	vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });
}

const sum = values => values.reduce((total, value) => total + value, 0);
const closeTo = (actual, expected, tol = 1e-12, ref = 1) => assert.ok(Math.abs(actual - expected) < tol * Math.max(1, Math.abs(ref)), `${actual} ≠ ${expected}`);

function run(model, seconds) {
	for (let n = 0; n < Math.round(seconds / ECONOMY_DT); n++) model.step();
}

function neutralLand(model) {
	model.land.terrain.fill(TERRAIN_FOREST);
	model.land.refresh();
	model.settlements.forestCap.fill(FOREST_TERRAIN);
	model.settlements.forest.fill(FOREST_TERRAIN);
}

function clearedMap() {
	const model = new PriceEconomy();
	model.actors.fill(0);
	model.pop.fill(0);
	model.scale.fill(0);
	model.taxMult.fill(0);
	model.workLoad.fill(0);
	model.laborFlow.gold.fill(0);
	model.depletedFlow.gold.fill(0);
	model.particles.reset();
	model.money.reset();
	model.settlements.reset();
	neutralLand(model);
	return model;
}

function checkLedger(model) {
	const { particles, money } = model;
	assert.ok(model.coal.every(v => v >= 0 && v <= 1 + 1e-12));
	assert.ok(model.goods.every(v => v >= 0 && v <= 1 + 1e-12));
	assert.ok(model.labor.every(v => v >= 0 && v <= 1));
	assert.ok(model.depleted.every(v => v >= 0 && v <= 1));
	assert.ok(model.laborFlow.gold.every(v => v >= 0));
	assert.ok(model.depletedFlow.gold.every(v => v >= 0));
	assert.ok(money.purse.every(v => v >= 0));
	assert.ok(money.workerPurse.every(v => v >= 0));
	assert.ok(money.transportVault >= 0);
	for (let i = 0; i < ECONOMY_SIZE; i++) {
		if (model.labor[i] <= 1e-12) assert.equal(model.laborFlow.gold[i], 0);
		if (model.depleted[i] <= 1e-12) assert.equal(model.depletedFlow.gold[i], 0);
	}
	closeTo(model.totalItem(ITEM_COAL), model.producedCoal - model.burnedCoal - particles.spoiled[ITEM_COAL], 1e-12, model.producedCoal);
	closeTo(model.totalItem(ITEM_GOODS), model.producedGoods - model.consumedGoods - particles.spoiled[ITEM_GOODS], 1e-12, model.producedGoods);
	closeTo(sum(model.labor), model.suppliedLabor - model.workedLabor, 1e-11, model.suppliedLabor);
	closeTo(sum(model.depleted), model.emittedDepleted - model.restedDepleted, 1e-11, model.emittedDepleted);
	closeTo(money.total(), money.seeded + money.mined, 1e-12, money.seeded + money.mined);
}

test('price decay weakens buyer bids with distance and derived factory bids respect joint budget and buffer cooling', () => {
	const model = clearedMap();
	const town = economyIndex(24, 14);
	model.setActor(town, ECONOMY_TOWN);
	run(model, 6);
	assert.ok(model.priceGoods[town] > model.priceGoods[town + 5]);
	assert.ok(model.priceGoods[town + 5] > model.priceGoods[town + 10]);

	const fModel = clearedMap();
	const factory = economyIndex(24, 14);
	fModel.setActor(factory, ECONOMY_FACTORY);
	fModel.priceGoods[factory] = 3;
	const coalBid = fModel.factoryCoalBid(factory);
	const wageBid = fModel.factoryLaborBid(factory);
	assert.ok(coalBid + wageBid * FACTORY_LABOR <= 3 * JOINT_BUDGET_SHARE + 1e-12);
	fModel.coal[factory] = FACTORY_RATE * BUFFER_SECONDS;
	assert.equal(fModel.factoryCoalBid(factory), 0);
	fModel.coal[factory] = 0;
	fModel.particles.accumulate(ITEM_GOODS, factory, FACTORY_RATE * BUFFER_SECONDS, 1.0);
	fModel.producedGoods = FACTORY_RATE * BUFFER_SECONDS;
	assert.equal(fModel.factoryCoalBid(factory), 0);
	checkLedger(model);
	checkLedger(fModel);
});

test('isolated mines and townless chains remain idle; distant chains deliver when price decay is off', () => {
	const lonely = clearedMap();
	lonely.setActor(economyIndex(10, 10), ECONOMY_MINE);
	lonely.setActor(economyIndex(12, 10), ECONOMY_FACTORY);
	run(lonely, 5);
	assert.equal(lonely.workedLabor, 0);
	assert.equal(lonely.producedCoal, 0);
	assert.equal(lonely.producedGoods, 0);
	checkLedger(lonely);

	const distant = clearedMap();
	distant.setActor(economyIndex(0, 0), ECONOMY_MINE);
	distant.setActor(economyIndex(12, 7), ECONOMY_FACTORY);
	distant.setActor(economyIndex(24, 14), ECONOMY_TOWN);
	distant.decay = false;
	run(distant, 60);
	assert.ok(distant.consumedGoods > 2);
	checkLedger(distant);
});

test('new particle arrivals survive their arrival tick before household consumption', () => {
	const model = clearedMap();
	const town = economyIndex(2, 0);
	model.setActor(town, ECONOMY_TOWN);
	model.priceGoods[town] = 4;
	model.producedGoods = 0.08;
	model.particles.emit(ITEM_GOODS, town, 0.08, 0.1, economyIndex(0, 0));
	model.step();
	closeTo(model.goods[town], 0.08, 1e-14);
	assert.equal(model.consumedGoods, 0);
	checkLedger(model);
});

test('unpaid bills cool factory bids and broke towns bid nothing', () => {
	const fModel = clearedMap();
	const factory = economyIndex(24, 14);
	fModel.setActor(factory, ECONOMY_FACTORY);
	fModel.priceGoods[factory] = 3;
	const solvent = fModel.factoryCoalBid(factory);
	fModel.money.bill(factory, PAY_COAL, 5);
	assert.ok(fModel.factoryCoalBid(factory) < solvent);

	const broke = clearedMap();
	const town = economyIndex(14, 10);
	broke.setActor(economyIndex(10, 10), ECONOMY_MINE);
	broke.setActor(economyIndex(12, 10), ECONOMY_FACTORY);
	broke.setActor(town, ECONOMY_TOWN);
	broke.money.purse[town] = 0;
	broke.money.workerPurse[town] = 0;
	broke.money.seeded = 0;
	run(broke, 6);
	assert.equal(broke.townGoodsBid(town), 0);
	assert.equal(broke.producedCoal, 0);
	checkLedger(broke);
});

test('a supplied town between mine and factory grows and passes coal bids across without starving the factory', () => {
	const model = clearedMap();
	const mine = economyIndex(10, 14);
	const betweenTown = economyIndex(12, 14);
	const factory = economyIndex(14, 14);
	const idleTown = economyIndex(40, 14);
	model.setActor(mine, ECONOMY_MINE);
	model.setActor(betweenTown, ECONOMY_TOWN);
	model.setActor(factory, ECONOMY_FACTORY);
	model.setActor(idleTown, ECONOMY_TOWN);
	run(model, 45);
	assert.ok(model.producedGoods > 4);
	assert.ok(model.pop[betweenTown] > model.pop[idleTown] + 4);
	assert.ok(model.profit[betweenTown] > model.profit[idleTown] + 0.15);
	checkLedger(model);
});

test('pool occupancy cools wages to zero on overflow and wealth classes differentiate living tax', () => {
	const model = clearedMap();
	const factory = economyIndex(24, 14);
	model.setActor(factory, ECONOMY_FACTORY);
	model.priceGoods[factory] = 4;
	const pool = model.firmLaborPool(factory);
	model.labor[factory] = pool;
	assert.equal(model.factoryLaborBid(factory), 0);

	const towns = clearedMap();
	const cheap = economyIndex(10, 14), med = economyIndex(34, 14);
	towns.setActor(cheap, ECONOMY_TOWN);
	towns.setActor(med, ECONOMY_TOWN);
	towns.wealthClass[cheap] = WEALTH_CHEAP;
	towns.wealthClass[med] = WEALTH_MED;
	run(towns, 12);
	assert.ok(towns.taxMult[cheap] < 1);
	assert.ok(towns.taxMult[med] > towns.taxMult[cheap] + 0.25);
	checkLedger(towns);
});

test('land rest and settle intent found a young town on meadow away from facility wasteland without minting gold', () => {
	const model = clearedMap();
	model.land.terrain.fill(TERRAIN_MEADOW);
	model.land.refresh();
	const mine = economyIndex(20, 14);
	model.setActor(mine, ECONOMY_MINE);
	for (let y = 13; y <= 15; y++) {
		for (let x = 21; x <= 23; x++) {
			const i = economyIndex(x, y);
			model.depleted[i] += 0.4;
			model.depletedFlow.gold[i] += 0.5;
			model.money.seeded += 0.5;
			model.emittedDepleted += 0.4;
		}
	}
	run(model, 6);
	assert.equal(model.settlements.founded, 1);
	const town = model.actors.indexOf(ECONOMY_TOWN);
	assert.ok(town >= 0 && model.settlements.isYoungTown(town));
	const dist = Math.hypot(town % ECONOMY_WIDTH - 20, Math.floor(town / ECONOMY_WIDTH) - 14);
	assert.ok(dist > 2);
	assert.equal(model.money.mined, 0);
	checkLedger(model);
});
