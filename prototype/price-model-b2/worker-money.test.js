// Owns: regression checks for B2 carried worker wallets, worker/town wait pools, paid rest and gold-tax appeal.
// Edit for: pool-occupancy hire demand, wait-pool living taxes, worker-gold advection and anti-siphon wage checks.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const file of ['simulation.js', 'actors.js', 'towns.js', 'gold.js', 'workforce.js', 'land.js', 'farms.js', 'settlement.js', 'harvest.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

const sum = (values) => values.reduce((total, value) => total + value, 0);
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);

function checkLedger(model) {
	assert.ok(model.laborFlow.gold.every((value) => value >= 0));
	assert.ok(model.depletedFlow.gold.every((value) => value >= 0));
	assert.ok(model.money.purse.every((value) => value >= 0));
	assert.ok(model.money.workerPurse.every((value) => value >= 0));
	for (let i = 0; i < ECONOMY_SIZE; i++) {
		if (model.labor[i] <= 1e-12) assert.equal(model.laborFlow.gold[i], 0);
		if (model.depleted[i] <= 1e-12) assert.equal(model.depletedFlow.gold[i], 0);
	}
	closeTo(sum(model.coal), model.producedCoal - model.burnedCoal);
	closeTo(sum(model.goods), model.producedGoods - model.consumedGoods);
	closeTo(sum(model.labor), model.suppliedLabor - model.workedLabor);
	closeTo(sum(model.depleted), model.emittedDepleted - model.restedDepleted);
	assert.ok(Math.abs(model.money.total() - model.money.seeded - model.money.mined) < 1e-7);
}

// Rule checks run on an even woodland so town placement never picks up a terrain bonus, desert or bare ground.
function neutralLand(model) {
	model.land.terrain.fill(TERRAIN_FOREST);
	model.land.refresh();
	model.settlements.forestCap.fill(FOREST_TERRAIN);
	model.settlements.forest.fill(FOREST_TERRAIN);
}

// Historical high-funding fixture keeps existing throughput gates independent of the new scenario default.
function referenceModel() {
	const model = new PriceEconomy();
	model.money.startGoldPerWorker = 5.165384615384615;
	model.reset();
	return model;
}

function clearedMap() {
	const model = referenceModel();
	model.actors.fill(0);
	model.pop.fill(0);
	model.scale.fill(0);
	model.taxMult.fill(0);
	model.workLoad.fill(0);
	model.laborFlow.gold.fill(0);
	model.depletedFlow.gold.fill(0);
	model.money.reset();
	neutralLand(model);
	return model;
}

test('workers carry earned wages in depletedGold to the cheaper town and pay rest tax on arrival', () => {
	const model = clearedMap();
	const cheap = economyIndex(10, 14);
	const mid = economyIndex(15, 14);
	const dear = economyIndex(20, 14);
	model.setActor(cheap, ECONOMY_TOWN);
	model.setActor(dear, ECONOMY_TOWN);
	model.satCoal[cheap] = model.satCoal[dear] = 1;
	model.satGoods[cheap] = model.satGoods[dear] = 1;
	model.goods[cheap] = model.goods[dear] = 0.8;
	model.coal[cheap] = model.coal[dear] = 0.4;
	model.producedGoods = 1.6;
	model.producedCoal = 0.8;
	model.taxMult[cheap] = 0.6;
	model.taxMult[dear] = 2.0;
	for (let n = 0; n < 120; n++) model.updatePrices();

	const cheapBefore = model.money.held(cheap);
	const dearBefore = model.money.held(dear);
	model.depleted[mid] = 0.5;
	model.depletedFlow.gold[mid] = 10;
	model.emittedDepleted = 0.5;
	model.money.seeded += 10;

	for (let n = 0; n < 180; n++) {
		model.taxMult[cheap] = 0.6;
		model.taxMult[dear] = 2.0;
		model.satCoal[cheap] = model.satCoal[dear] = 1;
		model.satGoods[cheap] = model.satGoods[dear] = 1;
		model.updatePrices();
		model.towns.restWorkers(cheap, 1, 1);
		model.towns.restWorkers(dear, 1, 1);
		model.transport(model.depletedFlow, model.depleted, model.priceHome);
	}
	assert.ok(model.money.held(cheap) > cheapBefore + 7);
	assert.ok(model.money.held(dear) < dearBefore + 0.5);
	assert.ok(model.money.taxes > 0.5);
	checkLedger(model);
});

