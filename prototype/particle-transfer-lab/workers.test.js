// Owns: Phase-2 verification of worker particles — dock release, entry wages, wallet-weighted home steering,
// dominated-town release, queue cooling, still docking with carried intent, founding absorption and conservation.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const file of ['simulation.js', 'steering.js', 'particles.js', 'worker-lifecycle.js', 'workers.js', 'track.js', 'actors.js', 'gold.js', 'workforce.js', 'land.js', 'settlement.js']) {
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
	// The honest boot seeds resident stock at the reference town; a blank map clears the pools along
	// with the workers, and the granted-supply counters with them, or the stale seed would break the
	// mass ledgers from tick one (seedTown books emittedDepleted/suppliedLabor for the residents).
	model.labor.fill(0);
	model.depleted.fill(0);
	model.suppliedLabor = model.workedLabor = model.emittedDepleted = model.restedDepleted = 0;
	model.starvedLabor = model.starvedTired = model.births = model.starved = 0;
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
	closeTo(model.totalItem(ITEM_LABOR), model.suppliedLabor - model.workedLabor - model.starvedLabor, 1e-11, model.suppliedLabor);
	closeTo(model.totalItem(ITEM_DEPLETED), model.emittedDepleted - model.restedDepleted - model.starvedTired, 1e-11, model.emittedDepleted);
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
	// Honest-boot magnitudes: the 10 seeded workers churn without any town mint (peak stays at the seeded
	// count until births grow it), 40 s measured: 137 launches, 120 dockings, 1.19 worked, 1.09 rested.
	assert.ok(model.workers.emitted > 80);
	assert.ok(model.workers.arrivals > 80);
	assert.ok(peak >= 10 && peak < WORKER_CAP);
	assert.ok(wallets > 0.05, 'tired walkers carry wages home');
	assert.ok(model.workedLabor > 0.8);
	assert.ok(model.restedDepleted > 0.7);
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

test('workers in a dominated town follow higher home appeal, resting only once they dock there', () => {
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
	closeTo(model.depleted[strong] + model.labor[strong], 3 * WORKER_UNIT, 1e-14);
	// Recovery lives at towns: the road restores nothing, so the tired mass arrives unrested.
	assert.equal(model.restedDepleted, 0);
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
	// Bare tired stock sits at a neighbor cell; the walker carries 0.6 tired from the founding cell.
	// Founding gathers both: the bare 0.3 transfers to the new town and the 0.6 walker is absorbed
	// into room the cell cap (1.0) allows.
	founding.depleted[economyIndex(31, 14)] = 0.3;
	founding.depleted[c] = 0.6;
	founding.workers.emitFrom(STATE_DEPLETED, c, 0.6);
	founding.workers.x[0] = 31.4;
	founding.workers.gold[0] = 0.7;
	founding.money.seeded = 0.7;
	founding.emittedDepleted = 0.9;
	founding.settlements.foundTown(c);
	assert.equal(founding.actors[c], ECONOMY_TOWN);
	// The walker docks as the young town's first resting resident (no despawn — founding gathers people,
	// it never dissolves them); his wallet banks into the household purse.
	assert.equal(founding.workers.count, 1);
	assert.equal(founding.workers.dockCell[0], c);
	closeTo(founding.depleted[c], 0.9, 1e-14);
	closeTo(founding.money.workerPurse[c], 0.7, 1e-14);
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
	const p = model.workers.byWid(entry.id);
	assert.ok(p >= 0, 'rest never dissolves a worker');
	assert.equal(entry.status, 'active');
	assert.equal(entry.banked, 0);
	assert.ok(entry.earned > 0, 'real wages grew the purse on top of the grant');
	assert.ok(model.workers.gold[p] >= 250, 'most of the grant survives the commute cycle');
	assert.ok(Object.keys(entry.stops).some(cell => model.actors[Number(cell)] === ECONOMY_TOWN), 'he rested at a town');
	checkWorkerLedger(model);
});

function consumeWork(model, i, amount) {
	model.labor[i] -= amount;
	model.depleted[i] += amount;
	model.workedLabor += amount;
	model.emittedDepleted += amount;
	model.workers.workAt(i, amount);
}

