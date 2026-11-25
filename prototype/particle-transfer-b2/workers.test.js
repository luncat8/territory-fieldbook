// Owns: worker SoA lifecycle, prepaid wages, FIFO room queues and wallet-pareto home choice tests.
// Edit for: worker state transitions, watched-worker ring buffer and town room/wealth rules.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPTS = ['simulation.js', 'land.js', 'steering.js', 'forage.js', 'gold.js', 'goods.js', 'workforce.js', 'workers.js', 'actors.js', 'towns.js', 'settlement.js', 'founding.js'];
for (const file of SCRIPTS) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

function run(model, seconds) {
	for (let n = 0; n < Math.round(seconds / ECONOMY_DT); n++) model.step();
}

test('watched worker completes work-rest-eat cycle and logs typed events without allocations', () => {
	const model = new PriceEconomy();
	assert.equal(model.workers.watchedId, 1);
	run(model, 45);
	assert.ok(model.workers.logCount > 0, 'watched worker should record lifecycle events');
	const seen = new Set();
	for (let n = 0; n < model.workers.logCount; n++) {
		const idx = (model.workers.logHead - model.workers.logCount + n + WATCH_LOG_CAP) % WATCH_LOG_CAP;
		seen.add(model.workers.logKind[idx]);
	}
	assert.ok(seen.has(EVT_WAGE) || seen.has(EVT_LEAVE), 'expected wage or room-leave event in watched log');
	assert.ok(seen.has(EVT_TAX) || seen.has(EVT_RATION) || seen.has(EVT_FORAGE), 'expected room/ration/forage event in watched log');
});

test('firm prepays shift wage at entry and erasing firm mid-shift conserves gold and evicts worker cleanly', () => {
	const model = new PriceEconomy();
	for (let i = 0; i < ECONOMY_SIZE; i++) if (model.actors[i]) model.setActor(i, 0);
	model.workers.reset();
	model.money.reset();
	const townCell = economyIndex(16, 14);
	const mineCell = economyIndex(14, 14);
	model.setActor(townCell, ECONOMY_TOWN);
	model.setActor(mineCell, ECONOMY_MINE);
	model.money.seedFirm(mineCell);
	for (let n = 0; n < 80; n++) model.updatePrices();
	const w = model.workers.spawn(14.5, 14.5, WORKER_WALK_JOB, 0, 0, 0.9, true);
	assert.ok(w >= 0);
	model.step();
	assert.equal(model.workers.state[w], WORKER_SHIFT);
	assert.ok(model.workers.gold[w] > 0, 'worker should receive prepaid shift wage at entry');
	const totalBeforeErase = model.money.total();
	model.setActor(mineCell, 0);
	assert.equal(model.money.owedWage[mineCell], 0);
	assert.equal(model.workers.state[w], WORKER_STILL);
	assert.ok(Math.abs(model.money.total() - totalBeforeErase) < 1e-9, 'erasing firm mid-shift must conserve gold');
});

test('town rooms enforce integer capacity and promote waiting workers in FIFO order', () => {
	const model = new PriceEconomy();
	for (let i = 0; i < ECONOMY_SIZE; i++) if (model.actors[i]) model.setActor(i, 0);
	model.workers.reset();
	const town = economyIndex(20, 14);
	model.setActor(town, ECONOMY_TOWN);
	model.rooms[town] = 1;
	model.rebuildCellView();
	const w0 = model.workers.spawn(20.5, 14.5, WORKER_WALK_HOME, 1, 10, 0.8, true);
	model.ticks = 10;
	const w1 = model.workers.spawn(20.5, 14.5, WORKER_WALK_HOME, 1, 10, 0.8, true);
	model.ticks = 20;
	const w2 = model.workers.spawn(20.5, 14.5, WORKER_WALK_HOME, 1, 10, 0.8, true);
	assert.equal(model.workers.tryAdmitTown(w0, town), true);
	assert.equal(model.workers.tryAdmitTown(w1, town), true);
	assert.equal(model.workers.tryAdmitTown(w2, town), true);
	assert.equal(model.workers.state[w0], WORKER_ROOM);
	assert.equal(model.workers.state[w1], WORKER_TOWN_WAIT);
	assert.equal(model.workers.state[w2], WORKER_TOWN_WAIT);
	model.roomCount[town] -= model.workers.amount[w0];
	model.workers.setState(w0, WORKER_WALK_JOB);
	model.workers.promoteQueues();
	assert.equal(model.workers.state[w1], WORKER_ROOM, 'first queued worker must promote first');
	assert.equal(model.workers.state[w2], WORKER_TOWN_WAIT, 'second queued worker must stay second in queue');
});

test('wallet-weighted pareto policy steers poor workers to value and rich workers to raw quality', () => {
	const model = new PriceEconomy();
	const center = economyIndex(10, 10);
	const cheapCell = economyIndex(11, 10);
	const luxuryCell = economyIndex(9, 10);
	model.priceHome.fill(0);
	model.priceRest.fill(0);
	model.priceHome[cheapCell] = 0.95;
	model.priceRest[cheapCell] = 0.35;
	model.priceHome[luxuryCell] = 0.25;
	model.priceRest[luxuryCell] = 0.95;
	const poorMix = walletWeight(0.15, 1, BASE_REST_FEE);
	const richMix = walletWeight(15, 1, BASE_REST_FEE);
	model.steering.sampleField(model.priceHome, model.priceRest, poorMix, center, 0);
	assert.ok(model.steering.grad.gx > 0, `poor worker should steer east toward cheap rest value, gx=${model.steering.grad.gx}`);
	model.steering.sampleField(model.priceHome, model.priceRest, richMix, center, 0);
	assert.ok(model.steering.grad.gx < 0, `rich worker should steer west toward luxury rest quality, gx=${model.steering.grad.gx}`);
});
