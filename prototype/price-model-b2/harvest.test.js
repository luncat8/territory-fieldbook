// Owns: regression checks for the land build ladder, water barriers, settlement harvesting, food/wood needs,
// founding without moving fresh labor, and the consumption litter/CO2 ledger.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const file of ['simulation.js', 'actors.js', 'towns.js', 'gold.js', 'workforce.js', 'land.js', 'settlement.js', 'harvest.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

const sum = (values) => values.reduce((total, value) => total + value, 0);
const closeTo = (actual, expected, eps = 1e-7) => assert.ok(Math.abs(actual - expected) < eps, `${actual} ≠ ${expected}`);

function run(model, seconds, each) {
	for (let n = 0; n < Math.round(seconds / ECONOMY_DT); n++) {
		if (each) each();
		model.step();
	}
}

function emptyMap(terrain = TERRAIN_FOREST, forest = FOREST_TERRAIN) {
	const model = new PriceEconomy();
	model.actors.fill(0);
	model.pop.fill(0);
	model.scale.fill(0);
	model.taxMult.fill(0);
	model.laborFlow.gold.fill(0);
	model.depletedFlow.gold.fill(0);
	model.land.terrain.fill(terrain);
	model.land.refresh();
	model.settlements.forestCap.fill(forest);
	model.money.reset();
	model.land.reset();
	model.settlements.reset();
	model.harvest.reset();
	return model;
}

function harvestBalanced(model) {
	const h = model.harvest;
	closeTo(sum(h.food), h.seededFood + h.harvestedFood - h.eatenFood);
	closeTo(sum(h.wood), h.seededWood + h.harvestedWood - h.usedWood - h.builtWood);
	closeTo(model.money.total(), model.money.seeded + model.money.mined);
	closeTo(sum(model.labor), model.suppliedLabor - model.workedLabor);
}

test('the default map ranks building ground: shore, glade, meadow, hills, forest, swamp edge, swamp', () => {
	const { land } = new PriceEconomy();
	const best = (pick) => {
		let value = -1;
		for (let i = 0; i < ECONOMY_SIZE; i++) if (pick(i)) value = Math.max(value, land.build[i]);
		return value;
	};
	const t = land.terrain;
	const shore = best((i) => land.waterEdge[i] && t[i] === TERRAIN_MEADOW && land.build[i] === SHORE_BUILD);
	const glade = best((i) => land.build[i] === GLADE_BUILD);
	const order = [shore, glade, TERRAIN_BUILD[TERRAIN_MEADOW], TERRAIN_BUILD[TERRAIN_HILLS], TERRAIN_BUILD[TERRAIN_FOREST], MARSH_EDGE_BUILD, TERRAIN_BUILD[TERRAIN_SWAMP]];
	for (let k = 1; k < order.length; k++) assert.ok(order[k - 1] > order[k], `rank ${k}: ${order[k - 1]} ≤ ${order[k]}`);
	for (const kind of [TERRAIN_WATER, TERRAIN_HILLS, TERRAIN_SWAMP]) assert.ok(t.includes(kind), TERRAIN_NAMES[kind]);
	assert.ok(shore > 0 && glade > 0);
	assert.ok(land.foodCap.some((cap, i) => land.waterEdge[i] && cap === SHORE_FOOD));
});

test('a shore town gets more housing than a forest town, and settlers prefer the shore', () => {
	const model = new PriceEconomy();
	const { land } = model;
	const shore = land.build.indexOf(SHORE_BUILD), forest = land.build.indexOf(TERRAIN_BUILD[TERRAIN_FOREST]);
	assert.equal(land.terrain[forest], TERRAIN_FOREST);
	assert.ok(land.housing(shore) > land.housing(forest));
	assert.ok(land.site[shore] > 1.5 * land.site[forest]);
	model.setActor(shore, ECONOMY_TOWN);
	model.setActor(forest, ECONOMY_TOWN);
	assert.ok(model.settlements.popCap(shore) > model.settlements.popCap(forest) * 1.3);
});

test('water blocks every flow and cannot hold an actor', () => {
	const model = new PriceEconomy();
	const water = model.land.terrain.indexOf(TERRAIN_WATER);
	assert.equal(model.setActor(water, ECONOMY_TOWN), false);
	run(model, 20);
	for (let k = 0; k < model.land.waterCount; k++) {
		const i = model.land.water[k];
		assert.equal(model.coal[i] + model.goods[i] + model.labor[i] + model.depleted[i] + model.harvest.food[i] + model.harvest.wood[i], 0);
		assert.equal(model.land.site[i], 0);
	}
});

