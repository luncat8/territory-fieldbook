// owns: the economy scene controls and live coal readouts
// edit for: scene playback controls and actor-tool feedback

const HUD_SCENE_TOOL_NOTE = [
	'Hover either map to inspect. Click a mine or factory to watch it in the workforce block; click any other cell to pin the same cell on both.',
	'Click an empty cell on either map to place a staffed coal mine.',
	'Click an empty cell on either map to add a settlement and watch the routes change.',
	'Click a mine, settlement or factory to remove it without deleting the coal already on the map.',
	'Click an empty cell on either map to add an active factory and watch its staffing and rates.'
];

const hudScene = {
	tools: [],
	fills: [],
	step: null,
	note: null,
	stock: null,
	mined: null,
	used: null
};

function hudSceneInit() {
	if (!mapScene.id) return;
	$('ui-around-panel').hidden = $('ui-survey-panel').hidden = true;
	$('ui-scene-tools').hidden = $('ui-scene-stats').hidden = false;
	$('ui-survey-link').hidden = false;
	$('ui-map-kicker').textContent = 'Economy test · ' + mapScene.id.toUpperCase();
	$('ui-map-title').textContent = MAPE_SCENE_LAYOUTS[mapScene.id].name;
	$('ui-scene-a').target = $('ui-scene-b').target = '_self';
	$('ui-scene-a').title = 'Open the Catchment layout';
	$('ui-scene-b').title = 'Open the Queue layout';
	$('ui-scene-' + mapScene.id).setAttribute('aria-current', 'page');
	hudScene.stock = $('ui-scene-stock');
	hudScene.mined = $('ui-scene-mined');
	hudScene.used = $('ui-scene-used');
	hudScene.note = $('ui-scene-note');
	$('ui-tools').appendChild(hudMakeSeg('ui-scene-tool', 'map tool', MAPE_SCENE_TOOLS, mapScene.tool, hudScene.tools, hudSceneSetTool, false));
	hudSceneSetTool(mapScene.tool);
	for (const fill of [0, 0.5]) {
		const button = hudButton('Fill ' + fill, true, () => actionsReplayScene(fill), 'ui-chip');
		hudScene.fills.push(button);
		$('ui-replay').appendChild(button);
	}
	hudScene.step = hudButton('Step 0.05s', false, actionsStepScene, 'ui-chip');
	$('ui-time').appendChild(hudScene.step);
}

function hudSceneSetTool(tool) {
	mapScene.tool = tool;
	inputClearSiteSelection();
	for (let k = 0; k < hudScene.tools.length; k++) hudScene.tools[k].checked = k === tool;
	hudScene.note.textContent = HUD_SCENE_TOOL_NOTE[tool];
}

function hudSceneUpdate() {
	const coal = mape.goodsView[MAPE_RES.COAL];
	let stored = 0;
	for (let i = 0; i < world.n; i++) stored += coal[i];
	hudScene.stock.textContent = stored.toFixed(1);
	hudScene.mined.textContent = mape.minedTotal.toFixed(1);
	hudScene.used.textContent = mape.massOut.toFixed(1);
	hudScene.step.disabled = clock.speed !== 0;
	for (let k = 0; k < hudScene.fills.length; k++) hudScene.fills[k].className = mape.marketFill === k * 0.5 ? 'ui-chip on' : 'ui-chip';
}

function hudSceneInspect(el) {
	const x = input.hoverX >= 0 ? input.hoverX : input.lastX;
	const y = input.hoverX >= 0 ? input.hoverY : input.lastY;
	let text = mape.mineCount + ' mines · ' + mape.settleCount + ' settlements';
	if (x < 0) {
		el.textContent = text + '\nHover either map to inspect coal, pull and flow.';
		return;
	}
	const idx = y * world.size + x;
	const p = MAPE_RES.COAL * world.n + idx;
	text += '\nCell ' + x + ',' + y + ' · settle ' + world.settleValue[idx].toFixed(2) + ' · stock ' + mape.goods[p].toFixed(2) + ' · pull ' + mape.demand[p].toFixed(3) +
		'\nNet flow ' + hudFlowRate(p).toFixed(2) + '/s';
	if (mape.workforceMode === MAPE_WORKFORCE_MODE.FLUID && mapeIsSettlement(idx)) {
		text += '\nPopulation ' + mape.pop[idx].toFixed(1) + ' · room ' + mapeFluidFreeSpace(idx).toFixed(1) + ' / ' + mapeFluidCapacity(idx).toFixed(1) + ' · migration signal ' + hudSigned(mape.wfMigration[idx] * MAPE_WF_MIGRATION_SHARE) + '/s';
	}
	if (mape.engine !== MAPE_ENGINE.DIFFUSION && mapeIsSettlement(idx)) {
		text += ' · target ' + Math.round(100 * mapeMarketPull(MAPE_RES.COAL, idx)) + '% of hungry pull';
	}
	const mine = mapeMineAt(x, y);
	if (mine >= 0) text += '\nDeposit left ' + sites.stock[mape.mineSite[mine]].toFixed(1) + ' · productivity ' + Math.round(100 * landProductivity(idx)) + '%';
	el.textContent = text;
}
