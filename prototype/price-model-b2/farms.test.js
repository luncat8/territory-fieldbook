// Owns: regression checks for self-moving resident workers, worker split/starvation, sawmills, seasonal farms and UI smoke wiring.
// Edit for: resident conservation, paid vs foraged wood/food flows, farmland moisture/waste rules and browser-stub coverage.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ENGINE_FILES = ['simulation.js', 'actors.js', 'towns.js', 'gold.js', 'workforce.js', 'land.js', 'farms.js', 'settlement.js', 'harvest.js'];
for (const file of ENGINE_FILES) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

const sum = (values) => values.reduce((total, value) => total + value, 0);
const closeTo = (actual, expected, eps = 1e-7) => assert.ok(Math.abs(actual - expected) < eps, `${actual} ≠ ${expected}`);

function run(model, seconds, each) {
	for (let n = 0; n < Math.round(seconds / ECONOMY_DT); n++) {
		if (each) each();
		model.step();
	}
}

function emptyMap(terrain = TERRAIN_MEADOW, forest = 0) {
	const model = new PriceEconomy();
	model.actors.fill(0);
	model.pop.fill(0);
	model.rooms.fill(0);
	model.fresh.fill(0);
	model.away.fill(0);
	model.scale.fill(0);
	model.taxMult.fill(0);
	model.labor.fill(0);
	model.depleted.fill(0);
	model.laborFlow.gold.fill(0);
	model.depletedFlow.gold.fill(0);
	model.land.terrain.fill(terrain);
	model.land.refresh();
	model.settlements.forestCap.fill(forest);
	model.money.reset();
	model.land.reset();
	model.settlements.reset();
	model.harvest.reset();
	model.farms.reset();
	model.workforce.resetResidents();
	return model;
}

function checkAllLedgers(model) {
	const h = model.harvest;
	closeTo(sum(model.coal), model.producedCoal - model.burnedCoal);
	closeTo(sum(model.goods), model.producedGoods - model.consumedGoods);
	closeTo(sum(h.wood), h.seededWood + h.harvestedWood - h.usedWood - h.builtWood);
	closeTo(sum(h.food), h.seededFood + h.harvestedFood - h.eatenFood);
	closeTo(sum(model.labor), model.suppliedLabor - model.workedLabor);
	closeTo(sum(model.depleted), model.emittedDepleted - model.restedDepleted);
	closeTo(model.totalWorkers(), model.seededWorkers + model.splitWorkers - model.starvedWorkers);
	closeTo(model.money.total(), model.money.seeded + model.money.mined);
	for (let i = 0; i < ECONOMY_SIZE; i++) {
		assert.ok(Number.isFinite(model.fresh[i]) && model.fresh[i] >= -1e-12);
		assert.ok(Number.isFinite(model.labor[i]) && model.labor[i] >= -1e-12);
		assert.ok(Number.isFinite(model.depleted[i]) && model.depleted[i] >= -1e-12);
		assert.ok(Number.isFinite(model.woodFlow.paid[i]) && model.woodFlow.paid[i] <= model.wood[i] + 1e-9);
		assert.ok(Number.isFinite(model.foodFlow.paid[i]) && model.foodFlow.paid[i] <= model.food[i] + 1e-9);
	}
}

test('towns never mint workers: residents sit home without wage gradients and self-commute when firms bid', () => {
	const idle = emptyMap(TERRAIN_MEADOW, 0);
	const town = economyIndex(20, 14);
	assert.equal(idle.setActor(town, ECONOMY_TOWN), true);
	const seeded = idle.seededWorkers;
	assert.ok(seeded > 0);
	run(idle, 10);
	closeTo(sum(idle.labor) - idle.labor[town], 0);
	assert.equal(idle.away[town], 0, 'without an external wage bid, no resident leaves town');
	assert.equal(idle.workedLabor, 0);
	closeTo(idle.totalWorkers(), seeded);
	checkAllLedgers(idle);

	const active = emptyMap(TERRAIN_MEADOW, 0);
	assert.equal(active.setActor(town, ECONOMY_TOWN), true);
	const mine = economyIndex(23, 14);
	assert.equal(active.setActor(mine, ECONOMY_MINE), true);
	run(active, 16);
	assert.ok(active.workedLabor > 0, 'commuting workers walk out on their own and staff the mine');
	assert.ok(active.restedDepleted > 0, 'tired workers walk home and rest back into resident slots');
	checkAllLedgers(active);
});

