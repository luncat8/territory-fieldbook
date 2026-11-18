// owns: paired fields, display-only presets, overlay applicability and contour/flow regressions
// run: node experiments/map_views.js

const assert = require('node:assert/strict');
const vm = require('node:vm');
const { elements, makeElement, loadDom, rafQueue, windowStub } = require('./dom_fixture');

let context;
let checks = 0;
function run(code) {
	return vm.runInContext(code, context);
}

function boot(query = '', reducedMotion = false) {
	elements.clear();
	elements.set('ui-canvas', makeElement('ui-canvas', true));
	elements.set('ui-demand-canvas', makeElement('ui-demand-canvas', true));
	rafQueue.length = 0;
	windowStub.listeners = {};
	windowStub.finePointer = false;
	windowStub.reducedMotion = reducedMotion;
	context = loadDom(query);
}

function check(name, ok) {
	assert.ok(ok, name);
	checks++;
	console.log('check_' + name + '=pass');
}

function toggle(id, checked) {
	const control = elements.get(id);
	assert.ok(control && !control.disabled, id + ' must be applicable');
	control.checked = checked;
	control.dispatch('change', { target: control });
}

function simulationSnapshot() {
	return run('JSON.stringify([clock, random.seed, mape.engine, mape.goods, mape.demand, mape.marketSignal, mape.pop, mape.workforce, mape.massIn, mape.massOut, mape.minedTotal, party.x, party.y, mape.surplusFeedback, mape.localPressure])');
}

function displaySnapshot() {
	return run('JSON.stringify([render.view, render.fieldStyle, ...HUD_DISPLAY_CONTROLS.map(config => render[config[1]])])');
}

boot();
check('survey_single_default', run('render.view === VIEW.SUPPLY && mape.viewItem === MAPE_RES.GOODS && render.fieldStyle === RENDER_STYLE.FIELDBOOK && clock.speed === CLOCK_DEFAULT_SPEED') && elements.get('ui-demand-map').hidden);
check('both_maps_bound', elements.get('ui-demand-canvas').listeners.click.length === 1 && elements.get('ui-canvas').listeners.click.length === 1);
run('const drawViews = []; const drawField = renderEconomyCells; renderEconomyCells = view => { drawViews.push(view); drawField(view); };');
run('hud.viewRadios[VIEW.PAIRED].click()');
check('paired_radio_draws_both', run('renderIsPaired() && drawViews.join(":") === [VIEW.SUPPLY, VIEW.DEMAND].join(":")') && !elements.get('ui-demand-map').hidden && /ui-paired/.test(elements.get('ui-app').className));
run('hud.itemRadios[MAPE_RES.COAL].click()');
check('paired_item_legends', elements.get('ui-map-layer').textContent === 'Supply · coal' && elements.get('ui-demand-layer').textContent === 'Demand · coal');
run('hud.viewRadios[VIEW.DEMAND].click()');
check('demand_single_radio', !run('renderIsPaired()') && elements.get('ui-demand-map').hidden && elements.get('ui-map-layer').textContent === 'Demand · coal');
run('inputKey({key:"0"})');
check('paired_key_sync', run('renderIsPaired() && hud.viewRadios[VIEW.PAIRED].checked'));
run('hud.viewRadios[VIEW.TERRAIN].click()');
check('terrain_disables_field_controls', elements.get('ui-demand-map').hidden && elements.get('ui-grid').disabled && elements.get('ui-flow').disabled && elements.get('ui-actor-labels').disabled && run('hud.itemGroup.hidden && hudDisplay.radios.every(radio => radio.disabled)'));
run('inputKey({key:"0", target:{tagName:"INPUT"}})');
check('native_controls_keep_number_keys', run('render.view === VIEW.TERRAIN'));
run('hudSetView(VIEW.PAIRED)');
const beforeLooks = simulationSnapshot();
run('hudDisplay.radios[RENDER_STYLE.A].click()');
check('a_overlay_defaults', run('!render.showFlow && !render.showGrid && !render.showContours && !render.smoothDemand && !render.showLabels && !render.showSurvey && render.showSources && render.showSettlements'));
check('a_fixed_log_legend', elements.get('ui-map-range').textContent === '0 → 10/cell · log' && /look-1/.test(elements.get('ui-demand-scale').className));
run('hudSetItem(MAPE_RES.GOODS)');
assert.match(elements.get('ui-demand-key').textContent, /Workshop/);
run('hudSetItem(MAPE_RES.COAL)');
assert.doesNotMatch(elements.get('ui-demand-key').textContent, /Mine/);
run('hudDisplay.radios[RENDER_STYLE.B].click()');
check('b_overlay_defaults', run('render.showFlow && render.animateFlow && render.flowArrows && render.showContours && render.showGrid && render.smoothDemand && render.showLabels && !render.showSurvey'));
check('looks_preserve_simulation', beforeLooks === simulationSnapshot());
const beforeOverlays = simulationSnapshot();
for (const [id, prop] of run('HUD_DISPLAY_CONTROLS')) {
	const value = run('render.' + prop);
	toggle(id, !value);
	assert.equal(run('render.' + prop), !value);
	toggle(id, value);
}
check('every_overlay_independent', beforeOverlays === simulationSnapshot());
toggle('ui-flow', false);
check('flow_dependents_disabled', elements.get('ui-flow-motion').disabled && elements.get('ui-flow-arrows').disabled && run('render.animateFlow && render.flowArrows'));
toggle('ui-flow', true);
run('hudSetItem(MAPE_RES.CO2)');
check('atmosphere_has_no_goods_arrows', elements.get('ui-flow').disabled && elements.get('ui-flow-arrows').disabled && !elements.get('ui-contours').disabled && run('render.showFlow'));
run('hudSetItem(MAPE_RES.IRON)');
check('signed_item_legend', /±6/.test(elements.get('ui-demand-unit').textContent) && /signed/.test(elements.get('ui-demand-scale').className));
run('hudSetItem(MAPE_RES.COAL)');
toggle('ui-settlement-markers', false);
toggle('ui-source-markers', false);
check('hidden_actors_hide_labels', elements.get('ui-actor-labels').disabled && elements.get('ui-map-key').textContent === '');
toggle('ui-settlement-markers', true);
toggle('ui-source-markers', true);
const pressure = elements.get('ui-pressure');
check('survey_pressure_exposed', !pressure.disabled);
pressure.checked = true;
pressure.dispatch('change', { target: pressure });
run('hudSetEngine(MAPE_ENGINE.DIFFUSION)');
check('signed_engine_disables_ambient_pressure', pressure.disabled && pressure.checked && /signed/.test(elements.get('ui-demand-scale').className));
run('hudSetEngine(MAPE_ENGINE.CATCHMENT)');
check('market_engine_restores_pressure', !pressure.disabled && pressure.checked && run('mape.localPressure'));
const customDisplay = displaySnapshot();
run('hudSetEngine(MAPE_ENGINE.QUEUE)');
check('engine_keeps_display', customDisplay === displaySnapshot());

