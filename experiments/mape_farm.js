// owns: farm gates — sawmill-rule clearing, build self-pay, crew-sized need, batch harvest, waste ring
// run: node experiments/mape_farm.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const [, file] of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
	vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}

const cell = (x, y) => y * world.size + x;
const FIELD_SIDE = MAPE_FARM_RADIUS * 2 + 1;
const FIELD = FIELD_SIDE * FIELD_SIDE;

function blank(x = 10, y = 10) {
	main.setup(START_SEED, 'a', 0, MAPE_ENGINE.DIFFUSION);
	world.terrain.fill(TERRAIN.MEADOW);
	land.disturbed.fill(0);
	economy.biomass.fill(0);
	mape.pop.fill(0);
	mape.money.fill(0);
	mapeRebuildSettlements();
	mapeSetWorkforceMode(MAPE_WORKFORCE_MODE.RESIDENTS);
	mape.scanOn = false;
	transportRebuild();
	return cell(x, y);
}

function farm(x, y, state = MAPE_FACTORY_STATE.BUILDING) {
	const f = mapeAddFactory(x, y, state, MAPE_FACTORY_KIND.FARM);
	assert.ok(f >= 0);
	return f;
}

function claim(f, x, y) {
	mape.farmOwner[cell(x, y)] = f + 1;
	economyTill(cell(x, y), true);
}

function farmCells(f, x, y) {
	let count = 0;
	for (let dy = -MAPE_FARM_RADIUS; dy <= MAPE_FARM_RADIUS; dy++) {
		for (let dx = -MAPE_FARM_RADIUS; dx <= MAPE_FARM_RADIUS; dx++) {
			if (mape.farmOwner[cell(x + dx, y + dy)] === f + 1) count++;
		}
	}
	return count;
}

function foodTotal() {
	let sum = 0;
	for (let i = 0; i < world.n; i++) sum += mape.goodsView[MAPE_RES.FOOD][i];
	return sum;
}

// The sample the next clearing visit takes: pick = (dy + R) * side + (dx + R).
function sampledCell(f, x, y) {
	const pick = randomInt(FIELD_SIDE * FIELD_SIDE);
	return cell(x + pick % FIELD_SIDE - MAPE_FARM_RADIUS, y + ((pick / FIELD_SIDE) | 0) - MAPE_FARM_RADIUS);
}

// Find a seed whose first clearing sample lands on one target cell.
function seedFor(f, x, y, tx, ty) {
	for (let s = 1; s < 4096; s++) {
		randomSeed(s);
		if (sampledCell(f, x, y) === cell(tx, ty)) return s;
	}
	throw new Error('no seed samples the target cell');
}

function verifyClearing() {
	const home = blank();
	const f = farm(10, 10);
	mape.pop[home] = MAPE_FACTORY_BUILD_WORKERS;
	// A fully claimed field makes every sample a miss: the visit costs the effort only.
	for (let dy = -MAPE_FARM_RADIUS; dy <= MAPE_FARM_RADIUS; dy++) {
		for (let dx = -MAPE_FARM_RADIUS; dx <= MAPE_FARM_RADIUS; dx++) claim(f, 10 + dx, 10 + dy);
	}
	mapeStepFarmBuild(f, home, 0.05, 1);
	assert.ok(Math.abs(mape.factoryHarvestWork[f] - (MAPE_FARM_TILL_SEC - MAPE_FACTORY_BUILD_WORKERS * 0.05)) < 1e-9,
		'a miss charges the visit cost');
	// A hit fells the whole cell into logs on the site and marks it farmland. One cell is
	// released bare-and-forested; every other sample is owned, so the seeded pick is forced.
	const sample = cell(11, 11);
	mape.farmOwner[sample] = 0;
	economyTill(sample, false);
	economy.biomass[sample] = 1;
	randomSeed(seedFor(f, 10, 10, 11, 11));
	mape.factoryHarvestWork[f] = 0;
	mapeStepFarmBuild(f, home, 0.05, 1);
	assert.equal(economy.biomass[sample], 0, 'clearing fells the sampled cell to zero');
	assert.ok(Math.abs(localLogs(home) - (1 / MAPE_SAWMILL_FOREST_PER_LOG - MAPE_BUILD_WOOD_RATE * 0.05)) < 1e-9,
		'felled cover stocks logs on the farm cell, the build eats its share');
	assert.equal(mape.farmOwner[sample], f + 1, 'a hit marks the cell farmland');
	assert.equal(economy.tilled[sample], 1, 'farmland is tilled');
	assert.ok(mape.factoryHarvestWork[f] > 1 * MAPE_SAWMILL_FELL_SEC, 'felling owes work per cover');
	// A tilled cell grows no forest; a released one hands regrowth back to the field model.
	assert.equal(economyForestTarget(sample, 0.4), 0, 'tilled farmland grows no forest');
	economyTill(sample, false);
	assert.ok(economyForestTarget(sample, 0.4) > 0, 'released farmland regrows on the ordinary model');
	economyTill(sample, true);
	// A cell owned by another farm is never cleared.
	mape.farmOwner[sample] = f + 2;
	economy.biomass[sample] = 1;
	economyTill(sample, false);
	randomSeed(seedFor(f, 10, 10, 11, 11));
	mape.factoryHarvestWork[f] = 0;
	const logsBefore = localLogs(home);
	mapeStepFarmBuild(f, home, 0.05, 1);
	assert.equal(economy.biomass[sample], 1, 'another farm\'s cell is not felled');
	assert.equal(mape.farmOwner[sample], f + 2, 'another farm\'s cell is not claimed');
	assert.ok(Math.abs(localLogs(home) - (logsBefore - MAPE_BUILD_WOOD_RATE * 0.05)) < 1e-9,
		'no logs come from a foreign cell, the build still eats its share');
}

