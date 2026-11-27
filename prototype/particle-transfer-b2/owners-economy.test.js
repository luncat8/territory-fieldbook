// Owns: scenario funding, shared-owner budgets, durable payees and price-scale regressions.
// Edit for: gold-only ownership and low-liquidity acceptance gates; no bank or paper assumptions.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPTS = ['simulation.js', 'land.js', 'steering.js', 'forage.js', 'owners.js', 'gold.js', 'banks.js', 'currencies.js', 'goods.js', 'workforce.js', 'workers.js', 'worker-life.js', 'farms.js', 'actors.js', 'towns.js', 'settlement.js', 'founding.js', 'track.js', 'diagnostics.js'];
for (const file of SCRIPTS) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const conserved = m => near(m.money.total(), m.money.seeded + m.money.mined);

function empty() {
	const m = new PriceEconomy(0);
	for (let i = 0; i < ECONOMY_SIZE; i++) if (m.actors[i]) m.setActor(i, 0);
	m.workers.reset();
	m.money.reset();
	m.goodsPool.reset();
	m.rebuildCellView();
	return m;
}

function capital(m, cell, amount) {
	m.money.seedWorker(amount);
	m.money.payOwner(m.owners.ownerAt(cell), amount);
	m.owners.allocate();
}

test('starting gold is one scenario allocation, full food is a separate real asset', () => {
	for (const level of [0, 0.001, 1, 100]) {
		const m = new PriceEconomy(level);
		near(m.money.seeded, level * m.workers.totalAmount());
		near(m.workers.totalGold(), m.money.seeded / 2);
		near(m.owners.total(), m.money.seeded / 2);
		near(m.workers.seededFood, m.workers.totalAmount() * FOOD_BAG);
		assert.equal(m.money.initializeScenario(level), false);
		conserved(m);
		m.reset();
		conserved(m);
		near(m.money.seeded, level * m.workers.totalAmount());
	}
});

test('placing and erasing towns never creates gold or destroys owner balances', () => {
	const m = new PriceEconomy();
	const cell = m.actors.findIndex((a, i) => !a && !m.farms.plotOwner[i] && !m.forage.plotOwner[i] && m.land.terrain[i] !== TERRAIN_WATER);
	const start = m.money.seeded, total = m.money.total();
	for (let n = 0; n < 12; n++) {
		assert.equal(m.setActor(cell, ECONOMY_TOWN), true);
		assert.equal(m.money.cash(cell), 0);
		m.setActor(cell, 0);
	}
	near(m.money.seeded, start);
	near(m.money.total(), total);
	const town = economyIndex(9, 20), owner = m.owners.ownerAt(town);
	const cash = m.owners.accounts[owner].cash;
	m.setActor(town, 0);
	near(m.owners.accounts[owner].cash, cash);
	conserved(m);
});

test('one worker owns two sites with one purse and bounded non-overlapping envelopes', () => {
	const m = empty(), a = economyIndex(20, 14), b = economyIndex(22, 14);
	m.setActor(a, ECONOMY_MINE);
	m.setActor(b, ECONOMY_FACTORY);
	const w = m.workers.spawn(20.5, 14.5, WORKER_STILL, 0, 0, 1, true);
	assert.equal(m.owners.buyFacility(a, w, 0), true);
	assert.equal(m.owners.buyFacility(b, w, 0), true);
	assert.equal(m.owners.ownerAt(a), m.owners.ownerAt(b));
	capital(m, a, 10);
	near(m.money.cash(a), 5);
	near(m.money.cash(b), 5);
	near(m.money.spend(a, 9), 5);
	near(m.money.spend(b, 9), 5);
	near(m.owners.total(), 0);
	m.money.custody += 10;
	conserved(m);
});

test('owner debt survives erase/rebuild and FIFO claims remain on the old debtor', () => {
	const m = empty(), cell = economyIndex(20, 14);
	m.setActor(cell, ECONOMY_MINE);
	const owner = m.owners.ownerAt(cell), facility = m.owners.cell[cell];
	const w = m.workers.spawn(20.5, 14.5, WORKER_SHIFT, 0, 0, 1, true);
	m.money.payEntryWage(cell, w, 2);
	m.setActor(cell, 0);
	m.setActor(cell, ECONOMY_FACTORY);
	assert.notEqual(m.owners.cell[cell], facility);
	assert.notEqual(m.owners.ownerAt(cell), owner);
	near(m.owners.accounts[owner].wageDebt, 2);
	near(m.money.wageDebt(cell), 0);
	m.money.payOwner(owner, 2);
	m.money.seedWorker(2);
	m.money.step();
	near(m.workers.gold[w], 2);
	near(m.owners.accounts[owner].wageDebt, 0);
	assert.equal(m.money.claimCount, 0);
	conserved(m);
});