run('world.terrain[0] = TERRAIN.MEADOW; mape.viewItem = MAPE_RES.COAL; mape.goodsView[0][0] = 10; renderSetStyle(RENDER_STYLE.A); renderEconomyCells(VIEW.SUPPLY)');
check('a_stock_palette', run('Array.from(render.pixels.slice(0,4)).join()') === '241,245,250,255');
run('mape.demandView[0][0] = 1; renderEconomyCells(VIEW.DEMAND)');
check('a_demand_palette', run('Array.from(render.pixels.slice(0,4)).join()') === '255,230,51,255');
run('mape.goodsView[0][0] = 8; renderSetStyle(RENDER_STYLE.B); renderEconomyCells(VIEW.SUPPLY)');
check('b_stock_palette', run('Array.from(render.pixels.slice(0,4)).join()') === '255,241,198,255');
run('renderEconomyCells(VIEW.DEMAND)');
check('b_demand_palette', run('Array.from(render.pixels.slice(0,4)).join()') === '237,207,255,255');
run('mape.demandView[0][0] = -1; renderEconomyCells(VIEW.DEMAND)');
check('signed_surplus_stays_green', run('render.pixels[1] > render.pixels[0] && render.pixels[1] > render.pixels[2]'));
run('world.terrain[0] = TERRAIN.WATER; renderEconomyCells(VIEW.DEMAND)');
check('water_masks_land_fields', run('Array.from(render.pixels.slice(0,4)).join()') === '21,34,53,255');