function localLogs(idx) {
	return mape.goodsView[MAPE_RES.LOGS][idx];
}

// A wooded site builds itself from felled logs; a meadow site stalls without haulage while
// its visits still till farmland, and finishes once logs arrive.
function verifyBuildPaysInForestOrWood() {
	const home = blank(30, 30);
	for (let dy = -MAPE_FARM_RADIUS; dy <= MAPE_FARM_RADIUS; dy++) {
		for (let dx = -MAPE_FARM_RADIUS; dx <= MAPE_FARM_RADIUS; dx++) economy.biomass[cell(30 + dx, 30 + dy)] = 1;
	}
	const f = farm(30, 30);
	mape.pop[home] = MAPE_FACTORY_BUILD_WORKERS;
	let ticks = 0;
	while (mape.factoryState[f] !== MAPE_FACTORY_STATE.ACTIVE && ticks++ < 4000) {
		mapeStepFarmBuild(f, home, 0.05, 1);
	}
	assert.equal(mape.factoryState[f], MAPE_FACTORY_STATE.ACTIVE, 'a wooded site builds from its own felled logs');
	assert.ok(farmCells(f, 30, 30) > 0, 'the build cleared farmland as it went');
	assert.ok(localLogs(home) >= 0, 'leftover logs stay on the site for the market');

	const meadow = blank(40, 40);
	const g = farm(40, 40);
	mape.pop[meadow] = MAPE_FACTORY_BUILD_WORKERS;
	for (let k = 0; k < 400; k++) mapeStepFarmBuild(g, meadow, 0.05, 1);
	assert.equal(mape.factoryState[g], MAPE_FACTORY_STATE.BUILDING, 'a meadow site cannot finish without logs');
	assert.ok(mape.factoryStarved[g] > 0, 'the meadow build starves on wood');
	assert.ok(farmCells(g, 40, 40) > 0, 'the meadow crew still tills farmland');
	mape.goodsView[MAPE_RES.LOGS][meadow] = 5;
	let rest = 0;
	while (mape.factoryState[g] !== MAPE_FACTORY_STATE.ACTIVE && rest++ < 4000) {
		mapeStepFarmBuild(g, meadow, 0.05, 1);
	}
	assert.equal(mape.factoryState[g], MAPE_FACTORY_STATE.ACTIVE, 'hauled logs finish the meadow build');
}

// The farm asks for exactly one worker per farmland cell; crew beyond the cells clears new ones.
function verifyCrewSizing() {
	const home = blank(20, 20);
	const f = farm(20, 20, MAPE_FACTORY_STATE.ACTIVE);
	claim(f, 19, 20);
	claim(f, 21, 20);
	claim(f, 20, 19);
	claim(f, 20, 21);
	claim(f, 20, 20);
	mapeSyncCells();
	assert.equal(mape.jobNeed[home], 5, 'job need equals the farmland count');
	mape.pop[home] = 1;
	mape.factoryHarvestWork[f] = 0;
	mapeStepFarm(f, home, 0.05);
	assert.equal(farmCells(f, 20, 20), 5, 'a crew of one works its five cells and clears nothing');
	mape.pop[home] = 8;
	mape.factoryHarvestWork[f] = 0;
	mapeStepFarm(f, home, 0.05);
	assert.ok(farmCells(f, 20, 20) > 5, 'spare crew clears new farmland');
	mapeSyncCells();
	assert.ok(mape.jobNeed[home] > 5, 'the advertised need follows the field');
	// The scene Farm tool places an active farm that grows its field from nothing.
	mapScene.tool = 8;
	mapSceneEdit(50, 50);
	const tool = mapeFactoryAt(50, 50);
	assert.ok(tool >= 0 && mape.factoryKind[tool] === MAPE_FACTORY_KIND.FARM, 'the Farm scene tool places a farm');
	mape.pop[cell(50, 50)] = MAPE_FACTORY_WORKERS;
	mapeStepFarm(tool, cell(50, 50), 0.05);
	assert.ok(farmCells(tool, 50, 50) > 0, 'a fresh farm turns its crew into farmland');
	mapScene.tool = 0;
}

