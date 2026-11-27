// Owns: town settlement, forest-felling tier build and sweat-equity firm founding tests.
// Edit for: zero-gold town/firm founding rules, garden plot protection and construction completion.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPTS = ['simulation.js', 'land.js', 'steering.js', 'forage.js', 'gold.js', 'goods.js', 'workforce.js', 'workers.js', 'worker-life.js', 'farms.js', 'actors.js', 'towns.js', 'settlement.js', 'founding.js', 'track.js'];
for (const file of SCRIPTS) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

function run(model, seconds) {
	for (let n = 0; n < Math.round(seconds / ECONOMY_DT); n++) model.step();
}

test('clearing towns causes tired workers to gather, found a young town and build tier without minting gold', () => {
	const model = new PriceEconomy();
	run(model, 8);
	model.clearTowns();
	for (let w = 0; w < model.workers.count; w++) {
		model.workers.tired[w] = 1;
		model.workers.setState(w, WORKER_WALK_HOME);
	}
	const goldBefore = model.money.seeded + model.money.mined;
	run(model, 45);
	let towns = 0;
	for (let i = 0; i < ECONOMY_SIZE; i++) if (model.actors[i] === ECONOMY_TOWN) towns++;
	assert.ok(towns >= 1, `expected tired workers to found at least 1 town, got ${towns}`);
	assert.ok(model.settlements.founded >= 1);
	assert.ok(Math.abs(model.money.seeded + model.money.mined - model.money.total()) < 1e-7, 'town founding must not mint gold');
	assert.ok(model.money.total() >= goldBefore - 1e-7);
});

test('forest regrowth skips tilled Monastery garden plots', () => {
	const model = new PriceEconomy();
	const gardenCell = economyIndex(19, 15);
	assert.equal(model.actors[gardenCell], ECONOMY_GARDEN);
	assert.ok(model.forage.plotCount(gardenCell) >= 4, 'Monastery garden should claim surrounding farm plots');
	const tag = gardenCell + 1;
	const before = new Float64Array(ECONOMY_SIZE);
	for (let i = 0; i < ECONOMY_SIZE; i++) {
		if (model.forage.plotOwner[i] === tag) before[i] = model.settlements.forest[i];
	}
	run(model, 25);
	for (let i = 0; i < ECONOMY_SIZE; i++) {
		if (model.forage.plotOwner[i] === tag) {
			assert.ok(model.settlements.forest[i] <= before[i] + 1e-9, `garden plot ${i} must not regrow wild forest over crops`);
		}
	}
});

test('idle fresh workers found and complete a sweat-equity coal mine on a coal deposit without minting gold', () => {
	const model = new PriceEconomy();
	for (let i = 0; i < ECONOMY_SIZE; i++) if (model.actors[i]) model.setActor(i, 0);
	model.workers.reset();
	model.money.reset();
	const townCell = economyIndex(12, 9);
	const factoryCell = economyIndex(9, 8);
	model.setActor(townCell, ECONOMY_TOWN);
	model.setActor(factoryCell, ECONOMY_FACTORY);
	model.money.seedFirm(factoryCell);
	let depositCell = -1;
	for (let y = 5; y <= 11 && depositCell < 0; y++) {
		for (let x = 5; x <= 11 && depositCell < 0; x++) {
			const c = economyIndex(x, y);
			if (model.founding.deposit[c] && model.land.terrain[c] !== TERRAIN_WATER && !model.actors[c]) depositCell = c;
		}
	}
	assert.ok(depositCell >= 0, 'expected a walkable coal deposit cell near factory');
	const dx = (depositCell % ECONOMY_WIDTH) + 0.5, dy = Math.floor(depositCell / ECONOMY_WIDTH) + 0.5;
	for (let n = 0; n < 8; n++) {
		model.workers.spawn(dx, dy, WORKER_STILL, 0, 2, 0.95, true);
		model.money.seedWorker(2);
	}
	run(model, 30);
	assert.ok(model.founding.founded >= 1, `expected idle fresh workers to found at least 1 firm, got ${model.founding.founded}`);
	assert.ok(model.founding.completed >= 1, `expected founders to finish sweat-equity construction, got ${model.founding.completed}`);
	let mines = 0;
	for (let i = 0; i < ECONOMY_SIZE; i++) if (model.actors[i] === ECONOMY_MINE) mines++;
	assert.ok(mines >= 1, 'expected founded firm to be a coal mine');
	assert.ok(Math.abs(model.money.seeded + model.money.mined - model.money.total()) < 1e-7, 'firm founding must not mint gold');
});