run('render.ctx.trace = []; world.terrain.fill(TERRAIN.MEADOW); mape.demandView[0].fill(0.25); renderDemandContours(render.ctx)');
check('flat_contours_empty', run('render.ctx.trace.length === 0'));
run('for (let i = 0; i < world.n; i++) mape.demandView[0][i] = (i % world.size) / (world.size - 1); renderDemandContours(render.ctx)');
check('ramp_contours_finite', run('render.ctx.trace.length > 0'));
run('render.ctx.trace.length = 0; world.terrain.fill(TERRAIN.WATER); renderDemandContours(render.ctx)');
check('contours_skip_water', run('render.ctx.trace.length === 0'));
run('mape.viewItem = MAPE_RES.CO2; mape.demandView[MAPE_RES.CO2].set(mape.demandView[0]); renderDemandContours(render.ctx)');
check('atmosphere_contours_cross_water', run('render.ctx.trace.length > 0'));
run('mape.viewItem = MAPE_RES.COAL; world.terrain.fill(TERRAIN.MEADOW); mape.demandView[0].fill(1000000); mape.demandView[0][0] = -1000000; renderDemandContours(render.ctx)');
check('saturated_signed_contours_bounded', run('render.ctx.trace.length < 200000'));

run('mape.flowX.fill(0); mape.flowY.fill(0); mape.flowX[0] = 0.1; mape.flowDt = 0.05; render.showFlow = true; render.animateFlow = false; clock.seconds = 1; render.ctx.trace.length = 0; renderGoodsFlow(render.ctx)');
const staticTrace = run('render.ctx.trace.join()');
run('clock.seconds = 2; render.ctx.trace.length = 0; renderGoodsFlow(render.ctx)');
check('static_flow_ignores_time', staticTrace.length > 0 && staticTrace === run('render.ctx.trace.join()'));
const arrows = run('render.ctx.trace.length');
run('render.flowArrows = false; render.ctx.trace.length = 0; renderGoodsFlow(render.ctx)');
check('arrowheads_add_geometry', arrows > run('render.ctx.trace.length'));
run('render.animateFlow = true; render.ctx.trace.length = 0; renderGoodsFlow(render.ctx)');
const movingTrace = run('render.ctx.trace.join()');
run('clock.seconds += 0.3; render.ctx.trace.length = 0; renderGoodsFlow(render.ctx)');
check('animated_flow_follows_simulation_time', movingTrace !== run('render.ctx.trace.join()'));
const pausedTrace = run('render.ctx.trace.join()');
run('clock.speed = 0; render.ctx.trace.length = 0; renderGoodsFlow(render.ctx)');
check('paused_flow_freezes', pausedTrace === run('render.ctx.trace.join()'));
run('mape.flowX.fill(0); render.ctx.trace.length = 0; renderGoodsFlow(render.ctx)');
check('arrows_require_accepted_transfers', run('render.ctx.trace.length === 0'));

for (const scene of ['a', 'b']) {
	boot('?scene=' + scene);
	check('scene_' + scene + '_presentation', run('renderIsPaired() && mape.viewItem === MAPE_RES.COAL && hud.itemGroup.hidden && !$("ui-views").hidden && render.fieldStyle === ' + (scene === 'a' ? 'RENDER_STYLE.A' : 'RENDER_STYLE.B')));
	check('scene_' + scene + '_field_only_radios', run('hud.viewRadios.every((radio, k) => radio.parent.hidden === !renderIsFieldView(k))'));
	run('hud.viewRadios[VIEW.SUPPLY].click()');
	check('scene_' + scene + '_single_view', elements.get('ui-demand-map').hidden && run('render.view === VIEW.SUPPLY'));
	run('hud.viewRadios[VIEW.PAIRED].click(); actionsSetSpeed(0)');
	toggle('ui-grid', !run('render.showGrid'));
	const custom = displaySnapshot();
	run('actionsReplayScene(0.5)');
	check('scene_' + scene + '_replay_keeps_display', custom === displaySnapshot() && run('clock.speed === 0 && clock.seconds === 0'));
	toggle('ui-settlement-markers', false);
	toggle('ui-source-markers', false);
	run('for (let k = 0; k < 160; k++) mainStep(SIM_STEP_SEC)');
	check('scene_' + scene + '_hidden_actors_still_work', run('mape.minedTotal > 1 && mape.massOut > 0 && mape.settleCount > 0'));
}

boot('?scene=b', true);
check('reduced_motion_static_arrows', run('render.showFlow && render.flowArrows && !render.animateFlow') && !elements.get('ui-flow-motion').checked);
run('hudSetLook(RENDER_STYLE.A); hudSetLook(RENDER_STYLE.B)');
check('reduced_motion_survives_preset_change', run('!render.animateFlow'));
toggle('ui-flow-motion', true);
check('motion_can_be_explicitly_enabled', run('render.animateFlow'));
console.log('map_view_checks=' + checks + ' failures=0');