// An undermanned field harvests a smaller share; it never gives cells back.
function verifyUndermannedFieldKeepsItsCells() {
	const home = blank(20, 20);
	const f = farm(20, 20, MAPE_FACTORY_STATE.ACTIVE);
	for (let dy = -MAPE_FARM_RADIUS; dy <= MAPE_FARM_RADIUS; dy++) {
		for (let dx = -MAPE_FARM_RADIUS; dx <= MAPE_FARM_RADIUS; dx++) claim(f, 20 + dx, 20 + dy);
	}
	mape.pop[home] = 1;
	for (let season = 0; season < 4; season++) {
		const before = farmCells(f, 20, 20);
		for (let k = 0; k < Math.round(MAPE_FARM_SEASON_SEC / 0.05); k++) mapeStepFarm(f, home, 0.05);
		assert.equal(farmCells(f, 20, 20), before, 'no farmland is released between seasons');
		assert.ok(mape.factoryGoods[f] > 0, 'an undermanned field still brings in a crop');
	}
}

// The whole field is brought in at once: nothing between passes, every farmland cell at the pass,
// the share set by worked cell-seconds, and the crop identical at 0.2 s and 0.05 s steps.
function verifyBatchHarvest() {
	assert.equal(MAPE_FARM_YIELD, 6, 'quality-1 farmland produces six food per season');
	const totals = [];
	for (const dt of [0.2, 0.05]) {
		const home = blank(20, 20);
		const f = farm(20, 20, MAPE_FACTORY_STATE.ACTIVE);
		for (let dy = -MAPE_FARM_RADIUS; dy <= MAPE_FARM_RADIUS; dy++) {
			for (let dx = -MAPE_FARM_RADIUS; dx <= MAPE_FARM_RADIUS; dx++) claim(f, 20 + dx, 20 + dy);
		}
		mape.pop[home] = FIELD_SIDE * FIELD_SIDE;
		let food = 0;
		let harvestTicks = 0;
		// One extra sim-second of slack: float drift at the exact 120 s edge must not decide the count.
		for (let k = 0; k < Math.round(121 / dt); k++) {
			const before = foodTotal();
			mapeStepFarm(f, home, dt);
			if (foodTotal() > before) harvestTicks++;
			food = foodTotal();
		}
		assert.equal(harvestTicks, Math.round(121 / MAPE_FARM_SEASON_SEC), 'food arrives only on the season pass');
		// Scene soil is flat 0.5, so quality is 1 − |0.5 − 0.6| / 0.3 and one full season yields 100.
		assert.ok(Math.abs(food - 15 * MAPE_FARM_YIELD * (1 - 0.1 / MAPE_FARM_MOISTURE_WIDTH) * FIELD) < 1e-6,
			'one season brings the whole crop in: ' + food.toFixed(3));
		totals.push(food);
	}
	assert.ok(Math.abs(totals[0] - totals[1]) < 1e-6, 'the crop is identical at 0.2 s and 0.05 s steps');

	// Half the crew brings in half the crop; no farmland is lost by it.
	const home = blank(20, 20);
	const f = farm(20, 20, MAPE_FACTORY_STATE.ACTIVE);
	for (let dy = -MAPE_FARM_RADIUS; dy <= MAPE_FARM_RADIUS; dy++) {
		for (let dx = -MAPE_FARM_RADIUS; dx <= MAPE_FARM_RADIUS; dx++) claim(f, 20 + dx, 20 + dy);
	}
	mape.pop[home] = FIELD / 2;
	for (let k = 0; k < Math.round(MAPE_FARM_SEASON_SEC / 0.05); k++) mapeStepFarm(f, home, 0.05);
	assert.ok(Math.abs(mape.factoryGoods[f] * MAPE_FARM_SEASON_SEC - totals[0] / 15 / 2) < 1e-6,
		'half the crew halves the harvest share');
	assert.equal(farmCells(f, 20, 20), FIELD, 'a partial crew never shrinks the field');
	assert.ok(Math.abs(mapeLedgerResidual()) < 1e-6, 'food production stays on the ledger');
}

