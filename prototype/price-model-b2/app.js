// Owns: lab controls, linked cell inspection and the fixed-step playback clock.
// Edit for: B2 resource descriptions, sawmill/farm tool hints and UI bindings.
'use strict';

const TOOL_KINDS = { inspect:0, erase:0, mine:ECONOMY_MINE, factory:ECONOMY_FACTORY, town:ECONOMY_TOWN, gold:ECONOMY_GOLD, sawmill:ECONOMY_SAWMILL, farm:ECONOMY_FARM };
const RESOURCE_TITLES = {
	coal:['Coal stock','Available stock per cell','Coal price','Diffused buyer bid per cell'],
	goods:['Goods stock','Available stock per cell','Goods price','Diffused buyer bid per cell'],
	wood:['Wood stock','Sawmill timber, town forage and stores','Wood price','Diffused town & builder bid per cell'],
	food:['Food stock','Seasonal farm harvest, wild forage and stores','Food price','Diffused town food bid per cell'],
	labor:['Labor force','Self-moving workers commuting to firms','Wage','Diffused firm wage bid per cell'],
	depleted:['Depleted workforce','Tired or migrating workers carrying earned gold','Living value','Diffused comfort per gold tax (fades with distance)'],
	gold:['Gold held','Vaults, resident purses, worker wallets and coin','Payment & home pull','Where owed bills and returning worker pay head'],
	land:['Land rest','Terrain rest pace less facility wasteland and consumption litter','Town site','Rest × build ease (shore best, swamp worst) less other towns\' claim']
};
const TOOL_HINTS = { inspect:'Select a cell on either map to inspect its values, farmland plots and carried worker gold.', mine:'Select an empty cell on either map to place a mine.', factory:'Select an empty cell on either map to place a factory.', sawmill:'Select an empty cell near forest to place a sawmill. Hired workers fell patch trees into priced timber.', farm:'Select an empty cell on moist meadow or shore to place a farm. Workers clear and harvest cultivated plots.', town:'Select an empty land cell on either map to place a town. Resident workers step out on wage gradients and pay living tax on rest.', gold:'Select an empty cell on either map to place a gold mine. Workers carry dug wages home in their wallets.', erase:'Select an actor to remove it. Stored stock and worker wallets stay in their cells.' };

