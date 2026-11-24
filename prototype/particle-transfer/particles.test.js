// Owns: Phase-1 verification of Lagrangian goods particles, machine-precision mass/gold conservation, profit identity and UI boot.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ENGINE_FILES = ['simulation.js', 'particles.js', 'actors.js', 'gold.js', 'workforce.js', 'land.js', 'settlement.js'];
for (const file of ENGINE_FILES) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

const sum = values => values.reduce((total, value) => total + value, 0);
const closeMachine = (actual, expected, tol = 1e-12, ref = 1) => {
	const limit = tol * Math.max(1, Math.abs(ref));
	assert.ok(Math.abs(actual - expected) < limit, `|${actual} - ${expected}| = ${Math.abs(actual - expected)} >= ${limit}`);
};

function run(model, seconds) {
	for (let n = 0; n < Math.round(seconds / ECONOMY_DT); n++) model.step();
}

function neutralLand(model) {
	model.land.terrain.fill(TERRAIN_MEADOW);
	model.land.refresh();
	model.settlements.forestCap.fill(FOREST_TERRAIN);
	model.settlements.forest.fill(FOREST_TERRAIN);
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
	model.money.reset();
	model.settlements.reset();
	neutralLand(model);
	return model;
}

function checkMachineConservation(model) {
	const { particles, money } = model;
	assert.ok(model.coal.every(v => v >= 0 && v <= 1 + 1e-12));
	assert.ok(model.goods.every(v => v >= 0 && v <= 1 + 1e-12));
	assert.ok(money.purse.every(v => v >= 0));
	assert.ok(money.workerPurse.every(v => v >= 0));
	assert.ok(money.transportVault >= 0);
	for (let p = 0; p < particles.count; p++) {
		assert.ok(particles.amount[p] > 0);
		assert.ok(particles.factoryCost[p] >= 0);
		assert.ok(particles.transportCost[p] >= 0);
	}
	closeMachine(model.totalItem(ITEM_COAL), model.producedCoal - model.burnedCoal - particles.spoiled[ITEM_COAL], 1e-12, model.producedCoal);
	closeMachine(model.totalItem(ITEM_GOODS), model.producedGoods - model.consumedGoods - particles.spoiled[ITEM_GOODS], 1e-12, model.producedGoods);
	closeMachine(sum(model.labor), model.suppliedLabor - model.workedLabor, 1e-11, model.suppliedLabor);
	closeMachine(sum(model.depleted), model.emittedDepleted - model.restedDepleted, 1e-11, model.emittedDepleted);
	closeMachine(money.total(), money.seeded + money.mined, 1e-12, money.seeded + money.mined);
}

test('Phase 1 reference chain (one mine -> one factory -> one town) runs smoothly and conserves mass and gold to < 1e-12', () => {
	const model = new PriceEconomy();
	const mine = economyIndex(7, 8), factory = economyIndex(13, 13), town = economyIndex(9, 20);
	assert.equal(model.actors[mine], ECONOMY_MINE);
	assert.equal(model.actors[factory], ECONOMY_FACTORY);
	assert.equal(model.actors[town], ECONOMY_TOWN);

	run(model, 60);
	assert.ok(model.producedCoal > 15);
	assert.ok(model.burnedCoal > 12);
	assert.ok(model.producedGoods > 10);
	assert.ok(model.consumedGoods > 10);
	assert.ok(model.particles.deliveries > 200);
	assert.ok(model.money.transportEarned > 0.5);
	assert.ok(model.profit[mine] > 0.005);
	assert.ok(model.profit[factory] > 0.05);
	assert.ok(model.profit[town] > 0.1);
	assert.ok(model.pop[town] > START_POP + 3);
	checkMachineConservation(model);
});

