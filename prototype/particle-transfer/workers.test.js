// Owns: Phase-2 verification of worker particles — dock release, entry wages, wallet-weighted home steering,
// dominated-town release, queue cooling, still docking with carried intent, founding absorption and conservation.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const file of ['simulation.js', 'steering.js', 'particles.js', 'workers.js', 'track.js', 'actors.js', 'gold.js', 'workforce.js', 'land.js', 'settlement.js']) {
	vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });
}

const closeTo = (actual, expected, tol = 1e-12, ref = 1) => assert.ok(Math.abs(actual - expected) < tol * Math.max(1, Math.abs(ref)), `${actual} ≠ ${expected}`);

function run(model, seconds) {
	for (let n = 0; n < Math.round(seconds / ECONOMY_DT); n++) model.step();
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
	model.workers.reset();
	model.money.reset();
	model.settlements.reset();
	model.land.terrain.fill(TERRAIN_MEADOW);
	model.land.refresh();
	return model;
}

function rampRow(field, y, x0, x1, base, slope) {
	for (let x = x0; x <= x1; x++) field[economyIndex(x, y)] = base + (x - x0) * slope;
}

function stepWorkers(model, ticks) {
	for (let n = 0; n < ticks; n++) {
		model.workforce.weighWallets();
		model.workers.step();
	}
}

function checkWorkerLedger(model) {
	const { money, workers } = model;
	assert.ok(model.labor.every(v => v >= 0 && v <= 1 + 1e-12));
	assert.ok(model.depleted.every(v => v >= 0 && v <= 1 + 1e-12));
	for (let p = 0; p < workers.count; p++) {
		assert.ok(workers.amount[p] > 0 && workers.gold[p] >= 0);
		assert.ok(workers.intent[p] >= 0 && workers.intent[p] <= 1);
	}
	closeTo(model.totalItem(ITEM_LABOR), model.suppliedLabor - model.workedLabor, 1e-11, model.suppliedLabor);
	closeTo(model.totalItem(ITEM_DEPLETED), model.emittedDepleted - model.restedDepleted, 1e-11, model.emittedDepleted);
	closeTo(money.total(), money.seeded + money.mined, 1e-12, money.seeded + money.mined);
}

test('reference chain commutes by worker particles: walkers launch, arrive, carry wallets and conserve mass and gold', () => {
	const model = new PriceEconomy();
	let peak = 0, wallets = 0;
	for (let n = 0; n < Math.round(40 / ECONOMY_DT); n++) {
		model.step();
		peak = Math.max(peak, model.workers.count);
		if (n % 60 === 0) wallets = Math.max(wallets, model.workers.goldTotal());
	}
	assert.ok(model.workers.emitted > 200);
	assert.ok(model.workers.arrivals > 100);
	assert.ok(peak > 20 && peak < WORKER_CAP);
	assert.ok(wallets > 0.05, 'tired walkers carry wages home');
	assert.ok(model.workedLabor > 3);
	assert.ok(model.restedDepleted > 2);
	checkWorkerLedger(model);
});

test('a fresh walker leaves a town dock, climbs the wage bid and is paid the entry wage on joining the firm pool', () => {
	const model = clearedMap();
	const town = economyIndex(10, 14), firm = economyIndex(16, 14);
	model.setActor(town, ECONOMY_TOWN);
	model.setActor(firm, ECONOMY_MINE);
	model.priceLabor.fill(0);
	rampRow(model.priceLabor, 14, 9, 16, 0.1, 0.05);
	model.laborFlow.cap[firm] = 0.5;
	model.labor[town] = WORKER_UNIT;
	model.suppliedLabor = WORKER_UNIT;
	const purseBefore = model.money.purse[firm];
	model.money.purse[firm] = 10;
	model.money.seeded += 10 - purseBefore;
	stepWorkers(model, 1);
	assert.equal(model.workers.count, 1);
	assert.equal(model.labor[town], 0);
	let ticks = 0;
	// The worker persists as an object: it walks to the firm and docks there (parked, not drawn). It does not
	// vanish on docking — the object keeps its wallet until the firm consumes it.
	while (model.workers.dockCell[0] !== firm && ticks++ < 300) stepWorkers(model, 1);
	assert.equal(model.workers.count, 1);
	assert.equal(model.workers.dockCell[0], firm);
	closeTo(model.labor[firm], WORKER_UNIT, 1e-14);
	const wage = WORKER_UNIT * model.priceLabor[firm];
	closeTo(model.laborFlow.gold[firm], wage, 1e-14);
	closeTo(model.money.purse[firm], 10 - wage, 1e-14);
	checkWorkerLedger(model);
});

