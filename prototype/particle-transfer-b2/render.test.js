// Owns: render verification — heading-triangle default, single-pixel points, large-8th shapes and gold-flow arrows.
// Edit for: FieldPlot shape modes in fields.js and the stub canvas draw-call counters.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPTS = ['simulation.js', 'land.js', 'steering.js', 'forage.js', 'gold.js', 'owners.js', 'banks.js', 'goods.js', 'workforce.js', 'workers.js', 'worker-life.js', 'farms.js', 'actors.js', 'towns.js', 'settlement.js', 'founding.js', 'track.js', 'fields.js'];
for (const file of SCRIPTS) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

const DRAW_CALLS = ['fillRect', 'strokeRect', 'beginPath', 'closePath', 'rect', 'clip', 'save', 'restore', 'translate', 'setTransform', 'putImageData', 'drawImage', 'fillText', 'stroke', 'fill', 'moveTo', 'lineTo', 'arc', 'clearRect'];

function makeCtx() {
	const counts = {};
	const ctx = { counts, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', globalAlpha: 1, font: '', textAlign: '', textBaseline: '', imageSmoothingEnabled: true };
	for (const name of DRAW_CALLS) ctx[name] = (...args) => {
		for (const a of args) assert.ok(!Number.isFinite(a) || Number.isFinite(a), `non-finite draw arg ${a}`);
		counts[name] = (counts[name] || 0) + 1;
	};
	ctx.createImageData = (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
	ctx.createLinearGradient = () => ({ addColorStop() {} });
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
	model.workers.reset();
	model.goodsPool.reset();
	model.land.terrain.fill(TERRAIN_MEADOW);
	model.land.refresh();
	for (let k = 0; k < 20; k++) {
		const i = economyIndex(10 + (k % 10), 14);
		model.goodsPool.emit(ITEM_COAL, i, 0.05, 0.01);
		model.goodsPool.emit(ITEM_GOODS, i, 0.05, 0.01);
	}
	for (let k = 0; k < 2; k++) {
		const w = model.workers.spawn(4.5 + k, 4.5, WORKER_WALK_JOB, 0, 8, 1, true);
		model.workers.hx[w] = 1;
		model.workers.hy[w] = 0;
	}
	return model;
}

function kindCount(pool, kind) {
	let n = 0;
	for (let p = 0; p < pool.count; p++) if (pool.kind[p] === kind) n++;
	return n;
}

function largeCount(pool, kind) {
	let n = 0;
	for (let p = 0; p < pool.count; p++) if (pool.kind[p] === kind && (p & 7) === 0) n++;
	return n;
}

test('particle views draw heading triangles by default and honour the points and large-8th settings', () => {
	const model = freshModel();
	const plot = new FieldPlot(makeCanvas(), true);
	plot.resource = 'coal';
	plot.fit();
	plot.readActors(model.actors);
	const count = name => plot.ctx.counts[name] || 0;
	const reset = () => { for (const name of DRAW_CALLS) delete plot.ctx.counts[name]; };
	const total = kindCount(model.goodsPool, ITEM_COAL);

	plot.drawParticles(model, false);
	assert.equal(count('arc'), 0, 'default mode draws no round dots');
	assert.equal(count('moveTo'), total, 'one heading triangle per particle');
	assert.equal(count('fill'), total);
	assert.equal(count('lineTo'), total * 2, 'two base corners per triangle');
	assert.equal(count('fillRect'), 0, 'default mode draws no points');
	reset();

	plot.shape = 'points';
	plot.drawParticles(model, false);
	assert.equal(count('fillRect'), total, 'points mode draws one pixel per particle');
	assert.equal(count('moveTo'), 0, 'points mode draws no triangles');
	reset();

	plot.shape = 'large';
	plot.drawParticles(model, false);
	const large = largeCount(model.goodsPool, ITEM_COAL);
	assert.ok(large > 0 && large < total, `the large mode keeps only an eighth of the particles (${large}/${total})`);
	assert.equal(count('moveTo'), large);
	assert.equal(count('arc'), 0);
	reset();

	plot.resource = 'labor';
	plot.shape = 'triangles';
	plot.drawParticles(model, false);
	assert.equal(count('moveTo'), 2, 'walking workers render as heading triangles too');
	assert.equal(count('arc'), 0);
});

test('motion tails draw behind heading particles only when flow is on', () => {
	const model = freshModel();
	const plot = new FieldPlot(makeCanvas(), true);
	plot.resource = 'labor'; // walking workers carry a heading; parked goods emit with zero velocity
	plot.fit();
	const count = name => plot.ctx.counts[name] || 0;
	plot.drawParticles(model, false);
	const quietMoveTo = count('moveTo');
	const quietStroke = count('stroke');
	plot.drawParticles(model, true);
	assert.ok(count('moveTo') > quietMoveTo, 'triangles still paint with flow on');
	assert.ok(count('stroke') > quietStroke, 'flow on adds a tail stroke per moving particle');
});

test('gold stock view paints value-flux arrows from walking wallets and full paint completes', () => {
	const model = freshModel();
	const plot = new FieldPlot(makeCanvas(), true);
	plot.resource = 'gold';
	plot.fit();
	plot.readActors(model.actors);
	plot.drawFlows(model);
	assert.ok((plot.ctx.counts.stroke || 0) > 0, 'gold-weighted wallet motion emits arrows');
	plot.resource = 'coal';
	plot.draw(model, -1, true);
	assert.ok((plot.ctx.counts.drawImage || 0) >= 2, 'terrain raster and grid both paint');
	assert.ok((plot.ctx.counts.fill || 0) > 0, 'particles paint above the terrain');
});