test('machine-precision conservation holds across 180 s with gold mining, mid-flight producer erasure and town clearing', () => {
	const model = new PriceEconomy();
	model.setActor(economyIndex(3, 13), ECONOMY_GOLD);
	model.setActor(economyIndex(33, 10), ECONOMY_FACTORY);
	model.setActor(economyIndex(39, 7), ECONOMY_MINE);
	model.setActor(economyIndex(28, 12), ECONOMY_TOWN);
	run(model, 60);
	checkMachineConservation(model);

	// Erase a factory and a mine while particles they own are mid-flight.
	model.setActor(economyIndex(13, 13), 0);
	model.setActor(economyIndex(39, 7), 0);
	run(model, 60);
	checkMachineConservation(model);

	model.clearTowns();
	run(model, 60);
	assert.ok(model.money.mined > 5);
	checkMachineConservation(model);
});

test('spawn accumulators batch fractional output to SPAWN_UNIT, gate on cost-basis selfPrice and flush on idle timeout', () => {
	const model = clearedMap();
	const factory = economyIndex(10, 14), neighbor = economyIndex(11, 14);
	model.setActor(factory, ECONOMY_FACTORY);
	model.priceGoods[factory] = 1.0;
	model.priceGoods[neighbor] = 3.0;

	// Sub-batch output stays in the accumulator with proportional cost.
	model.producedGoods += 0.03;
	model.particles.accumulate(ITEM_GOODS, factory, 0.03, 0.045);
	model.particles.step();
	assert.equal(model.particles.count, 0);
	closeMachine(model.particles.spawnAt(ITEM_GOODS, factory), 0.03, 1e-14);

	// Crossing SPAWN_UNIT stays gated when neighbor price is below selfPrice = 1.5 * 1.04 = 1.56.
	model.priceGoods[neighbor] = 1.5;
	model.producedGoods += 0.07;
	model.particles.accumulate(ITEM_GOODS, factory, 0.07, 0.105);
	model.particles.step();
	assert.equal(model.particles.count, 0);
	closeMachine(model.sellPrice(factory), 1.5 * (1 + SELL_MARGIN), 1e-14);

	// Raising neighbor price above selfPrice launches one SPAWN_UNIT batch carrying proportional factoryCost.
	model.priceGoods[neighbor] = 3.0;
	model.particles.step();
	assert.equal(model.particles.count, 1);
	closeMachine(model.particles.amount[0], SPAWN_UNIT, 1e-14);
	closeMachine(model.particles.factoryCost[0], 1.5 * SPAWN_UNIT, 1e-14);
	closeMachine(model.particles.spawnAt(ITEM_GOODS, factory), 0.10 - SPAWN_UNIT, 1e-14);

	// Remaining 0.02 partial batch flushes once the producer idles past IDLE_FLUSH_SECONDS.
	for (let n = 0; n < Math.ceil(2.6 / ECONOMY_DT); n++) model.particles.step();
	assert.equal(model.particles.spawnAt(ITEM_GOODS, factory), 0);
	assert.equal(model.particles.count, 2);
	checkMachineConservation(model);
});

