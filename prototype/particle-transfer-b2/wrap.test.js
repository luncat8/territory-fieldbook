// Owns: torus topology tests — neighbour rebuilds, wrapCell/torusDelta, seam-crossing scans and live edge swaps.
// Edit for: MAP_WRAP helpers in simulation.js, coarse rebuild in forage.js and cone stamping in land.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPTS = ['simulation.js', 'land.js', 'steering.js', 'forage.js', 'owners.js', 'gold.js', 'goods.js', 'workforce.js', 'workers.js', 'worker-life.js', 'farms.js', 'actors.js', 'towns.js', 'settlement.js', 'founding.js', 'track.js'];
for (const file of SCRIPTS) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

test('torus gives corner cells all 8 neighbours while bounded edges keep 3', () => {
	setMapWrap(true);
	const corner = economyIndex(0, 0);
	for (let k = 0; k < DEGREE; k++) assert.notEqual(NEIGHBORS[corner * DEGREE + k], -1, `wrap neighbour ${k}`);
	assert.equal(wrapCell(-1, 0), economyIndex(ECONOMY_WIDTH - 1, 0));
	assert.equal(wrapCell(0, -1), economyIndex(0, ECONOMY_HEIGHT - 1));
	assert.equal(wrapCell(ECONOMY_WIDTH, ECONOMY_HEIGHT - 1), economyIndex(0, ECONOMY_HEIGHT - 1));
	assert.equal(torusDelta(ECONOMY_WIDTH - 1, ECONOMY_WIDTH), -1);
	assert.equal(torusDelta(1 - ECONOMY_WIDTH, ECONOMY_WIDTH), 1);
	assert.equal(torusDelta(5, ECONOMY_WIDTH), 5, 'short deltas stay untouched');
	setMapWrap(false);
	let open = 0;
	for (let k = 0; k < DEGREE; k++) if (NEIGHBORS[corner * DEGREE + k] >= 0) open++;
	assert.equal(open, 3, 'bounded corner keeps only interior neighbours');
	assert.equal(wrapCell(-1, 0), -1, 'bounded edge reports off-map');
	setMapWrap(true);
});

test('cones, coarse neighbours and garden plots stamp across the seam only on a torus', () => {
	setMapWrap(true);
	const model = new PriceEconomy();
	model.land.stampCone(model.land.claim, economyIndex(0, 10), 3, 1);
	assert.ok(model.land.claim[economyIndex(ECONOMY_WIDTH - 1, 10)] > 0, 'claim cone crosses the X seam');
	assert.ok(model.land.claim[economyIndex(ECONOMY_WIDTH - 2, 9)] > 0, 'claim cone reaches diagonally across the seam');
	assert.ok(model.land.claim[economyIndex(2, 10)] > 0, 'claim cone still stamps inwards');
	const forage = model.forage;
	const west = forage.coarseNeighbors[2]; // coarse cell (0,0), direction (-1, 0)
	assert.equal(west % forage.cw, forage.cw - 1, 'coarse gradient links across the X seam');
	setMapWrap(false);
	model.land.claim.fill(0);
	model.land.stampCone(model.land.claim, economyIndex(0, 10), 3, 1);
	assert.equal(model.land.claim[economyIndex(ECONOMY_WIDTH - 1, 10)], 0, 'bounded cone stops at the rim');
	model.forage.rebuildCoarse();
	assert.equal(forage.coarseNeighbors[2], -1, 'bounded coarse table drops the seam link');
	setMapWrap(true);
	model.forage.rebuildCoarse();
	assert.notEqual(forage.coarseNeighbors[2], -1, 'torus rebuild restores the seam link');
});

test('map edges swap mid-run while positions, gold and headcount stay conserved', () => {
	setMapWrap(true);
	const model = new PriceEconomy();
	const toggle = wrap => {
		setMapWrap(wrap);
		model.land.refresh();
		model.forage.rebuildCoarse();
		model.forage.warm();
	};
	for (let n = 0; n < 600; n++) model.step();
	toggle(false);
	for (let n = 0; n < 600; n++) model.step();
	toggle(true);
	for (let n = 0; n < 600; n++) model.step();
	const { workers, goodsPool, money } = model;
	for (let w = 0; w < workers.count; w++) {
		assert.ok(workers.x[w] >= 0 && workers.x[w] < ECONOMY_WIDTH, `worker x ${workers.x[w]}`);
		assert.ok(workers.y[w] >= 0 && workers.y[w] < ECONOMY_HEIGHT, `worker y ${workers.y[w]}`);
		assert.notEqual(model.land.terrain[workers.cell[w]], TERRAIN_WATER);
	}
	for (let p = 0; p < goodsPool.count; p++) {
		assert.ok(goodsPool.x[p] >= 0 && goodsPool.x[p] < ECONOMY_WIDTH, `goods x ${goodsPool.x[p]}`);
		assert.ok(goodsPool.y[p] >= 0 && goodsPool.y[p] < ECONOMY_HEIGHT, `goods y ${goodsPool.y[p]}`);
	}
	assert.ok(Math.abs(money.total() - (money.seeded + money.mined)) < 1e-9, 'gold conserved across edge swaps');
	assert.ok(Math.abs((workers.seededWorkers + workers.births - model.workerLife.deaths) - workers.totalAmount()) < 1e-9, 'headcount conserved across edge swaps');
	assert.ok(Math.abs((workers.seededTired + model.workedLabor - model.restedDepleted - model.workerLife.removedTired) - workers.totalTired()) < 1e-7, 'tired ledger conserved across edge swaps');
});
