// Owns: browser DOM, canvas, resource-tab, garden-tool and watched-worker smoke tests for Particle Transfer B2.
// Edit for: index.html script load order, DOM id bindings and finite-coordinate canvas rendering checks.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function finiteAll(...nums) {
	for (const n of nums) assert.ok(Number.isFinite(n), `Non-finite canvas arg: ${n}`);
}

function makeCtx() {
	return {
		fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '', globalAlpha: 1, imageSmoothingEnabled: true,
		setTransform(...a) { finiteAll(...a); },
		clearRect(...a) { finiteAll(...a); },
		fillRect(...a) { finiteAll(...a); },
		strokeRect(...a) { finiteAll(...a); },
		beginPath() {}, closePath() {}, save() {}, restore() {}, clip() {}, fill() {}, stroke() {},
		translate(x, y) { finiteAll(x, y); },
		rect(x, y, w, h) { finiteAll(x, y, w, h); },
		moveTo(x, y) { finiteAll(x, y); },
		lineTo(x, y) { finiteAll(x, y); },
		arc(x, y, r, s, e) { finiteAll(x, y, r, s, e); assert.ok(r >= 0); },
		fillText(txt, x, y) { assert.equal(typeof txt, 'string'); finiteAll(x, y); },
		drawImage(_img, x, y, w, h) { finiteAll(x, y, w, h); },
		putImageData() {},
		createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
		createLinearGradient(x0, y0, x1, y1) { finiteAll(x0, y0, x1, y1); return { addColorStop() {} }; }
	};
}

function makeNode(tag = 'DIV', id = '', depth = 0) {
	const listeners = {};
	const node = {
		id, tagName: tag, className: '', textContent: '', innerHTML: '', outerHTML: '', hidden: false, disabled: false, open: false,
		checked: true, value: '1', clientWidth: 480, clientHeight: 280, offsetWidth: 160, offsetHeight: 72, width: 480, height: 280,
		style: {}, dataset: {}, children: [], parent: null, nextElementSibling: null,
		classList: { toggle() {} },
		setAttribute() {},
		appendChild() {},
		select() {},
		remove() {},
		getContext() { return this._ctx || (this._ctx = makeCtx()); },
		getBoundingClientRect() { return { left: 0, top: 0, right: 480, bottom: 280, width: 480, height: 280 }; },
		addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
		dispatch(type, ev = {}) { for (const fn of listeners[type] || []) fn({ preventDefault() {}, target: node, ...ev }); },
		click() { this.dispatch('click', { clientX: 205, clientY: 160 }); },
		closest() { return cardStub; },
		matches() { return true; },
		showModal() { this.open = true; },
		close() { this.open = false; },
		querySelector(sel) {
			if (sel === 'canvas') return makeNode('CANVAS', '', 1);
			node._q = node._q || {};
			return node._q[sel] || (node._q[sel] = makeNode('SPAN', '', 1));
		}
	};
	if (!depth) {
		node.firstElementChild = makeNode('SPAN', '', 1);
		node.lastElementChild = makeNode('SPAN', '', 1);
	}
	return node;
}

const cardStub = { querySelector() { return makeNode('SPAN', '', 1); } };

