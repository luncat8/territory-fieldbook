// owns: headless boot of the page with a stub DOM, frames, clicks, hover, views and buttons
// run: node experiments/dom_smoke.js

const vm = require('vm');
const { elements, makeElement, loadDom, rafQueue, windowStub, documentStub } = require('./dom_fixture');

let context;
let bootError = '';
try {
	context = loadDom('');
} catch (error) {
	bootError = error.message;
}

function run(code) {
	return vm.runInContext(code, context);
}

function frame(now) {
	const queue = rafQueue.splice(0, rafQueue.length);
	for (const callback of queue) callback(now);
}

function pixelSignature(pixels) {
	let hash = 2166136261 >>> 0;
	for (let i = 0; i < pixels.length; i += 16) {
		hash = Math.imul(hash ^ pixels[i], 16777619) >>> 0;
		hash = Math.imul(hash ^ pixels[i + 1], 16777619) >>> 0;
		hash = Math.imul(hash ^ pixels[i + 2], 16777619) >>> 0;
	}
	return hash;
}

const result = { bootError: bootError };

if (!bootError) {
	try {
		result.initialClock = run('$("ui-clock").textContent');
		result.starterCoalTrace = run('Array.from({ length: SITE_CAP }, (_, i) => i).some(i => sites.kind[i] === SITE.DEPOSIT && sites.res[i] === RES.FUEL && sites.state[i] === SITE_STATE.MARKED && (sites.x[i] - world.startX) ** 2 + (sites.y[i] - world.startY) ** 2 <= 64)');
		for (let f = 1; f <= 120; f++) frame(f * 16.7);
		result.frames = 120;
		result.clockSec = run('clock.seconds');
		const pixels = run('render.pixels');
		let lit = 0;
		for (let i = 0; i < pixels.length; i += 4) if (pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0) lit++;
		result.litCells = lit;
		result.clockText = run('$("ui-clock").textContent');
		result.timeButtons = run('$("ui-time").children.length');
		result.viewGroup = run('$("ui-views").children[0]');
		result.itemGroup = run('$("ui-views").children[1]');
		result.demandItemGroup = run('$("ui-views").children[2]');
		result.engineGroup = run('$("ui-engine").children[0]');
		result.workforceGroup = run('$("ui-workforce").children[0]');
		result.viewRadios = result.viewGroup.children.length;
		result.itemRadios = result.itemGroup.children.length;
		result.demandItemRadios = result.demandItemGroup.children.length;
		result.startsOnSupply = run('render.view === VIEW.AMOUNT && mape.viewItem === MAPE_RES.GOODS') && !result.itemGroup.hidden;
		result.viewGroup.children[0].children[0].click();
		result.itemHiddenOnTerrain = result.itemGroup.hidden === true;
		result.engineRadios = result.engineGroup.children.length;
		result.engineCatchmentChecked = result.engineGroup.children[1].children[0].checked;
		result.engineSitesDisabled = result.engineGroup.children[3].children[0].disabled;
		result.workforceRadios = result.workforceGroup ? result.workforceGroup.children.length : 0;
		result.workforceStats = elements.get('ui-workforce-stats').textContent;
		result.actionButtons = run('$("ui-actions").children.length');
		result.siteText = run('$("ui-site").textContent');
		result.inspectText = run('$("ui-inspect").textContent');

		result.aroundHasCoordinates = /\n[^\n]*\d+,\d+/.test(elements.get('ui-nearby').textContent);
		result.starterCoalListed = run('Array.from({ length: SITE_CAP }, (_, i) => i).some(i => sites.kind[i] === SITE.DEPOSIT && sites.res[i] === RES.FUEL && sites.state[i] !== SITE_STATE.GONE && $("ui-nearby").textContent.indexOf(sites.x[i] + "," + sites.y[i]) >= 0)');
		result.ironDepositsDeferred = run('Array.from({ length: SITE_CAP }, (_, i) => i).every(i => sites.kind[i] !== SITE.DEPOSIT || sites.res[i] !== RES.ORE || sites.state[i] === SITE_STATE.GONE)');
		const around = elements.get('ui-nearby');
		const aroundBeforeSelection = around.textContent;
		documentStub.selection = { isCollapsed: false, anchorNode: around, focusNode: around };
		run('investigation.progress[party.y * world.size + party.x] = 0.99; hudUpdateNearby()');
		result.aroundSelectionPreserved = around.textContent === aroundBeforeSelection;
		documentStub.selection.isCollapsed = true;
		run('hudUpdateNearby()');
		result.aroundRefreshesAfterSelection = around.textContent !== aroundBeforeSelection;
		documentStub.selection = null;
		result.victoryText = run('$("ui-victory").textContent');
		result.logItems = run('$("ui-log").children.length');

		// Paired fields share the demand raster; the nine single views stay distinct.
		const viewSigs = new Set();
		for (let v = 0; v < result.viewRadios; v++) {
			result.viewGroup.children[v].children[0].click();
			viewSigs.add(pixelSignature(pixels));
		}
		result.distinctViews = viewSigs.size;
		result.viewGroup.children[5].children[0].click();
		result.itemShownOnDemand = result.demandItemGroup.hidden === false && result.itemGroup.hidden === true;
		const itemSigs = new Set();
		for (let r = 0; r < result.demandItemRadios; r++) {
			result.demandItemGroup.children[r].children[0].click();
			itemSigs.add(pixelSignature(pixels));
		}
		result.distinctItems = itemSigs.size;

		const canvas = elements.get('ui-canvas');
		const settle = run('[mape.settleCells[0] % world.size, (mape.settleCells[0] / world.size) | 0]');
		canvas.dispatch('pointermove', { clientX: (settle[0] + 0.5) * 12, clientY: (settle[1] + 0.5) * 12 });
		run('hudRefresh(false)');
		result.hoverInspect = run('$("ui-inspect").textContent');
		result.hoverMatchesCell = result.hoverInspect.indexOf('Cell ' + settle[0] + ',' + settle[1]) >= 0;
		canvas.dispatch('pointerleave', {});

		const before = run('[party.x, party.y]');
		canvas.dispatch('click', { clientX: (settle[0] + 0.5) * 12, clientY: (settle[1] + 0.5) * 12 });
		frame(2100);
		result.moved = run('party.x + "," + party.y') !== before.join(',');
		result.settleSiteText = run('$("ui-site").textContent');

		const group = result.viewGroup;
		group.children[0].children[0].click();
		result.viewAfterClick = run('render.view');

		windowStub.finePointer = false;
		const coarseItem = group.children[2];
		group.dispatch('pointerover', { target: coarseItem.children[0] });
		result.coarseHoverChecked = coarseItem.children[0].checked;

		windowStub.finePointer = true;
		const hoverItem = group.children[5];
		group.dispatch('pointerover', { target: hoverItem.children[0] });
		result.viewAfterHover = run('render.view');
		result.hoverCheckedRadio = hoverItem.children[0].checked;
		const strayNode = makeElement('', false);
		group.dispatch('pointerover', { target: strayNode });
		result.strayHoverIgnored = run('render.view') === 5;
		result.radiogroupRole = group.getAttribute('role');
		result.radiogroupLabel = group.getAttribute('aria-label') || '';

		windowStub.listeners.keydown[0]({ key: '7', preventDefault() {} });
		result.viewAfterKey = run('render.view');
		result.viewRadioChecked = group.children[6].children[0].checked;
		windowStub.listeners.keydown[0]({ key: ' ', preventDefault() {} });
		result.speedAfterSpace = run('clock.speed');

		const buttons = run('$("ui-actions").children.slice()');
		let clicked = 0;
		for (const button of buttons) {
			if (button.disabled || !button.onclick) continue;
			button.onclick();
			clicked++;
			frame(2400 + clicked * 20);
		}
		result.buttonsClicked = clicked;
		result.surveyLabel = run('hudActionList()[1].label');
		result.surveyReady = run('hudActionList()[1].enabled');

		// Diffusion vs market pull diverge from tick 0; the coal stock heatmap converges between engines.
		const engines = result.engineGroup.children.map(item => item.children[0]);
		result.engineGroup.dispatch('pointerover', { target: engines[0] });
		result.engineClickOnly = engines[1].checked && !engines[0].checked;
		run('hudSetView(VIEW.DEMAND)');
		result.demandItemGroup.children[0].children[0].click();
		const beforeSwitch = run('[clock.seconds, party.x, party.y, mapeGoodsTotal(), mape.viewItem].join(":")');
		const engineSigs = new Set([pixelSignature(pixels)]);
		for (const radio of [engines[0], engines[2]]) {
			radio.click();
			engineSigs.add(pixelSignature(pixels));
		}
		result.engineViews = engineSigs.size;
		run('hudSetView(VIEW.AMOUNT)');
		result.queuesSelected = engines[2].checked && !engines[0].checked && !engines[1].checked;
		result.queueExplained = /short queue/.test(elements.get('ui-engine-note').textContent);
		result.switchKeptProgress = beforeSwitch === run('[clock.seconds, party.x, party.y, mapeGoodsTotal(), mape.viewItem].join(":")');
		result.workforceGroup.children[1].children[0].click();
		result.fluidSwitch = run('mape.workforceMode === MAPE_WORKFORCE_MODE.FLUID');
		result.fluidInspect = elements.get('ui-inspect').textContent.indexOf('fresh') >= 0;
		result.workforceGroup.children[0].children[0].click();
		result.residentsSwitch = run('mape.workforceMode === MAPE_WORKFORCE_MODE.RESIDENTS');

		const feedback = elements.get('ui-surplus');
		feedback.tagName = 'INPUT';
		let prevented = false;
		windowStub.listeners.keydown[0]({ key: ' ', target: feedback, preventDefault() { prevented = true; } });
		result.feedbackKeyboard = !prevented && run('clock.speed') === 0;
		feedback.checked = false;
		feedback.dispatch('change', { target: feedback });
		result.feedbackOff = run('!mape.surplusFeedback && mapeMarketPull(MAPE_RES.COAL, mape.settleCells[0]) === 1');
		feedback.checked = true;
		feedback.dispatch('change', { target: feedback });
		engines[1].click();
		result.switchBack = engines[1].checked && !engines[2].checked;

		run('party.alive = false; party.condition = 0; hudRefresh(true);');
		const lostButtons = run('$("ui-actions").children.slice()');
		const restart = lostButtons[lostButtons.length - 1];
		if (!restart || !restart.onclick) throw new Error('no restart button when lost');
		restart.onclick();
		result.restartState = run('party.alive + ":" + Math.round(clock.seconds)');
		Object.assign(result, checkSceneDom());
	} catch (error) {
		result.runtimeError = error.message + ' @ ' + (error.stack || '').split('\n')[1];
	}
}