test('well-fed residents with spare rooms and savings split without minting gold; starving towns lose workers cleanly', () => {
	const fed = emptyMap(TERRAIN_MEADOW, FOREST_TERRAIN);
	const town = economyIndex(20, 14);
	assert.equal(fed.setActor(town, ECONOMY_TOWN), true);
	fed.rooms[town] = POP_BASE * 2.2;
	fed.money.workerPurse[town] += 80;
	fed.money.seeded += 80;
	const startPop = fed.pop[town];
	run(fed, 18, () => {
		const foodAdd = Math.max(0, 0.9 - fed.food[town]);
		const woodAdd = Math.max(0, 0.9 - fed.wood[town]);
		const goodsAdd = Math.max(0, 0.9 - fed.goods[town]);
		const coalAdd = Math.max(0, 0.9 - fed.coal[town]);
		fed.food[town] += foodAdd; fed.harvest.seededFood += foodAdd;
		fed.wood[town] += woodAdd; fed.harvest.seededWood += woodAdd;
		fed.goods[town] += goodsAdd; fed.producedGoods += goodsAdd;
		fed.coal[town] += coalAdd; fed.producedCoal += coalAdd;
	});
	assert.ok(fed.splitWorkers > 0, `expected worker split > 0, got ${fed.splitWorkers}`);
	assert.ok(fed.pop[town] > startPop, `fed town with spare rooms grows via split (${fed.pop[town]} <= ${startPop})`);
	checkAllLedgers(fed);

	const hungry = emptyMap(TERRAIN_DESERT, 0);
	hungry.harvest.wild.fill(0);
	assert.equal(hungry.setActor(town, ECONOMY_TOWN), true);
	hungry.harvest.seededFood -= hungry.food[town];
	hungry.food[town] = 0;
	run(hungry, 32);
	assert.ok(hungry.starvedWorkers > 0, `expected starvation losses > 0, got ${hungry.starvedWorkers}`);
	assert.ok(hungry.totalWorkers() < hungry.seededWorkers);
	checkAllLedgers(hungry);
});

test('sawmills fell patch forest into priced wood, earn gold from town wood bids, and idle on treeless ground', () => {
	const forested = emptyMap(TERRAIN_MEADOW, 0);
	for (let y = 0; y < ECONOMY_HEIGHT; y++) {
		for (let x = 21; x < ECONOMY_WIDTH; x++) {
			const c = economyIndex(x, y);
			forested.land.terrain[c] = TERRAIN_FOREST;
			forested.settlements.forestCap[c] = FOREST_TERRAIN;
			forested.settlements.forest[c] = FOREST_TERRAIN;
		}
	}
	forested.land.refresh();
	const town = economyIndex(17, 14), mill = economyIndex(22, 14);
	assert.equal(forested.setActor(town, ECONOMY_TOWN), true);
	assert.equal(forested.setActor(mill, ECONOMY_SAWMILL), true);
	const treesBefore = sum(forested.settlements.forest);
	run(forested, 24);
	assert.ok(forested.producedWood > 0.2, `sawmill produced ${forested.producedWood} wood`);
	assert.ok(sum(forested.settlements.forest) < treesBefore, 'sawmill fells patch trees');
	assert.ok(forested.harvest.usedWood > 0, 'town consumes delivered wood');
	assert.ok(sum(forested.money.streams[PAY_WOOD].ask) > 0 || forested.money.purse[mill] > 0, 'sawmill bills gold on PAY_WOOD');
	checkAllLedgers(forested);

	const barren = emptyMap(TERRAIN_DESERT, 0);
	assert.equal(barren.setActor(town, ECONOMY_TOWN), true);
	assert.equal(barren.setActor(mill, ECONOMY_SAWMILL), true);
	run(barren, 12);
	assert.equal(barren.producedWood, 0, 'sawmill on treeless terrain produces zero wood');
	checkAllLedgers(barren);
});