test('buyer arrival splits payment between Transport Company vault and owner with exact profit identity', () => {
	const model = clearedMap();
	model.money.transportDrip = false;
	const factory = economyIndex(10, 14), town = economyIndex(15, 14);
	model.setActor(factory, ECONOMY_FACTORY);
	model.setActor(town, ECONOMY_TOWN);
	for (let x = 10; x <= 15; x++) model.priceGoods[economyIndex(x, 14)] = 2.0 + (x - 10) * 0.4;

	const startTownPurse = model.money.purse[town];
	const amount = 0.08, factoryCost = 0.12;
	model.producedGoods = amount;
	const p = model.particles.emit(ITEM_GOODS, factory, amount, factoryCost, factory, PARTICLE_SPEED, 0);
	assert.equal(p, 0);

	while (model.particles.count > 0) {
		model.earned.fill(0);
		model.particles.prepareStep();
		model.particles.setCap(ITEM_GOODS, town, 0.8);
		model.particles.step();
	}

	const buyerUnitPrice = model.priceGoods[town];
	const expectedBuyerPay = amount * buyerUnitPrice;
	const accruedTransport = model.particles.lastTransportCost;
	assert.ok(accruedTransport > 0);
	const itemPriceAtArrival = (factoryCost + accruedTransport) / amount;

	closeMachine(model.goods[town], amount, 1e-14);
	closeMachine(model.particles.lastBuyerPay, expectedBuyerPay, 1e-14);
	closeMachine(model.particles.lastTransportPaid, accruedTransport, 1e-14);
	closeMachine(model.particles.lastFactoryRevenue, expectedBuyerPay - accruedTransport, 1e-14);
	closeMachine(model.money.transportVault, accruedTransport, 1e-14);
	closeMachine(model.money.purse[factory], expectedBuyerPay - accruedTransport, 1e-14);
	closeMachine(startTownPurse - model.money.purse[town], expectedBuyerPay, 1e-14);

	// Profit identity: factoryRevenue - factoryCost == buyerPay - (factoryCost + transportCost) == amount * (buyerPrice - item.price)
	const expectedProfit = amount * (buyerUnitPrice - itemPriceAtArrival);
	closeMachine(model.particles.lastProfit, expectedProfit, 1e-14);
	closeMachine(model.particles.lastFactoryRevenue - factoryCost, expectedProfit, 1e-14);
	closeMachine(model.earned[factory] * ECONOMY_DT, expectedProfit, 1e-14);
	checkMachineConservation(model);
});

test('competing particles arriving at a nearly full buyer split remaining room without overflow', () => {
	const model = clearedMap();
	const town = economyIndex(20, 14);
	model.setActor(town, ECONOMY_TOWN);
	model.priceGoods[town] = 4.0;
	model.goods[town] = 0.45;
	model.producedGoods = 0.45 + 0.16;
	model.particles.setCap(ITEM_GOODS, town, 0.50);

	model.particles.emit(ITEM_GOODS, town, 0.08, 0.16, economyIndex(10, 14));
	model.particles.emit(ITEM_GOODS, town, 0.08, 0.20, economyIndex(12, 14));
	const price0Before = model.particles.priceOf(0);
	const price1Before = model.particles.priceOf(1);

	model.particles.step();
	closeMachine(model.goods[town], 0.50, 1e-14);
	assert.equal(model.particles.count, 2);
	closeMachine(model.particles.amount[0], 0.055, 1e-14);
	closeMachine(model.particles.amount[1], 0.055, 1e-14);
	closeMachine(model.particles.priceOf(0), price0Before, 1e-14);
	closeMachine(model.particles.priceOf(1), price1Before, 1e-14);
	checkMachineConservation(model);
});