function bootLab() {
	const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
	const scripts = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g), m => m[1]);
	assert.equal(scripts.length, 22);
	const byId = new Map();
	for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) {
		const node = makeNode(id.includes('map') || id.includes('relief') ? 'CANVAS' : 'DIV', id);
		node.nextElementSibling = makeNode('OUTPUT');
		byId.set(id, node);
	}
	const metrics = Array.from({ length: 5 }, () => makeNode('DIV'));
	const resources = ['coal', 'food', 'goods', 'labor', 'depleted', 'forage', 'gold', 'land'].map(r => { const b = makeNode('BUTTON'); b.dataset.resource = r; return b; });
	const tools = ['inspect', 'mine', 'factory', 'town', 'gold', 'garden', 'farm', 'erase'].map(t => { const b = makeNode('BUTTON'); b.dataset.tool = t; return b; });
	let rafCb = null, copied = '';
	const asides = [];
	const sandbox = {
		console, Math, Number, String, Array, Object, Float64Array, Float32Array, Int32Array, Int16Array, Uint32Array, Uint16Array, Uint8Array, Uint8ClampedArray,
		window: { devicePixelRatio: 2, addEventListener() {} },
		performance: { now: () => 1000 },
		matchMedia: () => ({ matches: false }),
		getComputedStyle: () => ({ color: '#eab864' }),
		requestAnimationFrame(cb) { rafCb = cb; },
		setTimeout,
		navigator: { clipboard: { writeText(text) { copied = text; return Promise.resolve(); } } },
		document: {
			fonts: null,
			body: makeNode('BODY'),
			getElementById(id) {
				assert.ok(byId.has(id), `Missing id in index.html: ${id}`);
				return byId.get(id);
			},
			createElement(tag) {
				const node = makeNode(tag.toUpperCase());
				if (tag === 'aside') asides.push(node);
				return node;
			},
			addEventListener() {},
			execCommand() {},
			querySelectorAll(sel) {
				if (sel === '[data-icon]') return [];
				if (sel === '.metric') return metrics;
				if (sel === '[data-resource]') return resources;
				if (sel === '[data-tool]') return tools;
				return [];
			}
		}
	};
	vm.createContext(sandbox);
	for (const file of scripts) {
		vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), sandbox, { filename: file });
	}
	assert.ok(typeof rafCb === 'function', 'bootEconomy should schedule animation frame');
	return { byId, resources, tools, asides, frame: now => rafCb(now), copiedText: () => copied };
}

test('index.html boots all 22 scripts, renders every resource tab, places a Garden/Farm and updates watched worker', () => {
	const { byId, resources, tools, frame } = bootLab();
	assert.match(byId.get('watched-worker').querySelector('[data-track-head]').textContent, /Watched worker #1/);
	assert.match(byId.get('actor-count').textContent, /1 A/);
	for (const btn of resources) {
		btn.click();
		byId.get('resource-map').dispatch('pointermove', { clientX: 205, clientY: 160 });
		assert.ok(!byId.get('resource-map').nextElementSibling.textContent.includes('NaN'), `Tooltip NaN on tab ${btn.dataset.resource}`);
	}
	const gardenTool = tools.find(b => b.dataset.tool === 'garden');
	gardenTool.click();
	byId.get('resource-map').dispatch('click', { clientX: 260, clientY: 150 });
	assert.match(byId.get('actor-count').textContent, /2 A/, 'Garden tool should place a second Monastery garden');
	tools.find(b => b.dataset.tool === 'farm').click();
	byId.get('resource-map').dispatch('click', { clientX: 350, clientY: 150 });
	assert.match(byId.get('actor-count').textContent, /1 H/, 'Farm tool should place a commercial farm');
	byId.get('clear-towns').click();
	frame(1250);
	assert.ok(!byId.get('gold-held').textContent.includes('NaN'));
	assert.ok(!byId.get('forage-garden').textContent.includes('NaN'));
});

test('paused frames leave panel text alone and ⧉ buttons copy inspector, watched worker and cell reading', () => {
	const { byId, asides, frame, copiedText } = bootLab();
	byId.get('run-button').click();
	const props = asides[0].querySelector('[data-props]');
	props.innerHTML = 'sentinel';
	frame(1600); frame(2000);
	assert.equal(props.innerHTML, 'sentinel', 'paused frames must not redraw inspector text');
	byId.get('step-button').click();
	assert.notEqual(props.innerHTML, 'sentinel', 'a manual step refreshes the inspector');
	asides[0].querySelector('[data-copy]').click();
	assert.match(copiedText(), /^# particle-transfer B2 stats/);
	byId.get('watched-worker').querySelector('[data-copy]').click();
	assert.match(copiedText(), /^## watched worker /);
	byId.get('resource-map').dispatch('pointermove', { clientX: 205, clientY: 160 });
	byId.get('copy-reading').click();
	assert.match(copiedText(), /^# cell reading · coal · t=\d\d:\d\d\n.*Food /s);
});
