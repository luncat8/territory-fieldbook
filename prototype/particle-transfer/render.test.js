// Owns: render verification — heading-triangle default, single-pixel points and large-8th particle shapes on both item and worker views.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const file of ['simulation.js', 'steering.js', 'particles.js', 'workers.js', 'track.js', 'actors.js', 'gold.js', 'workforce.js', 'land.js', 'settlement.js', 'fields.js']) {
	vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });
}

const DRAW_CALLS = ['fillRect', 'strokeRect', 'beginPath', 'closePath', 'rect', 'clip', 'save', 'restore', 'translate', 'setTransform', 'putImageData', 'drawImage', 'fillText', 'stroke', 'fill', 'moveTo', 'lineTo', 'arc', 'clearRect'];

function makeCtx() {
	const counts = {};
	const ctx = { counts, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', globalAlpha: 1, font: '', textAlign: '', textBaseline: '' };
	for (const name of DRAW_CALLS) ctx[name] = () => { counts[name] = (counts[name] || 0) + 1; };
	ctx.createImageData = (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
	return ctx;
}

function makeCanvas() {
	const ctx = makeCtx();
	return {
		width: 0,
		height: 0,
		clientWidth: 560,
		clientHeight: 320,
		style: {},
		getContext: () => ctx,
		nextElementSibling: { hidden: true, textContent: '', style: {}, offsetWidth: 100, offsetHeight: 40 },
		closest: () => ({ querySelector: () => ({ innerHTML: '', style: {} }) })
	};
}

globalThis.window = { devicePixelRatio: 1 };
globalThis.document = { createElement: () => makeCanvas() };

function freshModel() {
	const model = new PriceEconomy();
	model.actors.fill(0);
	model.pop.fill(0);
	model.particles.reset();
	model.workers.reset();
	model.land.terrain.fill(TERRAIN_MEADOW);
	model.land.refresh();
	for (let k = 0; k < 20; k++) {
		const i = economyIndex(10 + (k % 10), 14);
		model.particles.emit(ITEM_COAL, i, 0.05, 0.01, i, PARTICLE_SPEED, 0);
		model.particles.emit(ITEM_GOODS, i, 0.05, 0.01, i, 0, PARTICLE_SPEED);
	}
	const pool = economyIndex(4, 4);
	model.labor[pool] = 2 * WORKER_UNIT;
	for (let k = 0; k < 2; k++) {
		const p = model.workers.emitFrom(STATE_FRESH, pool, WORKER_UNIT);
		model.workers.vx[p] = WORKER_SPEED;
	}
	return model;
}

function coalCount(model) {
	let n = 0;
	for (let p = 0; p < model.particles.count; p++) if (model.particles.kind[p] === ITEM_COAL) n++;
	return n;
}

function largeCount(model) {
	let n = 0;
	for (let p = 0; p < model.particles.count; p++) if (model.particles.kind[p] === ITEM_COAL && (p & 7) === 0) n++;
	return n;
}

test('particle views draw heading triangles by default and honour the points and large-8th settings', () => {
	const model = freshModel();
	const plot = new FieldPlot(makeCanvas(), true);
	plot.resource = 'coal';
	plot.fit();
	plot.readActors(model.actors);
	plot.rescale(plot.fieldFor(model), model);
	const count = name => plot.ctx.counts[name] || 0;
	const reset = () => { for (const name of DRAW_CALLS) delete plot.ctx.counts[name]; };
	const total = coalCount(model);

	plot.drawParticles(model, false);
	assert.equal(count('arc'), 0, 'default mode draws no round dots');
	assert.equal(count('moveTo'), total, 'one heading triangle per particle');
	assert.equal(count('fill'), total);
	assert.equal(count('lineTo'), total * 2);
	reset();

	plot.shape = 'points';
	plot.drawParticles(model, false);
	assert.equal(count('fillRect'), total, 'points mode draws one pixel per particle');
	assert.equal(count('moveTo'), 0, 'points mode draws no triangles');
	reset();

	plot.shape = 'large';
	plot.drawParticles(model, false);
	assert.ok(largeCount(model) > 0 && largeCount(model) < total, 'the large mode keeps only an eighth of the particles');
	assert.equal(count('moveTo'), largeCount(model));
	assert.equal(count('arc'), 0);
	reset();

	plot.resource = 'labor';
	plot.shape = 'triangles';
	plot.rescale(plot.fieldFor(model), model);
	plot.drawParticles(model, false);
	assert.equal(count('moveTo'), 2, 'fresh walkers render as heading triangles too');
	assert.equal(count('arc'), 0);
});

test('a full stock-map paint with default particles completes without throwing', () => {
	const model = freshModel();
	const plot = new FieldPlot(makeCanvas(), true);
	plot.resource = 'coal';
	plot.fit();
	plot.readActors(model.actors);
	plot.draw(model, -1, false);
	assert.ok((plot.ctx.counts.drawImage || 0) >= 2, 'terrain raster and grid both paint');
	assert.ok((plot.ctx.counts.fill || 0) > 0, 'particles paint above the terrain');
});
