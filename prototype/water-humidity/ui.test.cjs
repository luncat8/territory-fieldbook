// Owns: boot and control smoke test for the standalone page, with a stub DOM and no browser.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML_DEFAULTS = {
	scenario: 'coast', seed: '20261119', speed: '2', 'rain-mode': 'local'
};

function makeElement(id, tag, frameCallbacks) {
	const ctx2d = {
		createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
		putImageData() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, stroke() {}, fill() {},
		strokeStyle: '', lineWidth: 1, fillStyle: ''
	};
	const el = {
		id, tagName: tag || 'div', dataset: {}, children: [], style: {}, checked: true,
		textContent: '', value: HTML_DEFAULTS[id] === undefined ? '' : HTML_DEFAULTS[id],
		width: 64, height: 64,
		getContext: () => ctx2d,
		getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 512 }),
		addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); },
		setAttribute(key, value) { this.attributes[key] = value; },
		getAttribute(key) { return this.attributes[key]; },
		appendChild(child) { this.children.push(child); return child; },
		matches() { return false; },
		listeners: {}, attributes: {}
	};
	return el;
}

function boot() {
	const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
	const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
	assert.deepEqual(scripts, ['terrain.js', 'simulation.js', 'palette.js', 'fields.js', 'app.js']);
	const elements = new Map();
	const frames = [];
	const document = {
		getElementById(id) {
			if (!elements.has(id)) elements.set(id, makeElement(id, 'div', frames));
			return elements.get(id);
		},
		createElement(tag) { return makeElement('', tag, frames); },
		addEventListener() {}
	};
	const context = vm.createContext({
		document, console, Uint8ClampedArray, Uint8Array, Float64Array, Int32Array, Math, Infinity,
		requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
		performance: { now: () => 0 }
	});
	for (const file of scripts) vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context, { filename: file });
	return { run: code => vm.runInContext(code, context), elements, frames };
}

test('page boots in load order, warms up and paints every layer', () => {
	const { run, elements, frames } = boot();
	const state = run('lab');
	assert.equal(state.view, 'composite');
	assert.ok(state.model && state.model.ticks > 1000, 'warm-up did not run');
	assert.equal(state.model.scenario, 'coast');
	assert.equal(elements.get('view-tabs').children.length, 7);
	assert.equal(elements.get('sliders').children.length, 3);
	assert.equal(elements.get('scenario').children.length, 6);
	assert.equal(state.minis.length, 6);
	assert.equal(state.sparks.length, 2);
	assert.ok(state.main.image, 'main plot has no ImageData');
	assert.equal(frames.length, 1, 'the animation loop must start once');
	const metrics = run('waterMetrics(lab.model)');
	assert.ok(metrics.rainTotal > 0, 'no rain after warm-up');
	assert.equal(metrics.rainOnSea, 0);
	assert.ok(Math.abs(metrics.ledgerResidual) < 1e-6);
	assert.ok(elements.get('m-water').textContent !== '0', 'readouts were not written');
	assert.ok(elements.get('sim-time').textContent.startsWith('01:'), 'clock readout missing');
});

test('view switching, pause, step and a frame all work headlessly', () => {
	const { run, elements, frames } = boot();
	run("labSetView('group')");
	assert.equal(run('lab.view'), 'group');
	assert.equal(elements.get('view-title').textContent, 'Water grouping demand');
	run('labToggleRun()');
	assert.equal(run('lab.running'), false);
	assert.equal(elements.get('run-state').textContent, 'Paused');
	const ticks = run('lab.model.ticks');
	run('lab.model.step(); labPaint(); labReadout();');
	assert.equal(run('lab.model.ticks'), ticks + 1);
	assert.ok(run('waterMetrics(lab.model).ledgerResidual') < 1e-6);
	const before = run('lab.model.ticks');
	frames[0](1000);
	frames[0](1050);
	assert.equal(run('lab.model.ticks'), before, 'a paused frame must not step');
	run('labToggleRun()');
	frames[frames.length - 1](1100);
	assert.ok(run('lab.model.ticks') > before, 'a running frame must step');
});

test('A/B controls change the model without a rebuild', () => {
	const { run, elements } = boot();
	const rain = run('waterMetrics(lab.model).rainTotal');
	assert.ok(rain > 0);
	run("lab.model.rainMode = 'off'");
	run('lab.model.step()');
	assert.equal(run('waterMetrics(lab.model).rainTotal'), 0);
	run("lab.model.rainMode = 'local'; lab.model.grouping = false");
	run('for (let k = 0; k < 20; k++) lab.model.step()');
	assert.equal(run('waterMetrics(lab.model).groupMax'), 0);
	assert.equal(run('waterMetrics(lab.model).rainTotal'), 0);
	assert.ok(Math.abs(run('waterMetrics(lab.model).ledgerResidual')) < 1e-6);
	assert.equal(elements.get('show-flow').checked, true);
});
