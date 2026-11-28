// Owns: lab controls, click-to-watch worker selection, map editing tools (including Monastery garden) and playback clock.
// Edit for: resource tab titles, tool hints, keyboard bindings and fixed-timestep frame loop.
'use strict';

const RESOURCE_TITLES = {
	coal: ['Coal particles & buffers', 'Live coal particles coloured by cost + haul price', 'Coal price', 'Diffused buyer bid per cell'],
	food: ['Food particles & farmland', 'Commercial harvests, bazaar food stocks and deliveries', 'Food price', 'Town bazaar bids attract farms and food'],
	goods: ['Goods particles & buffers', 'Live goods particles coloured by cost + haul price', 'Goods price', 'Diffused buyer bid per cell'],
	labor: ['Fresh workforce', 'Walking commuters and docked firm pools', 'Wage', 'Diffused firm entry-wage bid per cell'],
	depleted: ['Tired & resting workers', 'Homebound walkers, wait queues and town rooms', 'Home appeal', 'Blended rest value and quality field'],
	forage: ['Wild food & Monastery gardens', 'Shoreline/forest wild food, garden plots and FORAGE walkers', 'Low-res food gradient', 'Coarse 24×14 (4-tick) free-food reach field'],
	gold: ['Gold held', 'Purses and worker wallets on map', 'Wage & home pull', 'Combined gold circulation signal'],
	wood: ['Wood particles & timber', 'Sawmill felling, yard stocks and deliveries', 'Wood price', 'Diffused builder bid per cell'],
	land: ['Land rest', 'Terrain rest pace less industrial wasteland', 'Town site', 'Shoreline/meadow site quality less town claims']
};
const TOOL_HINTS = {
	inspect: 'Click a worker or cell to watch its wallet, food and state, or hover to inspect cell stocks.',
	mine: 'Click walkable land to place a coal mine.',
	factory: 'Click walkable land to place a goods factory.',
	town: 'Click walkable land to place a town. Workers buy rest and food; towns never create or remove workers.',
	gold: 'Click walkable land to place a gold mine.',
	farm: 'Click walkable land to build a food farm. Paid crews clear forest or use local wood, then harvest every seven seconds.',
	garden: 'Click walkable land to place a Monastery garden: farms surrounding plots and gives free food.',
	sawmill: 'Click walkable land to place a sawmill. Paid crews fell nearby forest into wood sold to builders.',
	erase: 'Click an actor to remove it. Docked workers step outside with their wallets intact.'
};

