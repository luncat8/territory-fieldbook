// Owns: regression checks for B2 carried worker wallets, paid town rest, migrant savings and gold-tax appeal.
// Edit for: worker-gold advection, rest-tax gating, distance-vs-tax migration and anti-siphon wage checks.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const file of ['simulation.js', 'actors.js', 'gold.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

const sum = (values) => values.reduce((total, value) => total + value, 0);
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);

function checkLedger(model) {
	assert.ok(model.laborFlow.gold.every((value) => value >= 0));
	assert.ok(model.depletedFlow.gold.every((value) => value >= 0));
	assert.ok(model.money.purse.every((value) => value >= 0));
	assert.ok(model.money.workerPurse.every((value) => value >= 0));
	for (let i = 0; i < ECONOMY_SIZE; i++) {
		if (model.labor[i] <= 1e-12) assert.equal(model.laborFlow.gold[i], 0);
		if (model.depleted[i] <= 1e-12) assert.equal(model.depletedFlow.gold[i], 0);
	}
	closeTo(sum(model.coal), model.producedCoal - model.burnedCoal);
	closeTo(sum(model.goods), model.producedGoods - model.consumedGoods);
	closeTo(sum(model.labor), model.suppliedLabor - model.workedLabor);
	closeTo(sum(model.depleted), model.emittedDepleted - model.restedDepleted);
	assert.ok(Math.abs(model.money.total() - model.money.seeded - model.money.mined) < 1e-7);
}

function clearedMap() {
	const model = new PriceEconomy();
	model.actors.fill(0);
	model.pop.fill(0);
	model.scale.fill(0);
	model.taxMult.fill(0);
	model.laborFlow.gold.fill(0);
	model.depletedFlow.gold.fill(0);
	model.money.reset();
	return model;
}

test('workers carry earned wages in depletedGold to the cheaper town and pay rest tax on arrival', () => {
	const model = clearedMap();
	const cheap = economyIndex(10, 14);
	const mid = economyIndex(15, 14);
	const dear = economyIndex(20, 14);
	model.setActor(cheap, ECONOMY_TOWN);
	model.setActor(dear, ECONOMY_TOWN);
	model.satCoal[cheap] = model.satCoal[dear] = 1;
	model.satGoods[cheap] = model.satGoods[dear] = 1;
	model.goods[cheap] = model.goods[dear] = 0.8;
	model.coal[cheap] = model.coal[dear] = 0.4;
	model.producedGoods = 1.6;
	model.producedCoal = 0.8;
	model.taxMult[cheap] = 0.6;
	model.taxMult[dear] = 2.0;
	for (let n = 0; n < 120; n++) model.updatePrices();

	const cheapBefore = model.money.held(cheap);
	const dearBefore = model.money.held(dear);
	model.depleted[mid] = 0.5;
	model.depletedFlow.gold[mid] = 10;
	model.emittedDepleted = 0.5;
	model.money.seeded += 10;

	for (let n = 0; n < 180; n++) {
		model.taxMult[cheap] = 0.6;
		model.taxMult[dear] = 2.0;
		model.satCoal[cheap] = model.satCoal[dear] = 1;
		model.satGoods[cheap] = model.satGoods[dear] = 1;
		model.updatePrices();
		model.optimizer.restWorkers(cheap, 1, 1);
		model.optimizer.restWorkers(dear, 1, 1);
		model.transport(model.depletedFlow, model.depleted, model.priceHome);
	}
	assert.ok(model.money.held(cheap) > cheapBefore + 7);
	assert.ok(model.money.held(dear) < dearBefore + 0.5);
	assert.ok(model.money.taxes > 0.5);
	checkLedger(model);
});

test('high-tax towns require cash to rest: funded workers pay and rest while penniless workers are priced out', () => {
	const funded = clearedMap();
	const broke = clearedMap();
	const town = economyIndex(24, 14);
	for (const model of [funded, broke]) {
		model.setActor(town, ECONOMY_TOWN);
		model.taxMult[town] = 1.8;
		model.satCoal[town] = 1;
		model.satGoods[town] = 1;
		model.depleted[town] = 0.4;
		model.emittedDepleted = 0.4;
	}
	funded.depletedFlow.gold[town] = 6;
	funded.money.seeded += 6;

	const restedFunded = funded.optimizer.restWorkers(town, 1, 1);
	const restedBroke = broke.optimizer.restWorkers(town, 1, 1);
	assert.ok(restedFunded > 0.008);
	assert.equal(restedBroke, 0);
	assert.ok(funded.money.taxes > 0);
	assert.equal(broke.money.taxes, 0);
	checkLedger(funded);
	checkLedger(broke);
});