test('high-tax towns require cash to rest: funded workers pay and rest while penniless workers are priced out', () => {
	const funded = clearedMap();
	const broke = clearedMap();
	const town = economyIndex(24, 14);
	for (const model of [funded, broke]) {
		model.setActor(town, ECONOMY_TOWN);
		model.taxMult[town] = 1.8;
		model.satCoal[town] = 1;
		model.satGoods[town] = 1;
		model.depleted[town] = 0.4;
		model.emittedDepleted = 0.4;
	}
	funded.depletedFlow.gold[town] = 6;
	funded.money.seeded += 6;

	const restedFunded = funded.towns.restWorkers(town, 1, 1);
	const restedBroke = broke.towns.restWorkers(town, 1, 1);
	assert.ok(restedFunded > 0.008);
	assert.equal(restedBroke, 0);
	assert.ok(funded.money.taxes > 0);
	assert.equal(broke.money.taxes, 0);
	checkLedger(funded);
	checkLedger(broke);
});

test('living appeal trades off gold tax against distance fade and does not favor inflated gold-tax towns', () => {
	const distModel = clearedMap();
	const near = economyIndex(12, 14);
	const probe = economyIndex(16, 14);
	const far = economyIndex(28, 14);
	distModel.setActor(near, ECONOMY_TOWN);
	distModel.setActor(far, ECONOMY_TOWN);
	distModel.satGoods[near] = distModel.satGoods[far] = 1;
	for (let n = 0; n < 180; n++) distModel.updatePrices();
	assert.ok(distModel.priceHome[probe - 1] > distModel.priceHome[probe + 1], 'equal-tax nearer town wins via fade');

	const taxModel = clearedMap();
	const cheap = economyIndex(10, 14);
	const mid = economyIndex(16, 14);
	const inflated = economyIndex(22, 14);
	taxModel.setActor(cheap, ECONOMY_TOWN);
	taxModel.setActor(inflated, ECONOMY_TOWN);
	taxModel.satGoods[cheap] = taxModel.satGoods[inflated] = 1;
	taxModel.money.seeded += taxModel.money.workerPurse[inflated] * 3;
	taxModel.money.workerPurse[inflated] *= 4;
	for (let n = 0; n < 180; n++) taxModel.updatePrices();
	assert.ok(taxModel.workforce.homeValueBid(cheap) > taxModel.workforce.homeValueBid(inflated) * 3, 'inflated 4x gold tax lowers living appeal');
	assert.ok(taxModel.priceHome[mid - 1] > taxModel.priceHome[mid + 1], 'equidistant cheaper gold-tax town wins');
	checkLedger(distModel);
	checkLedger(taxModel);
});

test('long-vacant or broke towns shed residents carrying proportional savings', () => {
	// Draft revision: cheap/med towns keep their built size and only shed residents when long-vacant or broke
	// (tax is the lever that keeps them full). The departing residents still carry their wallet gold proportionally.
	const model = clearedMap();
	const town = economyIndex(24, 14);
	model.setActor(town, ECONOMY_TOWN);
	model.vacantTicks[town] = VACANT_SECONDS + 10; // simulate a town that has stood empty for a long time
	const startWorkerGold = model.money.workerPurse[town];
	model.step();
	assert.ok(model.depleted[town] > 0);
	assert.ok(model.depletedFlow.gold[town] > 0);
	closeTo(model.money.workerPurse[town] + model.laborFlow.gold[town] + model.depletedFlow.gold[town], startWorkerGold);
	checkLedger(model);
});