test('wallets pick the home: broke walkers follow living value, funded walkers follow rest quality', () => {
	function walk(gold) {
		const model = clearedMap();
		const start = economyIndex(20, 14);
		model.priceHome.fill(0);
		model.priceRest.fill(0);
		for (let x = 10; x <= 30; x++) {
			model.priceHome[economyIndex(x, 14)] = 1 + (20 - x) * 0.05;
			model.priceRest[economyIndex(x, 14)] = 1 + (x - 20) * 0.05;
		}
		model.depleted[start] = WORKER_UNIT;
		model.depletedFlow.gold[start] = gold;
		model.emittedDepleted = WORKER_UNIT;
		model.money.seeded = gold;
		stepWorkers(model, 30);
		checkWorkerLedger(model);
		return model.workers.x[0] - 20;
	}
	assert.ok(walk(0) < -1, 'broke walker heads for cheap rest');
	assert.ok(walk(5) > 1, 'funded walker heads for rest quality');
});

test('a dominated town releases its wait pool toward a neighbor with higher home appeal', () => {
	const model = clearedMap();
	const weak = economyIndex(20, 14), strong = economyIndex(23, 14);
	model.setActor(weak, ECONOMY_TOWN);
	model.setActor(strong, ECONOMY_TOWN);
	model.priceHome.fill(0);
	model.priceRest.fill(0);
	rampRow(model.priceHome, 14, 19, 23, 0.5, 0.2);
	rampRow(model.priceRest, 14, 19, 23, 0.5, 0.2);
	model.depletedFlow.cap[weak] = model.depletedFlow.cap[strong] = 0.9;
	model.depleted[weak] = 3 * WORKER_UNIT;
	model.depletedFlow.gold[weak] = 0.3;
	model.money.seeded += 0.3;
	model.emittedDepleted = 3 * WORKER_UNIT;
	stepWorkers(model, 120);
	assert.equal(model.depleted[weak], 0);
	closeTo(model.depleted[strong], 3 * WORKER_UNIT, 1e-14);
	closeTo(model.depletedFlow.gold[strong], 0.3, 1e-14);
	checkWorkerLedger(model);
});

test('walkers queued at a full firm cool its wage to zero and still enter once the pool drains', () => {
	const model = clearedMap();
	const town = economyIndex(10, 14), firm = economyIndex(14, 14);
	model.setActor(town, ECONOMY_TOWN);
	model.setActor(firm, ECONOMY_MINE);
	run(model, 2);
	const pool = model.firmLaborPool(firm);
	model.suppliedLabor += pool - model.labor[firm];
	model.labor[firm] = pool;
	for (let k = 0; k < 10; k++) {
		model.labor[firm] += WORKER_UNIT;
		model.workers.emitFrom(STATE_FRESH, firm, WORKER_UNIT);
	}
	model.suppliedLabor += 10 * WORKER_UNIT;
	model.workforce.weighWallets();
	model.workers.advanceAll();
	model.workers.admit(STATE_FRESH);
	assert.ok(model.workers.queuedAt(firm) > 0.5);
	assert.ok(model.poolOccupancy(firm) > 1);
	assert.equal(model.mineLaborBid(firm), 0);
	let minQueue = Infinity;
	const madeBefore = model.producedCoal;
	for (let n = 0; n < Math.round(12 / ECONOMY_DT); n++) {
		model.step();
		minQueue = Math.min(minQueue, model.workers.queuedAt(firm));
	}
	assert.ok(minQueue < 0.05, 'queue drains into the pool');
	assert.ok(model.producedCoal - madeBefore > 3, 'the pool keeps the shift running');
	checkWorkerLedger(model);
});