test('underwater shipments re-steer toward a neighbor clearing item.price, hold non-perishables at peaks and spot-sell perishables', () => {
	// 1. Re-steer at a fork when one uphill branch is underwater and another clears item.price.
	const forkModel = clearedMap();
	const center = economyIndex(20, 14), cheapBranch = economyIndex(20, 13), hungryBranch = economyIndex(21, 14);
	forkModel.priceGoods[center] = 1.8;
	forkModel.priceGoods[cheapBranch] = 2.1;
	forkModel.priceGoods[hungryBranch] = 2.8;
	forkModel.producedGoods = 0.08;
	forkModel.particles.emit(ITEM_GOODS, center, 0.08, 0.08 * 2.5, economyIndex(10, 14));
	forkModel.particles.step();
	assert.ok(forkModel.particles.vx[0] > 0 && Math.abs(forkModel.particles.vy[0]) < 1e-12, 're-steers toward +x neighbor clearing 2.5');
	checkMachineConservation(forkModel);

	// 2. Non-perishable holds stationary in consignment at an underwater peak without accruing extra haul cost, then sells on recovery.
	const holdModel = clearedMap();
	const factory = economyIndex(10, 14), town = economyIndex(20, 14);
	holdModel.setActor(factory, ECONOMY_FACTORY);
	holdModel.setActor(town, ECONOMY_TOWN);
	holdModel.priceGoods[town] = 2.0;
	holdModel.producedGoods = 0.08;
	holdModel.particles.emit(ITEM_GOODS, town, 0.08, 0.08 * 2.6, factory);
	for (let n = 0; n < 60; n++) {
		holdModel.particles.prepareStep();
		holdModel.particles.setCap(ITEM_GOODS, town, 0.8);
		holdModel.particles.step();
	}
	assert.equal(holdModel.particles.count, 1, 'non-perishable waits in consignment below cost floor');
	assert.equal(holdModel.particles.transportCost[0], 0, 'stationary consignment accrues zero haulage');

	holdModel.priceGoods[town] = 3.0;
	holdModel.particles.prepareStep();
	holdModel.particles.setCap(ITEM_GOODS, town, 0.8);
	holdModel.particles.step();
	assert.equal(holdModel.particles.count, 0, 'sells once buyer bid recovers above floor');
	assert.ok(holdModel.particles.lastProfit > 0);
	checkMachineConservation(holdModel);

	// 3. Perishable shrinks by spoilage, raises item.price, spot-sells underwater and books exact negative profit + spoiled mass.
	const spoilModel = clearedMap();
	spoilModel.setActor(factory, ECONOMY_FACTORY);
	spoilModel.setActor(town, ECONOMY_TOWN);
	spoilModel.particles.spoilRate[ITEM_GOODS] = 0.25;
	for (let x = 10; x <= 20; x++) spoilModel.priceGoods[economyIndex(x, 14)] = 1.0 + (x - 10) * 0.08;
	spoilModel.producedGoods = 0.08;
	spoilModel.particles.emit(ITEM_GOODS, factory, 0.08, 0.08 * 2.4, factory, PARTICLE_SPEED, 0);

	while (spoilModel.particles.count > 0) {
		spoilModel.earned.fill(0);
		spoilModel.particles.prepareStep();
		spoilModel.particles.setCap(ITEM_GOODS, town, 0.8);
		spoilModel.particles.step();
	}
	assert.ok(spoilModel.particles.spoiled[ITEM_GOODS] > 0.005);
	assert.ok(spoilModel.goods[town] > 0 && spoilModel.goods[town] < 0.08);
	assert.ok(spoilModel.particles.lastProfit < 0, 'spot-sale below cost books negative profit on producer');
	checkMachineConservation(spoilModel);
});

test('terrain speed table weights movement pace and scales per-cell haul cost as 1 / conductance', () => {
	function measureHaul(terrainKind) {
		const model = clearedMap();
		model.land.terrain.fill(terrainKind);
		model.land.refresh();
		const start = economyIndex(5, 14), end = economyIndex(15, 14);
		model.setActor(start, ECONOMY_FACTORY);
		model.setActor(end, ECONOMY_TOWN);
		for (let x = 5; x <= 15; x++) model.priceGoods[economyIndex(x, 14)] = 1.0 + (x - 5) * 0.3;
		model.producedGoods = 0.08;
		model.particles.emit(ITEM_GOODS, start, 0.08, 0.05, start, PARTICLE_SPEED * TERRAIN_SPEED[terrainKind], 0);
		let ticks = 0;
		while (model.particles.count > 0 && ticks < 1000) {
			model.particles.prepareStep();
			model.particles.setCap(ITEM_GOODS, end, 0.8);
			model.particles.step();
			ticks++;
		}
		checkMachineConservation(model);
		return { ticks, haulCost: model.particles.lastTransportCost };
	}

	const meadow = measureHaul(TERRAIN_MEADOW);
	const forest = measureHaul(TERRAIN_FOREST);
	const desert = measureHaul(TERRAIN_DESERT);
	assert.ok(meadow.ticks < forest.ticks && forest.ticks < desert.ticks);
	assert.ok(meadow.haulCost < forest.haulCost && forest.haulCost < desert.haulCost);
	closeMachine(desert.haulCost / meadow.haulCost, TERRAIN_SPEED[TERRAIN_MEADOW] / TERRAIN_SPEED[TERRAIN_DESERT], 1e-2);
});

