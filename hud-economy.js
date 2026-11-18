// owns: economy engine and feedback controls, both field legends and the inspector
// edit for: engine descriptions, fixed display scales and cell readouts

const HUD_ENGINE_NOTE = [
	'Stock pushes down demand at its cell. The signed signal spreads across land.',
	'Settlements draw from nearby stock. As their catchments fill, the flow bends toward hungrier towns.',
	'A short queue meters arrivals. Stock in the queue and on nearby tiles both ease the pull.'
];

const hudEconomy = { radios: [], noteEl: null, inspectEl: null, pressureEl: null, primary: null, secondary: null };

function hudEconomyInit() {
	hudEconomy.noteEl = $('ui-engine-note');
	hudEconomy.inspectEl = $('ui-inspect');
	hudEconomy.pressureEl = $('ui-pressure');
	hudEconomy.primary = hudLegendRefs('ui-map');
	hudEconomy.secondary = hudLegendRefs('ui-demand');
	hudBuildEngine();
	const surplus = $('ui-surplus');
	surplus.checked = mape.surplusFeedback;
	surplus.addEventListener('change', () => {
		mape.surplusFeedback = surplus.checked;
		hudUpdateInspect();
	});
	const pressure = hudEconomy.pressureEl;
	pressure.checked = mape.localPressure;
	pressure.addEventListener('change', () => { mape.localPressure = pressure.checked; });
}

function hudLegendRefs(prefix) {
	return {
		meta: $(prefix + '-meta'),
		layer: $(prefix + '-layer'),
		unit: $(prefix + '-unit'),
		legend: $(prefix + '-legend'),
		scale: $(prefix + '-scale'),
		range: $(prefix + '-range'),
		key: $(prefix + '-key')
	};
}

function hudBuildEngine() {
	const host = $('ui-engine');
	host.textContent = '';
	const group = hudMakeSeg('ui-engine-mode', 'economy engine', MAPE_ENGINE_NAME, mape.engine, hudEconomy.radios, hudSetEngine, false);
	for (let k = 0; k < hudEconomy.radios.length; k++) hudEconomy.radios[k].disabled = !mapeEngineAvailable(k);
	group.children[MAPE_ENGINE.SITES].title = 'Discrete shipments are not available.';
	host.appendChild(group);
	hudSyncEngine();
}

function hudSetEngine(mode) {
	actionsSetEngine(mode);
	hudSyncEngine();
}

function hudSyncEngine() {
	for (let k = 0; k < hudEconomy.radios.length; k++) hudEconomy.radios[k].checked = mape.engine === k;
	hudEconomy.noteEl.textContent = HUD_ENGINE_NOTE[mape.engine];
	hudEconomy.pressureEl.disabled = mape.engine === MAPE_ENGINE.DIFFUSION;
	hudSyncMapLegend();
}

function hudSyncMapLegend() {
	if (!hudEconomy.primary) return;
	const show = renderIsFieldView(render.view);
	hudEconomy.primary.meta.hidden = hudEconomy.primary.legend.hidden = !show;
	if (!show) return;
	hudPaintFieldLegend(hudEconomy.primary, render.view === VIEW.DEMAND);
	hudPaintFieldLegend(hudEconomy.secondary, true);
}

function hudPaintFieldLegend(refs, demand) {
	const item = mape.viewItem;
	const style = render.fieldStyle;
	const bounded = renderDemandMax() === 1;
	refs.layer.textContent = (demand ? 'Demand · ' : 'Supply · ') + MAPE_RES_NAME[item];
	refs.unit.textContent = demand ? bounded ? 'Pull / 0–1' : 'Signed pull / ±6' : 'Stock per cell';
	refs.scale.className = 'ui-scale look-' + style + (demand ? bounded ? ' demand' : ' demand signed' : '');
	const stockMax = style === RENDER_STYLE.A ? RENDER_A_STOCK_MAX : RENDER_STOCK_MAX;
	refs.range.textContent = demand ? bounded ? '0 → 1 pull' : '−6 surplus → +6 pull' : '0 → ' + stockMax + '/cell' + (style === RENDER_STYLE.FIELDBOOK ? '' : ' · log');
	let key = render.showSettlements ? '○ Settlement' : '';
	const showSource = render.showSources && (item === MAPE_RES.GOODS || !demand || style !== RENDER_STYLE.A);
	if (showSource && item !== MAPE_RES.CO2) {
		const source = item === MAPE_RES.GOODS ? '◇ Workshop' : style === RENDER_STYLE.A ? '■ Mine' : style === RENDER_STYLE.B ? '◆ Mine' : '▲ Mine';
		key += (key ? ' · ' : '') + source;
	}
	refs.key.textContent = key;
}

function hudSigned(value) {
	return (value >= 0 ? '+' : '') + value.toFixed(2);
}

function hudFlowRate(slot) {
	return mape.flowDt ? Math.hypot(mape.flowX[slot], mape.flowY[slot]) / mape.flowDt : 0;
}

function hudUpdateInspect() {
	if (!hudEconomy.inspectEl) return;
	if (mapScene.id) return hudSceneInspect(hudEconomy.inspectEl);
	const x = input.hoverX >= 0 ? input.hoverX : party.x;
	const y = input.hoverX >= 0 ? input.hoverY : party.y;
	const n = world.n;
	const idx = y * world.size + x;
	const pct = (mape.settleCount / n * 100).toFixed(1);
	let text = 'Settlements ' + mape.settleCount + ' (' + pct + '%) · pop ' + Math.round(mape.totalPop) +
		'\nCell ' + x + ',' + y + ' · ' + TERRAIN_NAME[world.terrain[idx]] +
		' · pop ' + mape.pop[idx].toFixed(1) + ' · work ' + mape.workforce[idx].toFixed(1);
	for (let r = 0; r < MAPE_R; r++) {
		const slot = r * n + idx;
		text += (r % 2 === 0 ? '\n' : ' · ') + MAPE_RES_NAME[r] +
			' d ' + hudSigned(mape.demand[slot]) + ' s ' + mape.goods[slot].toFixed(2);
	}
	if (mape.engine !== MAPE_ENGINE.DIFFUSION && mapeIsSettlement(idx)) {
		text += '\nImport pull · coal ' + Math.round(100 * mapeMarketPull(MAPE_RES.COAL, idx)) +
			'% · goods ' + Math.round(100 * mapeMarketPull(MAPE_RES.GOODS, idx)) + '%';
	}
	const lock = mapeDepositState(x, y);
	if (lock >= 0) text += '\nDeposit ' + hudMineText(lock, idx);
	if (renderHasSupply() && mape.viewItem !== MAPE_RES.CO2) {
		text += '\nNet flow ' + hudFlowRate(mape.viewItem * n + idx).toFixed(2) + '/s';
	}
	hudEconomy.inspectEl.textContent = text;
}
