// Owns: commercial food-chain and worker-owned demographic regression tests.
// Edit for: farm construction/harvest accounting, split gates and starvation/compaction invariants.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SCRIPTS = ['simulation.js', 'land.js', 'steering.js', 'forage.js', 'owners.js', 'gold.js', 'banks.js', 'goods.js', 'workforce.js', 'workers.js', 'worker-life.js', 'farms.js', 'actors.js', 'towns.js', 'settlement.js', 'founding.js', 'track.js'];
for (const file of SCRIPTS) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} !== ${b}`);

function emptyModel() {
	const m = new PriceEconomy();
	for (let i = 0; i < ECONOMY_SIZE; i++) if (m.actors[i]) m.setActor(i, 0);
	m.workers.reset();
	m.workerLife.reset();
	m.money.reset();
	m.goodsPool.reset();
	m.land.terrain.fill(TERRAIN_MEADOW);
	m.land.moisture.fill(0.6);
	m.land.refresh();
	m.forage.reset();
	m.rebuildCellView();
	return m;
}

function lifeTicks(m, seconds) {
	for (let t = 0; t < Math.ceil(seconds / ECONOMY_DT); t++) m.workerLife.step();
}

test('town services never create workers or turn comfort goods into food', () => {
	const m = emptyModel(), c = economyIndex(20, 14);
	m.setActor(c, ECONOMY_TOWN);
	m.workers.spawn(20.5, 14.5, WORKER_STILL, 0, 32, 1, true);
	m.rebuildCellView();
	for (let t = 0; t < 18000; t++) {
		m.coal[c] = m.goods[c] = 100;
		m.towns.stepTown(c);
	}
	assert.equal(m.workers.count, 1);
	assert.equal(m.workers.births, 0);
	assert.equal(m.food[c], 0);
});

test('splitting requires personal needs, food, money and personal cooldown; shares rather than mints', () => {
	const m = emptyModel(), w = m.workers.spawn(20.5, 14.5, WORKER_STILL, 0.2, 32, 1, true);
	m.money.seedWorker(32);
	m.workerLife.needs[w] = 1;
	m.workers.food[w] = 0.1;
	lifeTicks(m, WORKER_SPLIT_SECONDS + 1);
	assert.equal(m.workers.count, 1);
	m.workers.food[w] = 1;
	m.workers.gold[w] = 1;
	lifeTicks(m, WORKER_SPLIT_SECONDS + 1);
	assert.equal(m.workers.count, 1);
	m.workers.gold[w] = 32;
	m.workerLife.needs[w] = 0;
	lifeTicks(m, WORKER_SPLIT_SECONDS + 1);
	assert.equal(m.workers.count, 1);
	m.workerLife.needs[w] = 1;
	m.workerLife.splitAge[w] = 0;
	lifeTicks(m, WORKER_SPLIT_SECONDS - 1);
	assert.equal(m.workers.count, 1);
	lifeTicks(m, 2);
	assert.equal(m.workers.count, 2);
	close(m.workers.gold[0], 16);
	close(m.workers.gold[1], 16);
	close(m.workers.food[0] + m.workers.food[1], 1);
	close(m.workers.totalTired(), 0.2);
	close(m.money.total(), m.money.seeded);
	assert.equal(m.workers.state[1], WORKER_STILL);
	assert.notEqual(m.workers.id[0], m.workers.id[1]);
	assert.equal(m.workers.births, 1);
});

test('a full worker pool leaves the parent wallet, food and counters untouched', () => {
	const m = emptyModel();
	for (let n = 0; n < MAX_WORKERS; n++) m.workers.spawn(20.5, 14.5, WORKER_STILL, 0, 32, 1, true);
	assert.equal(m.workerLife.split(0), false);
	assert.equal(m.workers.gold[0], 32);
	assert.equal(m.workers.food[0], 1);
	assert.equal(m.workers.births, 0);
});

test('only prolonged personal food absence despawns; refeeding resets grace and swap removal preserves identity', () => {
	const m = emptyModel(), p = m.workers;
	p.spawn(20.5, 14.5, WORKER_FORAGE, 0.4, 7, 0, true);
	p.spawn(22.5, 14.5, WORKER_STILL, 0.2, 4, 0.5, true);
	const survivorId = p.id[1];
	m.money.seedWorker(11);
	lifeTicks(m, WORKER_STARVE_SECONDS - 1);
	assert.equal(p.count, 2);
	p.food[0] = 0.1;
	lifeTicks(m, 1);
	p.food[0] = 0;
	lifeTicks(m, WORKER_STARVE_SECONDS - 1);
	assert.equal(p.count, 2);
	lifeTicks(m, 2);
	assert.equal(p.count, 1);
	assert.equal(p.id[0], survivorId);
	assert.equal(p.cell[0], economyIndex(22, 14));
	assert.equal(p.food[0], 0.5);
	assert.equal(m.workerLife.deaths, 1);
	close(m.workerLife.removedTired, 0.4);
	close(m.money.custody, 7);
	close(m.money.total(), 11);
	assert.equal(p.indexOfId(survivorId), 0);
});

test('high food bids and idle fresh workers found a farm, but no forest or wood means no farm', () => {
	const m = emptyModel();
	m.priceCoal.fill(0);
	m.priceGoods.fill(0);
	m.priceFood.fill(0.5);
	m.settlements.forest.fill(0);
	assert.equal(m.farms.canSite(economyIndex(20, 14)), false);
	for (let n = 0; n < FIRM_FOUNDERS; n++) m.workers.spawn(20.5, 14.5, WORKER_STILL, 0, 8, 1, true);
	for (let t = 0; t < FIRM_SCAN_TICKS; t++) m.founding.step();
	assert.equal(m.founding.founded, 0);
	m.settlements.forest.fill(1);
	for (let t = 0; t < FIRM_SCAN_TICKS; t++) m.founding.step();
	assert.equal(m.founding.founded, 1);
	assert.ok(m.actors.includes(ECONOMY_FARM));
	assert.equal(m.money.mined, 0);
});

test('paid farm crews fully clear random farmland, build from felled wood and harvest whole fields', () => {
	const m = emptyModel(), c = economyIndex(20, 14);
	m.settlements.forest.fill(1);
	m.priceFood.fill(0.45);
	m.setActor(c, ECONOMY_FARM);
	m.money.payOwner(m.owners.ownerAt(c), 12);
	m.money.seedWorker(12);
	m.owners.allocate();
	m.priceLabor[c] = 0.1;
	for (let n = 0; n < 12; n++) {
		const w = m.workers.spawn(20.5, 14.5, WORKER_STILL, 0, 8, 1, true);
		m.money.seedWorker(8);
		assert.equal(m.workers.tryAdmitFirm(w, c), true);
	}
	assert.ok(m.money.wages > 0);
	for (let t = 0; t < 720; t++) {
		m.rebuildCellView();
		m.farms.step();
		if (t < 400) assert.equal(m.producedFood, 0, 'no continuous per-tick output');
	}
	assert.equal(m.founding.isBuilding(c), false);
	assert.ok(m.farms.plots[c] > 1);
	assert.ok(m.producedFood > 0);
	for (let i = 0; i < ECONOMY_SIZE; i++) if (m.farms.plotOwner[i] === c + 1) assert.equal(m.settlements.forest[i], 0);
	close(m.goodsPool.spawnBufferTotal(ITEM_FOOD), m.producedFood);
	close(m.money.total(), m.money.seeded);
	close(m.workers.seededTired + m.workedLabor, m.workers.totalTired());
	m.setActor(c, 0);
	assert.equal(m.farms.plotOwner.some(v => v === c + 1), false);
	close(m.goodsPool.spawnBufferTotal(ITEM_FOOD) + m.goodsPool.inTransitTotal(ITEM_FOOD) + m.goodsPool.spoiled[ITEM_FOOD], m.producedFood);
});

test('wood builds a forestless farm, humidity is sampled at harvest and waste lands beyond its range even on another farm', () => {
	const m = emptyModel(), c = economyIndex(20, 14), neighbor = economyIndex(23, 14);
	m.settlements.forest.fill(0);
	m.wood[c] = FARM_BUILD_WOOD;
	assert.equal(m.farms.canSite(c), true);
	m.setActor(c, ECONOMY_FARM);
	m.farms.clearVisit(c);
	m.farms.step();
	assert.equal(m.founding.isBuilding(c), false);
	m.land.moisture.fill(0);
	m.farms.crewTime[c] = FARM_SEASON_SECONDS;
	m.farms.clock[c] = FARM_SEASON_SECONDS;
	m.farms.harvest(c);
	assert.equal(m.producedFood, 0);
	m.land.moisture.fill(0.6);
	m.farms.crewTime[c] = FARM_SEASON_SECONDS;
	m.farms.clock[c] = FARM_SEASON_SECONDS;
	m.farms.harvest(c);
	close(m.producedFood, FARM_YIELD);
	for (let i = 0; i < ECONOMY_SIZE; i++) {
		if (m.farms.waste[i] <= 0) continue;
		assert.equal(Math.max(Math.abs(i % ECONOMY_WIDTH - 20), Math.abs(Math.floor(i / ECONOMY_WIDTH) - 14)), 3);
	}
	m.farms.waste.fill(0);
	// Force the first eligible ring cell to be selected, independently of its ownership.
	m.farms.random = n => n === 1 ? 0 : 1;
	const ring = economyIndex(17, 11);
	m.farms.plotOwner[ring] = neighbor + 1;
	m.farms.pushWaste(c, 0.01);
	assert.ok(m.farms.waste[ring] > 0);
});

test('food particles pay their producer and hauler; workers buy food rather than comfort goods', () => {
	const m = emptyModel(), c = economyIndex(20, 14), f = economyIndex(24, 14);
	m.setActor(c, ECONOMY_TOWN);
	m.setActor(f, ECONOMY_FARM);
	m.money.payOwner(m.owners.ownerAt(c), 12);
	m.money.seedWorker(12);
	m.owners.allocate();
	m.priceFood[c] = 0.5;
	m.towns.stepTown(c);
	m.goodsPool.emit(ITEM_FOOD, c, 1, 0.02);
	m.goodsPool.owner[0] = m.owners.ownerAt(f);
	m.goodsPool.transportCost[0] = 0.01;
	m.goodsPool.stepMove();
	m.goodsPool.admitKind(ITEM_FOOD);
	assert.ok(m.food[c] > 0.9);
	assert.ok(m.owners.accountAt(f).cash > 0);
	assert.ok(m.money.transportEarned > 0);
	const w = m.workers.spawn(20.5, 14.5, WORKER_STILL, 0, 8, 0, true);
	m.money.seedWorker(8);
	assert.ok(m.towns.buyRation(c, w) > 0.9);
	close(m.food[c] + m.consumedFood + m.goodsPool.spoiled[ITEM_FOOD], 1);
	close(m.money.total(), m.money.seeded);
	assert.ok(m.goodsPool.maxProfitError < 1e-11);
});

test('the canonical tick sustains a paid farm-to-bazaar chain with exact food and gold ledgers', () => {
	const m = emptyModel(), c = economyIndex(20, 14);
	m.settlements.forest.fill(1);
	m.setActor(c, ECONOMY_FARM);
	m.setActor(economyIndex(26, 14), ECONOMY_TOWN);
	m.money.payOwner(m.owners.ownerAt(c), 12);
	m.money.seedWorker(12);
	m.owners.allocate();
	m.priceFood.fill(0.45);
	m.priceLabor[c] = 0.1;
	for (let n = 0; n < 6; n++) {
		const w = m.workers.spawn(20.5, 14.5, WORKER_STILL, 0, 8, 1, true);
		m.money.seedWorker(8);
		m.workers.tryAdmitFirm(w, c);
	}
	for (let n = 0; n < 7200; n++) m.step();
	assert.ok(m.farms.harvests >= 2);
	assert.ok(m.producedFood > 10);
	assert.ok(m.consumedFood > 1);
	const held = m.food.reduce((a, b) => a + b, 0) + m.goodsPool.spawnBufferTotal(ITEM_FOOD) + m.goodsPool.inTransitTotal(ITEM_FOOD);
	close(m.producedFood - m.consumedFood - m.goodsPool.spoiled[ITEM_FOOD], held);
	close(m.money.total(), m.money.seeded + m.money.mined);
	close(m.workers.totalAmount(), m.workers.seededWorkers + m.workers.births - m.workerLife.deaths);
	close(m.workers.totalTired(), m.workers.seededTired + m.workedLabor - m.restedDepleted - m.workerLife.removedTired);
});

test('founding a town creates services without teleporting, checking in or changing any workers', () => {
	const m = emptyModel(), c = economyIndex(20, 14), p = m.workers;
	for (let n = 0; n < 4; n++) p.spawn(19.5 + n, 14.5, WORKER_STILL, 0.8, 8, 0.5, true);
	const snapshots = p.columns.map(col => col.slice(0, p.count));
	m.settlements.foundTown(c);
	assert.equal(m.actors[c], ECONOMY_TOWN);
	for (let k = 0; k < p.columns.length; k++) assert.deepEqual(p.columns[k].slice(0, p.count), snapshots[k]);
	assert.equal(p.count, 4);
});