test('farms clear plots, drop seasonal harvests paid in gold, respect moisture/terrain, and dump waste outside plots', () => {
	const model = emptyMap(TERRAIN_MEADOW, 0.45);
	model.land.moisture.fill(0.58);
	model.harvest.wild.fill(0);
	const town = economyIndex(18, 14), farm = economyIndex(22, 14);
	assert.equal(model.setActor(town, ECONOMY_TOWN), true);
	assert.equal(model.setActor(farm, ECONOMY_FARM), true);

	run(model, 24);
	assert.ok(model.farms.plots[farm] > 0, 'farm claims nearby meadow plots');
	assert.ok(model.producedFood > 0.25, `farm produced seasonal food (${model.producedFood})`);
	assert.ok(model.harvest.eatenFood > 0.1, 'town buys and eats farm food');

	for (let dy = -FARM_RADIUS; dy <= FARM_RADIUS; dy++) {
		for (let dx = -FARM_RADIUS; dx <= FARM_RADIUS; dx++) {
			const c = economyIndex(22 + dx, 14 + dy);
			if (model.farms.plotOwner[c] === farm + 1) {
				assert.equal(model.settlements.forest[c], 0, 'cultivated farm plot stays cleared of regrowing forest');
			}
		}
	}

	let ringLitter = 0;
	for (let dy = -(FARM_RADIUS + 1); dy <= FARM_RADIUS + 1; dy++) {
		for (let dx = -(FARM_RADIUS + 1); dx <= FARM_RADIUS + 1; dx++) {
			if (Math.max(Math.abs(dx), Math.abs(dy)) === FARM_RADIUS + 1) ringLitter += model.land.litter[economyIndex(22 + dx, 14 + dy)];
		}
	}
	assert.ok(ringLitter > 0, 'seasonal farm fertilizer waste lands on the outer ring rather than poisoning farm plots');
	checkAllLedgers(model);

	const swampCell = economyIndex(10, 10), desertCell = economyIndex(11, 10), moistCell = economyIndex(12, 10), dryCell = economyIndex(13, 10);
	model.land.terrain[swampCell] = TERRAIN_SWAMP;
	model.land.terrain[desertCell] = TERRAIN_DESERT;
	model.land.terrain[moistCell] = TERRAIN_MEADOW;
	model.land.terrain[dryCell] = TERRAIN_MEADOW;
	model.land.moisture[moistCell] = 0.58;
	model.land.moisture[dryCell] = 0.1;
	assert.equal(model.farms.quality(swampCell), 0);
	assert.equal(model.farms.quality(desertCell), 0);
	assert.equal(model.farms.quality(dryCell), 0);
	assert.ok(model.farms.quality(moistCell) > 0.7);

	assert.equal(model.setActor(farm, 0), true);
	assert.equal(model.farms.plotOwner.some((owner) => owner === farm + 1), false, 'erasing farm releases owned plots');
	checkAllLedgers(model);
});


test('plot clearing conserves forest: a full wood cell holds felling and the plot is claimed only once cleared', () => {
	const model = emptyMap(TERRAIN_MEADOW, 0);
	const farm = economyIndex(24, 14), plot = economyIndex(24, 13);
	assert.equal(model.setActor(farm, ECONOMY_FARM), true);
	for (let dy = -FARM_RADIUS; dy <= FARM_RADIUS; dy++) {
		for (let dx = -FARM_RADIUS; dx <= FARM_RADIUS; dx++) {
			const c = economyIndex(24 + dx, 14 + dy);
			if (c !== farm && c !== plot) model.land.waste[c] = 1; // every other cell in range is too disturbed to claim
		}
	}
	model.settlements.forestCap[plot] = 1;
	model.settlements.forest[plot] = 1;
	model.wood[plot] = 0.99; // nearly full: only 0.01 wood fits
	model.harvest.seededWood += 0.99;
	model.labor[farm] = 1;
	model.suppliedLabor += 1;
	model.seededWorkers += 1;
	model.farms.clearWork[farm] = 100; // enough visits that the single legal cell is hit many times
	model.farms.stepFarm(farm, model.optimizer.recipes[ECONOMY_FARM]);

	assert.ok(model.settlements.forest[plot] > 0.99, `unfelled forest stands (${model.settlements.forest[plot]})`);
	closeTo(model.wood[plot], 1, 1e-9);
	closeTo(model.settlements.forest[plot] + model.wood[plot] / WOOD_PER_FOREST, 1 + 0.99 / WOOD_PER_FOREST, 1e-9);
	assert.equal(model.farms.plots[farm], 0, 'plot is not claimed while forest stands');
	assert.equal(model.farms.plotOwner[plot], 0);

	model.harvest.usedWood += model.wood[plot]; // buyers haul the cell's timber away
	model.wood[plot] = 0;
	model.settlements.forest[plot] = 0.5;
	model.farms.clearWork[farm] = 100;
	model.farms.stepFarm(farm, model.optimizer.recipes[ECONOMY_FARM]);

	assert.equal(model.farms.plotOwner[plot], farm + 1, 'cleared cell becomes a plot');
	assert.equal(model.settlements.forest[plot], 0);
	closeTo(model.wood[plot], 0.5 * WOOD_PER_FOREST, 1e-9);
	checkAllLedgers(model);
});