test('active firms pay wages into worker pockets rather than wage streams, so bystander towns do not siphon wages', () => {
	const model = clearedMap();
	const goldMine = economyIndex(16, 14);
	const suppliedTown = economyIndex(10, 14);
	const idleBystander = economyIndex(22, 14);
	model.setActor(goldMine, ECONOMY_GOLD);
	model.setActor(suppliedTown, ECONOMY_TOWN);
	model.setActor(idleBystander, ECONOMY_TOWN);
	// Pin the supplied town to the balanced (Med) class so this test isolates wage routing from the wealth-class tax
	// strategies; the bystander is already a different cell and must not siphon the mine's wages.
	model.wealthClass[suppliedTown] = WEALTH_MED;
	model.goods[suppliedTown] = 0.9;
	model.coal[suppliedTown] = 0.5;
	model.producedGoods = 0.9;
	model.producedCoal = 0.5;
	const bystanderStart = model.money.held(idleBystander);

	for (let n = 0; n < 360; n++) {
		model.goods[suppliedTown] = 0.9;
		model.coal[suppliedTown] = 0.5;
		model.producedGoods = model.consumedGoods + 0.9;
		model.producedCoal = model.burnedCoal + 0.5;
		model.step();
	}
	assert.ok(model.money.mined > 0.8);
	assert.ok(sum(model.money.streams[PAY_WAGE].coin) < 1e-6);
	// The supplied (working) town must capture a solid share of the mine's wages — not the idle bystander.
	assert.ok(model.money.held(suppliedTown) - bystanderStart > 0.3 * model.money.mined);
	assert.ok(model.money.held(idleBystander) <= bystanderStart + 0.05);
	checkLedger(model);
});

test('supplied towns temporarily in negative profit do not deadlock funded worker rest and tax recovery', () => {
	const model = clearedMap();
	const town = economyIndex(24, 14);
	model.setActor(town, ECONOMY_TOWN);
	model.profit[town] = -0.25;
	model.satCoal[town] = 1;
	model.satGoods[town] = 1;
	model.depleted[town] = 0.3;
	model.depletedFlow.gold[town] = 5;
	model.emittedDepleted = 0.3;
	model.money.seeded += 5;

	const rested = model.towns.restWorkers(town, 1, 1);
	assert.ok(rested > 0.008);
	assert.ok(model.money.taxes > 0);
	checkLedger(model);
});

test('factories emit workforce demand inversely with fresh-worker pool occupancy and drop wages to zero on overflow', () => {
	const model = clearedMap();
	const factory = economyIndex(24, 14);
	model.setActor(factory, ECONOMY_FACTORY);
	model.priceGoods[factory] = 4;
	model.profit[factory] = 0.6;
	const pool = model.firmLaborPool(factory);
	assert.ok(pool > FACTORY_RATE * FACTORY_LABOR * BUFFER_SECONDS);

	const bids = [0, 0.25, 0.5, 0.85, 1.0, 1.2].map((occ) => {
		model.labor[factory] = pool * occ;
		return model.factoryLaborBid(factory);
	});
	assert.ok(bids[0] > bids[1] && bids[1] > bids[2] && bids[2] > bids[3] && bids[3] > 0);
	assert.equal(bids[4], 0);
	assert.equal(bids[5], 0);

	const runLaborMarket = (townCoords, goldCoords) => {
		const sim = clearedMap();
		for (const [x, y] of townCoords) sim.setActor(economyIndex(x, y), ECONOMY_TOWN);
		for (const [x, y] of goldCoords) sim.setActor(economyIndex(x, y), ECONOMY_GOLD);
		for (let n = 0; n < 15 * 60; n++) {
			for (const [x, y] of townCoords) {
				const t = economyIndex(x, y);
				sim.coal[t] = 0.2;
				sim.goods[t] = 0.2;
				sim.producedCoal = sim.burnedCoal + 0.2 * townCoords.length;
				sim.producedGoods = sim.consumedGoods + 0.2 * townCoords.length;
			}
			sim.step();
		}
		checkLedger(sim);
		return sim;
	};
	const scarce = runLaborMarket([[24, 14]], [[14, 8], [14, 14], [14, 20], [34, 8], [34, 14], [34, 20]]);
	const overflow = runLaborMarket([[22, 12], [22, 16], [26, 14]], [[24, 14]]);
	const gScarce = economyIndex(14, 14);
	const gOverflow = economyIndex(24, 14);
	assert.ok(overflow.poolOccupancy(gOverflow) > scarce.poolOccupancy(gScarce) + 0.35);
	assert.ok(overflow.priceLabor[gOverflow] < scarce.priceLabor[gScarce] * 0.25);
});

