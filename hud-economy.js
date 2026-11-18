// owns: the economy engine picker, stock-feedback control and cell inspector
// edit for: descriptions and field readouts

const HUD_ENGINE_NOTE = [
	'Stock pushes down demand at its cell; the signal spreads across land.',
	'Stock within four steps softens a settlement’s pull and can be used directly.',
	'Only stock at the settlement softens its pull. A short queue limits arrivals.'
];

const hudEconomy = {
	radios: [],
	noteEl: null,
	inspectEl: null
};

function hudEconomyInit() {
	hudEconomy.noteEl = $('ui-engine-note');
	hudEconomy.inspectEl = $('ui-inspect');
	hudBuildEngine();
	const surplus = $('ui-surplus');
	surplus.checked = mape.surplusFeedback;
	surplus.addEventListener('change', () => { mape.surplusFeedback = surplus.checked; });
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
}

function hudSigned(value) {
	return (value >= 0 ? '+' : '') + value.toFixed(2);
}

function hudUpdateInspect() {
	if (!hudEconomy.inspectEl) return;
	const x = input.hoverX >= 0 ? input.hoverX : party.x;
	const y = input.hoverX >= 0 ? input.hoverY : party.y;
	const n = world.n;
	const idx = y * world.size + x;
	const pct = (mape.settleCount / n * 100).toFixed(1);
	let text = 'Settlements ' + mape.settleCount + ' (' + pct + '%) · pop ' + Math.round(mape.totalPop) +
		' · ' + MAPE_ENGINE_NAME[mape.engine] +
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
	hudEconomy.inspectEl.textContent = text;
}