function untilDocked(model, id, cell) {
	for (let n = 0; n < 600; n++) {
		stepWorkers(model, 1);
		const p = model.workers.byWid(id);
		assert.ok(p >= 0, 'worker object survives');
		if (model.workers.dockCell[p] === cell) return p;
	}
	assert.fail(`worker ${id} did not arrive at ${cell}`);
}

test('50-credit worker commutes, keeps prepaid shift wages, waits for room, pays only his rest fee and commutes again', () => {
	const model = clearedMap();
	const town = economyIndex(10, 14), firm = economyIndex(16, 14);
	model.setActor(town, ECONOMY_TOWN);
	model.setActor(firm, ECONOMY_MINE);
	model.money.purse[firm] = 10;
	model.money.seeded += 10;
	model.laborFlow.cap[firm] = model.depletedFlow.cap[town] = 0.5;
	rampRow(model.priceLabor, 14, 10, 16, 0, (5 / WORKER_UNIT) / 6);
	rampRow(model.priceHome, 14, 10, 16, 7, -1);
	rampRow(model.priceRest, 14, 10, 16, 7, -1);
	const entry = model.spawnTrackedWorker(town, 'Worker1', 50);
	const w = model.workers;
	let p = untilDocked(model, entry.id, firm);
	closeTo(w.gold[p], 55);
	for (let k = 0; k < 6; k++) {
		consumeWork(model, firm, WORKER_UNIT / 6);
		w.syncFromCells();
		assert.equal(w.wid[p], entry.id);
		closeTo(w.amount[p], WORKER_UNIT);
		closeTo(w.gold[p], 55);
	}
	assert.equal(w.state[p], STATE_DEPLETED);
	p = untilDocked(model, entry.id, town);
	model.priceLabor.fill(0);
	const before = w.tired[p];
	assert.equal(model.optimizer.restWorkers(town, 1, model.labor[town]), 0, 'a full fresh dock neither rests nor charges');
	closeTo(w.gold[p], 55);
	closeTo(w.tired[p], before);
	model.optimizer.townRestTax = () => 6 * WORKER_UNIT / (before * REST_TAX_SHARE);
	for (let k = 0; k < 120 && w.state[p] === STATE_DEPLETED; k++) model.optimizer.restWorkers(town, 1, 1);
	assert.equal(w.state[p], STATE_FRESH);
	closeTo(w.gold[p], 49);
	assert.equal(entry.status, 'active');
	assert.equal(entry.banked, 0);
	stepWorkers(model, 1);
	assert.equal(w.dockCell[p], town, 'flat job field leaves the worker independently idle');
	rampRow(model.priceLabor, 14, 10, 16, 0, (5 / WORKER_UNIT) / 6);
	p = untilDocked(model, entry.id, firm);
	closeTo(w.gold[p], 54);
	closeTo(entry.earned, 10);
	closeTo(entry.spent, 6);
	checkWorkerLedger(model);
});

test('untracked workers also keep identity, amount and savings while exhausting and recovering', () => {
	const model = clearedMap();
	const spot = economyIndex(25, 14);
	const w = model.workers;
	const p = w.spawnWalker(STATE_FRESH, spot, WORKER_UNIT, 50);
	const id = w.wid[p];
	model.money.seeded = 50;
	model.suppliedLabor = WORKER_UNIT;
	w.park(p, spot);
	consumeWork(model, spot, WORKER_UNIT);
	w.syncFromCells();
	assert.equal(w.wid[p], id);
	assert.equal(w.state[p], STATE_DEPLETED);
	w.restAt(spot, WORKER_UNIT, 0);
	assert.equal(w.state[p], STATE_FRESH);
	assert.equal(w.wid[p], id);
	closeTo(w.amount[p], WORKER_UNIT);
	closeTo(w.gold[p], 50);
	checkWorkerLedger(model);
});

