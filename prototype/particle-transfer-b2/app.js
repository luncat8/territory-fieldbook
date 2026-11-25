// Owns: lab controls, click-to-watch worker selection, map editing tools (including Monastery garden) and playback clock.
// Edit for: resource tab titles, tool hints, keyboard bindings and fixed-timestep frame loop.
'use strict';

const $ = id => document.getElementById(id);
const ICON_PATHS = {
	book:'M12 6c-3-2-7-2-10-1v13c3-1 7-1 10 1 3-2 7-2 10-1V5c-3-1-7-1-10 1Zm0 0v13',
	pause:'M9 5v14M15 5v14',play:'m8 4 12 8-12 8z',step:'m5 5 10 7-10 7zM19 5v14',chevron:'m6 9 6 6 6-6',
	box:'m3 7 9-5 9 5v10l-9 5-9-5zM3 7l9 5 9-5M12 12v10',
	up:'M3 17l6-6 4 4 8-10m-7 0h7v7',down:'m3 7 6 6 4-4 8 10m-7 0h7v-7',
	grid:'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',check:'m5 12 4 4L19 6',
	layers:'m2 8 10-5 10 5-10 5zM2 12l10 5 10-5M2 16l10 5 10-5',
	contour:'M3 12c0-4 3-4 5-7 4-5 11-2 11 3 0 4 5 6 2 10-2 4-6 1-10 3-5 1-9-3-8-9Zm4 0c0-2 3-3 4-5 3-2 5 0 5 3 0 3 4 5 1 7-2 1-3-1-6 0-3 1-5-2-4-5Zm4 0c1-3 4-3 4 1 0 3-4 3-4-1Z',
	sliders:'M3 7h4m5 0h9M3 17h10m5 0h3M7 4h5v6H7zM13 14h5v6h-5z',
	cursor:'m4 3 6.5 18 3.2-7.5L21 10z',crosshair:'M12 3v5m0 8v5M3 12h5m8 0h5M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
	diamond:'m12 2 10 10-10 10L2 12z',hexagon:'M12 2l8.7 5v10L12 22l-8.7-5V7z',square:'M4 4h16v16H4z',circle:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
	leaf:'M11 20A7 7 0 0 1 4 13C4 7 11 4 20 4c0 9-3 16-9 16Zm0 0v-7',
	erase:'m3 14 10-10a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 8H9l-6-6Zm6-6 8 8M12 20h9',
	reset:'M3 4v6h6M4 9a8 8 0 1 1 .7 8',clear:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',close:'m6 6 12 12M18 6 6 18'
};
const labIcon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON_PATHS[name]}"/></svg>`;
const RESOURCE_TITLES = {
	coal: ['Coal particles & buffers', 'Live coal particles coloured by cost + haul price', 'Coal price', 'Diffused buyer bid per cell'],
	goods: ['Goods particles & buffers', 'Live goods particles coloured by cost + haul price', 'Goods price', 'Diffused buyer bid per cell'],
	labor: ['Fresh workforce', 'Walking commuters and docked firm pools', 'Wage', 'Diffused firm entry-wage bid per cell'],
	depleted: ['Tired & resting workers', 'Homebound walkers, wait queues and town rooms', 'Home appeal', 'Blended rest value and quality field'],
	forage: ['Wild food & Monastery gardens', 'Shoreline/forest wild food, garden plots and FORAGE walkers', 'Low-res food gradient', 'Coarse 24×14 (4-tick) free-food reach field'],
	gold: ['Gold held', 'Purses and worker wallets on map', 'Wage & home pull', 'Combined gold circulation signal'],
	land: ['Land rest', 'Terrain rest pace less industrial wasteland', 'Town site', 'Shoreline/meadow site quality less town claims']
};
const TOOL_HINTS = {
	inspect: 'Click a worker or cell to watch its wallet, food and state, or hover to inspect cell stocks.',
	mine: 'Click walkable land to place a coal mine.',
	factory: 'Click walkable land to place a goods factory.',
	town: 'Click walkable land to place a town. Hungry workers in unsupplied towns forage rather than dying.',
	gold: 'Click walkable land to place a gold mine.',
	garden: 'Click walkable land to place a Monastery garden: farms surrounding plots and gives free food.',
	erase: 'Click an actor to remove it. Docked workers step outside with their wallets intact.'
};

