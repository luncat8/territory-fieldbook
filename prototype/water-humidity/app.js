// owns: boot, shared clock, DOM refs, control wiring, telemetry and the cell inspector
// edit for: control set, view defaults, warm-up length
'use strict';

const $ = id => document.getElementById(id);

const LAB_WARM_SECONDS = 90;
const LAB_FRAME_MAX = 0.15;
const LAB_ACC_MAX = 0.4;
const LAB_SPEEDS = [0.5, 1, 2, 4, 16];
const LAB_DEFAULT_SPEED = 4;

const LAB_SLIDERS = [
	{ title: 'Grouping demand', items: [
		{ key: 'groupFlow', label: 'Up-gradient flow', min: 0, max: 20, step: 0.5 },
		{ key: 'groupEmit', label: 'Emission · speed × depth', min: 0, max: 3, step: 0.05 },
		{ key: 'groupDecay', label: 'Memory fade', min: 0.05, max: 1, step: 0.01 },
		{ key: 'groupDiffuse', label: 'Grouping diffusion', min: 0, max: 1.5, step: 0.05 }
	] },
	{ title: 'Water & soil', items: [
		{ key: 'flowK', label: 'Downhill conductance', min: 20, max: 400, step: 5 },
		{ key: 'fillMix', label: 'Depression-fill weight', min: 0, max: 1, step: 0.05 },
		{ key: 'springRate', label: 'Spring inflow', min: 0, max: 1.5, step: 0.05 },
		{ key: 'retention', label: 'Immobile retention', min: 0, max: 0.08, step: 0.005 },
		{ key: 'filmRate', label: 'Soil film absorption', min: 0, max: 2, step: 0.05 }
	] },
	{ title: 'Humidity & rain', items: [
		{ key: 'seaEvap', label: 'Sea evaporation', min: 0, max: 0.05, step: 0.002 },
		{ key: 'humDiffuse', label: 'Humidity diffusion', min: 0, max: 6, step: 0.1 },
		{ key: 'windX', label: 'Prevailing wind', min: -4, max: 4, step: 0.1 },
		{ key: 'rainRate', label: 'Condensation rate', min: 0, max: 3, step: 0.05 }
	] }
];

const lab = {
	model: null,
	main: null,
	minis: [],
	view: 'composite',
	params: Object.assign({}, WATER_PARAMS),
	scenario: 'coast',
	seed: WATER_SEED,
	hover: -1,
	running: true,
	speed: LAB_DEFAULT_SPEED,
	acc: 0,
	last: 0,
	lastPaint: 0,
	lastReadout: 0,
	showFlow: true,
	showRain: true,
	showSprings: true,
	sparks: [],
	metrics: null
};

function labFormat(value) {
	if (Math.abs(value) >= 100) return value.toFixed(0);
	if (Math.abs(value) >= 1) return value.toFixed(2);
	return value.toFixed(3);
}

function labBuildControls() {
	const tabs = $('view-tabs');
	for (const mode of WATER_MODES) {
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = WATER_MODE_LABEL[mode];
		button.dataset.mode = mode;
		button.addEventListener('click', () => labSetView(mode));
		tabs.appendChild(button);
	}
	const sliderRoot = $('sliders');
	for (const section of LAB_SLIDERS) {
		const box = document.createElement('div');
		box.className = 'control-group';
		const heading = document.createElement('h3');
		heading.textContent = section.title;
		box.appendChild(heading);
		for (const spec of section.items) {
			const row = document.createElement('label');
			row.className = 'slider-row';
			const name = document.createElement('span');
			name.textContent = spec.label;
			const input = document.createElement('input');
			input.type = 'range';
			input.min = spec.min;
			input.max = spec.max;
			input.step = spec.step;
			input.value = lab.params[spec.key];
			const out = document.createElement('output');
			out.textContent = labFormat(lab.params[spec.key]);
			input.addEventListener('input', () => {
				const value = Number(input.value);
				lab.params[spec.key] = value;
				lab.model.params[spec.key] = value;
				out.textContent = labFormat(value);
			});
			row.appendChild(name);
			row.appendChild(input);
			row.appendChild(out);
			box.appendChild(row);
		}
		sliderRoot.appendChild(box);
	}
	const miniModes = WATER_MODES.filter(mode => mode !== 'composite');
	for (const mode of miniModes) {
		const canvas = $('mini-' + mode);
		const plot = new WaterPlot(canvas);
		plot.mode = mode;
		lab.minis.push(plot);
		canvas.addEventListener('click', () => labSetView(mode));
		canvas.addEventListener('mousemove', event => labHover(event, plot));
	}
}

