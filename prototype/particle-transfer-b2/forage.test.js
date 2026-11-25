// Owns: unsupplied-town self-foraging survival, coarse food gradient and Monastery garden tests.
// Edit for: WORKER_FORAGE isolation, low-res gradient cadence and free charity farm mechanics.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPTS = ['simulation.js', 'land.js', 'steering.js', 'forage.js', 'gold.js', 'goods.js', 'workforce.js', 'workers.js', 'worker-life.js', 'farms.js', 'actors.js', 'towns.js', 'settlement.js', 'founding.js'];
for (const file of SCRIPTS) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

function run(model, seconds) {
	for (let n = 0; n < Math.round(seconds / ECONOMY_DT); n++) model.step();
}

test('hungry workers survive unsupplied towns by self-foraging and return to work', () => {
	const model = new PriceEconomy();
	for (let i = 0; i < ECONOMY_SIZE; i++) {
		if (model.actors[i] === ECONOMY_FACTORY) model.setActor(i, 0);
	}
	const initialHeadcount = model.workers.totalAmount();
	run(model, 70);
	assert.equal(model.workers.totalAmount(), initialHeadcount + model.workers.births, 'workers with reachable food survive this run');
	assert.ok(model.workers.forageEntries >= initialHeadcount, `expected hungry workers to enter forage mode, got ${model.workers.forageEntries}`);
	assert.ok(model.forage.gardenFed + model.forage.wildPicked > 10, 'expected substantial self-picked food across garden and wild sources');
	assert.ok(Math.abs(model.money.seeded + model.money.mined - model.money.total()) < 1e-7, 'gold remains strictly conserved during foraging');
});

test('WORKER_FORAGE mode is undisturbed by firm hiring, town rooms and founding tasks until food bag is full', () => {
	const model = new PriceEconomy();
	for (let i = 0; i < ECONOMY_SIZE; i++) if (model.actors[i]) model.setActor(i, 0);
	model.workers.reset();
	model.money.reset();
	const mineCell = economyIndex(19, 14);
	const townCell = economyIndex(21, 14);
	model.setActor(mineCell, ECONOMY_MINE);
	model.setActor(townCell, ECONOMY_TOWN);
	model.money.seedFirm(mineCell);
	for (let n = 0; n < 60; n++) model.updatePrices();
	const w = model.workers.spawn(19.5, 14.5, WORKER_WALK_JOB, 0, 5, 0.02, true);
	model.money.seedWorker(5);
	model.step();
	assert.equal(model.workers.state[w], WORKER_FORAGE, 'hungry worker on hiring firm cell must enter WORKER_FORAGE instead of taking shift');
	assert.equal(model.shiftCount[mineCell], 0, 'foraging worker must not occupy firm shift');
	assert.equal(model.poolCount[mineCell], 0, 'foraging worker must not occupy firm pool');
	for (let t = 0; t < 20; t++) {
		model.step();
		if (model.workers.food[w] < FOOD_FULL) {
			assert.equal(model.workers.state[w], WORKER_FORAGE, 'foraging worker must remain undisturbed before FOOD_FULL');
		}
	}
});

test('coarse 24x14 food gradient updates on 4-tick stride, stays zero on water and peaks near shorelines/gardens', () => {
	const model = new PriceEconomy();
	assert.equal(model.forage.cw, 24);
	assert.equal(model.forage.ch, 14);
	const updates0 = model.forage.coarseUpdates;
	for (let t = 0; t < 40; t++) model.step();
	const deltaUpdates = model.forage.coarseUpdates - updates0;
	assert.equal(deltaUpdates, 10, 'coarse food gradient must update once every FORAGE_STRIDE=4 ticks');
	const gradView = model.forage.buildGradientView();
	let shoreMean = 0, shoreCount = 0, desertMean = 0, desertCount = 0;
	for (let i = 0; i < ECONOMY_SIZE; i++) {
		if (model.land.terrain[i] === TERRAIN_WATER) {
			assert.equal(gradView[i], 0, 'water cell must have zero forage gradient');
			continue;
		}
		if (model.land.waterEdge[i] || model.actors[i] === ECONOMY_GARDEN) {
			shoreMean += gradView[i];
			shoreCount++;
		} else if (model.land.terrain[i] === TERRAIN_DESERT) {
			desertMean += gradView[i];
			desertCount++;
		}
	}
	assert.ok(shoreMean / shoreCount > desertMean / Math.max(1, desertCount), `food gradient must be higher at shorelines/gardens (${shoreMean / shoreCount}) than dry desert (${desertMean / desertCount})`);
});

test('Monastery garden farms surrounding plots seasonally and feeds penniless workers for zero gold', () => {
	const model = new PriceEconomy();
	for (let i = 0; i < ECONOMY_SIZE; i++) if (model.actors[i]) model.setActor(i, 0);
	model.workers.reset();
	model.money.reset();
	const gardenCell = economyIndex(19, 15);
	assert.equal(model.setActor(gardenCell, ECONOMY_GARDEN), true);
	model.forage.gardenStock[gardenCell] = 0;
	const grownBefore = model.forage.gardenGrown;
	run(model, 14);
	assert.ok(model.forage.gardenGrown > grownBefore, 'Monastery garden should harvest seasonal crops from surrounding plots');
	assert.ok(model.forage.gardenStock[gardenCell] > 0, 'Monastery garden stock should refill from seasonal harvest');
	const w = model.workers.spawn(19.5, 15.5, WORKER_WALK_JOB, 0, 0, 0.01, true);
	run(model, 6);
	assert.ok(model.forage.gardenFed > 0, 'penniless worker should receive free food from Monastery garden');
	assert.ok(model.workers.food[w] > 0.5, 'worker food bag should refill at Monastery garden');
	assert.equal(model.money.total(), 0, 'Monastery garden charity food must neither cost nor mint gold');
});