function bootEconomy() {
	for (const node of document.querySelectorAll('[data-icon]')) node.outerHTML = labIcon(node.dataset.icon);
	const toolKinds = { inspect: 0, erase: 0, mine: ECONOMY_MINE, factory: ECONOMY_FACTORY, town: ECONOMY_TOWN, gold: ECONOMY_GOLD, garden: ECONOMY_GARDEN };
	const model = new PriceEconomy();
	const plots = [new FieldPlot($('resource-map'), true), new FieldPlot($('price-map'), false)];
	const stats = new EconomyTelemetry();
	const guide = $('field-guide'), runButton = $('run-button'), runState = $('run-state');
	const speedSelect = $('speed'), decay = $('price-decay'), derived = $('derived-bid'), suppression = $('stock-suppression'), flow = $('show-flow');
	const toolButtons = document.querySelectorAll('[data-tool]'), clearButton = $('clear-towns');
	const resourceButtons = document.querySelectorAll('[data-resource]');
	const message = $('edit-message'), stepButton = $('step-button');
	let running = !matchMedia('(prefers-reduced-motion: reduce)').matches;
	let rate = Number(speedSelect.value), tool = 'inspect';
	let selected = -1, owner = null, pinned = false, dirty = true;
	let lastFrame = performance.now(), lastPaint = 0, lastStats = 0, accumulator = 0;
	model.decay = decay.checked;
	model.derived = derived.checked;
	model.suppression = suppression.checked;
	$('grid-size').textContent = `${ECONOMY_WIDTH} × ${ECONOMY_HEIGHT} (forage ${model.forage.cw} × ${model.forage.ch})`;
	$('source-note').textContent = SOURCE_RATE.toFixed(2);
	$('uptake-note').textContent = NEED_RATE.toFixed(2);
	$('start-price-note').textContent = START_PRICE.toFixed(0);
	$('gold-rate-note').textContent = GOLD_RATE.toFixed(2);

	function syncActors() {
		const counts = [0, 0, 0, 0, 0, 0];
		for (const kind of model.actors) counts[kind]++;
		const [, mines, factories, towns, gold, gardens] = counts;
		let young = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) if (model.settlements.isYoungTown(i)) young++;
		$('actor-count').textContent = `${mines} M · ${factories} F · ${towns} T${young ? ` (${young}y)` : ''} · ${gold} G · ${gardens} A`;
		clearButton.disabled = !towns;
		for (const plot of plots) plot.readActors(model.actors);
		dirty = true;
	}

	function paint() {
		for (const plot of plots) plot.draw(model, selected, flow.checked);
		dirty = false;
	}

	function fit() {
		for (const plot of plots) plot.fit();
		stats.fit(); stats.refresh(model); paint(); readings();
	}

	function readings() {
		for (const plot of plots) plot.showReading(plot === owner ? selected : -1, model, pinned);
	}

	function selectCell(plot, i) {
		owner = plot; selected = i; dirty = true;
		readings();
	}

	function clearSelection() {
		pinned = false; selectCell(null, -1);
	}

	function applyTool(plot, event, i) {
		if (i < 0) return;
		if (tool === 'inspect') {
			if (event) {
				const [gx, gy] = plot.coordsAt(event);
				const pickedWorker = model.workers.pickNear(gx, gy, 1.8);
				if (pickedWorker > 0) {
					model.workers.watch(pickedWorker);
					stats.refreshWatched(model);
				}
			}
			pinned = !(pinned && owner === plot && selected === i);
			selectCell(plot, i);
			message.textContent = pinned ? `Pinned cell ${cellName(i)}.` : 'Click any worker to watch its cycle.';
			return;
		}
		const kind = toolKinds[tool];
		if (kind === 0 && !model.actors[i]) { message.textContent = 'No actor in this cell.'; return; }
		if (!model.setActor(i, kind)) {
			message.textContent = model.land.terrain[i] === TERRAIN_WATER ? 'Cannot build on water.' : 'Cell occupied. Erase its actor first.';
			return;
		}
		message.textContent = `${kind ? ACTOR_NAMES[kind] + ' placed' : 'Actor removed'} at ${cellName(i)}.`;
		syncActors(); selectCell(plot, i);
	}

	function tick() {
		const townFounded = model.settlements.founded, firmFounded = model.founding.founded;
		model.step(); stats.record(model); dirty = true;
		if (model.settlements.founded !== townFounded || model.founding.founded !== firmFounded) syncActors();
	}

	function frame(now) {
		const elapsed = Math.min(0.15, Math.max(0, now - lastFrame) / 1000);
		lastFrame = now;
		if (running) {
			accumulator += elapsed * rate;
			while (accumulator >= ECONOMY_DT) { tick(); accumulator -= ECONOMY_DT; }
		}
		if (dirty && now - lastPaint >= 1000 / 30) { paint(); lastPaint = now; }
		if (running && now - lastStats >= 250) { stats.refresh(model); readings(); lastStats = now; }
		requestAnimationFrame(frame);
	}

	function syncPlayback() {
		runButton.firstElementChild.outerHTML = labIcon(running ? 'pause' : 'play');
		runButton.lastElementChild.textContent = running ? 'Pause' : 'Resume';
		runButton.setAttribute('aria-label', running ? 'Pause simulation' : 'Resume simulation');
		runState.classList.toggle('paused', !running);
		runState.lastElementChild.textContent = running ? 'Running' : 'Paused';
		stepButton.hidden = running;
		lastFrame = performance.now();
	}

	function toggleRun() { running = !running; syncPlayback(); stats.refresh(model); readings(); }

	function reset() {
		model.reset(); stats.reset(model); syncActors(); clearSelection();
		accumulator = 0; lastFrame = performance.now();
		message.textContent = 'Reset · goods and workers run as conserved SoA particles.';
		stats.refresh(model); paint();
	}

	for (const plot of plots) {
		const { canvas } = plot;
		canvas.addEventListener('pointermove', event => { if (!pinned) selectCell(plot, plot.cellAt(event)); });
		canvas.addEventListener('pointerleave', () => { if (!pinned) clearSelection(); });
		canvas.addEventListener('click', event => applyTool(plot, event, plot.cellAt(event)));
		canvas.addEventListener('focus', () => { if (!pinned && canvas.matches(':focus-visible')) selectCell(plot, economyIndex(ECONOMY_WIDTH / 2, ECONOMY_HEIGHT / 2)); });
		canvas.addEventListener('blur', () => { if (!pinned) clearSelection(); });
		canvas.addEventListener('keydown', event => {
			if (event.key === 'Enter') { event.preventDefault(); applyTool(plot, null, selected); return; }
			if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
			event.preventDefault(); pinned = false;
			const i = Math.max(0, selected);
			const x = i % ECONOMY_WIDTH + (event.key === 'ArrowRight') - (event.key === 'ArrowLeft');
			const y = Math.floor(i / ECONOMY_WIDTH) + (event.key === 'ArrowDown') - (event.key === 'ArrowUp');
			selectCell(plot, economyIndex(Math.max(0, Math.min(ECONOMY_WIDTH - 1, x)), Math.max(0, Math.min(ECONOMY_HEIGHT - 1, y))));
		});
	}
	for (const button of toolButtons) button.addEventListener('click', () => {
		tool = button.dataset.tool;
		for (const candidate of toolButtons) candidate.setAttribute('aria-pressed', candidate === button);
		$('tool-hint').textContent = TOOL_HINTS[tool]; message.textContent = 'Both maps are linked.';
		for (const plot of plots) plot.canvas.style.cursor = tool === 'inspect' ? 'crosshair' : 'cell';
		clearSelection();
	});
	for (const button of resourceButtons) button.addEventListener('click', () => {
		for (const plot of plots) plot.resource = button.dataset.resource;
		for (const candidate of resourceButtons) candidate.setAttribute('aria-pressed', candidate === button);
		const [stockTitle, stockNote, priceTitle, priceNote] = RESOURCE_TITLES[button.dataset.resource];
		$('stock-title').textContent = stockTitle; $('stock-note').textContent = stockNote;
		$('price-title').textContent = priceTitle; $('price-note').textContent = priceNote;
		dirty = true; paint();
	});
	runButton.addEventListener('click', toggleRun);
	stepButton.addEventListener('click', () => { tick(); stats.refresh(model); readings(); paint(); });
	speedSelect.addEventListener('change', () => { rate = Number(speedSelect.value); });
	decay.addEventListener('change', () => { model.decay = decay.checked; message.textContent = `Price decay ${model.decay ? 'enabled' : 'disabled'}.`; });
	derived.addEventListener('change', () => { model.derived = derived.checked; message.textContent = `Derived bid ${model.derived ? 'enabled' : 'disabled'}.`; });
	suppression.addEventListener('change', () => { model.suppression = suppression.checked; message.textContent = `Stock suppression ${model.suppression ? 'enabled' : 'disabled'}.`; });
	flow.addEventListener('change', () => { dirty = true; paint(); });
	$('new-map').addEventListener('click', reset);
	clearButton.addEventListener('click', () => { model.clearTowns(); syncActors(); readings(); paint(); message.textContent = 'Towns removed. Tired workers shelter-rest, forage and found a young town.'; });
	$('guide-button').addEventListener('click', () => guide.showModal());
	$('close-guide').addEventListener('click', () => guide.close());
	guide.addEventListener('click', event => {
		if (event.target !== guide) return;
		const r = guide.getBoundingClientRect();
		if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) guide.close();
	});
	document.addEventListener('keydown', event => {
		if (guide.open || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
		if (event.key === '?') { guide.showModal(); return; }
		if (event.key === 'Escape') { clearSelection(); message.textContent = 'Both maps are linked.'; return; }
		if (event.code !== 'Space' || event.target.closest('button,select,input')) return;
		event.preventDefault(); toggleRun();
	});
	document.addEventListener('visibilitychange', () => { lastFrame = performance.now(); accumulator = 0; });
	window.addEventListener('resize', fit);
	stats.reset(model);
	for (let n = 0; n < Math.round(12 / ECONOMY_DT); n++) tick();
	syncActors(); syncPlayback(); fit();
	if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
	requestAnimationFrame(frame);
}

bootEconomy();