test('in-flight cargo pays its original owner, not a replacement at the same cell', () => {
	const m = empty(), source = economyIndex(20, 14), buyer = economyIndex(22, 14);
	m.setActor(source, ECONOMY_FACTORY);
	m.setActor(buyer, ECONOMY_TOWN);
	const owner = m.owners.ownerAt(source);
	m.goodsPool.emit(ITEM_GOODS, buyer, 1, 0, source);
	m.setActor(source, 0);
	m.setActor(source, ECONOMY_FACTORY);
	const replacement = m.owners.ownerAt(source);
	capital(m, buyer, 2);
	m.priceGoods[buyer] = 2;
	m.goodsPool.cap[ITEM_GOODS][buyer] = 1;
	m.goodsPool.arriving[0] = 1;
	m.goodsPool.admitKind(ITEM_GOODS);
	near(m.owners.accounts[owner].cash, 2);
	near(m.owners.accounts[replacement].cash, 0);
	near(m.goods[buyer], 1);
	conserved(m);
});

test('buying a facility transfers actual worker gold; seller keeps existing cash and liabilities', () => {
	const m = empty(), cell = economyIndex(20, 14);
	m.setActor(cell, ECONOMY_MINE);
	const seller = m.owners.ownerAt(cell), facility = m.owners.cell[cell];
	const w = m.workers.spawn(20.5, 14.5, WORKER_STILL, 0, 3, 1, true);
	m.money.seedWorker(3);
	m.money.payEntryWage(cell, w, 1);
	assert.equal(m.owners.buyFacility(cell, w, 4), false);
	assert.equal(m.owners.buyFacility(cell, w, 2), true);
	near(m.workers.gold[w], 1);
	near(m.owners.accounts[seller].cash, 2);
	near(m.owners.accounts[seller].wageDebt, 1);
	assert.equal(m.owners.cell[cell], facility);
	assert.equal(m.owners.accountAt(cell).workerId, m.workers.id[w]);
	m.money.step();
	near(m.workers.gold[w], 2);
	conserved(m);
});

test('initial price quotes do not read starting gold, while live prices can fall below old floors', () => {
	const a = new PriceEconomy(0.001), b = new PriceEconomy(100);
	const cell = economyIndex(9, 20);
	near(a.towns.restTax(cell), b.towns.restTax(cell));
	near(a.towns.foodFee(cell), b.towns.foodFee(cell));
	a.localWealth[cell] = b.localWealth[cell] = 0.000008;
	near(a.towns.restTax(cell), b.towns.restTax(cell));
	assert.ok(a.towns.restTax(cell) < 0.0001);
	assert.ok(a.towns.foodFee(cell) < 0.0001);
	a.localWealth[cell] = 0;
	near(a.towns.restTax(cell), 0);
	near(a.towns.foodFee(cell), 0);
});

test('denomination changes do not change price-gradient direction or movement speed', () => {
	const m = empty(), cell = economyIndex(20, 14), right = cell + 1;
	m.land.speed.fill(1);
	m.steering.rebuildConductance();
	let speed = 0;
	for (const level of [1, 0.001, 1000]) {
		m.priceCoal.fill(level);
		m.priceCoal[right] = 2 * level;
		m.steering.sampleField(m.priceCoal, null, 0, cell, 0);
		assert.equal(m.steering.grad.bestDir, 0);
		m.steering.advance(20.5, 14.5, 0, 0, GOODS_SPEED);
		if (!speed) speed = m.steering.out.ds;
		near(m.steering.out.ds, speed);
	}
});

test('tiny-gold delivery buys the same real quantity, not a discounted cash-clipped free transfer', () => {
	for (const level of [1, 0.001, 0.000001]) {
		const m = empty(), source = economyIndex(20, 14), buyer = economyIndex(22, 14);
		m.setActor(source, ECONOMY_FACTORY);
		m.setActor(buyer, ECONOMY_TOWN);
		capital(m, buyer, level);
		m.priceGoods[buyer] = 2 * level;
		m.goodsPool.cap[ITEM_GOODS][buyer] = 2;
		m.goodsPool.emit(ITEM_GOODS, buyer, 1, level, source);
		m.goodsPool.arriving[0] = 1;
		m.goodsPool.admitKind(ITEM_GOODS);
		near(m.goods[buyer], 0.5);
		near(m.goodsPool.amount[0], 0.5);
		near(m.owners.accountAt(source).cash, level);
		conserved(m);
	}
});

