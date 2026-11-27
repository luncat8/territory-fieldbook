// Owns: conservation, Transport Company accounting, pass-through and consignment tests for Particle Transfer B2.
// Edit for: mass/headcount/gold invariants across reference runs, actor edits and edge particle routing.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPTS = ['simulation.js', 'land.js', 'steering.js', 'forage.js', 'owners.js', 'gold.js', 'banks.js', 'currencies.js', 'goods.js', 'workforce.js', 'workers.js', 'worker-life.js', 'farms.js', 'actors.js', 'towns.js', 'settlement.js', 'founding.js', 'track.js'];
for (const file of SCRIPTS) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

const sum = values => values.reduce((total, value) => total + value, 0);
const closeTo = (actual, expected, eps = 1e-7) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} !== ${expected}`);

function run(model, seconds) {
	for (let n = 0; n < Math.round(seconds / ECONOMY_DT); n++) model.step();
}

function checkLedgers(model) {
	const { goodsPool, workers, money } = model;
	assert.ok(model.coal.every(v => Number.isFinite(v) && v >= 0));
	assert.ok(model.goods.every(v => Number.isFinite(v) && v >= 0));
	assert.ok(model.owners.accounts.slice(1).every(a => Number.isFinite(a.cash) && a.cash >= -1e-12));
	assert.ok(model.owners.accounts.slice(1).every(a => Number.isFinite(a.wageDebt) && a.wageDebt >= -1e-12));
	assert.ok(Number.isFinite(money.transport) && money.transport >= -1e-12);
	assert.ok(Number.isFinite(money.custody) && money.custody >= -1e-12);
	assert.ok(Number.isFinite(money.total()) && money.total() >= -1e-12);
	assert.ok(goodsPool.maxProfitError <= 1e-11, `profit identity error too large: ${goodsPool.maxProfitError}`);
	for (let p = 0; p < goodsPool.count; p++) {
		assert.ok(goodsPool.amount[p] > 0 && Number.isFinite(goodsPool.amount[p]));
		assert.ok(goodsPool.transportCost[p] >= 0 && Number.isFinite(goodsPool.transportCost[p]));
		const pCell = economyIndex(Math.floor(goodsPool.x[p]), Math.floor(goodsPool.y[p]));
		assert.notEqual(model.land.terrain[pCell], TERRAIN_WATER);
	}
	for (let w = 0; w < workers.count; w++) {
		assert.ok(workers.gold[w] >= -1e-12 && Number.isFinite(workers.gold[w]));
		assert.ok(workers.tired[w] >= 0 && workers.tired[w] <= workers.amount[w] + 1e-12);
		assert.ok(workers.food[w] >= 0 && workers.food[w] <= FOOD_BAG + 1e-12);
		assert.notEqual(model.land.terrain[workers.cell[w]], TERRAIN_WATER);
	}
	const coalHeld = sum(model.coal) + goodsPool.spawnBufferTotal(ITEM_COAL) + goodsPool.inTransitTotal(ITEM_COAL);
	const goodsHeld = sum(model.goods) + goodsPool.spawnBufferTotal(ITEM_GOODS) + goodsPool.inTransitTotal(ITEM_GOODS);
	closeTo(model.producedCoal - model.burnedCoal - goodsPool.spoiled[ITEM_COAL], coalHeld);
	closeTo(model.producedGoods - model.consumedGoods - goodsPool.spoiled[ITEM_GOODS], goodsHeld);
	const foodHeld = sum(model.food) + goodsPool.spawnBufferTotal(ITEM_FOOD) + goodsPool.inTransitTotal(ITEM_FOOD);
	closeTo(model.producedFood - model.consumedFood - goodsPool.spoiled[ITEM_FOOD], foodHeld);
	const woodHeld = sum(model.wood) + goodsPool.spawnBufferTotal(ITEM_WOOD) + goodsPool.inTransitTotal(ITEM_WOOD);
	closeTo(model.seededTimber + model.producedWood - model.consumedWood - goodsPool.spoiled[ITEM_WOOD], woodHeld);
	closeTo(workers.seededWorkers + workers.births - model.workerLife.deaths, workers.totalAmount(), 1e-9);
	closeTo(workers.seededTired + model.workedLabor - model.restedDepleted - model.workerLife.removedTired, workers.totalTired());
	closeTo(money.seeded + money.mined, money.total());
}

test('reference chain sustains particle throughput and conserves mass, people, tired and gold', () => {
	const model = new PriceEconomy();
	run(model, 90);
	checkLedgers(model);
	assert.ok(model.producedCoal > 8, `expected coal mined > 8, got ${model.producedCoal}`);
	assert.ok(model.producedGoods > 4, `expected goods made > 4, got ${model.producedGoods}`);
	assert.ok(model.consumedGoods > 3, `expected goods eaten > 3, got ${model.consumedGoods}`);
	assert.ok(model.money.wages > 4, `expected wages > 4, got ${model.money.wages}`);
	assert.ok(model.money.transportEarned > 0, 'expected positive Transport Company haul revenue');
});

test('young town builds its first tier from sawmill wood delivered through the market', () => {
	const model = new PriceEconomy();
	const town = economyIndex(9, 20);
	// Reference towns start mature (tier 1, zero wood demand); reset one to young so it must buy construction wood.
	model.settlements.tier[town] = 0;
	run(model, 60);
	checkLedgers(model);
	assert.ok(model.producedWood > 1, `expected wood produced > 1, got ${model.producedWood}`);
	assert.ok(model.consumedWood > 0, `expected delivered wood consumed by builders, got ${model.consumedWood}`);
	assert.ok(model.settlements.tier[town] > 0, `expected young town tier to grow from wood, got ${model.settlements.tier[town]}`);
});

test('placing, erasing and clearing actors mid-run flushes buffers, releases purses and conserves ledgers', () => {
	const model = new PriceEconomy();
	run(model, 12);
	const factoryCell = economyIndex(13, 13);
	const mineCell = economyIndex(7, 8);
	assert.equal(model.setActor(factoryCell, 0), true);
	assert.equal(model.setActor(mineCell, 0), true);
	checkLedgers(model);
	run(model, 5);
	checkLedgers(model);
	assert.equal(model.setActor(factoryCell, ECONOMY_FACTORY), true);
	model.clearTowns();
	checkLedgers(model);
	run(model, 10);
	checkLedgers(model);
});

test('goods particles pass through a saturated buyer toward a hungry downstream buyer', () => {
	const model = new PriceEconomy();
	for (let i = 0; i < ECONOMY_SIZE; i++) if (model.actors[i]) model.setActor(i, 0);
	model.workers.reset();
	model.money.reset();
	const fullTown = economyIndex(21, 12);
	const hungryTown = economyIndex(23, 12);
	const sender = economyIndex(19, 12);
	model.setActor(fullTown, ECONOMY_TOWN);
	model.setActor(hungryTown, ECONOMY_TOWN);
	model.money.payOwner(model.owners.ownerAt(hungryTown), 12);
	model.money.seedWorker(12);
	model.owners.allocate();
	model.setActor(sender, ECONOMY_FACTORY);
	model.goods[fullTown] = model.townGoodsTarget(fullTown) * 2.5;
	model.producedGoods += model.goods[fullTown];
	model.goodsPool.cap[ITEM_GOODS][fullTown] = model.goods[fullTown];
	model.goods[hungryTown] = 0;
	for (let n = 0; n < 80; n++) model.updatePrices();
	assert.equal(model.goodsPool.emit(ITEM_GOODS, sender, 0.1, 0.2), true);
	model.producedGoods += 0.1;
	run(model, 4);
	checkLedgers(model);
	assert.ok(model.goods[hungryTown] + model.consumedGoods > 0.02, 'downstream hungry town should receive the passed-through goods particle');
});

test('over-hauled goods particle consigns into a hungry town after CONSIGN_WAIT_TICKS without minting gold', () => {
	const model = new PriceEconomy();
	for (let i = 0; i < ECONOMY_SIZE; i++) if (model.actors[i]) model.setActor(i, 0);
	model.workers.reset();
	model.money.reset();
	const town = economyIndex(24, 14);
	const sender = economyIndex(22, 14);
	model.setActor(town, ECONOMY_TOWN);
	model.money.payOwner(model.owners.ownerAt(town), 12);
	model.money.seedWorker(12);
	model.owners.allocate();
	model.setActor(sender, ECONOMY_FACTORY);
	for (let n = 0; n < 60; n++) model.updatePrices();
	assert.equal(model.goodsPool.emit(ITEM_GOODS, town, 0.08, 0.5), true);
	const p = model.goodsPool.count - 1;
	model.goodsPool.owner[p] = model.owners.ownerAt(sender);
	model.goodsPool.transportCost[p] = 12;
	model.producedGoods += 0.08;
	run(model, 5);
	checkLedgers(model);
	assert.equal(model.goodsPool.count, 0, 'stranded goods particle should consign into hungry town');
	assert.ok(model.goodsPool.underwaterLosses >= 1, 'consignment below haul cost should record an underwater spot sale');
	assert.ok(model.goods[town] > 0 || model.consumedGoods > 0);
});

test('stranded in-flight coal relaxes its over-hauled book toward the buyer instead of parking', () => {
	const model = new PriceEconomy();
	for (let i = 0; i < ECONOMY_SIZE; i++) if (model.actors[i]) model.setActor(i, 0);
	model.workers.reset();
	model.money.reset();
	const town = economyIndex(24, 14);
	model.setActor(town, ECONOMY_TOWN);
	model.money.payOwner(model.owners.ownerAt(town), 12);
	model.money.seedWorker(12);
	model.owners.allocate();
	model.coal[town] = 0;
	for (let n = 0; n < 60; n++) model.updatePrices();
	const field = model.priceCoal[town];
	assert.ok(field > 0, `town should bid for coal, got field ${field}`);
	// Ask 1.5x the buyer's field price, so the particle is underwater at the town and no road pays its floor.
	assert.equal(model.goodsPool.emit(ITEM_COAL, town, 0.08, field * 1.5 * 0.08), true);
	const p = model.goodsPool.count - 1;
	const ask0 = model.goodsPool.unitPrice(p);
	assert.ok(ask0 > field, `particle ask ${ask0} should exceed the buyer field ${field}`);
	model.producedCoal += 0.08;
	run(model, 10);
	checkLedgers(model);
	assert.ok(model.goodsPool.writtenDown[ITEM_COAL] > 0, 'stranded coal should write down its over-hauled book cost');
	if (model.goodsPool.count > 0) {
		const still = model.goodsPool.count - 1;
		if (model.goodsPool.kind[still] === ITEM_COAL) {
			assert.ok(model.goodsPool.unitPrice(still) < ask0, 'stranded coal ask should relax down toward the buyer');
		}
	}
});