function checkSceneDom() {
	elements.clear();
	elements.set('ui-canvas', makeElement('ui-canvas', true));
	elements.set('ui-demand-canvas', makeElement('ui-demand-canvas', true));
	rafQueue.length = 0;
	windowStub.listeners.keydown = [];
	context = loadDom('?scene=b');
	const sceneBoots = run('mapScene.id === "b" && mape.engine === MAPE_ENGINE.QUEUE && renderIsPaired()') &&
		elements.get('ui-survey-panel').hidden && !elements.get('ui-demand-map').hidden;
	run('actionsSetSpeed(0)');
	elements.get('ui-replay').children[1].click();
	const sceneFill = run('clock.speed === 0 && clock.seconds === 0 && mapeGoodsTotal() === 0 && mape.demandView[MAPE_RES.COAL].every(v => v === 0.5)');
	const step = elements.get('ui-time').children[4];
	step.click();
	const sceneStep = run('clock.seconds === 0.05 && mape.minedTotal > 0');
	const tools = elements.get('ui-tools').children[0].children;
	const demand = elements.get('ui-demand-canvas');
	result.factoryTool = tools.length;
	tools[4].children[0].click();
	demand.dispatch('click', { clientX: 64, clientY: 64 });
	result.factoryPlaced = run('mapeFactoryAt(5, 5) >= 0');
	tools[0].children[0].click();
	demand.dispatch('click', { clientX: 64, clientY: 64 });
	result.factorySelected = run('input.selX === 5 && input.selY === 5 && !$("ui-jobsite").hidden && /Factory F1/.test($("ui-jobsite").textContent)');
	tools[1].children[0].click();
	demand.dispatch('click', { clientX: 30, clientY: 30 });
	const sceneEdit = run('mape.mineCount === 4 && mapeMineAt(2, 2) >= 0 && render.markX === 2 && render.markY === 2');
	tools[3].children[0].click();
	elements.get('ui-canvas').dispatch('click', { clientX: 30, clientY: 30 });
	const sceneErase = run('mape.mineCount === 3 && mapeMineAt(2, 2) < 0 && clock.seconds === 0.05');
	const flow = elements.get('ui-flow');
	flow.checked = false;
	flow.dispatch('change', { target: flow });
	const sceneFlow = run('!render.showFlow');
	windowStub.listeners.keydown[0]({ key: ' ', preventDefault() {} });
	const sceneResume = run('clock.speed === CLOCK_DEFAULT_SPEED && clock.seconds === 0.05');
	return { sceneBoots, sceneFill, sceneStep, sceneEdit, sceneErase, sceneFlow, sceneResume,
		factoryToolCount: result.factoryTool, factoryPlaced: result.factoryPlaced, factorySelected: result.factorySelected };
}