test('towns increase living taxes and cool home appeal when their wait pool to live is crowded', () => {
	const model = clearedMap();
	const calm = economyIndex(10, 14);
	const crowded = economyIndex(34, 14);
	model.setActor(calm, ECONOMY_TOWN);
	model.setActor(crowded, ECONOMY_TOWN);
	for (let n = 0; n < 8 * 60; n++) {
		for (const t of [calm, crowded]) {
			model.coal[t] = 0.4;
			model.goods[t] = 0.7;
		}
		model.producedCoal = model.burnedCoal + 0.8;
		model.producedGoods = model.consumedGoods + 1.4;
		if (model.depleted[crowded] < 0.45) {
			const add = 0.45 - model.depleted[crowded];
			model.depleted[crowded] += add;
			model.emittedDepleted += add;
			model.depletedFlow.gold[crowded] += add * 4;
			model.money.seeded += add * 4;
		}
		model.step();
	}
	assert.ok(model.poolOccupancy(crowded) > model.poolOccupancy(calm) + 0.35);
	assert.ok(model.taxMult[crowded] > model.taxMult[calm] + 0.25);
	const calmBase = model.townTaxRate(calm), crowdedBase = model.townTaxRate(crowded);
	assert.ok(model.townRestTax(crowded) / crowdedBase > model.townRestTax(calm) / calmBase * 1.5);
	assert.ok(model.workforce.homeValueBid(crowded) * crowdedBase < model.workforce.homeValueBid(calm) * calmBase * 0.7);
	checkLedger(model);
});

test('worker and town wait pools balance to real occupancy and smooth shifts across commute travel', () => {
	const model = clearedMap();
	const mine = economyIndex(10, 10);
	const activeFactory = economyIndex(14, 10);
	const idleFactory = economyIndex(14, 20);
	const activeTown = economyIndex(20, 12);
	const quietTown = economyIndex(42, 22);
	model.setActor(mine, ECONOMY_MINE);
	model.setActor(activeFactory, ECONOMY_FACTORY);
	model.setActor(idleFactory, ECONOMY_FACTORY);
	model.setActor(activeTown, ECONOMY_TOWN);
	model.setActor(quietTown, ECONOMY_TOWN);
	for (let n = 0; n < 20 * 60; n++) {
		model.coal[idleFactory] = 0;
		model.producedCoal = sum(model.coal) + model.burnedCoal;
		model.step();
	}
	assert.ok(model.workLoad[activeFactory] > 0.05);
	assert.equal(model.workLoad[idleFactory], 0);
	assert.ok(model.poolTarget(activeFactory) > model.poolTarget(idleFactory) * 2);
	assert.ok(model.poolTarget(activeTown) > model.poolTarget(quietTown) * 1.8);

	let stalledTicks = 0;
	for (let n = 0; n < 300; n++) {
		const before = model.workedLabor;
		model.step();
		if (model.workedLabor - before <= 1e-9) stalledTicks++;
	}
	assert.equal(stalledTicks, 0);
	checkLedger(model);
});