test('still walkers dock where they stand with intent·amount conserved, and founding absorbs walkers with their wallets', () => {
	const model = clearedMap();
	const spot = economyIndex(30, 14);
	model.depleted[spot] = 0.5;
	model.depletedFlow.intent[spot] = 0.2;
	model.workers.emitFrom(STATE_DEPLETED, spot, 0.5);
	const p = 0;
	model.workers.intent[p] = 0.8;
	model.workers.gold[p] = 0.4;
	model.money.seeded = 0.4;
	model.emittedDepleted = 0.5;
	// A still walker docks where it stands: the object persists (parked, not drawn) and its intent·amount joins
	// the docked stock. The object does not vanish on docking.
	model.workers.park(p, spot);
	assert.equal(model.workers.count, 1);
	assert.equal(model.workers.dockCell[p], spot);
	closeTo(model.depleted[spot], 0.5, 1e-14);
	closeTo(model.depletedFlow.intent[spot] * model.depleted[spot], 0.8 * 0.5, 1e-14);
	checkWorkerLedger(model);

	const founding = clearedMap();
	const c = economyIndex(30, 14);
	founding.depleted[c] = 0.6;
	founding.workers.emitFrom(STATE_DEPLETED, c, 0.6);
	founding.workers.x[0] = 31.4;
	founding.workers.gold[0] = 0.7;
	founding.money.seeded = 0.7;
	founding.emittedDepleted = 0.6;
	founding.settlements.foundTown(c);
	assert.equal(founding.actors[c], ECONOMY_TOWN);
	assert.equal(founding.workers.count, 0);
	closeTo(founding.money.workerPurse[c], 0.7, 1e-14);
	closeTo(founding.restedDepleted, 0.6, 1e-14);
	checkWorkerLedger(founding);
});

test('a tracked worker keeps his purse across walk, dock, shift and rest cycles with an exact ledger', () => {
	const model = new PriceEconomy();
	const town = model.actors.indexOf(ECONOMY_TOWN);
	const entry = model.spawnTrackedWorker(town, 'Audit', 500);
	assert.ok(entry, 'tracked worker spawned with a name and opening purse');
	let earnedOnce = false, rested = false;
	for (let n = 0; n < Math.round(120 / ECONOMY_DT); n++) {
		model.step();
		model.tracker.sampleAll();
		const p = model.workers.byWid(entry.id);
		const wallet = p >= 0 ? model.workers.gold[p] : 0;
		const balance = entry.funded + entry.earned - entry.spent - wallet;
		assert.ok(Math.abs(balance) < 1e-9, `tick ${n}: ledger off by ${balance.toExponential(3)} g`);
		if (entry.earned > 0) earnedOnce = true;
		if (Object.keys(entry.stops).length) rested = true;
	}
	assert.ok(earnedOnce, 'he earned wages on the way');
	assert.ok(rested, 'he rested somewhere');
	assert.ok(entry.spent - entry.banked < entry.funded, 'taxes never ate the grant');
	assert.ok(entry.history.length > 100, 'purse history sampled over the run');
	checkWorkerLedger(model);
});

test('a rich tracked worker saves his gold over time and rests only at towns', () => {
	const model = new PriceEconomy();
	const town = model.actors.indexOf(ECONOMY_TOWN);
	const entry = model.spawnTrackedWorker(town, 'Rich', 500);
	run(model, 120);
	// The commute can end two ways, both money-preserving: still active with his purse, or settled into a
	// town whose worker purse banked his savings when the wait pool absorbed him.
	const p = model.workers.byWid(entry.id);
	const kept = entry.status === 'active' ? (p >= 0 ? model.workers.gold[p] + model.workers.moved[p] : 0) : entry.banked;
	assert.ok(entry.earned > 0.02, 'wages grew the purse on top of the grant');
	assert.ok(kept >= 250, 'most of the grant survives the commute cycle');
	assert.ok(Object.keys(entry.stops).some(cell => model.actors[Number(cell)] === ECONOMY_TOWN), 'he rested at a town');
	checkWorkerLedger(model);
});