function bootEconomy() {
	for (const node of document.querySelectorAll('[data-icon]')) node.outerHTML = labIcon(node.dataset.icon);
	const model = new PriceEconomy();
	const plots = [new FieldPlot($('resource-map'),true),new FieldPlot($('price-map'),false)];
	const stats = new EconomyTelemetry();
	const diagnostics = new EconomyDiagnostics(model);
	const panel = new EconomyPanel(diagnostics, PANEL_ROWS);
	const guide = $('field-guide'), runButton = $('run-button'), runState = $('run-state');
	const speedSelect = $('speed'), decay = $('price-decay'), derived = $('derived-bid'), suppression = $('stock-suppression'), flow = $('show-flow');
	const edgeButtons = document.querySelectorAll('[data-map-edge]');
	const toolButtons = document.querySelectorAll('[data-tool]'), clearButton = $('clear-towns');
	const resourceButtons = document.querySelectorAll('[data-resource]');
	const message = $('edit-message'), stepButton = $('step-button');
	let running = !matchMedia('(prefers-reduced-motion: reduce)').matches;
	let speed = Number(speedSelect.value), tool = 'inspect';
	let selected = -1, owner = null, pinned = false, dirty = true;
	let lastFrame = performance.now(), lastPaint = 0, lastStats = 0, accumulator = 0;
	model.decay = decay.checked;
	model.derived = derived.checked;
	model.suppression = suppression.checked;
	function syncEdgeLabel() {
		$('grid-size').textContent = `${ECONOMY_WIDTH} × ${ECONOMY_HEIGHT} · ${MAP_WRAP ? 'wrap' : 'bounded'}`;
	}
	syncEdgeLabel();
	$('source-note').textContent = SOURCE_RATE.toFixed(2);
	$('uptake-note').textContent = NEED_RATE.toFixed(2);
	$('start-price-note').textContent = START_PRICE.toFixed(0);
	$('gold-rate-note').textContent = GOLD_RATE.toFixed(2);

	function syncActors() {
		const counts = [0,0,0,0,0,0,0];
		for (const kind of model.actors) counts[kind]++;
		const [, mines, factories, towns, gold, sawmills, farms] = counts;
		let young = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) if (model.settlements.isYoungTown(i)) young++;
		$('actor-count').textContent = `${mines} M · ${factories} F · ${sawmills} S · ${farms} A · ${towns} T${young ? ` (${young} young)` : ''} · ${gold} G`;
		clearButton.disabled = !towns;
		for (const plot of plots) plot.readActors(model.actors);
		dirty = true;
	}

	function paint() {
		for (const plot of plots) plot.draw(model,selected,flow.checked);
		dirty = false;
	}

	function fit() {
		for (const plot of plots) plot.fit();
		stats.fit(); stats.refresh(model); paint(); readings();
	}

	function readings() {
		for (const plot of plots) plot.showReading(plot === owner ? selected : -1,model,pinned);
	}

	function selectCell(plot, i) {
		owner = plot; selected = i; dirty = true;
		readings();
	}

	function clearSelection() {
		pinned = false; selectCell(null,-1);
	}

	function applyTool(plot, i) {
		if (i < 0) return;
		if (tool === 'inspect') {
			pinned = !(pinned && owner === plot && selected === i);
			selectCell(plot,i);
			message.textContent = pinned ? `Pinned cell ${cellName(i)}.` : 'Both maps are linked.';
			return;
		}
		const kind = TOOL_KINDS[tool];
		if (kind === 0 && !model.actors[i]) { message.textContent = 'No actor in this cell.'; return; }
		if (!model.setActor(i,kind)) { message.textContent = 'Cell occupied. Erase its actor first.'; return; }
		message.textContent = `Actor ${kind ? 'placed' : 'removed'} at ${cellName(i)}.`;
		syncActors(); selectCell(plot,i);
	}

	function tick() {
		const founded = model.settlements.founded;
		model.step(); stats.record(model); diagnostics.record(); dirty = true;
		if (model.settlements.founded !== founded) syncActors();
	}

	function frame(now) {
		const elapsed = Math.min(0.15,Math.max(0,now-lastFrame)/1000);
		lastFrame = now;
		if (running) {
			accumulator += elapsed*speed;
			while (accumulator >= ECONOMY_DT) { tick(); accumulator -= ECONOMY_DT; }
		}
		if (dirty && now-lastPaint >= 1000/30) { paint(); lastPaint = now; }
		if (now-lastStats >= 250) {
			if (running) stats.refresh(model);
			panel.refresh(); readings(); lastStats = now;
		}
		requestAnimationFrame(frame);
	}

	function syncPlayback() {
		runButton.firstElementChild.outerHTML = labIcon(running ? 'pause' : 'play');
		runButton.lastElementChild.textContent = running ? 'Pause' : 'Resume';
		runButton.setAttribute('aria-label', running ? 'Pause simulation' : 'Resume simulation');
		runState.classList.toggle('paused',!running);
		runState.lastElementChild.textContent = running ? 'Running' : 'Paused';
		stepButton.hidden = running;
		lastFrame = performance.now();
	}

	function toggleRun() { running = !running; syncPlayback(); stats.refresh(model); readings(); }

	function reset() {
		model.reset(); stats.reset(model); syncActors(); clearSelection();
		accumulator = 0; lastFrame = performance.now();
		message.textContent = 'New map · workers carry wages in depletedGold and pay living tax on rest.';
		stats.refresh(model); panel.refresh(); paint();
	}

	for (const plot of plots) {
		const { canvas } = plot;
		canvas.addEventListener('pointermove',event => { if (!pinned) selectCell(plot,plot.cellAt(event)); });
		canvas.addEventListener('pointerleave',() => { if (!pinned) clearSelection(); });
		canvas.addEventListener('click',event => applyTool(plot,plot.cellAt(event)));
		canvas.addEventListener('focus',() => { if (!pinned && canvas.matches(':focus-visible')) selectCell(plot,economyIndex(ECONOMY_WIDTH/2,ECONOMY_HEIGHT/2)); });
		canvas.addEventListener('blur',() => { if (!pinned) clearSelection(); });
		canvas.addEventListener('keydown',event => {
			if (event.key === 'Enter') { event.preventDefault(); applyTool(plot,selected); return; }
			if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
			event.preventDefault(); pinned = false;
			const i = Math.max(0,selected);
			const x = i%ECONOMY_WIDTH + (event.key === 'ArrowRight') - (event.key === 'ArrowLeft');
			const y = Math.floor(i/ECONOMY_WIDTH) + (event.key === 'ArrowDown') - (event.key === 'ArrowUp');
			selectCell(plot,economyIndex(Math.max(0,Math.min(ECONOMY_WIDTH-1,x)),Math.max(0,Math.min(ECONOMY_HEIGHT-1,y))));
		});
	}
	for (const button of toolButtons) button.addEventListener('click',() => {
		tool = button.dataset.tool;
		for (const candidate of toolButtons) candidate.setAttribute('aria-pressed',candidate === button);
		$('tool-hint').textContent = TOOL_HINTS[tool]; message.textContent = 'Both maps are linked.';
		for (const plot of plots) plot.canvas.style.cursor = tool === 'inspect' ? 'crosshair' : 'cell';
		clearSelection();
	});
	for (const button of resourceButtons) button.addEventListener('click',() => {
		for (const plot of plots) plot.resource = button.dataset.resource;
		for (const candidate of resourceButtons) candidate.setAttribute('aria-pressed',candidate === button);
		const [stockTitle, stockNote, priceTitle, priceNote] = RESOURCE_TITLES[button.dataset.resource];
		$('stock-title').textContent = stockTitle; $('stock-note').textContent = stockNote;
		$('price-title').textContent = priceTitle; $('price-note').textContent = priceNote;
		dirty = true;
	});
	runButton.addEventListener('click',toggleRun);
	stepButton.addEventListener('click',() => { tick(); stats.refresh(model); readings(); paint(); });
	speedSelect.addEventListener('change',() => { speed = Number(speedSelect.value); });
	decay.addEventListener('change',() => { model.decay = decay.checked; message.textContent = `Price decay ${model.decay ? 'enabled' : 'disabled'}: ${model.decay ? 'bids and appeal weaken with distance.' : 'signals reach the whole map.'}`; });
	derived.addEventListener('change',() => { model.derived = derived.checked; message.textContent = `Derived bid ${model.derived ? 'enabled' : 'disabled'}.`; });
	suppression.addEventListener('change',() => { model.suppression = suppression.checked; message.textContent = `Stock suppression ${model.suppression ? 'enabled' : 'disabled'}.`; });
	flow.addEventListener('change',() => { dirty = true; });
	for (const button of edgeButtons) button.addEventListener('click',() => {
		const wrap = button.dataset.mapEdge === 'wrap';
		for (const candidate of edgeButtons) candidate.setAttribute('aria-pressed',candidate === button);
		setMapWrap(wrap);
		model.land.refresh();
		syncEdgeLabel();
		message.textContent = wrap ? 'Map wraps X and Y: goods, workers and prices cross the edges.' : 'Map bounded: edges and corners reflect price peaks.';
		dirty = true;
	});
	$('new-map').addEventListener('click',reset);
	clearButton.addEventListener('click',() => { model.clearTowns(); syncActors(); readings(); message.textContent = 'Towns removed. Bids fade and the chain halts.'; });
	$('guide-button').addEventListener('click',() => guide.showModal());
	$('close-guide').addEventListener('click',() => guide.close());
	guide.addEventListener('click',event => {
		if (event.target !== guide) return;
		const r = guide.getBoundingClientRect();
		if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) guide.close();
	});
	document.addEventListener('keydown',event => {
		if (guide.open || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
		if (event.key === '?') { guide.showModal(); return; }
		if (event.key === 'Escape') { clearSelection(); message.textContent = 'Both maps are linked.'; return; }
		if (event.code !== 'Space' || event.target.closest('button,select,input')) return;
		event.preventDefault(); toggleRun();
	});
	document.addEventListener('visibilitychange',() => { lastFrame = performance.now(); accumulator = 0; });
	window.addEventListener('resize',fit);
	stats.reset(model);
	for (let n = 0; n < Math.round(16/ECONOMY_DT); n++) tick();
	syncActors(); syncPlayback(); fit();
	panel.refresh();
	document.fonts.ready.then(fit);
	requestAnimationFrame(frame);
}

bootEconomy();
