// owns: reusable classic-script browser fixture for DOM experiments
// edit for: canvas instrumentation, native-control stubs and page boot

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g), match => match[1]);

function makeContext2d() {
	return {
		imageSmoothingEnabled: true,
		fillStyle: '',
		strokeStyle: '',
		lineWidth: 1,
		calls: 0,
		fillRect() { this.calls++; },
		fillText() { this.textCalls = (this.textCalls || 0) + 1; this.calls++; },
		strokeRect() { this.calls++; },
		beginPath() { this.calls++; },
		closePath() { this.calls++; },
		arc() { this.calls++; },
		rect(x, y, w, h) { this.calls++; },
		moveTo(x, y) { this.calls++; recordPoint(this, 'move', x, y); },
		lineTo(x, y) { this.calls++; recordPoint(this, 'line', x, y); },
		fill() { this.calls++; },
		stroke() { this.calls++; },
		setLineDash() { this.calls++; },
		putImageData(image) { this.image = image; this.calls++; },
		drawImage() { this.calls++; },
		createImageData(width, height) {
			return { width: width, height: height, data: new Uint8ClampedArray(width * height * 4) };
		}
	};
}

function recordPoint(ctx, kind, x, y) {
	if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Non-finite canvas point');
	if (ctx.trace) ctx.trace.push(kind, x, y);
}

function makeElement(id, isCanvas) {
	const element = {
		id: id,
		tagName: isCanvas ? 'CANVAS' : 'DIV',
		children: [],
		listeners: {},
		textContent: '',
		className: '',
		disabled: false,
		hidden: false,
		onclick: null,
		type: '',
		checked: false,
		width: 0,
		height: 0,
		ctx: null,
		contains(node) {
			if (node === this) return true;
			for (const child of this.children) if (child.contains(node)) return true;
			return false;
		},
		closest(selector) {
			const cls = selector.replace('.', '');
			let node = this;
			while (node) {
				if ((node.className || '').split(' ').indexOf(cls) >= 0) return node;
				node = node.parent;
			}
			return null;
		},
		matches(selector) {
			return (this.className || '').split(' ').indexOf(selector.replace('.', '')) >= 0;
		},
		click() {
			if (this.tagName === 'INPUT' && this.type === 'radio') {
				if (!this.checked && !this.disabled) {
					this.checked = true;
					if (this.parent && this.parent.parent) this.parent.parent.dispatch('change', { target: this });
				}
				return;
			}
			if (this.onclick) this.onclick();
		},
		setAttribute(name, value) {
			if (!this.attributes) this.attributes = {};
			this.attributes[name] = value;
		},
		getAttribute(name) {
			return this.attributes ? this.attributes[name] : undefined;
		},
		dispatch(type, event) {
			event.currentTarget = this;
			const handlers = this.listeners[type] || [];
			for (const handler of handlers) handler(event);
		},
		appendChild(child) {
			this.children.push(child);
			child.parent = this;
			return child;
		},
		addEventListener(type, handler) {
			if (!this.listeners[type]) this.listeners[type] = [];
			this.listeners[type].push(handler);
		},
		getBoundingClientRect() {
			return { left: 0, top: 0, width: 768, height: 768 };
		},
		getContext() {
			if (!this.ctx) this.ctx = makeContext2d();
			return this.ctx;
		}
	};
	return element;
}

const elements = new Map();
elements.set('ui-canvas', makeElement('ui-canvas', true));

const documentStub = {
	selection: null,
	getSelection() {
		return this.selection;
	},
	getElementById(id) {
		if (!elements.has(id)) elements.set(id, makeElement(id, false));
		return elements.get(id);
	},
	createElement(tag) {
		const element = makeElement('', tag === 'canvas');
		element.tagName = tag.toUpperCase();
		return element;
	}
};

const rafQueue = [];
function requestAnimationFrame(callback) {
	rafQueue.push(callback);
}

const windowStub = {
	location: { search: '' },
	addEventListener(type, handler) {
		if (!windowStub.listeners) windowStub.listeners = {};
		if (!windowStub.listeners[type]) windowStub.listeners[type] = [];
		windowStub.listeners[type].push(handler);
	},
	listeners: {},
	matchMedia(query) {
		return { matches: query === '(prefers-reduced-motion: reduce)' ? windowStub.reducedMotion === true : windowStub.finePointer === true, media: query };
	}
};

function loadDom(query) {
	windowStub.location.search = query;
	const context = vm.createContext({ console, document: documentStub, window: windowStub, requestAnimationFrame, URLSearchParams });
	for (const file of scripts) {
		const code = fs.readFileSync(path.join(root, file), 'utf8');
		vm.runInContext(code, context, { filename: file });
	}
	return context;
}

module.exports = { elements, makeElement, loadDom, rafQueue, windowStub, documentStub };