test('mixed wild forage and commercial farm food only bill gold on the commercial share', () => {
	const model = emptyMap(TERRAIN_MEADOW, FOREST_TERRAIN);
	model.land.moisture.fill(0.58);
	const town = economyIndex(20, 14), farm = economyIndex(24, 14);
	assert.equal(model.setActor(town, ECONOMY_TOWN), true);
	assert.equal(model.setActor(farm, ECONOMY_FARM), true);
	// Seed abundant wild food right next to the town alongside the commercial farm so both streams mix.
	model.harvest.wild[economyIndex(19, 14)] = 1;
	model.harvest.wild[economyIndex(20, 13)] = 1;
	run(model, 25);
	assert.ok(model.harvest.harvestedFood > 0, 'town also gathered free wild food');
	assert.ok(model.producedFood > 0, 'farm produced commercial food');
	checkAllLedgers(model);
});

test('reference map runs cleanly with sawmills, farms, self-moving residents and full conservation', () => {
	const model = new PriceEconomy();
	let sawmills = 0, farms = 0;
	for (let i = 0; i < ECONOMY_SIZE; i++) {
		if (model.actors[i] === ECONOMY_SAWMILL) sawmills++;
		if (model.actors[i] === ECONOMY_FARM) farms++;
	}
	assert.ok(sawmills >= 1 && farms >= 1, 'reference map includes starter sawmill and farm');
	run(model, 30);
	assert.ok(model.producedWood > 0, 'reference sawmill fells wood');
	assert.ok(model.producedFood > 0, 'reference farm harvests seasonal food');
	checkAllLedgers(model);
});

