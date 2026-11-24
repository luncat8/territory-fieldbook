// Owns: regression checks for still-worker shelter rest, hamlet founding without minted gold and tier growth.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const file of ['simulation.js', 'actors.js', 'gold.js', 'workforce.js', 'settlement.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

const sum = (values) => values.reduce((total, value) => total + value, 0);
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≠ ${expected}`);
const towns = (model) => model.actors.filter((kind) => kind === ECONOMY_TOWN).length;

function run(model, seconds) {
	for (let n = 0; n < Math.round(seconds / ECONOMY_DT); n++) model.step();
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

test('gathered tired workers beyond town reach found a hamlet with their own savings', () => {
	const model = emptyMap();
	strand(model, 20, 14, 0.4, 0.5);
	const savings = 9 * 0.5;
	run(model, 6);
	assert.equal(towns(model), 1);
	const hamlet = model.actors.indexOf(ECONOMY_TOWN);
	assert.ok(model.settlements.isHamlet(hamlet));
	assert.ok(model.pop[hamlet] <= model.settlements.popCap(hamlet) + 1e-9);
	assert.equal(model.money.mined, 0);
	assert.ok(model.money.held(hamlet) + model.workerGoldAt(hamlet) <= savings + 1e-9);
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

test('fresh labor waiting for work never founds a hamlet', () => {
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

test('a hamlet fells forest up to half tier, then only comfort lifts it', () => {
	const model = emptyMap();
	strand(model, 20, 14, 0.4, 0.5);
	run(model, 6);
	const hamlet = model.actors.indexOf(ECONOMY_TOWN);
	const forest = model.settlements.sumAround(model.settlements.forest, hamlet);
	run(model, 60);
	const tier = model.settlements.tier[hamlet];
	assert.ok(model.settlements.felled > 0);
	assert.ok(model.settlements.sumAround(model.settlements.forest, hamlet) < forest);
	assert.ok(tier > 0.2 && tier <= WOOD_TIER_CAP + 1e-9, `tier ${tier}`);
	assert.ok(model.settlements.restFactor(hamlet) < 1 && model.settlements.taxFactor(hamlet) < 1);
	goldBalanced(model);
});