test('wage debt follows its worker rather than paying a replacement at the firm', () => {
	const model = clearedMap();
	const firm = economyIndex(20, 14);
	model.setActor(firm, ECONOMY_MINE);
	const first = model.spawnTrackedWorker(firm, 'Creditor', 50);
	const next = model.spawnTrackedWorker(firm, 'Replacement', 0);
	const w = model.workers;
	w.park(w.byWid(next.id), firm);
	assert.equal(model.money.payOnEntry(firm, 5, first.id), 0);
	closeTo(model.money.unpaidWages(first.id), 5);
	model.money.purse[firm] = 5;
	model.money.seeded += 5;
	model.money.settle(firm, ECONOMY_MINE);
	closeTo(w.gold[w.byWid(first.id)], 55);
	closeTo(w.gold[w.byWid(next.id)], 0);
	closeTo(first.earned, 5);
	closeTo(model.money.unpaidWages(first.id), 0);
	checkWorkerLedger(model);
});

test('a worker unfed past the starvation budget dies where he stands, leaving his purse and mass exactly', () => {
	const model = clearedMap();
	const town = economyIndex(20, 14);
	model.setActor(town, ECONOMY_TOWN);
	// The town is unsupplied: comfort 0 never clears hunger, so every unfed tick counts toward starvation.
	const w = model.workers;
	const p = w.spawnWalker(STATE_FRESH, town, WORKER_UNIT, 3);
	const id = w.wid[p];
	model.money.seeded += 3;
	model.suppliedLabor = WORKER_UNIT;
	w.park(p, town);
	consumeWork(model, town, WORKER_UNIT / 2);
	w.syncFromCells();
	const tiredBefore = w.tired[p], freshBefore = w.portion(p, STATE_FRESH);
	w.hunger[p] = STARVE_SECONDS;
	const purseBefore = model.money.workerPurse[town];
	model.step();
	assert.equal(w.count, 0, 'the starved worker leaves the world');
	assert.ok(w.byWid(id) < 0);
	assert.equal(model.starved, 1);
	// Shelter rest may shift the split while hunger runs out, but the booked mass equals his whole body.
	closeTo(model.starvedLabor + model.starvedTired, freshBefore + tiredBefore, 1e-12);
	// His purse orphans where he fell and the town inherits it through the household purse.
	assert.ok(model.money.workerPurse[town] > purseBefore);
	checkWorkerLedger(model);
});

test('recovery lives at towns: a funded guest pays the rest fee, a broke guest rests slowly on the shelter floor, both keep their identity', () => {
	const model = clearedMap();
	const spot = economyIndex(25, 14);
	model.setActor(spot, ECONOMY_TOWN);
	const entry = model.spawnTrackedWorker(spot, 'Slow', 50);
	const w = model.workers, p = w.byWid(entry.id);
	w.park(p, spot);
	consumeWork(model, spot, WORKER_UNIT / 2);
	assert.equal(w.state[p], STATE_FRESH);
	// Paid service: the fee comes out of the guest's own purse, the object is never replaced.
	const rested = w.restAt(spot, WORKER_UNIT, 1);
	assert.ok(rested > 0 && rested <= WORKER_UNIT / 2 + 1e-12);
	assert.ok(w.tired[p] < WORKER_UNIT / 2);
	assert.ok(w.gold[p] > 50 - WORKER_UNIT && w.gold[p] < 50, 'the guest paid exactly rested * fee');
	closeTo(w.amount[p], WORKER_UNIT);
	assert.equal(w.wid[p], entry.id);
	checkWorkerLedger(model);

	const broke = clearedMap();
	const home = economyIndex(25, 14);
	broke.setActor(home, ECONOMY_TOWN);
	const poor = broke.spawnTrackedWorker(home, 'Broke', 0);
	const w2 = broke.workers, q = w2.byWid(poor.id);
	w2.park(q, home);
	consumeWork(broke, home, WORKER_UNIT);
	broke.workforce.weighWallets();
	for (let n = 0; n < 2200; n++) broke.workforce.stepStill();
	assert.ok(w2.tired[q] < WORKER_DUST, 'shelter rest completes for broke guests');
	assert.equal(w2.wid[q], poor.id);
	closeTo(w2.gold[q], 0);
	checkWorkerLedger(broke);
});

