// owns: headless boot of the page with a stub DOM, frames, clicks and buttons
// run: node experiments/dom_smoke.js

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
		strokeRect() { this.calls++; },
		beginPath() { this.calls++; },
		closePath() { this.calls++; },
		arc() { this.calls++; },
		moveTo() { this.calls++; },
		lineTo() { this.calls++; },
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

function makeElement(id, isCanvas) {
	const element = {
		id: id,
		tagName: isCanvas ? 'CANVAS' : 'DIV',
		children: [],
		listeners: {},
		textContent: '',
		className: '',
		disabled: false,
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
				if (!this.checked) {
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
	if (isCanvas) element.tagName = 'CANVAS';
	return element;
}

const elements = new Map();
elements.set('ui-canvas', makeElement('ui-canvas', true));

const documentStub = {
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
	addEventListener(type, handler) {
		if (!windowStub.listeners) windowStub.listeners = {};
		if (!windowStub.listeners[type]) windowStub.listeners[type] = [];
		windowStub.listeners[type].push(handler);
	},
	listeners: {},
	matchMedia(query) {
		return { matches: windowStub.finePointer === true, media: query };
	}
};

const context = vm.createContext({
	console: console,
	document: documentStub,
	window: windowStub,
	requestAnimationFrame: requestAnimationFrame
});

let bootError = '';
try {
	for (const file of scripts) {
		const code = fs.readFileSync(path.join(root, file), 'utf8');
		vm.runInContext(code, context, { filename: file });
	}
} catch (error) {
	bootError = error.message;
}

function run(code) {
	return vm.runInContext(code, context);
}

function frame(now) {
	const queue = rafQueue.splice(0, rafQueue.length);
	for (const callback of queue) callback(now);
}

const result = { bootError: bootError };

if (!bootError) {
	try {
		for (let f = 1; f <= 120; f++) frame(f * 16.7);
		result.frames = 120;
		result.clockHours = run('clock.hours');
		const pixels = run('render.pixels');
		let lit = 0;
		for (let i = 0; i < pixels.length; i += 4) if (pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0) lit++;
		result.litCells = lit;
		result.clockText = run('$("ui-clock").textContent');
		result.timeButtons = run('$("ui-time").children.length');
		result.viewGroup = run('$("ui-views").children[0]');
		result.viewRadios = run('$("ui-views").children[0].children.length');
		result.actionButtons = run('$("ui-actions").children.length');
		result.siteText = run('$("ui-site").textContent');
		result.victoryText = run('$("ui-victory").textContent');
		result.logItems = run('$("ui-log").children.length');

		const before = run('[party.x, party.y]');
		const target = run(`(function () {
			for (let dy = -4; dy <= 4; dy++) {
				for (let dx = -4; dx <= 4; dx++) {
					if (dx === 0 && dy === 0) continue;
					if (worldWalkableAt(party.x + dx, party.y + dy)) return [party.x + dx, party.y + dy];
				}
			}
			return [-1, -1];
		})()`);
		const canvas = elements.get('ui-canvas');
		canvas.listeners.click[0]({ clientX: (target[0] + 0.5) * 12, clientY: (target[1] + 0.5) * 12 });
		frame(2100);
		result.clickTarget = target.join(',');
		result.moved = run('party.x + "," + party.y') !== before.join(',');

		const group = result.viewGroup;
		group.children[0].children[0].click();
		result.viewAfterClick = run('render.view');

		windowStub.finePointer = false;
		const coarseItem = group.children[2];
		group.dispatch('pointerover', { target: coarseItem.children[0] });
		result.coarseHoverChecked = coarseItem.children[0].checked;

		windowStub.finePointer = true;
		const hoverItem = group.children[4];
		group.dispatch('pointerover', { target: hoverItem.children[0] });
		result.viewAfterHover = run('render.view');
		result.hoverCheckedRadio = hoverItem.children[0].checked;
		const strayNode = makeElement('', false);
		group.dispatch('pointerover', { target: strayNode });
		result.strayHoverIgnored = run('render.view') === 4;
		result.radiogroupRole = group.getAttribute('role');
		result.radiogroupLabel = group.getAttribute('aria-label') || '';

		windowStub.listeners.keydown[0]({ key: '2', preventDefault() {} });
		result.viewAfterKey = run('render.view');
		result.viewRadioChecked = group.children[1].children[0].checked;
		windowStub.listeners.keydown[0]({ key: ' ', preventDefault() {} });
		result.speedAfterSpace = run('clock.speed');

		const buttons = run('$("ui-actions").children.slice()');
		let clicked = 0;
		for (const button of buttons) {
			if (button.disabled || !button.onclick) continue;
			button.onclick();
			clicked++;
			frame(2400 + clicked * 20);
		}
		result.buttonsClicked = clicked;
		result.surveyLabel = run('hudActionList()[1].label');
		result.surveyReady = run('hudActionList()[1].enabled');

		run('party.alive = false; party.condition = 0; hudRefresh(true);');
		const lostButtons = run('$("ui-actions").children.slice()');
		const restart = lostButtons[lostButtons.length - 1];
		if (!restart || !restart.onclick) throw new Error('no restart button when lost');
		restart.onclick();
		result.restartState = run('party.alive + ":" + Math.round(clock.hours)');
	} catch (error) {
		result.runtimeError = error.message + ' @ ' + (error.stack || '').split('\n')[1];
	}
}

let failures = 0;
function check(name, ok, detail) {
	if (!ok) failures++;
	console.log('check_' + name + '=' + (ok ? 'pass' : 'fail') + (detail === undefined ? '' : ' ' + detail));
}

console.log('boot_error=' + (result.bootError || 'none'));
if (result.bootError) {
	console.log('check_boot=fail');
	process.exit(1);
}
if (result.runtimeError) console.log('runtime_error=' + result.runtimeError);
console.log('frames=' + (result.frames || 0) + ' clock_hours=' + (result.clockHours || 0).toFixed(2));
console.log('lit_cells=' + result.litCells);
console.log('clock_text=' + JSON.stringify(result.clockText || ''));
console.log('buttons_time=' + result.timeButtons + ' buttons_actions=' + result.actionButtons);
console.log('log_items=' + result.logItems + ' buttons_clicked=' + (result.buttonsClicked || 0));
console.log('buttons_view=' + result.viewRadios);
console.log('view_click=' + result.viewAfterClick + ' hover=' + result.viewAfterHover + ' coarse_checked=' + result.coarseHoverChecked + ' stray_ignored=' + result.strayHoverIgnored);
console.log('view_after_key=' + result.viewAfterKey + ' radio_follows_key=' + result.viewRadioChecked + ' speed_after_space=' + result.speedAfterSpace);
console.log('survey_label=' + JSON.stringify(result.surveyLabel || '') + ' ready=' + result.surveyReady);
console.log('restart_state=' + result.restartState);

check('boot_ok', !result.bootError);
check('no_runtime_error', !result.runtimeError);
check('frames_advance_clock', result.clockHours > 6.05);
check('canvas_painted', result.litCells > 3000);
check('clock_rendered', /day 1/.test(result.clockText || ''));
check('time_controls', result.timeButtons === 4);
check('view_controls', result.viewRadios === 5);
check('view_group_labelled', result.radiogroupRole === 'radiogroup' && result.radiogroupLabel.length > 0);
check('view_click_selects', result.viewAfterClick === 0);
check('view_hover_selects', result.viewAfterHover === 4 && result.hoverCheckedRadio === true);
check('view_hover_ignores_stray', result.strayHoverIgnored === true);
check('view_coarse_ignores_hover', result.coarseHoverChecked === false);
check('view_key_syncs_radio', result.viewAfterKey === 1 && result.viewRadioChecked === true);
check('survey_button_present', /Survey/.test(result.surveyLabel || ''));
check('action_panel', result.actionButtons >= 5);
check('site_panel', (result.siteText || '').length > 5);
check('victory_panel', (result.victoryText || '').length > 5);
check('feed_rendered', result.logItems > 0);
check('click_moved_party', result.moved === true);
check('pause_key', result.speedAfterSpace === 0);
check('all_buttons_safe', (result.buttonsClicked || 0) >= 4);
check('new_survey_restarts', result.restartState === 'true:6');

if (failures > 0) {
	console.log('dom_smoke_failures=' + failures);
	process.exit(1);
}
console.log('dom_smoke_failures=0');