test('UI boots cleanly in a stub DOM, renders particle overlays across views and updates ledgers', () => {
	const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
	const scripts = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g), m => m[1]);

	function makeCtx() {
		return {
			fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', font: '', textAlign: '', textBaseline: '', globalAlpha: 1, imageSmoothingEnabled: true,
			setTransform() {}, save() {}, restore() {}, translate() {}, beginPath() {}, closePath() {}, clip() {}, rect() {},
			fillRect() {}, clearRect() {}, strokeRect() {}, moveTo() {}, lineTo() {}, arc() {}, fill() {}, stroke() {}, fillText() {},
			drawImage() {}, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {},
			createLinearGradient: () => ({ addColorStop() {} })
		};
	}

	const byId = new Map();
	const allButtons = [];
	const metricCards = [];

	function makeEl(id = '', dataset = {}) {
		const listeners = {};
		const el = {
			id, dataset, hidden: false, disabled: false, checked: true, value: '1', textContent: '', innerHTML: '', open: false,
			clientWidth: 480, clientHeight: 280, offsetWidth: 120, offsetHeight: 60,
			style: {},
			classList: { toggle() {} },
			firstElementChild: { outerHTML: '' },
			lastElementChild: { textContent: '' },
			nextElementSibling: null,
			addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
			trigger(type, ev = {}) { for (const fn of listeners[type] || []) fn(ev); },
			setAttribute() {},
			matches: () => false,
			closest: () => ({ querySelector: () => makeEl() }),
			querySelector: sel => sel === 'canvas' ? makeEl() : sel === 'strong' ? makeEl() : makeEl(),
			getContext: () => makeCtx(),
			getBoundingClientRect: () => ({ left: 0, top: 0, right: 480, bottom: 280 }),
			showModal() { this.open = true; },
			close() { this.open = false; }
		};
		el.nextElementSibling = { hidden: true, textContent: '', style: {}, offsetWidth: 100, offsetHeight: 50 };
		if (id) byId.set(id, el);
		return el;
	}

	for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) makeEl(id);
	for (const id of ['price-decay', 'derived-bid', 'stock-suppression', 'show-flow']) byId.get(id).checked = true;
	byId.get('speed').value = '1';
	for (let i = 0; i < 5; i++) metricCards.push(makeEl());
	const resourceBtns = ['coal', 'goods', 'labor', 'depleted', 'gold', 'land'].map(r => { const b = makeEl('', { resource: r }); allButtons.push(b); return b; });
	const toolBtns = ['inspect', 'mine', 'factory', 'town', 'gold', 'erase'].map(t => { const b = makeEl('', { tool: t }); allButtons.push(b); return b; });

	const sandbox = vm.createContext({
		Math, Number, String, Array, Object, Uint8Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, Infinity,
		window: { devicePixelRatio: 1, addEventListener() {} },
		performance: { now: () => 1000 },
		requestAnimationFrame() {},
		getComputedStyle: () => ({ color: '#f3b765' }),
		matchMedia: () => ({ matches: true }),
		document: {
			getElementById: id => byId.get(id) || makeEl(id),
			createElement: () => makeEl(),
			addEventListener() {},
			fonts: { ready: { then() {} } },
			querySelectorAll(sel) {
				if (sel === '[data-icon]') return [];
				if (sel === '.metric') return metricCards;
				if (sel === '[data-tool]') return toolBtns;
				if (sel === '[data-resource]') return resourceBtns;
				return [];
			}
		}
	});

	for (const script of scripts) vm.runInContext(fs.readFileSync(path.join(__dirname, script), 'utf8'), sandbox, { filename: script });
	assert.ok(byId.get('actor-count').textContent.includes('1 M · 1 F · 1 T'));
	assert.ok(Number(byId.get('coal-made').textContent) > 1);
	for (const btn of resourceBtns) btn.trigger('click');
	byId.get('step-button').trigger('click');
	byId.get('resource-map').trigger('pointermove', { clientX: 120, clientY: 120 });
	assert.ok(byId.get('resource-map').nextElementSibling.textContent.includes('HaulVault') || byId.get('resource-map').nextElementSibling.textContent.includes('Town'));
});