test('full healthy towns keep positive home appeal via rent pressure while shrinking towns get no fake popRoom boost', () => {
	const model = clearedMap();
	const fullHealthy = economyIndex(10, 14);
	const roomyHealthy = economyIndex(22, 14);
	const dying = economyIndex(34, 14);
	model.setActor(fullHealthy, ECONOMY_TOWN);
	model.setActor(roomyHealthy, ECONOMY_TOWN);
	model.setActor(dying, ECONOMY_TOWN);
	const full = model.settlements.popCap(fullHealthy);
	model.pop[fullHealthy] = full;
	model.money.seeded += model.money.workerPurse[fullHealthy] * (full / START_POP - 1);
	model.money.workerPurse[fullHealthy] *= full / START_POP;
	model.satCoal[fullHealthy] = model.satGoods[fullHealthy] = 1;
	model.satCoal[roomyHealthy] = model.satGoods[roomyHealthy] = 1;
	model.pop[dying] = 2.5;
	model.taxMult[dying] = 1.6;

	assert.ok(model.workforce.homeValueBid(fullHealthy) > 2, 'full town still welcomes its own commuters home');
	assert.ok(model.townRestTax(fullHealthy) > model.townRestTax(roomyHealthy), 'near-capacity town charges higher living tax');
	assert.ok(model.workforce.homeValueBid(roomyHealthy) > model.workforce.homeValueBid(fullHealthy), 'newcomers prefer equally comfortable town with housing room');
	assert.ok(model.workforce.homeValueBid(fullHealthy) > model.workforce.homeValueBid(dying) * 5, 'shrinking unsupplied town never outbids healthy full town');
	checkLedger(model);
});

test('settled wages split proportionally across on-site pool and shift workers so every shift leaves paid', () => {
	const model = clearedMap();
	const goldMine = economyIndex(24, 14);
	model.setActor(goldMine, ECONOMY_GOLD);
	model.money.dig(goldMine, 5);
	model.labor[goldMine] = 0.1;
	model.suppliedLabor = 0.1;
	model.money.bill(goldMine, PAY_WAGE, 0.4);

	for (let shift = 0; shift < 8; shift++) {
		model.depletedFlow.gold[goldMine] = 0;
		model.emittedDepleted -= model.depleted[goldMine];
		model.depleted[goldMine] = 0;
		model.optimizer.stepFirm(goldMine, model.optimizer.recipes[ECONOMY_GOLD]);
		model.money.step();
		const perWorker = model.depletedFlow.gold[goldMine] / model.depleted[goldMine];
		assert.ok(perWorker >= 3.9, `shift ${shift} paid ${perWorker}`);
	}
});

test('cheap towns drop living tax to fill vacant slots, unlike balanced towns', () => {
	// Draft "town wealth class": a Cheap town lowers living tax when it has vacant resident slots (to attract
	// workers even if it cannot yet buy every resource); a balanced town without comfort taxes harder to fund itself.
	const model = clearedMap();
	const cheap = economyIndex(10, 14);
	const med = economyIndex(34, 14);
	model.setActor(cheap, ECONOMY_TOWN);
	model.setActor(med, ECONOMY_TOWN);
	model.wealthClass[cheap] = WEALTH_CHEAP;
	model.wealthClass[med] = WEALTH_MED;
	for (let n = 0; n < 12 * 60; n++) model.step();
	assert.ok(model.taxMult[cheap] < 1, 'cheap town drops tax to attract into vacant slots');
	assert.ok(model.taxMult[med] > model.taxMult[cheap] + 0.25, 'balanced town without comfort taxes harder to fund itself');
	checkLedger(model);
});

test('rich towns keep a cozy occupancy with a few free slots rather than filling to capacity', () => {
	// Draft "town wealth class": a Rich town holds a comfortable occupancy (queue ≈ 0, few free slots) while a
	// balanced town fills closer to capacity.
	const model = clearedMap();
	const rich = economyIndex(10, 14);
	const med = economyIndex(34, 14);
	model.setActor(rich, ECONOMY_TOWN);
	model.setActor(med, ECONOMY_TOWN);
	model.wealthClass[rich] = WEALTH_RICH;
	model.wealthClass[med] = WEALTH_MED;
	for (let n = 0; n < 30 * 60; n++) {
		for (const t of [rich, med]) { model.coal[t] = 0.4; model.goods[t] = 0.7; }
		model.producedCoal = model.burnedCoal + 0.8;
		model.producedGoods = model.consumedGoods + 1.4;
		model.step();
	}
	const occ = (t) => model.pop[t] / model.settlements.popCap(t);
	assert.ok(occ(rich) > 0 && occ(rich) < 0.95, 'rich town keeps a few free slots');
	assert.ok(occ(med) > occ(rich), 'balanced town fills closer to capacity');
	checkLedger(model);
});