function labSetView(mode) {
	lab.view = mode;
	for (const button of $('view-tabs').children) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
	$('view-title').textContent = WATER_MODE_LABEL[mode];
	$('view-hint').textContent = mode === 'composite' ? 'All layers together' : 'Fixed scale · click a mini map to switch';
	labPaint();
}

function labHover(event, plot) {
	const i = plot.cellAt(event, lab.model);
	if (i < 0) return;
	lab.hover = i;
	labInspect();
}

function labInspect() {
	const i = lab.hover;
	const m = lab.model;
	if (i < 0) {
		$('inspect').textContent = 'Hover over any map to inspect a cell.';
		return;
	}
	const x = i % m.width;
	const y = (i / m.width) | 0;
	$('inspect').textContent = 'Cell ' + x + ',' + y + ' · ' + (m.sea[i] ? 'sea' : 'land') +
		' | height ' + m.elev[i].toFixed(3) + ' (drain ' + m.filled[i].toFixed(3) + ')' +
		' | water ' + m.water[i].toFixed(3) +
		' | grouping ' + m.group[i].toFixed(3) +
		' | humidity ' + m.humidity[i].toFixed(3) +
		' | rain ' + m.rain[i].toFixed(5) +
		' | flow ' + m.fluxRate[i].toFixed(3);
}

function labReset() {
	lab.scenario = $('scenario').value;
	lab.seed = Number($('seed').value) || WATER_SEED;
	lab.model = new WaterLab({ scenario: lab.scenario, seed: lab.seed, params: lab.params });
	lab.model.grouping = $('grouping').checked;
	lab.model.wind = $('wind').checked;
	lab.model.rainMode = $('rain-mode').value;
	lab.model.params.springRate = $('springs').checked ? lab.params.springRate : 0;
	lab.hover = -1;
	lab.main.bind(lab.model);
	for (const plot of lab.minis) plot.bind(lab.model);
	for (const spark of lab.sparks) spark.reset();
	for (let k = 0; k < Math.round(LAB_WARM_SECONDS / WATER_DT); k++) lab.model.step();
	lab.metrics = waterMetrics(lab.model);
	labPaint();
	labReadout();
}

function labPaint() {
	if (!lab.model) return;
	const m = lab.model;
	lab.main.paint(m, lab.view, lab.showRain);
	lab.main.vectors(m, lab.showFlow, lab.showSprings);
	for (const plot of lab.minis) plot.paint(m, plot.mode, true);
	for (const spark of lab.sparks) spark.draw();
}

function labReadout() {
	const r = waterMetrics(lab.model);
	lab.metrics = r;
	const pairs = [
		['m-water', labFormat(r.landWater)],
		['m-wet', (r.wetFraction * 100).toFixed(1) + '%'],
		['m-channel', (r.riverShare * 100).toFixed(1) + '%'],
		['m-rain', r.rainTotal.toFixed(3)],
		['m-grouped', (r.groupedRainShare * 100).toFixed(1) + '%'],
		['m-sea-rain', r.rainOnSea.toFixed(4)],
		['m-humidity', r.humidityMean.toFixed(3)],
		['m-ledger', r.ledgerResidual.toExponential(1)]
	];
	for (const [id, value] of pairs) $(id).textContent = value;
	$('m-sea-drain').textContent = lab.model.seaDrain.toFixed(1);
	$('sim-time').textContent = Math.floor(r.time / 60).toString().padStart(2, '0') + ':' + Math.floor(r.time % 60).toString().padStart(2, '0');
}