test('an unsupplied town feeds itself by harvesting wild food, which walks home over the map', () => {
	const model = emptyMap();
	const town = economyIndex(24, 14);
	model.setActor(town, ECONOMY_TOWN);
	let carried = 0;
	run(model, 40, () => {
		for (let i = 0; i < ECONOMY_SIZE; i++) if (i !== town) carried = Math.max(carried, model.harvest.food[i]);
	});
	assert.ok(model.harvest.harvestedFood > 1, `harvested ${model.harvest.harvestedFood}`);
	assert.ok(carried > 0, 'harvest lands on picked cells before reaching the town');
	assert.ok(!model.harvest.hungry(town) && model.harvest.satFood[town] > 0.8);
	assert.ok(model.harvest.eatenFood > 0.9 * model.pop[town] * FOOD_NEED * 40 * 0.8);
	assert.equal(model.depleted[town], 0, 'household harvest never queues for paid rest');
	harvestBalanced(model);
});

test('without wild food a town goes hungry and shrinks; with it the same town holds its size', () => {
	const fed = emptyMap(TERRAIN_FOREST), bare = emptyMap(TERRAIN_DESERT, 0);
	const town = economyIndex(24, 14);
	for (const model of [fed, bare]) {
		model.setActor(town, ECONOMY_TOWN);
		model.wealthClass[town] = WEALTH_MED;
		run(model, 120);
		harvestBalanced(model);
	}
	assert.ok(bare.harvest.hungry(town));
	assert.ok(!fed.harvest.hungry(town));
	assert.ok(bare.pop[town] < START_POP - 0.5, `bare pop ${bare.pop[town]}`);
	assert.ok(fed.pop[town] >= START_POP - 0.01, `fed pop ${fed.pop[town]}`);
});

test('a supplied town grows only as fast as harvested wood allows', () => {
	const grow = (forest) => {
		const model = emptyMap(TERRAIN_MEADOW, forest);
		const town = economyIndex(24, 14);
		model.setActor(town, ECONOMY_TOWN);
		model.wealthClass[town] = WEALTH_CHEAP;
		run(model, 40, () => {
			model.coal[town] = 0.4;
			model.goods[town] = 0.7;
			model.producedCoal = model.burnedCoal + sum(model.coal);
			model.producedGoods = model.consumedGoods + sum(model.goods);
		});
		harvestBalanced(model);
		return model.pop[town] - START_POP;
	};
	const wooded = grow(0.6), treeless = grow(0);
	assert.ok(wooded > 2, `wooded grew ${wooded}`);
	assert.ok(treeless < wooded * 0.5, `treeless grew ${treeless} vs ${wooded}`);
	assert.ok(treeless * WOOD_PER_POP <= 0.6, 'only seeded wood paid for treeless growth');
});

test('founding turns gathered tired settlers into residents but leaves nearby fresh labor where it stands', () => {
	const model = emptyMap();
	const c = economyIndex(20, 14);
	for (let y = 13; y <= 15; y++) {
		for (let x = 19; x <= 21; x++) {
			model.depleted[economyIndex(x, y)] = 0.4;
			model.emittedDepleted += 0.4;
		}
	}
	const fresh = economyIndex(22, 14);
	model.labor[fresh] = 0.3;
	model.suppliedLabor += 0.3;
	model.settlements.foundTown(c);
	assert.equal(model.actors[c], ECONOMY_TOWN);
	closeTo(model.labor[fresh], 0.3);
	closeTo(model.pop[c], Math.min(model.settlements.popCap(c), 9 * 0.4 * SETTLER_POP));
});

test('consumption leaves CO2 and litter that the land slowly heals once the town is gone', () => {
	const model = new PriceEconomy();
	run(model, 40);
	const { land } = model;
	assert.ok(land.co2 > 0.5 * model.burnedCoal, 'burned coal mostly ends as CO2');
	assert.ok(land.littered > 0 && land.used > land.co2 + land.littered);
	closeTo(land.litterHeld(), land.littered - land.recovered, 1e-9);
	assert.ok(land.litter.every((d) => d >= 0 && d < 0.2));
	for (let i = 0; i < ECONOMY_SIZE; i++) if (model.actors[i]) model.setActor(i, 0);
	const held = land.litterHeld();
	run(model, 20);
	assert.ok(land.litterHeld() < 0.6 * held, `litter ${land.litterHeld()} of ${held}`);
	closeTo(land.litterHeld(), land.littered - land.recovered, 1e-9);
});