test('unemployed workers found useful firms only when the selected recipe has resources', () => {
	for (const coal of [0, 0.5]) {
		const model = clearedMap();
		const spot = economyIndex(25, 14), w = model.workers;
		for (let k = 0; k < FACILITY_UNEMPLOY_WORKERS; k++) {
			const p = w.spawnWalker(STATE_FRESH, spot, WORKER_UNIT, 0);
			w.park(p, spot);
			model.suppliedLabor += WORKER_UNIT;
		}
		model.priceCoal.fill(1);
		model.priceGoods.fill(10);
		model.coal[spot] = coal;
		model.producedCoal = coal;
		w.updateUnemployment();
		assert.ok(w.facilityDemand());
		model.ticks = FOUND_FIRM_COOLDOWN_TICKS;
		w.maybeFoundFirm();
		assert.ok(model.actors.includes(coal ? ECONOMY_FACTORY : ECONOMY_MINE));
		checkWorkerLedger(model);
	}
});

test('default 50-credit worker remains alive through repeated real simulation shifts with an exact personal ledger', () => {
	const model = new PriceEconomy();
	const entry = model.spawnTrackedWorker(model.actors.indexOf(ECONOMY_TOWN), 'Worker1', 50);
	let tired = false, rested = false, jobs = 0, lastDock = -1;
	for (let n = 0; n < 90 / ECONOMY_DT; n++) {
		model.step();
		const w = model.workers, p = w.byWid(entry.id);
		assert.ok(p >= 0);
		closeTo(w.amount[p], WORKER_UNIT);
		closeTo(entry.funded + entry.earned - entry.spent, w.gold[p]);
		if (w.state[p] === STATE_DEPLETED) tired = true;
		if (tired && w.state[p] === STATE_FRESH) rested = true;
		if (w.dockCell[p] !== lastDock && w.dockCell[p] >= 0 && w.isFirm(w.dockCell[p])) jobs++;
		lastDock = w.dockCell[p];
	}
	assert.ok(tired && rested && jobs >= 2);
	assert.ok(entry.earned > 0);
	assert.ok(entry.spent > 0);
	assert.equal(entry.status, 'active');
	assert.equal(entry.banked, 0);
	assert.ok(Object.values(entry.stops).some(stop => stop.tax > 0));
	checkWorkerLedger(model);
});

test('broke workers can finish shelter recovery at a town without inventing wages, tax or a bank deposit', () => {
	const model = clearedMap();
	const town = economyIndex(20, 14);
	model.setActor(town, ECONOMY_TOWN);
	const w = model.workers;
	const p = w.spawnWalker(STATE_DEPLETED, town, WORKER_UNIT, 0);
	model.emittedDepleted = WORKER_UNIT;
	w.park(p, town);
	model.workforce.weighWallets();
	for (let n = 0; n < 2200; n++) model.workforce.stepStill();
	assert.equal(w.state[p], STATE_FRESH);
	assert.equal(w.gold[p], 0);
	assert.equal(model.money.taxes, 0);
	checkWorkerLedger(model);
});

test('a tired worker docks at a town only while its rest cell has room, without charging the outside queue', () => {
	const model = clearedMap();
	const town = economyIndex(20, 14);
	model.setActor(town, ECONOMY_TOWN);
	model.priceHome.fill(1);
	model.priceRest.fill(1);
	model.depleted[town] = model.depletedFlow.cap[town] - WORKER_UNIT / 2;
	const w = model.workers, p = w.spawnWalker(STATE_DEPLETED, town, WORKER_UNIT, 50);
	const id = w.wid[p];
	model.emittedDepleted = WORKER_UNIT;
	model.money.seeded += 50;
	stepWorkers(model, 1);
	assert.equal(w.dockCell[p], -1);
	assert.ok(w.queuedAt(town) > 0);
	closeTo(w.gold[p], 50);
	assert.equal(model.money.taxes, 0);
	model.depleted[town] = 0;
	stepWorkers(model, 1);
	assert.equal(w.dockCell[p], town);
	assert.equal(w.wid[p], id);
	closeTo(w.gold[p], 50);
	checkWorkerLedger(model);
});
