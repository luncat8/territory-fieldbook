// owns: economy engine and feedback controls, both field legends and the inspector
// edit for: engine descriptions, fixed display scales and cell readouts

const HUD_ENGINE_NOTE = [
	'Stock pushes down demand at its cell. The signed signal spreads across land.',
	'Settlements draw from nearby stock. As their catchments fill, the flow bends toward hungrier towns.',
	'A short queue meters arrivals. Stock in the queue and on nearby tiles both ease the pull.'
];

const MAPE_WORKFORCE_NOTE = [
	'Residents walk to jobs up the pull.',
	'Fresh workforce travels to jobs and returns exhausted. Towns gain or lose population gradually with the balance; full towns stop accepting it.'
];

const hudEconomy = { radios: [], workforceRadios: [], noteEl: null, workforceNoteEl: null, inspectEl: null, pressureEl: null, primary: null, secondary: null, statsEl: null, jobsiteEl: null };

function hudEconomyInit() {
	hudEconomy.noteEl = $('ui-engine-note');
	hudEconomy.inspectEl = $('ui-inspect');
	hudEconomy.pressureEl = $('ui-pressure');
	hudEconomy.statsEl = $('ui-workforce-stats');
	hudEconomy.jobsiteEl = $('ui-jobsite');
	hudEconomy.workforceNoteEl = $('ui-workforce-note');
	hudEconomy.primary = hudLegendRefs('ui-map');
	hudEconomy.secondary = hudLegendRefs('ui-demand');
	hudBuildEngine();
	const workforce = hudMakeSeg('ui-workforce-mode', 'workforce model', MAPE_WORKFORCE_MODE_NAME, mape.workforceMode, hudEconomy.workforceRadios, hudSetWorkforce, false);
	$('ui-workforce').appendChild(workforce);
	hudEconomy.workforceNoteEl.textContent = MAPE_WORKFORCE_NOTE[mape.workforceMode];
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

function hudSetWorkforce(mode) {
	actionsSetWorkforceMode(mode);
	hudSyncWorkforce();
	hudDisplaySync();
}

function hudSyncWorkforce() {
	for (let k = 0; k < hudEconomy.workforceRadios.length; k++) hudEconomy.workforceRadios[k].checked = mape.workforceMode === k;
	hudEconomy.workforceNoteEl.textContent = MAPE_WORKFORCE_NOTE[mape.workforceMode];
}

function hudSyncEngine() {
	for (let k = 0; k < hudEconomy.radios.length; k++) hudEconomy.radios[k].checked = mape.engine === k;
	hudEconomy.noteEl.textContent = HUD_ENGINE_NOTE[mape.engine];
	hudEconomy.pressureEl.disabled = mape.engine === MAPE_ENGINE.DIFFUSION;
	hudSyncMapLegend();
}

function hudSyncMapLegend() {
	if (!hudEconomy.primary) return;
	const paired = renderIsPaired();
	const show = renderIsFieldView(render.view);
	hudEconomy.primary.meta.hidden = hudEconomy.primary.legend.hidden = !show;
	hudEconomy.secondary.meta.hidden = hudEconomy.secondary.legend.hidden = !paired;
	if (!show) return;
	hudPaintFieldLegend(hudEconomy.primary, render.view === VIEW.DEMAND);
	if (paired) hudPaintFieldLegend(hudEconomy.secondary, true);
}

function hudPaintFieldLegend(refs, demand) {
	const item = demand ? mape.viewItemDemand : mape.viewItem;
	const style = render.fieldStyle;
	const scale = 'ui-scale look-' + style;
	refs.layer.textContent = (demand ? 'Demand · ' : 'Amount · ') + MAPE_VIEW_ITEM_LABEL[item];
	if (item > MAPE_RES.CO2) hudPaintWorkerLegend(refs, item, demand, scale);
	else if (demand) hudPaintPullLegend(refs, item, scale);
	else hudPaintStockLegend(refs, style, scale);
	hudPaintLegendKey(refs, item, demand, style);
}

// People and pools are quantities, not resource stock: each has its own fixed scale.
function hudPaintWorkerLegend(refs, item, demand, scale) {
	if (!demand) {
		refs.unit.textContent = item === MAPE_VIEW_ITEM.POPULATION ? 'Persons / cell' : 'Workforce pool / cell';
		refs.scale.className = scale;
		refs.range.textContent = item === MAPE_VIEW_ITEM.POPULATION ? '0 → ' + MAPE_VIEW_POP_MAX + ' · sqrt' : 'log 0 → ' + MAPE_VIEW_POOL_MAX;
		return;
	}
	refs.scale.className = scale + ' demand';
	if (item === MAPE_VIEW_ITEM.JOBS) {
		refs.unit.textContent = 'Job slots / cell';
		refs.range.textContent = '0 → ' + MAPE_VIEW_JOB_MAX + ' · sqrt';
		return;
	}
	refs.unit.textContent = item === MAPE_VIEW_ITEM.FRESH ? 'Fresh pull / cell' : 'Rest pull / cell';
	refs.range.textContent = '0 → 1 pull';
}

function hudPaintPullLegend(refs, item, scale) {
	const bounded = renderDemandMax(item) === 1;
	refs.unit.textContent = bounded ? 'Pull / 0–1' : 'Signed pull / ±6';
	refs.scale.className = scale + (bounded ? ' demand' : ' demand signed');
	refs.range.textContent = bounded ? '0 → 1 pull' : '−6 surplus → +6 pull';
}

function hudPaintStockLegend(refs, style, scale) {
	const stockMax = style === RENDER_STYLE.A ? RENDER_A_STOCK_MAX : RENDER_STOCK_MAX;
	refs.unit.textContent = 'Amount per cell';
	refs.scale.className = scale;
	refs.range.textContent = '0 → ' + stockMax + '/cell' + (style === RENDER_STYLE.FIELDBOOK ? '' : ' · log');
}

function hudPaintLegendKey(refs, item, demand, style) {
	const resource = item <= MAPE_RES.CO2;
	const towns = render.showSettlements && item !== MAPE_VIEW_ITEM.POPULATION;
	let key = towns ? '○ Settlement' : '';
	const showSource = render.showSources && resource && (item === MAPE_RES.GOODS || !demand || style !== RENDER_STYLE.A);
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
		' · pop ' + mape.pop[idx].toFixed(1) + ' · jobs ' + mape.jobNeed[idx].toFixed(0) +
		' · pull ' + mape.workforce[idx].toFixed(2) + (mape.workforceMode === MAPE_WORKFORCE_MODE.FLUID ? ' · rest ' + mape.wfRestPull[idx].toFixed(2) : '') +
		' · settle ' + world.settleValue[idx].toFixed(2) + ' · waste ' + Math.round(100 * land.disturbed[idx]) + '%';
	for (let r = 0; r < MAPE_R; r++) {
		const slot = r * n + idx;
		text += (r % 2 === 0 ? '\n' : ' · ') + MAPE_RES_NAME[r] +
			' d ' + hudSigned(mape.demand[slot]) + ' s ' + mape.goods[slot].toFixed(2);
	}
	if (mape.workforceMode === MAPE_WORKFORCE_MODE.FLUID) {
		text += '\nfresh ' + mape.wfFresh[idx].toFixed(1) + ' · depleted ' + mape.wfDepleted[idx].toFixed(1);
		if (mapeIsSettlement(idx)) text += '\nSettlement room ' + mapeFluidFreeSpace(idx).toFixed(1) + ' / ' + mapeFluidCapacity(idx).toFixed(1) + ' · migration signal ' + hudSigned(mape.wfMigration[idx] * MAPE_WF_MIGRATION_SHARE) + '/s';
	}
	if (mape.engine !== MAPE_ENGINE.DIFFUSION && mapeIsSettlement(idx)) {
		text += '\nImport pull · coal ' + Math.round(100 * mapeMarketPull(MAPE_RES.COAL, idx)) +
			'% · goods ' + Math.round(100 * mapeMarketPull(MAPE_RES.GOODS, idx)) + '%';
	}
	const lock = mapeDepositState(x, y);
	if (lock >= 0) text += '\nDeposit ' + hudMineText(lock, idx);
	if (renderHasAmount() && renderHasFlowItem(mape.viewItem)) {
		text += '\nNet flow ' + hudFlowRate(mape.viewItem * n + idx).toFixed(2) + '/s';
	}
	hudEconomy.inspectEl.textContent = text;
}

function hudFactorySiteText(f, idx) {
	const st = mape.factoryState[f];
	const need = mapeFactoryWorkers(st);
	const present = mapeWorkPresent(idx);
	const staff = need > 0 ? Math.min(1, present / need) : 0;
	let text = 'Factory F' + (f + 1) + ' · ' + MAPE_FACTORY_STATE_NAME[st];
	if (st === MAPE_FACTORY_STATE.BUILDING) text += ' · ' + Math.floor(mape.factoryProgress[f] * 100) + '%';
	text += '\nCell ' + mape.factoryX[f] + ',' + mape.factoryY[f] + ' · productivity ' + Math.round(100 * landProductivity(idx)) + '% · disturbed ' + Math.round(100 * land.disturbed[idx]) + '%';
	text += '\nWorkers ' + present.toFixed(1) + '/' + need + ' · ' + Math.round(100 * staff) + '% staffed';
	if (st === MAPE_FACTORY_STATE.BUILDING) {
		text += '\niron −' + mape.factoryIron[f].toFixed(2) + '/s · starved ' + Math.floor(mape.factoryStarved[f]) + 's';
		text += '\niron stock ' + mape.goods[MAPE_RES.IRON * world.n + idx].toFixed(2);
		return text;
	}
	text += '\ncoal −' + mape.factoryCoal[f].toFixed(2) + '/s · iron −' + mape.factoryIron[f].toFixed(2) + '/s';
	text += '\ngoods +' + mape.factoryGoods[f].toFixed(2) + '/s · co2 +' + mape.factoryCo2[f].toFixed(2) + '/s';
	text += '\nstarved ' + Math.floor(mape.factoryStarved[f]) + 's';
	text += '\nstock coal ' + mape.goods[MAPE_RES.COAL * world.n + idx].toFixed(2) + ' · iron ' + mape.goods[MAPE_RES.IRON * world.n + idx].toFixed(2);
	return text;
}

function hudMineSiteText(m) {
	const site = mape.mineSite[m];
	const idx = mape.mineY[m] * world.size + mape.mineX[m];
	const present = mapeWorkPresent(idx);
	const staff = Math.min(1, present / MAPE_MINE_WORKERS);
	const active = mapeMineActive(m);
	const fuel = sites.res[site] === RES.FUEL;
	const state = !mape.mineUnlocked[m] ? 'locked' : active ? 'active' : 'inactive';
	let text = 'Mine S' + (m + 1) + ' · ' + (fuel ? 'coal' : 'iron') + ' · ' + state;
	text += '\nCell ' + mape.mineX[m] + ',' + mape.mineY[m] + ' · productivity ' + Math.round(100 * landProductivity(idx)) + '% · disturbed ' + Math.round(100 * land.disturbed[idx]) + '%';
	text += '\nWorkers ' + present.toFixed(1) + '/' + MAPE_MINE_WORKERS + ' · ' + Math.round(100 * staff) + '% staffed';
	text += '\nRate ' + (active ? (MAPE_MINE_RATE * staff).toFixed(2) : '0.00') + '/s · deposit left ' + sites.stock[site].toFixed(1);
	return text;
}

function hudUpdateJobSite() {
	const el = hudEconomy.jobsiteEl;
	const panel = $('ui-site-panel');
	if (!el || !panel) return;
	const show = (hidden) => {
		el.hidden = hidden;
		panel.hidden = hidden;
	};
	const x = input.selX;
	const y = input.selY;
	if (x < 0) {
		show(true);
		return;
	}
	const f = mapeFactoryAt(x, y);
	const m = f >= 0 ? -1 : mapeMineAt(x, y);
	if (f < 0 && m < 0) {
		show(true);
		inputClearSiteSelection();
		return;
	}
	el.textContent = f >= 0 ? hudFactorySiteText(f, y * world.size + x) : hudMineSiteText(m);
	show(false);
}

function hudUpdateWorkforce() {
	const el = hudEconomy.statsEl;
	if (!el) return;
	const t = mapeJobSummary();
	let text = 'Jobs ' + t.staffed.toFixed(1) + '/' + Math.round(t.slots) + ' staffed · open ' + t.open.toFixed(1);
	if (mape.workforceMode === MAPE_WORKFORCE_MODE.FLUID) {
		text += '\nfresh ' + t.fresh.toFixed(1) + ' · depleted ' + t.depleted.toFixed(1);
		text += '\nrested ' + mape.fluidRested.toFixed(1) + ' · spawned ' + mape.fluidSpawned;
	}
	el.textContent = text;
}
