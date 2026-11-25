// Owns: regression checks for still-worker shelter rest, settle intent, land-aware young-town founding without minted gold and tier growth.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const file of ['simulation.js', 'actors.js', 'towns.js', 'gold.js', 'workforce.js', 'land.js', 'settlement.js', 'harvest.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

const sum = (values) => values.reduce((total, value) => total + value, 0);
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≠ ${expected}`);
const towns = (model) => model.actors.filter((kind) => kind === ECONOMY_TOWN).length;

function run(model, seconds) {
	for (let n = 0; n < Math.round(seconds / ECONOMY_DT); n++) model.step();
}

// Rule checks run on an even woodland so town placement never picks up a terrain bonus, desert or bare ground.
function neutralLand(model) {
	model.land.terrain.fill(TERRAIN_FOREST);
	model.land.refresh();
	model.settlements.forestCap.fill(FOREST_TERRAIN);
	model.settlements.forest.fill(FOREST_TERRAIN);
}

function emptyMap() {
	const model = new PriceEconomy();
	model.actors.fill(0);
	model.pop.fill(0);
	model.scale.fill(0);
	model.taxMult.fill(0);
	model.laborFlow.gold.fill(0);
	model.depletedFlow.gold.fill(0);
	model.money.reset();
	model.settlements.reset();
	neutralLand(model);
	return model;
}

// Strands a block of tired workers with wallets; the gold enters the seeded total so the ledger stays exact.
function strand(model, cx, cy, amount, gold, stream = 'depleted') {
	const stock = stream === 'depleted' ? model.depleted : model.labor;
	const flow = stream === 'depleted' ? model.depletedFlow : model.laborFlow;
	for (let y = cy - 1; y <= cy + 1; y++) {
		for (let x = cx - 1; x <= cx + 1; x++) {
			const i = economyIndex(x, y);
			stock[i] += amount;
			flow.gold[i] += gold;
			model.money.seeded += gold;
			if (stream === 'depleted') model.emittedDepleted += amount;
			else model.suppliedLabor += amount;
		}
	}
}

function goldBalanced(model) {
	closeTo(model.money.total(), model.money.seeded + model.money.mined);
	closeTo(sum(model.depleted), model.emittedDepleted - model.restedDepleted);
	closeTo(sum(model.labor), model.suppliedLabor - model.workedLabor);
}

test('gathered tired workers beyond town reach found a young town with their own savings', () => {
	const model = emptyMap();
	strand(model, 20, 14, 0.4, 0.5);
	const savings = 9 * 0.5;
	run(model, 6);
	assert.equal(towns(model), 1);
	const young = model.actors.indexOf(ECONOMY_TOWN);
	assert.ok(model.settlements.isYoungTown(young));
	assert.ok(model.pop[young] <= model.settlements.popCap(young) + 1e-9);
	assert.equal(model.money.mined, 0);
	assert.ok(model.money.held(young) + model.workerGoldAt(young) <= savings + 1e-9);
	goldBalanced(model);
});

test('a few tired workers only rest slowly where they stand', () => {
	const model = emptyMap();
	const i = economyIndex(20, 14);
	model.depleted[i] = 0.05;
	model.emittedDepleted = 0.05;
	run(model, 1);
	assert.equal(towns(model), 0);
	assert.ok(model.labor[i] > 0 && model.depleted[i] > 0.01);
	goldBalanced(model);
});

test('fresh labor waiting for work never founds a young town', () => {
	const model = emptyMap();
	strand(model, 20, 14, 0.4, 0.5, 'labor');
	run(model, 6);
	assert.equal(towns(model), 0);
	goldBalanced(model);
});

test('tired workers inside a town home field go home instead of founding', () => {
	const model = emptyMap();
	const town = economyIndex(24, 14);
	model.setActor(town, ECONOMY_TOWN);
	run(model, 4);
	strand(model, 21, 14, 0.3, 0.3);
	run(model, 8);
	assert.equal(towns(model), 1);
	assert.equal(model.settlements.founded, 0);
});

function forestAround(model, c) {
	let total = 0;
	for (let i = 0; i < ECONOMY_SIZE; i++) {
		if (Math.abs(i % ECONOMY_WIDTH - c % ECONOMY_WIDTH) <= HARVEST_RADIUS && Math.abs(Math.floor(i / ECONOMY_WIDTH) - Math.floor(c / ECONOMY_WIDTH)) <= HARVEST_RADIUS) total += model.settlements.forest[i];
	}
	return total;
}

test('a young town builds from wood its residents harvest, up to half tier, then only comfort lifts it', () => {
	const model = emptyMap();
	strand(model, 20, 14, 0.4, 0.5);
	run(model, 6);
	const young = model.actors.indexOf(ECONOMY_TOWN);
	const forest = forestAround(model, young);
	run(model, 60);
	const tier = model.settlements.tier[young];
	assert.ok(model.harvest.harvestedWood > 0 && model.harvest.builtWood > 0);
	assert.ok(forestAround(model, young) < forest);
	assert.ok(tier > 0.2 && tier <= WOOD_TIER_CAP + 1e-9, `tier ${tier}`);
	assert.ok(model.settlements.restFactor(young) < 1 && model.settlements.taxFactor(young) < 1);
	goldBalanced(model);
});

const distance = (a, b) => Math.hypot(a % ECONOMY_WIDTH - b % ECONOMY_WIDTH, Math.floor(a / ECONOMY_WIDTH) - Math.floor(b / ECONOMY_WIDTH));

function paintTerrain(model, kind, x0, x1) {
	for (let y = 0; y < ECONOMY_HEIGHT; y++) {
		for (let x = x0; x <= x1; x++) model.land.terrain[economyIndex(x, y)] = kind;
	}
	model.land.refresh();
}

test('the same few settlers found on meadow but not in the desert', () => {
	const desert = emptyMap(), meadow = emptyMap();
	paintTerrain(desert, TERRAIN_DESERT, 0, ECONOMY_WIDTH - 1);
	paintTerrain(meadow, TERRAIN_MEADOW, 0, ECONOMY_WIDTH - 1);
	for (const model of [desert, meadow]) {
		strand(model, 20, 14, 0.12, 0.05);
		run(model, 6);
	}
	assert.equal(towns(desert), 0);
	assert.equal(towns(meadow), 1);
	goldBalanced(desert);
	goldBalanced(meadow);
});

test('a still worker rests slower in the desert than on meadow', () => {
	const rested = (kind) => {
		const model = emptyMap();
		paintTerrain(model, kind, 0, ECONOMY_WIDTH - 1);
		const i = economyIndex(20, 14);
		model.depleted[i] = 0.05;
		model.emittedDepleted = 0.05;
		run(model, 1);
		goldBalanced(model);
		return model.restedDepleted;
	};
	assert.ok(rested(TERRAIN_DESERT) < 0.6 * rested(TERRAIN_MEADOW));
});

test('settlers beside a mine found their town on the far side, away from its wasteland', () => {
	const model = emptyMap();
	const mine = economyIndex(20, 14);
	model.setActor(mine, ECONOMY_MINE);
	strand(model, 22, 14, 0.4, 0.5);
	run(model, 6);
	assert.equal(towns(model), 1);
	const town = model.actors.indexOf(ECONOMY_TOWN);
	assert.ok(distance(town, mine) > 2, `town ${distance(town, mine)} cells from the mine`);
	assert.ok(model.land.rest[town] > model.land.rest[economyIndex(22, 14)]);
	goldBalanced(model);
});

test('a town claims the land around it; removing it frees the site again', () => {
	const model = emptyMap();
	const town = economyIndex(24, 14), near = economyIndex(27, 14), far = economyIndex(40, 14);
	const before = model.land.site[near];
	model.setActor(town, ECONOMY_TOWN);
	assert.equal(model.land.site[town], 0);
	assert.ok(model.land.site[near] < 0.6 * model.land.site[far]);
	model.setActor(town, 0);
	closeTo(model.land.site[near], before);
});

test('settle intent travels with walking workers and mixes by headcount', () => {
	const model = emptyMap();
	const a = economyIndex(20, 14), b = economyIndex(21, 14);
	model.depleted[a] = 0.6;
	model.depleted[b] = 0.2;
	model.depletedFlow.intent[a] = 1;
	model.depletedFlow.intent[b] = 0.25;
	const carried = () => sum(Array.from(model.depleted, (amount, i) => amount * model.depletedFlow.intent[i]));
	const total = carried();
	for (let n = 0; n < 30; n++) model.transport(model.depletedFlow, model.depleted, model.priceHome, model.priceRest);
	closeTo(carried(), total);
	assert.ok(model.depletedFlow.intent[b] > 0.25 && model.depletedFlow.intent[a] <= 1);
});