function bootEconomy() {
	for (const node of document.querySelectorAll('[data-icon]')) node.outerHTML = labIcon(node.dataset.icon);
	const toolKinds = { inspect: 0, erase: 0, mine: ECONOMY_MINE, factory: ECONOMY_FACTORY, town: ECONOMY_TOWN, gold: ECONOMY_GOLD, garden: ECONOMY_GARDEN, farm: ECONOMY_FARM, sawmill: ECONOMY_SAWMILL };
	const model = new PriceEconomy();
	const plots = [new FieldPlot($('resource-map'), true), new FieldPlot($('price-map'), false)];
	const stats = new EconomyTelemetry();
	const diagnostics = new EconomyDiagnostics(model);
	const tracked = new TrackedPanel(model, diagnostics);
	const panel = new EconomyPanel(diagnostics, PANEL_ROWS, () => model.tracker.list);
	const guide = $('field-guide'), runButton = $('run-button'), runState = $('run-state');
	const speedSelect = $('speed'), decay = $('price-decay'), derived = $('derived-bid'), suppression = $('stock-suppression'), flow = $('show-flow');
	const creditBox = $('credit-notes'), redeemButton = $('redeem-notes'), creditMessage = $('credit-message');
	const toolButtons = document.querySelectorAll('[data-tool]'), clearButton = $('clear-towns');
	const resourceButtons = document.querySelectorAll('[data-resource]');
	const edgeButtons = document.querySelectorAll('[data-map-edge]');
	const message = $('edit-message'), stepButton = $('step-button');
	let running = !matchMedia('(prefers-reduced-motion: reduce)').matches;
	let rate = Number(speedSelect.value), tool = 'inspect';
	let selected = -1, owner = null, readingPlot = plots[0], pinned = false, dirty = true;
	let lastFrame = performance.now(), lastPaint = 0, lastStats = 0, accumulator = 0;
	model.decay = decay.checked;
	model.derived = derived.checked;
	model.suppression = suppression.checked;
	// Credit is a saved preference (plan M.3), never world state: restore from localStorage only, so the
	// DOM default (or a test's checked node) can never switch the bank's note issuance on by itself.
	const SETTINGS_KEY = 'fluxfield.particle-transfer-b2.settings';
	function saveSettings() {
		try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ v: 1, credit: model.creditOn })); } catch (err) { /* storage unavailable */ }
	}
	function restoreSettings() {
		let credit = false;
		try {
			const raw = localStorage.getItem(SETTINGS_KEY);
			if (raw) {
				const data = JSON.parse(raw);
				if (data && data.v === 1) credit = !!data.credit;
			}
		} catch (err) { /* corrupt or unavailable */ }
		model.creditOn = credit;
		creditBox.checked = credit;
		if (credit) creditMessage.textContent = 'Credit notes restored from your last session.';
	}
	restoreSettings();
	function syncEdgeLabel() {
		$('grid-size').textContent = `${ECONOMY_WIDTH} × ${ECONOMY_HEIGHT} (forage ${model.forage.cw} × ${model.forage.ch}) · ${MAP_WRAP ? 'wrap' : 'bounded'}`;
	}
	syncEdgeLabel();
	$('source-note').textContent = SOURCE_RATE.toFixed(2);
	$('uptake-note').textContent = NEED_RATE.toFixed(2);
	$('start-price-note').textContent = START_PRICE.toFixed(0);
	$('gold-rate-note').textContent = GOLD_RATE.toFixed(2);

	function syncActors() {
		const counts = [0, 0, 0, 0, 0, 0, 0, 0];
		for (const kind of model.actors) counts[kind]++;
		const [, mines, factories, towns, gold, gardens, farms, sawmills] = counts;
		let young = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) if (model.settlements.isYoungTown(i)) young++;
		$('actor-count').textContent = `${mines} M · ${factories} F · ${towns} T${young ? ` (${young}y)` : ''} · ${gold} G · ${gardens} A · ${farms} H · ${sawmills} S`;
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

	// Text panels refresh at 4 Hz while running; when paused only the handler that changed something calls this.
	function texts() {
		stats.refresh(model); tracked.refresh(); panel.refresh(); readings();
	}

	function readings() {
		for (const plot of plots) plot.showReading(plot === owner ? selected : -1, model, pinned);
	}

	function selectCell(plot, i) {
		owner = plot; selected = i; dirty = true;
		if (plot && i >= 0) readingPlot = plot;
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
					tracked.refresh();
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
		syncActors(); selectCell(plot, i); texts();
	}

	function tick() {
		const townFounded = model.settlements.founded, firmFounded = model.founding.founded;
		model.step(); stats.record(model); diagnostics.record(); tracked.tick(); dirty = true;
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
		if (running && now - lastStats >= 250) { texts(); lastStats = now; }
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

	function toggleRun() { running = !running; syncPlayback(); texts(); }

	function reset() {
		model.reset(); stats.reset(model); tracked.reset(); syncActors(); clearSelection();
		accumulator = 0; lastFrame = performance.now();
		message.textContent = 'Reset · goods and workers run as conserved SoA particles.';
		texts(); paint();
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
	stepButton.addEventListener('click', () => { tick(); texts(); paint(); });
	speedSelect.addEventListener('change', () => { rate = Number(speedSelect.value); });
	decay.addEventListener('change', () => { model.decay = decay.checked; message.textContent = `Price decay ${model.decay ? 'enabled' : 'disabled'}.`; });
	derived.addEventListener('change', () => { model.derived = derived.checked; message.textContent = `Derived bid ${model.derived ? 'enabled' : 'disabled'}.`; });
	suppression.addEventListener('change', () => { model.suppression = suppression.checked; message.textContent = `Stock suppression ${model.suppression ? 'enabled' : 'disabled'}.`; });
	creditBox.addEventListener('change', () => {
		if (creditBox.checked) {
			model.creditOn = true;
			model.creditStop = false;
			saveSettings();
			creditMessage.textContent = 'Credit notes on: the bank lends its own notes — expansion adds notes, never gold.';
			return;
		}
		// M.3: the switch may only fall once every note is settled; until then stop new issuance and let F1 resume.
		if (!model.bank.notesSettled()) {
			creditBox.checked = true;
			model.creditStop = true;
			creditMessage.textContent = `Credit stopping: ${model.bank.noteLiability.toFixed(2)} g of notes still outstanding. New note loans stop and gold lending resumes — redeem and repay, then uncheck again.`;
			return;
		}
		model.creditOn = false;
		model.creditStop = false;
		saveSettings();
		creditMessage.textContent = 'Credit notes off: the bank lends gold again.';
	});
	redeemButton.addEventListener('click', () => {
		const pool = model.workers;
		const w = pool.watchedId >= 0 ? pool.indexOfId(pool.watchedId) : -1;
		const held = w >= 0 ? pool.notes[w] : 0;
		if (held <= 0) {
			creditMessage.textContent = 'Watched worker holds no notes to redeem — click a worker with a note wallet first.';
			return;
		}
		const { fill, queued } = model.bank.redeemWorker(w, held);
		const susp = model.bank.isSuspended() ? '; reserve empty — credit suspended, issuance refused' : '';
		creditMessage.textContent = `Redeemed ${fill.toFixed(2)} g of ${held.toFixed(2)} g notes; ${queued.toFixed(2)} g queued${susp}.`;
	});
	flow.addEventListener('change', () => { dirty = true; paint(); });
	$('particle-shape').addEventListener('change', event => {
		for (const plot of plots) plot.shape = event.target.value;
		dirty = true; paint();
	});
	for (const button of edgeButtons) button.addEventListener('click', () => {
		const wrap = button.dataset.mapEdge === 'wrap';
		for (const candidate of edgeButtons) candidate.setAttribute('aria-pressed', candidate === button);
		setMapWrap(wrap);
		model.land.refresh();
		model.forage.rebuildCoarse();
		model.forage.warm();
		syncEdgeLabel();
		message.textContent = wrap ? 'Map wraps X and Y: goods, workers and prices cross the edges.' : 'Map bounded: edges and corners reflect prices.';
		dirty = true;
	});
	labBindCopy($('copy-reading'), () => `# cell reading · ${plots[0].resource} · t=${$('sim-time').textContent}\n${readingPlot.tooltip.textContent || 'Hover or pin a cell on either map first.'}`);
	$('new-map').addEventListener('click', reset);
	clearButton.addEventListener('click', () => { model.clearTowns(); syncActors(); texts(); paint(); message.textContent = 'Towns removed. Tired workers shelter-rest, forage and found a young town.'; });
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
	tracked.tick();
	tracked.refresh();
	panel.refresh();
	requestAnimationFrame(frame);
}

bootEconomy();
