// Owns: the prototype controls, animation clock, and the two canvas views.
'use strict';

const $ = (id) => document.getElementById(id);
const PALETTE_STEPS = 512;

function makePalette(stops) {
	const colors = [];
	let upper = 1;
	for (let i = 0; i <= PALETTE_STEPS; i++) {
		const t = i / PALETTE_STEPS;
		while (t > stops[upper][0]) upper++;
		const [a, r, g, b] = stops[upper - 1];
		const [z, rr, gg, bb] = stops[upper];
		const mix = (t - a) / (z - a);
		colors[i] = `rgb(${Math.round(r + (rr - r) * mix)} ${Math.round(g + (gg - g) * mix)} ${Math.round(b + (bb - b) * mix)})`;
	}
	return colors;
}

function mapView(id, palette, isResource) {
	const canvas = $(id);
	return { canvas, context: canvas.getContext('2d'), tooltip: canvas.nextElementSibling, palette, isResource };
}

function drawMap(view, model) {
	const { canvas, context, palette, isResource } = view;
	const values = isResource ? model.stock : model.demand;
	const cw = canvas.width / ECONOMY_WIDTH;
	const ch = canvas.height / ECONOMY_HEIGHT;
	for (let y = 0; y < ECONOMY_HEIGHT; y++) {
		for (let x = 0; x < ECONOMY_WIDTH; x++) {
			context.fillStyle = palette[Math.round(values[economyIndex(x, y)] * PALETTE_STEPS)];
			context.fillRect(x * cw, y * ch, Math.ceil(cw), Math.ceil(ch));
		}
	}
	context.strokeStyle = 'rgba(8, 16, 12, .28)';
	context.lineWidth = Math.max(0.5, canvas.width / 1500);
	context.beginPath();
	for (let x = 1; x < ECONOMY_WIDTH; x++) {
		context.moveTo(x * cw, 0);
		context.lineTo(x * cw, canvas.height);
	}
	for (let y = 1; y < ECONOMY_HEIGHT; y++) {
		context.moveTo(0, y * ch);
		context.lineTo(canvas.width, y * ch);
	}
	context.stroke();
	if (isResource) drawFlow(context, cw, ch, model);
	drawActors(context, cw, ch, model.actors);
}

function drawFlow(context, cw, ch, model) {
	const phase = model.ticks * ECONOMY_DT * 2.4;
	context.strokeStyle = '#d8f696';
	context.lineWidth = Math.max(1, Math.min(cw, ch) * 0.115);
	context.lineCap = 'round';
	for (let i = 0; i < ECONOMY_SIZE; i++) {
		const rate = model.flowRate[i];
		if (rate < 0.006) continue;
		const to = model.flowTo[i];
		const x = i % ECONOMY_WIDTH;
		const y = Math.floor(i / ECONOMY_WIDTH);
		const dx = to % ECONOMY_WIDTH - x;
		const dy = Math.floor(to / ECONOMY_WIDTH) - y;
		const start = (phase + i * 0.618) % 1;
		const end = Math.min(1, start + 0.24);
		context.globalAlpha = Math.min(0.86, 0.28 + rate * 5);
		context.beginPath();
		context.moveTo((x + 0.5 + start * dx) * cw, (y + 0.5 + start * dy) * ch);
		context.lineTo((x + 0.5 + end * dx) * cw, (y + 0.5 + end * dy) * ch);
		context.stroke();
	}
	context.globalAlpha = 1;
	context.lineCap = 'butt';
}