test('living appeal trades off gold tax against distance fade and does not favor inflated gold-tax towns', () => {
	const distModel = clearedMap();
	const near = economyIndex(12, 14);
	const probe = economyIndex(16, 14);
	const far = economyIndex(28, 14);
	distModel.setActor(near, ECONOMY_TOWN);
	distModel.setActor(far, ECONOMY_TOWN);
	distModel.satGoods[near] = distModel.satGoods[far] = 1;
	for (let n = 0; n < 180; n++) distModel.updatePrices();
	assert.ok(distModel.priceHome[probe - 1] > distModel.priceHome[probe + 1], 'equal-tax nearer town wins via fade');

	const taxModel = clearedMap();
	const cheap = economyIndex(10, 14);
	const mid = economyIndex(16, 14);
	const inflated = economyIndex(22, 14);
	taxModel.setActor(cheap, ECONOMY_TOWN);
	taxModel.setActor(inflated, ECONOMY_TOWN);
	taxModel.satGoods[cheap] = taxModel.satGoods[inflated] = 1;
	taxModel.money.seeded += taxModel.money.workerPurse[inflated] * 3;
	taxModel.money.workerPurse[inflated] *= 4;
	for (let n = 0; n < 180; n++) taxModel.updatePrices();
	assert.ok(taxModel.townHomeBid(cheap) > taxModel.townHomeBid(inflated) * 3, 'inflated 4x gold tax lowers living appeal');
	assert.ok(taxModel.priceHome[mid - 1] > taxModel.priceHome[mid + 1], 'equidistant cheaper gold-tax town wins');
	checkLedger(distModel);
	checkLedger(taxModel);
});

test('shrinking towns send proportional resident savings out with departing depleted workers', () => {
	const model = clearedMap();
	const dying = economyIndex(24, 14);
	model.setActor(dying, ECONOMY_TOWN);
	const startWorkerGold = model.money.workerPurse[dying];
	model.step();
	assert.ok(model.depleted[dying] > 0);
	assert.ok(model.depletedFlow.gold[dying] > 0);
	closeTo(model.money.workerPurse[dying] + model.laborFlow.gold[dying] + model.depletedFlow.gold[dying], startWorkerGold);
	checkLedger(model);
});

test('active firms pay wages into worker pockets rather than wage streams, so bystander towns do not siphon wages', () => {
	const model = clearedMap();
	const goldMine = economyIndex(16, 14);
	const suppliedTown = economyIndex(10, 14);
	const idleBystander = economyIndex(22, 14);
	model.setActor(goldMine, ECONOMY_GOLD);
	model.setActor(suppliedTown, ECONOMY_TOWN);
	model.setActor(idleBystander, ECONOMY_TOWN);
	model.goods[suppliedTown] = 0.9;
	model.coal[suppliedTown] = 0.5;
	model.producedGoods = 0.9;
	model.producedCoal = 0.5;
	const bystanderStart = model.money.held(idleBystander);

	for (let n = 0; n < 360; n++) {
		model.goods[suppliedTown] = 0.9;
		model.coal[suppliedTown] = 0.5;
		model.producedGoods = model.consumedGoods + 0.9;
		model.producedCoal = model.burnedCoal + 0.5;
		model.step();
	}
	assert.ok(model.money.mined > 0.8);
	assert.ok(sum(model.money.streams[PAY_WAGE].coin) < 1e-6);
	assert.ok(model.money.held(suppliedTown) > bystanderStart + 0.5 * model.money.mined);
	assert.ok(model.money.held(idleBystander) <= bystanderStart + 0.05);
	checkLedger(model);
});

test('supplied towns temporarily in negative profit do not deadlock funded worker rest and tax recovery', () => {
	const model = clearedMap();
	const town = economyIndex(24, 14);
	model.setActor(town, ECONOMY_TOWN);
	model.profit[town] = -0.25;
	model.satCoal[town] = 1;
	model.satGoods[town] = 1;
	model.depleted[town] = 0.3;
	model.depletedFlow.gold[town] = 5;
	model.emittedDepleted = 0.3;
	model.money.seeded += 5;

	const rested = model.optimizer.restWorkers(town, 1, 1);
	assert.ok(rested > 0.008);
	assert.ok(model.money.taxes > 0);
	checkLedger(model);
});