test('UI smoke check: index.html scripts, FieldPlot, EconomyTelemetry and Sawmill/Farm tools run cleanly on stub DOM', () => {
	const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
	const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
	assert.ok(scripts.includes('farms.js'), 'index.html loads farms.js');
	assert.ok(scripts.indexOf('farms.js') < scripts.indexOf('fields.js'), 'farms.js loads before fields.js');

	const makeCtx = () => ({
		fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', globalAlpha: 1,
		font: '', textAlign: 'left', textBaseline: 'alphabetic', imageSmoothingEnabled: true,
		setTransform() {}, save() {}, restore() {}, translate() {}, beginPath() {}, closePath() {},
		rect() {}, clip() {}, fillRect() {}, strokeRect() {}, clearRect() {}, drawImage() {},
		moveTo() {}, lineTo() {}, arc() {}, fill() {}, stroke() {}, fillText() {},
		putImageData() {},
		createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
		createLinearGradient: () => ({ addColorStop() {} })
	});
	const makeEl = (id = '') => {
		const listeners = {};
		const el = {
			id, hidden: false, disabled: false, checked: true, value: '1', textContent: '', innerHTML: '',
			clientWidth: 480, clientHeight: 260, offsetWidth: 120, offsetHeight: 60,
			dataset: {}, style: {},
			classList: { toggle() {} },
			firstElementChild: { outerHTML: '' },
			lastElementChild: { textContent: '' },
			nextElementSibling: null,
			getContext: () => makeCtx(),
			getBoundingClientRect: () => ({ left: 0, top: 0, right: 480, bottom: 260 }),
			addEventListener: (ev, fn) => { (listeners[ev] ||= []).push(fn); },
			trigger: (ev, payload = {}) => { for (const fn of listeners[ev] || []) fn(payload); },
			setAttribute(k, v) { this[k] = String(v); },
			matches: () => false,
			closest: () => ({ querySelector: () => makeEl() }),
			querySelector: () => makeEl(),
			showModal() { this.open = true; },
			close() { this.open = false; }
		};
		el.nextElementSibling = { hidden: true, textContent: '', style: {}, offsetWidth: 120, offsetHeight: 60 };
		return el;
	};

	const elements = new Map();
	const getEl = (id) => {
		if (!elements.has(id)) elements.set(id, makeEl(id));
		return elements.get(id);
	};
	const toolButtons = ['inspect', 'mine', 'factory', 'sawmill', 'farm', 'town', 'gold', 'erase'].map((t) => {
		const b = makeEl(`tool-${t}`);
		b.dataset.tool = t;
		return b;
	});
	const resourceButtons = ['coal', 'goods', 'wood', 'food', 'labor', 'depleted', 'gold', 'land'].map((r) => {
		const b = makeEl(`res-${r}`);
		b.dataset.resource = r;
		return b;
	});
	const edgeButtons = ['wrap', 'bounded'].map((e) => {
		const b = makeEl(`edge-${e}`);
		b.dataset.mapEdge = e;
		return b;
	});
	const metricCards = Array.from({ length: 5 }, () => ({
		querySelector: (sel) => sel === 'canvas' ? makeEl() : sel === 'strong' ? makeEl() : { style: {} }
	}));

	const prev = { window: globalThis.window, document: globalThis.document, matchMedia: globalThis.matchMedia, getComputedStyle: globalThis.getComputedStyle, requestAnimationFrame: globalThis.requestAnimationFrame };
	Object.assign(globalThis, {
		window: { devicePixelRatio: 1, addEventListener() {} },
		matchMedia: () => ({ matches: true }),
		getComputedStyle: () => ({ color: '#fff' }),
		requestAnimationFrame() {},
		document: {
			getElementById: getEl,
			createElement: () => makeEl(),
			addEventListener() {},
			fonts: { ready: { then() {} } },
			querySelectorAll: (sel) => {
				if (sel === '[data-icon]') return [];
				if (sel === '.metric') return metricCards;
				if (sel === '[data-tool]') return toolButtons;
				if (sel === '[data-resource]') return resourceButtons;
				if (sel === '[data-map-edge]') return edgeButtons;
				return [];
			}
		}
	});
	try {
		for (const file of ['fields.js', 'telemetry.js', 'app.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

		assert.match(getEl('actor-count').textContent, /1 S · 1 A/, 'actor badge reports starter sawmill and farm');
		assert.match(getEl('grid-size').textContent, /wrap/, 'grid badge shows the torus default');
		edgeButtons.find((b) => b.dataset.mapEdge === 'bounded').trigger('click');
		assert.match(getEl('grid-size').textContent, /bounded/, 'grid badge follows the topology switch');
		assert.equal(MAP_WRAP, false, 'bounded button swaps the engine topology');
		edgeButtons[0].trigger('click');
		assert.equal(MAP_WRAP, true, 'wrap button restores the torus');
		assert.ok(Number(getEl('workers-held').textContent) > 0, 'worker conservation ledger renders live headcount');
		for (const id of ['wood-in', 'wood-firm', 'food-in', 'food-firm', 'workers-seeded', 'workers-split', 'workers-starved', 'workers-held']) {
			assert.equal(Number.isNaN(Number(getEl(id).textContent)), false, `${id} should not be NaN`);
		}

		for (const btn of resourceButtons) {
			btn.trigger('click');
			getEl('step-button').trigger('click');
		}
		const sawmillBtn = toolButtons.find((b) => b.dataset.tool === 'sawmill');
		const farmBtn = toolButtons.find((b) => b.dataset.tool === 'farm');
		sawmillBtn.trigger('click');
		assert.match(getEl('tool-hint').textContent, /sawmill/i);
		farmBtn.trigger('click');
		assert.match(getEl('tool-hint').textContent, /farm/i);

		getEl('resource-map').trigger('click', { clientX: 22 + 15.5 * 9, clientY: 9 + 14.5 * 8 });
		const inspectBtn = toolButtons.find((b) => b.dataset.tool === 'inspect');
		inspectBtn.trigger('click');
		getEl('resource-map').trigger('pointermove', { clientX: 22 + 15.5 * 9, clientY: 9 + 14.5 * 8 });
		assert.ok(getEl('resource-map').nextElementSibling.textContent.length > 20, 'cell tooltip renders without error');
	} finally {
		Object.assign(globalThis, prev);
	}
});