function drawActors(context, cw, ch, actors) {
	const marker = Math.max(7, Math.min(cw, ch) * 0.62);
	context.font = `700 ${marker * 1.05}px sans-serif`;
	context.textAlign = 'center';
	context.textBaseline = 'middle';
	context.lineWidth = Math.max(1, marker * 0.1);
	for (let i = 0; i < actors.length; i++) {
		if (!actors[i]) continue;
		const source = actors[i] === ECONOMY_SOURCE;
		const color = source ? '#d0f582' : '#f0c16f';
		const x = (i % ECONOMY_WIDTH + 0.5) * cw;
		const y = (Math.floor(i / ECONOMY_WIDTH) + 0.5) * ch;
		context.beginPath();
		context.arc(x, y, marker * 0.64, 0, Math.PI * 2);
		context.fillStyle = source ? '#263520' : '#3b2c1c';
		context.fill();
		context.strokeStyle = color;
		context.stroke();
		context.fillStyle = color;
		context.fillText(source ? '+' : '−', x, y + 0.5);
	}
}

function bootEconomy() {
	const model = new DiffusionEconomy();
	const resourceView = mapView('resource-map', makePalette([
		[0, 20, 34, 27], [0.018, 37, 73, 46], [0.06, 51, 108, 59],
		[0.28, 101, 160, 71], [1, 198, 235, 112]
	]), true);
	const demandView = mapView('demand-map', makePalette([
		[0, 22, 40, 48], [0.2, 27, 70, 81], [0.48, 40, 119, 129],
		[0.76, 115, 164, 131], [1, 233, 194, 103]
	]), false);
	const views = [resourceView, demandView];
	const runButton = $('run-button');
	const runLabel = runButton.querySelector('span:last-child');
	const runIcon = runButton.querySelector('.play-icon');
	const speedSelect = $('speed');
	const negativeToggle = $('negative-demand');
	const clearButton = $('clear-consumers');
	const toolButtons = document.querySelectorAll('[data-tool]');
	const actorCount = $('actor-count');
	const resourceTotal = $('resource-total').querySelector('b');
	const demandMean = $('demand-mean').querySelector('b');
	const supplyRate = $('supply-rate');
	const uptakeRate = $('uptake-rate');
	const consumedTotal = $('consumed-total');
	const timeLabel = $('sim-time');
	let running = true;
	let speed = Number(speedSelect.value);
	let tool = 'inspect';
	let lastFrame = performance.now();
	let lastStats = lastFrame;
	let accumulator = 0;
	let hoveredView = null;
	let hoveredCell = 0;
	model.pressure = negativeToggle.checked;

	function render() {
		for (const view of views) drawMap(view, model);
	}

	function fitCanvases() {
		for (const { canvas } of views) {
			const ratio = window.devicePixelRatio || 1;
			const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
			const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
			if (canvas.width !== width) canvas.width = width;
			if (canvas.height !== height) canvas.height = height;
		}
		render();
	}

	function updateStats(now = performance.now()) {
		lastStats = now;
		let total = 0;
		let need = 0;
		let sources = 0;
		let consumers = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			total += model.stock[i];
			need += model.demand[i];
			if (model.actors[i] === ECONOMY_SOURCE) sources++;
			if (model.actors[i] === ECONOMY_CONSUMER) consumers++;
		}
		actorCount.textContent = `${sources} ${sources === 1 ? 'SOURCE' : 'SOURCES'} · ${consumers} ${consumers === 1 ? 'CONSUMER' : 'CONSUMERS'}`;
		clearButton.disabled = consumers === 0;
		resourceTotal.textContent = total.toFixed(2);
		demandMean.textContent = (need / ECONOMY_SIZE).toFixed(2);
		supplyRate.textContent = `${(running ? model.productionRate : 0).toFixed(2)}/s`;
		uptakeRate.textContent = `${(running && consumers ? model.uptakeRate : 0).toFixed(2)}/s`;
		consumedTotal.textContent = model.consumed.toFixed(2);
		const seconds = Math.floor(model.ticks * ECONOMY_DT);
		timeLabel.textContent = `SIM TIME  ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
		updateTooltip();
	}

	function frame(now) {
		const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
		lastFrame = now;
		if (running) {
			accumulator += dt * speed;
			const previousTick = model.ticks;
			while (accumulator >= ECONOMY_DT) {
				model.step();
				accumulator -= ECONOMY_DT;
			}
			if (model.ticks !== previousTick) render();
			if (now - lastStats >= 250) updateStats(now);
		}
		requestAnimationFrame(frame);
	}

	function reset(fill) {
		model.reset(fill);
		accumulator = 0;
		lastFrame = performance.now();
		updateStats();
		render();
	}

	function updateTooltip() {
		if (!hoveredView) return;
		const i = hoveredCell;
		const x = i % ECONOMY_WIDTH + 1;
		const y = Math.floor(i / ECONOMY_WIDTH) + 1;
		const kind = hoveredView.isResource ? 'STOCK' : 'DEMAND';
		const value = hoveredView.isResource ? model.stock[i] : model.demand[i];
		const actor = model.actors[i] === ECONOMY_SOURCE ? ' · PRODUCER' : model.actors[i] === ECONOMY_CONSUMER ? ' · CONSUMER' : '';
		hoveredView.tooltip.textContent = `${x}, ${y}  ·  ${kind} ${value.toFixed(3)}${actor}`;
	}

	function pointAt(view, event) {
		const { canvas, tooltip } = view;
		const rect = canvas.getBoundingClientRect();
		const px = event.clientX - rect.left;
		const py = event.clientY - rect.top;
		const x = Math.floor(economyClamp(px / rect.width) * ECONOMY_WIDTH);
		const y = Math.floor(economyClamp(py / rect.height) * ECONOMY_HEIGHT);
		hoveredView = view;
		hoveredCell = economyIndex(Math.min(x, ECONOMY_WIDTH - 1), Math.min(y, ECONOMY_HEIGHT - 1));
		updateTooltip();
		tooltip.style.display = 'block';
		tooltip.style.left = `${Math.max(0, Math.min(px, rect.width - tooltip.offsetWidth - 8))}px`;
		tooltip.style.top = `${Math.max(0, Math.min(py, rect.height - tooltip.offsetHeight - 8))}px`;
	}

	runButton.addEventListener('click', () => {
		running = !running;
		runLabel.textContent = running ? 'Pause' : 'Resume';
		runIcon.textContent = running ? 'Ⅱ' : '▶';
		runButton.setAttribute('aria-label', running ? 'Pause simulation' : 'Resume simulation');
		lastFrame = performance.now();
		updateStats();
	});
	speedSelect.addEventListener('change', () => { speed = Number(speedSelect.value); });
	negativeToggle.addEventListener('change', () => { model.pressure = negativeToggle.checked; });
	$('new-zero').addEventListener('click', () => reset(0));
	$('new-half').addEventListener('click', () => reset(0.5));
	clearButton.addEventListener('click', () => {
		model.clearConsumers();
		updateStats();
		render();
	});
	for (const button of toolButtons) {
		button.addEventListener('click', () => {
			tool = button.dataset.tool;
			for (const candidate of toolButtons) {
				candidate.classList.toggle('active', candidate === button);
				candidate.setAttribute('aria-pressed', candidate === button);
			}
			for (const { canvas } of views) canvas.parentElement.style.cursor = tool === 'inspect' ? 'crosshair' : 'cell';
		});
	}
	for (const view of views) {
		view.canvas.addEventListener('pointermove', (event) => pointAt(view, event));
		view.canvas.addEventListener('pointerleave', () => {
			view.tooltip.style.display = 'none';
			hoveredView = null;
		});
		view.canvas.addEventListener('click', (event) => {
			pointAt(view, event);
			if (tool === 'inspect') return;
			const kind = tool === 'source' ? ECONOMY_SOURCE : tool === 'consumer' ? ECONOMY_CONSUMER : 0;
			model.setActor(hoveredCell, kind);
			updateStats();
			render();
		});
	}
	window.addEventListener('resize', fitCanvases);
	fitCanvases();
	updateStats();
	requestAnimationFrame(frame);
}

bootEconomy();