// Crop per cell follows root-zone moisture, peaking at the farm optimum.
function verifyMoistureYield() {
	const wet = blank(40, 40);
	const f = farm(40, 40, MAPE_FACTORY_STATE.ACTIVE);
	claim(f, 40, 40);
	mape.pop[wet] = 1;
	hydrology.soil[wet] = MAPE_FARM_MOISTURE_OPTIMUM;
	hydrology.soil[50 * world.size + 40] = MAPE_FARM_MOISTURE_OPTIMUM - MAPE_FARM_MOISTURE_WIDTH;
	// Run to the first harvest with slack: float drift at the exact season edge must not decide it.
	let k = 0;
	while (mape.factoryGoods[f] === 0 && k++ < 400) mapeStepFarm(f, wet, 0.05);
	assert.ok(mape.factoryGoods[f] > 0, 'the field brings a crop in');
	assert.ok(Math.abs(mape.factoryGoods[f] * MAPE_FARM_SEASON_SEC - mapeFarmCellQuality(wet) * MAPE_FARM_YIELD) < 1e-6,
		'optimal moisture brings the full per-cell yield');
	assert.equal(economy.biomass[wet], 0, 'harvesting does not touch the forest field');
	assert.ok(mapeFarmCellQuality(50 * world.size + 40) < 1e-6, 'the moisture margin closes the cell');
	// Safely outside the band the crop is exactly zero.
	const g = farm(50, 40, MAPE_FACTORY_STATE.ACTIVE);
	claim(g, 50, 40);
	mape.pop[50 * world.size + 40] = 1;
	hydrology.soil[50 * world.size + 40] = MAPE_FARM_MOISTURE_OPTIMUM - MAPE_FARM_MOISTURE_WIDTH - 0.05;
	for (let n = 0; n < Math.round((MAPE_FARM_SEASON_SEC + 1) / 0.05); n++) mapeStepFarm(g, 50 * world.size + 40, 0.05);
	assert.equal(mape.factoryGoods[g], 0, 'cell food falls to zero outside the moisture band');
	assert.ok(Math.abs(mapeLedgerResidual()) < 1e-6, 'moisture-gated harvests stay on the ledger');
}

// Each harvest pushes its waste onto exactly one ring cell a Chebyshev step beyond the field;
// a water pick drops the season's waste.
function verifyWasteRing() {
	const home = blank(20, 20);
	const f = farm(20, 20, MAPE_FACTORY_STATE.ACTIVE);
	for (let dy = -MAPE_FARM_RADIUS; dy <= MAPE_FARM_RADIUS; dy++) {
		for (let dx = -MAPE_FARM_RADIUS; dx <= MAPE_FARM_RADIUS; dx++) claim(f, 20 + dx, 20 + dy);
	}
	mape.pop[home] = FIELD;
	for (let k = 0; k < Math.round(MAPE_FARM_SEASON_SEC / 0.05); k++) mapeStepFarm(f, home, 0.05);
	let disturbed = [];
	for (let dy = -3; dy <= 3; dy++) {
		for (let dx = -3; dx <= 3; dx++) {
			const ring = Math.max(Math.abs(dx), Math.abs(dy));
			const d = land.disturbed[cell(20 + dx, 20 + dy)];
			if (ring === 3) {
				if (d > 0) disturbed.push(cell(20 + dx, 20 + dy));
			} else {
				assert.equal(d, 0, 'the field itself stays clean');
			}
		}
	}
	assert.equal(disturbed.length, 1, 'exactly one ring cell takes the season\'s waste');
	assert.ok(Math.abs(land.disturbed[disturbed[0]] - 100 * MAPE_FARM_WASTE_PER_FOOD) < 1e-9, 'waste scales with the crop');
	// Water all around: the pick lands in the water and the waste is dropped.
	const island = blank(45, 45);
	const g = farm(45, 45, MAPE_FACTORY_STATE.ACTIVE);
	claim(g, 45, 45);
	mape.pop[island] = 1;
	for (let dy = -3; dy <= 3; dy++) {
		for (let dx = -3; dx <= 3; dx++) {
			if (Math.max(Math.abs(dx), Math.abs(dy)) !== 3) continue;
			world.terrain[cell(45 + dx, 45 + dy)] = TERRAIN.WATER;
		}
	}
	for (let k = 0; k < Math.round(MAPE_FARM_SEASON_SEC / 0.05); k++) mapeStepFarm(g, island, 0.05);
	assert.equal(land.disturbed[island], 0, 'a water pick drops the waste');
}