test('no demand retains internal products, demand fields stay live and full depot halts output', () => {
	const m = empty(), cell = economyIndex(20, 14);
	m.setActor(cell, ECONOMY_MINE);
	m.goodsPool.produce(ITEM_COAL, cell, 1, 0);
	m.goodsPool.stepSpawn();
	near(m.goodsPool.spawnAmount[ITEM_COAL][cell], 1);
	assert.equal(m.goodsPool.count, 0);
	m.priceCoal[cell + 1] = 1;
	m.goodsPool.stepSpawn();
	assert.equal(m.goodsPool.count, 1);
	near(m.goodsPool.spawnAmount[ITEM_COAL][cell] + m.goodsPool.amount[0], 1);
	m.goodsPool.spawnAmount[ITEM_COAL][cell] = 100;
	m.shiftAvail[cell] = 1;
	m.optimizer.stepFirm(cell, m.optimizer.recipes[ECONOMY_MINE]);
	near(m.producedCoal, 0);
	m.updatePrices();
	assert.ok(m.priceCoal[cell] > 0);
});

test('strict zero-start gold mine produces gold and pays the original worked wage claims', () => {
	const m = empty(), cell = economyIndex(20, 14);
	m.setActor(cell, ECONOMY_GOLD);
	m.money.seedTimber(cell, GOLD_TIMBER); // recorded initial timber: a real-asset grant, never gold
	const w = m.workers.spawn(20.5, 14.5, WORKER_SHIFT, 0, 0, 1, true);
	m.money.payEntryWage(cell, w, 0.1);
	m.rebuildCellView();
	m.optimizer.stepFirm(cell, m.optimizer.recipes[ECONOMY_GOLD]);
	m.money.step();
	assert.ok(m.money.mined > 0);
	assert.ok(m.workers.gold[w] > 0);
	assert.ok(m.money.unpaidWages(m.workers.id[w]) < 0.1);
	near(m.money.seeded, 0);
	conserved(m);
});

test('diagnostics count shared and retired owner cash exactly once', () => {
	const m = new PriceEconomy(), cell = economyIndex(7, 8);
	m.setActor(cell, 0);
	const d = new EconomyDiagnostics(m), s = d.snapshot();
	near(s.townPurse + s.firmPurse + s.wallets + s.transport + s.custody + s.bankGold, s.goldTotal);
	conserved(m);
});


test('felled logs appear at the cut cell and retain the mill payee; full cargo pool preserves forest', () => {
	const m = empty(), cell = economyIndex(20, 14), cut = economyIndex(21, 15);
	m.setActor(cell, ECONOMY_SAWMILL);
	m.settlements.forest[cut] = 1;
	m.farms.random = () => SAWMILL_RADIUS + 1;
	m.farms.sawCost[cell] = 0.25;
	m.farms.fellVisit(cell);
	assert.equal(m.goodsPool.count, 1);
	near(m.goodsPool.x[0], 21.5);
	near(m.goodsPool.y[0], 15.5);
	assert.equal(m.goodsPool.owner[0], m.owners.ownerAt(cell));
	assert.equal(m.goodsPool.facility[0], m.owners.cell[cell]);
	near(m.goodsPool.factoryCost[0], 0.25);
	near(m.goodsPool.spawnBufferTotal(ITEM_WOOD), 0);
	near(m.producedWood, m.goodsPool.inTransitTotal(ITEM_WOOD));
	m.goodsPool.count = MAX_GOODS_PARTICLES;
	const before = m.settlements.forest[cut];
	m.farms.fellVisit(cell);
	near(m.settlements.forest[cut], before);
});

test('resetting and replacing a producer cannot carry a previous wage cost into a new business', () => {
	const m = new PriceEconomy(), cell = economyIndex(7, 8);
	m.optimizer.laborCost[cell] = 100;
	m.setActor(cell, 0);
	near(m.optimizer.laborCost[cell], 0);
	m.optimizer.laborCost[cell] = 100;
	m.reset();
	near(m.optimizer.laborCost[cell], 0);
});


test('hiring uses the employer quote, never a richer rival wage diffused across its cell', () => {
	const m = empty(), cell = economyIndex(20, 14);
	m.setActor(cell, ECONOMY_MINE);
	capital(m, cell, 0.001);
	m.priceCoal[cell] = 0.0001;
	m.priceLabor[cell] = 100;
	const w = m.workers.spawn(20.5, 14.5, WORKER_STILL, 0, 0, 1, true);
	m.rebuildCellView();
	const quote = m.optimizer.entryWage(cell);
	assert.ok(quote > 0 && quote < 0.001);
	assert.equal(m.workers.tryAdmitFirm(w, cell), true);
	near(m.workers.gold[w], quote);
	near(m.money.wageDebt(cell), 0);
	conserved(m);
});

test('a tiny-money reference scene circulates actual gold without a minimum service fee', () => {
	const m = new PriceEconomy(0.001);
	for (let n = 0; n < 90 / ECONOMY_DT; n++) m.step();
	assert.ok(m.money.mined > 0);
	assert.ok(m.money.wages > 0);
	assert.ok(m.money.taxes > 0);
	assert.ok(m.goodsPool.arrivals > 0);
	conserved(m);
});