let failures = 0;
function check(name, ok, detail) {
	if (!ok) failures++;
	console.log('check_' + name + '=' + (ok ? 'pass' : 'fail') + (detail === undefined ? '' : ' ' + detail));
}

console.log('boot_error=' + (result.bootError || 'none'));
if (result.bootError) {
	console.log('check_boot=fail');
	process.exit(1);
}
if (result.runtimeError) console.log('runtime_error=' + result.runtimeError);
console.log('frames=' + (result.frames || 0) + ' clock_sec=' + (result.clockSec || 0).toFixed(2));
console.log('lit_cells=' + result.litCells + ' distinct_views=' + result.distinctViews + ' distinct_items=' + result.distinctItems);
console.log('clock_initial=' + JSON.stringify(result.initialClock || '') + ' clock_after=' + JSON.stringify(result.clockText || ''));
console.log('buttons_time=' + result.timeButtons + ' buttons_actions=' + result.actionButtons);
console.log('starter_coal_trace=' + result.starterCoalTrace + ' listed=' + result.starterCoalListed + ' iron_deferred=' + result.ironDepositsDeferred + ' around_coordinates=' + result.aroundHasCoordinates + ' selection_preserved=' + result.aroundSelectionPreserved);
console.log('buttons_view=' + result.viewRadios + ' buttons_item=' + result.itemRadios + ' buttons_engine=' + result.engineRadios);
console.log('view_click=' + result.viewAfterClick + ' hover=' + result.viewAfterHover + ' coarse_checked=' + result.coarseHoverChecked + ' stray_ignored=' + result.strayHoverIgnored);
console.log('view_after_key=' + result.viewAfterKey + ' radio_follows_key=' + result.viewRadioChecked + ' speed_after_space=' + result.speedAfterSpace);
console.log('survey_label=' + JSON.stringify(result.surveyLabel || '') + ' ready=' + result.surveyReady);
console.log('restart_state=' + result.restartState);