function labFrame(now) {
	const dt = lab.last === 0 ? 0 : Math.min((now - lab.last) / 1000, LAB_FRAME_MAX);
	lab.last = now;
	if (lab.running) {
		lab.acc = Math.min(LAB_ACC_MAX, lab.acc + dt * lab.speed);
		while (lab.acc + 1e-9 >= WATER_DT) {
			lab.model.step();
			lab.acc = Math.max(0, lab.acc - WATER_DT);
		}
	}
	if (now - lab.lastPaint >= 50) {
		labPaint();
		lab.lastPaint = now;
	}
	if (now - lab.lastReadout >= 200) {
		labReadout();
		lab.sparks[0].push(lab.metrics.landWater);
		lab.sparks[1].push(lab.metrics.rainTotal);
		labInspect();
		lab.lastReadout = now;
	}
	requestAnimationFrame(labFrame);
}

function labToggleRun() {
	lab.running = !lab.running;
	$('run').textContent = lab.running ? 'Pause' : 'Run';
	$('run-state').textContent = lab.running ? 'Running' : 'Paused';
	$('run-state').dataset.state = lab.running ? 'on' : 'off';
}

function labWire() {
	lab.main = new WaterPlot($('main-map'), $('main-overlay'));
	lab.sparks.push(new WaterSpark($('spark-water'), '#7fd4f0'));
	lab.sparks.push(new WaterSpark($('spark-rain'), '#f0cf86'));
	labBuildControls();
	const scenario = $('scenario');
	for (const name of WATER_SCENARIOS) {
		const option = document.createElement('option');
		option.value = name;
		option.textContent = name;
		scenario.appendChild(option);
	}
	scenario.value = lab.scenario;
	$('seed').value = lab.seed;
	const speed = $('speed');
	for (const value of LAB_SPEEDS) {
		const option = document.createElement('option');
		option.value = value;
		option.textContent = value + '×';
		speed.appendChild(option);
	}
	speed.value = lab.speed;
	$('run').addEventListener('click', labToggleRun);
	$('step').addEventListener('click', () => { lab.model.step(); labPaint(); labReadout(); });
	speed.addEventListener('change', () => { lab.speed = Number(speed.value); });
	scenario.addEventListener('change', labReset);
	$('seed').addEventListener('change', labReset);
	$('new-seed').addEventListener('click', () => {
		$('seed').value = (Math.imul(Number($('seed').value), 1664525) + 1013904223) >>> 0;
		labReset();
	});
	$('reset').addEventListener('click', labReset);
	$('warm').addEventListener('click', () => {
		for (let k = 0; k < Math.round(60 / WATER_DT); k++) lab.model.step();
		labPaint();
		labReadout();
	});
	for (const [id, key] of [['grouping', 'grouping'], ['wind', 'wind']]) {
		$(id).addEventListener('change', event => { lab.model[key] = event.target.checked; });
	}
	$('springs').addEventListener('change', event => {
		lab.model.params.springRate = event.target.checked ? lab.params.springRate : 0;
	});
	$('rain-mode').addEventListener('change', event => { lab.model.rainMode = event.target.value; });
	for (const [id, key] of [['show-flow', 'showFlow'], ['show-rain', 'showRain'], ['show-springs', 'showSprings']]) {
		$(id).addEventListener('change', event => { lab[key] = event.target.checked; labPaint(); });
	}
	$('main-map').addEventListener('mousemove', event => labHover(event, lab.main));
	document.addEventListener('keydown', event => {
		if (event.target.matches && event.target.matches('input, select, button')) return;
		if (event.code === 'Space') { event.preventDefault(); labToggleRun(); }
		else if (event.key === 's') { lab.model.step(); labPaint(); labReadout(); }
		else if (event.key >= '1' && event.key <= '7') labSetView(WATER_MODES[Number(event.key) - 1]);
	});
	labSetView(lab.view);
	labReset();
	requestAnimationFrame(labFrame);
}

if (typeof document !== 'undefined') labWire();
if (typeof module !== 'undefined') module.exports = { lab, LAB_SLIDERS, labReset, labSetView, labPaint, labReadout };
