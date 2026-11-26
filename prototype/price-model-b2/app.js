// Owns: lab controls, linked cell inspection and the fixed-step playback clock.
// Edit for: B2 resource descriptions, sawmill/farm tool hints and UI bindings.
'use strict';

const $ = id => document.getElementById(id);
const ICON_PATHS = {
	book:'M12 6c-3-2-7-2-10-1v13c3-1 7-1 10 1 3-2 7-2 10-1V5c-3-1-7-1-10 1Zm0 0v13',
	pause:'M9 5v14M15 5v14',play:'m8 4 12 8-12 8z',step:'m5 5 10 7-10 7zM19 5v14',chevron:'m6 9 6 6 6-6',
	box:'m3 7 9-5 9 5v10l-9 5-9-5zM3 7l9 5 9-5M12 12v10',
	radio:'M12 10a2 2 0 1 0 .01 0M7.8 7.8a6 6 0 0 0 0 8.4m8.4-8.4a6 6 0 0 1 0 8.4M5 4.8a10 10 0 0 0 0 14.4M19 4.8a10 10 0 0 1 0 14.4',
	up:'M3 17l6-6 4 4 8-10m-7 0h7v7',down:'m3 7 6 6 4-4 8 10m-7 0h7v-7',
	grid:'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',check:'m5 12 4 4L19 6',
	layers:'m2 8 10-5 10 5-10 5zM2 12l10 5 10-5M2 16l10 5 10-5',
	contour:'M3 12c0-4 3-4 5-7 4-5 11-2 11 3 0 4 5 6 2 10-2 4-6 1-10 3-5 1-9-3-8-9Zm4 0c0-2 3-3 4-5 3-2 5 0 5 3 0 3 4 5 1 7-2 1-3-1-6 0-3 1-5-2-4-5Zm4 0c1-3 4-3 4 1 0 3-4 3-4-1Z',
	sliders:'M3 7h4m5 0h9M3 17h10m5 0h3M7 4h5v6H7zM13 14h5v6h-5z',
	cursor:'m4 3 6.5 18 3.2-7.5L21 10z',crosshair:'M12 3v5m0 8v5M3 12h5m8 0h5M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
	diamond:'m12 2 10 10-10 10L2 12z',hexagon:'M12 2l8.7 5v10L12 22l-8.7-5V7z',square:'M4 4h16v16H4z',circle:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
	triangle:'M12 3 21 19H3z',pentagon:'M12 2.5 21 9l-3.4 10.5H6.4L3 9z',
	erase:'m3 14 10-10a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 8H9l-6-6Zm6-6 8 8M12 20h9',
	reset:'M3 4v6h6M4 9a8 8 0 1 1 .7 8',clear:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',close:'m6 6 12 12M18 6 6 18'
};
const labIcon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON_PATHS[name]}"/></svg>`;
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
	const guide = $('field-guide'), runButton = $('run-button'), runState = $('run-state');
	const speedSelect = $('speed'), decay = $('price-decay'), derived = $('derived-bid'), suppression = $('stock-suppression'), flow = $('show-flow');
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
	$('grid-size').textContent = `${ECONOMY_WIDTH} × ${ECONOMY_HEIGHT}`;
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
		model.step(); stats.record(model); dirty = true;
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
		if (running && now-lastStats >= 250) { stats.refresh(model); readings(); lastStats = now; }
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
		stats.refresh(model); paint();
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
	document.fonts.ready.then(fit);
	requestAnimationFrame(frame);
}

bootEconomy();