check('boot_ok', !result.bootError);
check('no_runtime_error', !result.runtimeError);
check('frames_advance_at_4x', result.clockSec >= 7.8 && result.clockSec <= 8.1 && result.initialClock === 'day 1 · 0s · 4×' && /^day 8 · 7s/.test(result.clockText || ''));
check('canvas_painted', result.litCells > 3000);
check('time_controls', result.timeButtons === 4);
check('view_controls', result.viewRadios === 8 && result.distinctViews === 7);
check('item_controls', result.startsOnSupply && result.itemRadios === 14 && result.demandItemRadios === 9 && result.itemHiddenOnTerrain && result.itemShownOnDemand && result.distinctItems >= 5);
check('engine_controls', result.engineRadios === 4 && result.engineCatchmentChecked && result.engineSitesDisabled && result.engineClickOnly);
check('workforce_controls', result.workforceRadios === 2 && /Jobs/.test(result.workforceStats || ''));
check('workforce_switch', result.fluidSwitch && result.residentsSwitch);
check('engine_switch_and_redraw', result.engineViews === 3 && result.queuesSelected && result.queueExplained && result.switchBack);
check('engine_switch_keeps_progress', result.switchKeptProgress);
check('engine_feedback_toggle', result.feedbackOff && result.feedbackKeyboard);
check('starter_coal_trace_visible', result.starterCoalTrace && result.starterCoalListed && result.aroundHasCoordinates);
check('iron_deposits_deferred', result.ironDepositsDeferred);
check('around_selection_preserved', result.aroundSelectionPreserved && result.aroundRefreshesAfterSelection);
check('view_group_labelled', result.radiogroupRole === 'radiogroup' && result.radiogroupLabel.length > 0);
check('view_click_selects', result.viewAfterClick === 0);
check('view_hover_selects', result.viewAfterHover === 5 && result.hoverCheckedRadio === true);
check('view_hover_ignores_stray', result.strayHoverIgnored === true);
check('view_coarse_ignores_hover', result.coarseHoverChecked === false);
check('view_key_syncs_radio', result.viewAfterKey === 6 && result.viewRadioChecked === true);
check('inspector_tracks_hover', result.hoverMatchesCell && /coal d/.test(result.hoverInspect || ''));
check('settlement_panel', /^Settlement/.test(result.settleSiteText || ''));
check('survey_button_seconds', /^Survey in progress \(\d+s\)$/.test(result.surveyLabel || ''));
check('action_panel', result.actionButtons >= 5);
check('victory_panel', (result.victoryText || '').length > 5);
check('feed_rendered', result.logItems > 0);
check('click_moved_party', result.moved === true);
check('pause_key', result.speedAfterSpace === 0);
check('all_buttons_safe', (result.buttonsClicked || 0) >= 4);
check('new_survey_restarts', result.restartState === 'true:0');
check('test_scene_boot', result.sceneBoots);
check('test_scene_replay_and_step', result.sceneFill && result.sceneStep && result.sceneResume);
check('test_scene_paired_tools', result.sceneEdit && result.sceneErase && result.sceneFlow);
check('test_scene_factory_select', result.factoryPlaced === true && result.factorySelected === true && result.factoryToolCount === 9);

if (failures > 0) {
	console.log('dom_smoke_failures=' + failures);
	process.exit(1);
}
console.log('dom_smoke_failures=0');
