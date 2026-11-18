// owns: the economy engine picker, field legends and cell inspector
// edit for: descriptions, overlay controls and field readouts

const HUD_ENGINE_NOTE = [
	'Stock pushes down demand at its cell. The signed signal spreads across land.',
	'Settlements draw from nearby stock. As their catchments fill, the flow bends toward hungrier towns.',
	'A short queue meters arrivals. Stock in the queue and on nearby tiles both ease the pull.'
];

const hudEconomy = {
	radios: [],
	noteEl: null,
	inspectEl: null,
	mapMeta: null,
	mapLayer: null,
	mapUnit: null,
	legend: null,
	scale: null,
	scaleLabel: null,
	siteKey: null
};

function hudEconomyInit() {
	hudEconomy.noteEl = $('ui-engine-note');
	hudEconomy.inspectEl = $('ui-inspect');
	hudEconomy.mapMeta = $('ui-field-meta');
	hudEconomy.mapLayer = $('ui-map-layer');
	hudEconomy.mapUnit = $('ui-map-unit');
	hudEconomy.legend = $('ui-field-legend');
	hudEconomy.scale = $('ui-scale');
	hudEconomy.scaleLabel = $('ui-scale-label');
	hudEconomy.siteKey = $('ui-site-key');
	hudBuildEngine();
	const surplus = $('ui-surplus');
	surplus.checked = mape.surplusFeedback;
	surplus.addEventListener('change', () => {
		mape.surplusFeedback = surplus.checked;
		hudUpdateInspect();
	});
	const flow = $('ui-flow');
	flow.checked = render.showFlow;
	flow.addEventListener('change', () => { render.showFlow = flow.checked; renderDraw(); });
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
	hudSyncMapLegend();
	if (mapScene.id) hudSyncSceneLegend();
}

function hudSyncMapLegend() {
	const item = mape.viewItem;
	const demand = !mapScene.id && render.view === VIEW.DEMAND;
	const show = !!mapScene.id || renderIsFieldView(render.view);
	hudEconomy.mapMeta.hidden = hudEconomy.legend.hidden = !show;
	if (!show) return;
	const bounded = mape.engine !== MAPE_ENGINE.DIFFUSION && mapeIsMarketItem(item);
	hudEconomy.mapLayer.textContent = (demand ? 'Demand · ' : 'Supply · ') + MAPE_RES_NAME[item];
	hudEconomy.mapUnit.textContent = demand ? bounded ? 'Pull / 0–1' : 'Signed pull' : 'Stock per cell';
	hudEconomy.scale.className = demand ? bounded ? 'ui-scale demand' : 'ui-scale signed' : 'ui-scale';
	hudEconomy.scaleLabel.textContent = demand ? bounded ? 'Low → high pull' : 'Surplus → demand' : 'Empty → stocked';
	hudEconomy.siteKey.textContent = item === MAPE_RES.GOODS ? '○ Settlement · ◇ Workshop' :
		item === MAPE_RES.CO2 ? '○ Settlement' : '○ Settlement · ▲ Mine';
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
	if (render.view === VIEW.SUPPLY && mape.viewItem !== MAPE_RES.CO2) {
		text += '\nNet flow ' + hudFlowRate(mape.viewItem * n + idx).toFixed(2) + '/s';
	}
	hudEconomy.inspectEl.textContent = text;
}