// Households demand and eat food with no farm on the map, in all four engines.
function verifyHouseholdFood(engine) {
	main.setup(START_SEED, 'a', 0, engine);
	world.terrain.fill(TERRAIN.MEADOW);
	mapeSetWorkforceMode(MAPE_WORKFORCE_MODE.RESIDENTS);
	mapeInit(engine, true);
	const town = 20 * world.size + 20;
	mapePlaceSettlement(town, 20, false);
	mapeRebuildSettlements();
	mapeSyncCells();
	mapeWarmDemand();
	if (engine === MAPE_ENGINE.DIFFUSION) {
		assert.ok(mape.demandView[MAPE_RES.FOOD][town] > 0, 'households pull food in Diffusion');
	}
	mapeProduceStock(MAPE_RES.FOOD, town, 1);
	const before = mape.goodsView[MAPE_RES.FOOD][town];
	if (engine === MAPE_ENGINE.DIFFUSION) mapeUseDiffusionStock(1);
	if (engine === MAPE_ENGINE.CATCHMENT) mapeUseCatchments(1);
	if (engine === MAPE_ENGINE.QUEUE) mapeServeQueues(1);
	if (engine === MAPE_ENGINE.SITES) {
		assert.equal(mapeSitesHouseholdHold(MAPE_RES.FOOD, town), 20 * MAPE_MARKET_FOOD_USE * MAPE_SITE_HOLD_SEC);
		mapeSitesMetabolism(1);
	}
	assert.ok(Math.abs(before - mape.goodsView[MAPE_RES.FOOD][town] - 20 * (engine === MAPE_ENGINE.DIFFUSION ? MAPE_NEED_FOOD : MAPE_MARKET_FOOD_USE)) < 1e-9,
		'household food consumption is population-scaled in ' + MAPE_ENGINE_NAME[engine]);
	assert.ok(Math.abs(mapeLedgerResidual()) < 1e-6, 'food consumption balances in ' + MAPE_ENGINE_NAME[engine]);
}

function verifyFoodTransport() {
	blank();
	const source = cell(20, 20);
	const dest = cell(21, 20);
	const oldHaul = tune.haul;
	for (const haul of [1, 10]) {
		tune.haul = haul;
		for (const mode of ['diffusion', 'catchment', 'queue']) {
			const fractions = [];
			for (const r of [MAPE_RES.FOOD, MAPE_RES.IRON]) {
				mape.goods.fill(0);
				mape.demand.fill(0);
				mape.goodsView[r][source] = 100;
				mape.demandView[r][dest] = 1;
				mape.goodsNext.set(mape.goods);
				mape.workforceNext.fill(0);
				if (mode === 'queue') mapeRouteQueues(r, SIM_STEP_SEC);
				else mapeTransportSlice(r, world.size, world.terrain, mape.demand, mape.goods,
					mape.goodsNext, mape.pop, mape.workforce, mape.workforceNext, SIM_STEP_SEC,
					mode === 'catchment', mape.flowX, mape.flowY, transport);
				const off = r * world.n;
				const moved = mape.goodsNext[off + dest];
				assert.ok(moved > 0 && moved <= 100, 'transport is positive and bounded');
				assert.ok(Math.abs(mape.goodsNext[off + source] + moved - 100) < 1e-8, 'transport conserves stock');
				fractions.push(moved);
			}
			const speed = mode === 'queue' ? MAPE_QUEUE_FLOW_SPEED : mode === 'catchment' ? MAPE_MARKET_FLOW_SPEED : MAPE_FLOW_SPEED;
			const expected = Math.min(MAPE_STEP_FRAC_MAX, speed * 0.25 * haul * SIM_STEP_SEC) /
				Math.min(MAPE_STEP_FRAC_MAX, speed * haul * SIM_STEP_SEC);
			assert.ok(Math.abs(fractions[0] / fractions[1] - expected) < 1e-8, mode + ' uses food-specific flow before the transfer cap');
		}
	}
	tune.haul = oldHaul;
}

verifyClearing();
verifyBuildPaysInForestOrWood();
verifyCrewSizing();
verifyUndermannedFieldKeepsItsCells();
verifyBatchHarvest();
verifyFoodTransport();
verifyMoistureYield();
verifyWasteRing();
for (const engine of [MAPE_ENGINE.DIFFUSION, MAPE_ENGINE.CATCHMENT, MAPE_ENGINE.QUEUE, MAPE_ENGINE.SITES]) verifyHouseholdFood(engine);
console.log('farm_checks=pass food_ledger=' + mapeLedgerResidual().toExponential(1));
