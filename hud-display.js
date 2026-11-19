// owns: map look radios, overlay checkboxes and paired-map layout
// edit for: display defaults, control applicability and map visibility

const HUD_DISPLAY_CONTROLS = [
	['ui-flow', 'showFlow', 'amount'],
	['ui-flow-motion', 'animateFlow', 'flow'],
	['ui-flow-arrows', 'flowArrows', 'flow'],
	['ui-contours', 'showContours', 'demand'],
	['ui-grid', 'showGrid', 'field'],
	['ui-smooth', 'smoothDemand', 'demand'],
	['ui-settlement-markers', 'showSettlements', 'actors'],
	['ui-source-markers', 'showSources', 'actors'],
	['ui-actor-labels', 'showLabels', 'labels'],
	['ui-survey-markers', 'showSurvey', 'survey']
];
const HUD_DISPLAY_NOTE = [
	'Cool stock, warm demand, moving traces.',
	'Blue-white stock, warm demand, crisp cells.',
	'Amber stock, purple demand, contours and arrows.'
];

const hudDisplay = { radios: [], controls: [], app: null, demand: null, note: null };

function hudDisplayInit() {
	hudDisplay.app = $('ui-app');
	hudDisplay.demand = $('ui-demand-map');
	hudDisplay.note = $('ui-display-note');
	$('ui-look').appendChild(hudMakeSeg('ui-map-look', 'field map look', RENDER_STYLE_NAME, render.fieldStyle, hudDisplay.radios, hudSetLook, false));
	for (let k = 0; k < HUD_DISPLAY_CONTROLS.length; k++) {
		const config = HUD_DISPLAY_CONTROLS[k];
		const control = $(config[0]);
		hudDisplay.controls.push(control);
		control.addEventListener('change', () => {
			render[config[1]] = control.checked;
			hudDisplaySync();
			hudSyncMapLegend();
			renderDraw();
		});
	}
	hudDisplaySync();
	hudSyncMapLegend();
}

function hudSetLook(style) {
	renderSetStyle(style);
	hudDisplaySync();
	hudSyncMapLegend();
	renderDraw();
}

function hudDisplayEnabled(scope) {
	const field = renderIsFieldView(render.view);
	const amount = renderHasAmount() && mape.viewItem < MAPE_RES.CO2;
	if (scope === 'amount') return amount;
	if (scope === 'flow') return amount && render.showFlow;
	if (scope === 'demand') return (render.view === VIEW.DEMAND || renderIsPaired()) && mape.viewItemDemand <= MAPE_RES.CO2;
	if (scope === 'field') return field;
	if (scope === 'labels') return field && (render.showSettlements || render.showSources);
	if (scope === 'survey') return !mapScene.id;
	return true;
}

function hudDisplaySync() {
	if (!hudDisplay.app) return;
	hudDisplay.app.className = (mapScene.id ? 'ui-scene-active' : '') + (renderIsPaired() ? ' ui-paired' : '');
	hudDisplay.demand.hidden = !renderIsPaired();
	hudDisplay.note.textContent = HUD_DISPLAY_NOTE[render.fieldStyle];
	for (let k = 0; k < hudDisplay.radios.length; k++) {
		hudDisplay.radios[k].checked = k === render.fieldStyle;
		hudDisplay.radios[k].disabled = !renderIsFieldView(render.view);
	}
	for (let k = 0; k < HUD_DISPLAY_CONTROLS.length; k++) {
		const config = HUD_DISPLAY_CONTROLS[k];
		const control = hudDisplay.controls[k];
		control.checked = render[config[1]];
		control.disabled = !hudDisplayEnabled(config[2]);
	}
	$('ui-canvas').setAttribute('aria-label', renderIsFieldView(render.view) ? (render.view === VIEW.DEMAND ? 'Demand · ' : 'Amount · ') + MAPE_VIEW_ITEM_NAME[renderViewItem(render.view)] : VIEW_NAME[render.view] + ' map');
	$('ui-demand-canvas').setAttribute('aria-label', 'Demand · ' + MAPE_VIEW_ITEM_NAME[mape.viewItemDemand]);
}
