// owns: the side panel, view/item switches and under-map nearby list
// edit for: panel content, action buttons, formatting

const HUD_REFRESH_SECONDS = 0.2;
const HUD_LOG_LINES = 8;
const HUD_SPEED_LABEL = ['pause', '1×', '2×', '4×'];
const HUD_LOCK_TEXT = ['locked — record 100% and hold cell', 'unlocked', 'unlocked (contested)', 'exhausted'];

const hud = {
	clockEl: null,
	statsEl: null,
	skillsEl: null,
	membersEl: null,
	siteEl: null,
	nearbyEl: null,
	actionsEl: null,
	viewsEl: null,
	itemGroup: null,
	itemGroupDemand: null,
	timeEl: null,
	victoryEl: null,
	statusEl: null,
	logEl: null,
	timeButtons: [],
	viewRadios: [],
	itemRadios: [],
	demandItemRadios: [],
	acc: 0,
	key: '',
	logVersion: -1,
	statusVersion: -1
};

function hudInit() {
	hud.clockEl = $('ui-clock');
	hud.statsEl = $('ui-stats');
	hud.skillsEl = $('ui-skills');
	hud.membersEl = $('ui-members');
	hud.siteEl = $('ui-site');
	hud.nearbyEl = $('ui-nearby');
	hud.actionsEl = $('ui-actions');
	hud.viewsEl = $('ui-views');
	hud.timeEl = $('ui-time');
	hud.victoryEl = $('ui-victory');
	hud.statusEl = $('ui-status');
	hud.logEl = $('ui-log');
	hudBuildTime();
	hudBuildViews();
	hudEconomyInit();
	hudSceneInit();
	hudDisplayInit();
	hud.key = '';
	hud.logVersion = -1;
	hud.statusVersion = -1;
	hudRefresh(true);
}

function hudButton(label, enabled, run, cls) {
	const button = document.createElement('button');
	button.type = 'button';
	button.textContent = label;
	button.disabled = !enabled;
	if (cls) button.className = cls;
	if (run) button.onclick = run;
	return button;
}

function hudBuildTime() {
	const host = hud.timeEl;
	host.textContent = '';
	hud.timeButtons.length = 0;
	for (let k = 0; k < HUD_SPEED_LABEL.length; k++) {
		const speed = k;
		const button = hudButton(HUD_SPEED_LABEL[k], true, function () { actionsSetSpeed(speed); }, 'ui-chip');
		host.appendChild(button);
		hud.timeButtons.push(button);
	}
}

// Each segmented group has one writer (its change handler); hover and keys route through radio state.
function hudMakeSeg(name, ariaLabel, labels, selected, radios, onPick, preview, ids) {
	radios.length = 0;
	const group = document.createElement('div');
	group.className = 'ui-seg';
	group.setAttribute('role', 'radiogroup');
	group.setAttribute('aria-label', ariaLabel);
	for (let k = 0; k < labels.length; k++) {
		const id = ids ? ids[k] : k;
		const item = document.createElement('label');
		item.className = 'ui-seg-item';
		const radio = document.createElement('input');
		radio.type = 'radio';
		radio.name = name;
		radio.value = String(id);
		radio.checked = selected === id;
		const text = document.createElement('span');
		text.textContent = labels[k];
		item.appendChild(radio);
		item.appendChild(text);
		group.appendChild(item);
		radios.push(radio);
	}
	group.addEventListener('change', function (event) {
		const radio = event.target;
		if (!radio || radio.type !== 'radio') return;
		onPick(Number(radio.value));
	});
	if (preview) {
		group.addEventListener('pointerover', function (event) {
			hudSegPreview(group, event);
		});
	}
	return group;
}

// Touch and stylus keep click-only selection because they report no hovering fine pointer.
function hudSegPreview(group, event) {
	if (!hudViewFinePointer()) return;
	const item = event.target && event.target.closest ? event.target.closest('.ui-seg-item') : null;
	if (!item || !group.contains(item)) return;
	const radio = item.children[0];
	if (!radio || radio.checked || radio.disabled) return;
	radio.click();
}

function hudViewFinePointer() {
	if (typeof window === 'undefined' || !window.matchMedia) return false;
	return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function hudBuildViews() {
	const host = hud.viewsEl;
	host.textContent = '';
	const group = hudMakeSeg('ui-view', 'map view mode', VIEW_NAME, render.view, hud.viewRadios, hudSetView, true);
	if (mapScene.id) {
		for (let k = 0; k < VIEW_NAME.length; k++) group.children[k].hidden = !renderIsFieldView(k);
	}
	group.children[VIEW.PAIRED].title = 'Amount and demand side by side · key 0';
	host.appendChild(group);
	hud.itemGroup = hudMakeSeg('ui-item', 'amount item', MAPE_VIEW_AMOUNT_NAMES, mape.viewItem, hud.itemRadios, hudSetAmountItem, true, MAPE_VIEW_AMOUNT_IDS);
	hud.itemGroupDemand = hudMakeSeg('ui-item-demand', 'demand item', MAPE_VIEW_DEMAND_NAMES, mape.viewItemDemand, hud.demandItemRadios, hudSetDemandItem, true, MAPE_VIEW_DEMAND_IDS);
	hudSyncItemVisibility();
	host.appendChild(hud.itemGroup);
	host.appendChild(hud.itemGroupDemand);
}

function hudSyncItemVisibility() {
	if (!hud.itemGroup) return;
	const field = renderIsFieldView(render.view);
	const scene = !!mapScene.id;
	hud.itemGroup.hidden = !field || render.view === VIEW.DEMAND;
	hud.itemGroupDemand.hidden = scene || !field || render.view === VIEW.AMOUNT;
}

function hudSetView(view) {
	if (render.view === view || (mapScene.id && !renderIsFieldView(view))) return;
	render.view = view;
	for (let k = 0; k < hud.viewRadios.length; k++) hud.viewRadios[k].checked = view === k;
	hudSyncItemVisibility();
	hudSyncMapLegend();
	hudDisplaySync();
	hudRefresh(true);
	renderDraw();
}

function hudSyncItemRadios(radios, ids, value) {
	for (let k = 0; k < radios.length; k++) radios[k].checked = ids[k] === value;
}

function hudSetSideItem(radios, ids, key, item) {
	if (mape[key] === item) return;
	mape[key] = item;
	hudSyncItemRadios(radios, ids, item);
	hudSyncMapLegend();
	hudDisplaySync();
	hudRefresh(false);
	renderDraw();
}

function hudSetAmountItem(item) { hudSetSideItem(hud.itemRadios, MAPE_VIEW_AMOUNT_IDS, 'viewItem', item); }
function hudSetDemandItem(item) { hudSetSideItem(hud.demandItemRadios, MAPE_VIEW_DEMAND_IDS, 'viewItemDemand', item); }

function hudTick(dt) {
	hud.acc += dt;
	if (hud.acc < HUD_REFRESH_SECONDS) return;
	hud.acc = 0;
	hudRefresh(false);
}

function hudRefresh(force) {
	if (!hud.clockEl) return;
	hudUpdateClock();
	if (mapScene.id) {
		hudSceneUpdate();
		hudUpdateInspect();
		hudUpdateWorkforce();
		hudUpdateJobSite();
		hudUpdateStatus();
		hudUpdateLog(force);
		return;
	}
	hudUpdateStats();
	hudUpdateSkills();
	hudUpdateMembers();
	hudUpdateSite();
	hudUpdateInspect();
	hudUpdateWorkforce();
	hudUpdateJobSite();
	hudUpdateNearby();
	hudUpdateVictory();
	hudUpdateLog(force);
	hudUpdateStatus();
	hudUpdateActions(force);
}

function hudUpdateClock() {
	const sec = Math.floor(clock.seconds + 1e-8);
	const day = sec + 1;
	const speedText = clock.speed === 0 ? 'paused' : HUD_SPEED_LABEL[clock.speed];
	let text = mapScene.id ? clock.seconds.toFixed(2) + 's · ' + speedText : 'day ' + day + ' · ' + sec + 's · ' + speedText;
	if (!party.alive) text += ' · lost';
	hud.clockEl.textContent = text;
	for (let k = 0; k < hud.timeButtons.length; k++) hud.timeButtons[k].className = clock.speed === k ? 'ui-chip on' : 'ui-chip';
}

function hudUpdateStats() {
	const members = party.members.length;
	hud.statsEl.textContent =
		'Condition ' + Math.round(party.condition) +
		' · Morale ' + Math.round(party.morale) +
		' · Funds ' + Math.round(party.funds) +
		' · Supplies ' + Math.round(party.supplies) +
		' · Relics ' + party.items +
		' · ' + members + ' members\n' +
		'Wages ' + (PARTY_WAGE * members).toFixed(2) + '/d · Supplies ' + (PARTY_SUPPLY_USE * members).toFixed(2) + '/d';
}

function hudUpdateSkills() {
	let text = '';
	for (let d = 0; d < SKILL_COUNT; d++) {
		text += (text === '' ? '' : ' · ') + SKILL_NAME[d] + ' ' + party.skills[d].toFixed(1);
	}
	const unlocks = [];
	if (party.unlocks.route) unlocks.push('route charting');
	if (party.unlocks.assay) unlocks.push('field assay');
	if (party.unlocks.trust) unlocks.push('local trust');
	text += '\n' + (unlocks.length ? 'capabilities: ' + unlocks.join(', ') : 'capabilities: none yet');
	hud.skillsEl.textContent = text;
}

function hudUpdateMembers() {
	let text = '';
	for (let k = 0; k < party.members.length; k++) {
		const member = party.members[k];
		if (k > 0) text += '\n';
		text += member.name +
			' · learn ' + member.learning.toFixed(1) +
			' · body ' + member.physical.toFixed(1) +
			' · rest ' + member.recovery.toFixed(1) +
			' · growth ' + member.potential.toFixed(1);
	}
	hud.membersEl.textContent = text;
}

function hudSiteText(i) {
	if (!party.alive) return 'The party is lost.';
	const idx = party.y * world.size + party.x;
	const state = i >= 0 ? sites.state[i] : SITE_STATE.GONE;
	if (state === SITE_STATE.GONE || state === SITE_STATE.HIDDEN) {
		if (mapeIsSettlement(idx)) return hudSettlementText(idx);
		return 'Open ' + TERRAIN_NAME[world.terrain[idx]] + ' at ' + party.x + ',' + party.y + '. Nothing recorded here.';
	}
	const kind = sites.kind[i];
	if (state === SITE_STATE.MARKED) {
		const chance = sites.discover[i] * investigation.progress[idx];
		if (chance < 0.002) return 'Unidentified trace at ' + party.x + ',' + party.y + '. Investigate this cell.';
		return 'Unidentified trace. Identify chance ' + Math.round(chance * 100) + '%/s.';
	}
	if (state === SITE_STATE.DONE) return 'Spent: ' + sitesName(i) + '.';
	if (kind === SITE.DEPOSIT) {
		const mineRes = mapeResOf(sites.res[i]);
		const depositName = mineRes >= 0 ? MAPE_RES_NAME[mineRes] : RES_NAME[sites.res[i]];
		let text = 'Deposit: ' + depositName + '. ';
		if (party.unlocks.assay) text += 'Stock ' + sites.stock[i].toFixed(1) + ' of ' + SITE_DEPOSIT_STOCK[sites.res[i]] + '.';
		else text += 'Stock unassessed — field assay would read it.';
		text += hudClaimText(i);
		const lock = mapeDepositState(party.x, party.y);
		if (lock >= 0) text += ' Mine ' + hudMineText(lock, idx) + '.';
		return text;
	}
	if (kind === SITE.GATHER) return 'Cache: ' + sites.stock[i].toFixed(1) + ' ' + RES_NAME[sites.res[i]] + '.' + hudClaimText(i);
	if (kind === SITE.ITEM) return 'A relic, worth ' + ITEM_VALUE + ' funds at a settlement.' + hudClaimText(i);
	if (kind === SITE.SKILL) return 'Field school: trains ' + SKILL_NAME[sites.res[i]] + '.' + hudClaimText(i);
	let text = 'Local task, reward ' + sites.stock[i].toFixed(0) + ' funds. Checks ' + SKILL_NAME[sites.res[i]] + '.';
	if (sites.trust[i] && !party.unlocks.trust) text += ' Needs local trust.';
	return text + hudClaimText(i);
}

function hudMineText(lock, idx) {
	if (lock !== 1 && lock !== 2) return HUD_LOCK_TEXT[lock];
	return HUD_LOCK_TEXT[lock] + ' (' + mape.pop[idx].toFixed(1) + '/' + MAPE_MINE_WORKERS + ' workers)';
}

function hudClaimText(i) {
	const owner = sitesOwner(i);
	if (owner < 0) return '';
	if (owner === FACTION_PLAYER) return ' Ours.';
	return ' Held by ' + FACTION_NAME[owner] + '.';
}

function hudSettlementText(idx) {
	const pop = mape.pop[idx];
	const stock = mape.goods[MAPE_RES.GOODS * world.n + idx];
	let text = 'Settlement (pop ' + Math.round(pop) + '). Market funds ' + Math.round(mape.money[idx]) +
		' · goods ' + stock.toFixed(1) + ' · supplies ' + SUPPLY_PRICE + ' each.';
	for (let r = 0; r < RES_COUNT; r++) {
		if (economy.inventory[r] < 0.01) continue;
		text += '\n' + RES_NAME[r] + ' ' + economy.inventory[r].toFixed(1) + ' @ ' + mapePrice(r, idx).toFixed(1);
	}
	if (party.items > 0) text += '\nrelic @ ' + ITEM_VALUE;
	if (territory.share[FACTION_PLAYER] > 0) text += '\nOurs ' + Math.round(territory.share[FACTION_PLAYER] * 1000) / 10 + '% of the map.';
	return text;
}

function hudUpdateSite() {
	hud.siteEl.textContent = hudSiteText(sitesAt(party.x, party.y));
}

function hudNearbyState(state) {
	if (state === SITE_STATE.MARKED) return 'trace';
	if (state === SITE_STATE.VISIBLE) return 'open';
	if (state === SITE_STATE.DONE) return 'spent';
	return '';
}

function hudNearbyName(i) {
	if (sites.kind[i] === SITE.DEPOSIT) {
		const mineRes = mapeResOf(sites.res[i]);
		if (mineRes >= 0) return MAPE_RES_NAME[mineRes] + ' deposit';
	}
	return sitesName(i);
}

function hudSetNearbyText(text) {
	const host = hud.nearbyEl;
	if (host.textContent === text) return;
	if (typeof document !== 'undefined' && document.getSelection) {
		const selection = document.getSelection();
		if (selection && !selection.isCollapsed && (host.contains(selection.anchorNode) || host.contains(selection.focusNode))) return;
	}
	host.textContent = text;
}

function hudUpdateNearby() {
	if (!hud.nearbyEl) return;
	investigationCollectNearby();
	const size = world.size;
	const idx = party.y * size + party.x;
	const reach = investigationReach();
	let text = 'Recording here ' + Math.round(investigation.progress[idx] * 100) + '% · reach ' + reach.toFixed(1) + ' cells.';
	const near = mapeNearestSettlement(party.x, party.y);
	if (near >= 0) {
		const sx = near % size;
		const sy = (near / size) | 0;
		const dist = Math.sqrt((sx - party.x) * (sx - party.x) + (sy - party.y) * (sy - party.y));
		text += '\nNearest settlement ' + dist.toFixed(1) + ' cells at ' + sx + ',' + sy + ' (pop ' + Math.round(mape.pop[near]) + ').';
	}
	const count = investigation.nearbyCount;
	if (count === 0) {
		text += '\nNo recorded sites within ' + INV_NEARBY_RANGE + ' cells.';
		hudSetNearbyText(text);
		return;
	}
	for (let k = 0; k < count; k++) {
		const i = investigation.nearby[k];
		const dx = sites.x[i] - party.x;
		const dy = sites.y[i] - party.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		const cell = sites.y[i] * size + sites.x[i];
		const rec = Math.round(investigation.progress[cell] * 100);
		const label = sites.state[i] === SITE_STATE.MARKED ? 'unidentified' : hudNearbyName(i);
		text += '\n' + dist.toFixed(1) + '  ' + sites.x[i] + ',' + sites.y[i] + '  ' + label + '  ' + hudNearbyState(sites.state[i]) + '  rec ' + rec + '%';
	}
	hudSetNearbyText(text);
}

function hudVictoryText() {
	if (victory.result === 0) return 'Victory declared. The fieldbook stands.';
	if (victory.result === 2) return 'The party did not survive.';
	const fails = victoryEvaluate();
	if (!party.alive) return 'The party did not survive.';
	if (fails === 0) return 'All conditions are met — declare when ready.';
	return 'Not yet: ' + victoryFailText() + '.';
}

function hudUpdateVictory() {
	const share = territory.share;
	hud.victoryEl.textContent = hudVictoryText() +
		'\nTerritory ours ' + (share[FACTION_PLAYER] * 100).toFixed(1) +
		'% · ' + FACTION_NAME[FACTION_A] + ' ' + (share[FACTION_A] * 100).toFixed(1) +
		'% · ' + FACTION_NAME[FACTION_B] + ' ' + (share[FACTION_B] * 100).toFixed(1) + '%' +
		'\nOxygen ' + economy.oxygenProduced.toFixed(1) + ' / ' + economy.oxygenUsed.toFixed(1) +
		' · energy ' + economy.energySun.toFixed(0) + ' / ' + economy.energyFuel.toFixed(1);
}

function hudUpdateLog(force) {
	if (!force && hud.logVersion === events.version) return;
	hud.logVersion = events.version;
	const host = hud.logEl;
	host.textContent = '';
	const list = events.list;
	let shown = 0;
	for (let k = list.length - 1; k >= 0 && shown < HUD_LOG_LINES; k--) {
		const item = document.createElement('li');
		item.textContent = list[k].text;
		host.appendChild(item);
		shown++;
	}
}

function hudUpdateStatus() {
	if (hud.statusVersion === events.statusVersion) return;
	hud.statusVersion = events.statusVersion;
	hud.statusEl.textContent = events.status;
}

function hudActionKey() {
	const idx = party.y * world.size + party.x;
	const i = sitesAt(party.x, party.y);
	let key = party.x + ':' + party.y + ':' + (party.camped ? 1 : 0) + (party.working ? 1 : 0);
	key += ':' + investigationSurveyCooldown();
	key += ':' + Math.round(party.funds) + ':' + party.members.length + ':' + (party.unlocks.trust ? 1 : 0) + (party.alive ? 1 : 0);
	key += ':' + Math.round(party.supplies) + ':' + party.items + ':' + victory.result;
	key += ':' + Math.round(land.disturbed[idx] * 10) + ':' + (economyHasCargo() ? 1 : 0);
	key += ':' + Math.round(economy.inventory[RES.ORE]) + '.' + Math.round(economy.inventory[RES.FUEL]) + '.' + Math.round(economy.inventory[RES.FOOD]);
	if (mapeIsSettlement(idx)) {
		key += ':S' + Math.round(mape.pop[idx]) + '.' + Math.round(mape.money[idx] / 10) + '.' + Math.round(mape.goods[MAPE_RES.GOODS * world.n + idx]);
	}
	if (i < 0) return key;
	key += ':' + i + ':' + sites.state[i] + ':' + sites.kind[i] + ':' + Math.round(sites.stock[i] * 10) + ':' + sites.claim[i];
	return key;
}

function hudActionList() {
	const list = [];
	if (!party.alive) {
		list.push({ label: 'The party is lost', enabled: false, run: null });
		list.push({ label: 'New survey', enabled: true, run: actionsNewSurvey, primary: true });
		return list;
	}
	const idx = party.y * world.size + party.x;
	const i = actionsHere();
	const state = i >= 0 ? sites.state[i] : SITE_STATE.GONE;
	const kind = i >= 0 ? sites.kind[i] : -1;
	const ready = state === SITE_STATE.VISIBLE && sitesWorkable(i);
	list.push({ label: party.camped ? 'Break camp' : 'Make camp', enabled: true, run: actionsCamp, primary: true });
	const surveyLeft = investigationSurveyCooldown();
	list.push({ label: surveyLeft > 0 ? 'Survey in progress (' + surveyLeft + 's)' : 'Survey the ground', enabled: surveyLeft === 0, run: actionsSurvey });
	if (ready && kind === SITE.DEPOSIT && sites.res[i] !== RES.FUEL && sites.res[i] !== RES.ORE) {
		list.push({ label: party.working ? 'Stop working the deposit' : 'Work the deposit', enabled: true, run: actionsToggleWork, primary: true });
	}
	if (ready && kind === SITE.GATHER) list.push({ label: 'Gather ' + RES_NAME[sites.res[i]], enabled: true, run: actionsGather, primary: true });
	if (ready && kind === SITE.ITEM) list.push({ label: 'Take the relic', enabled: true, run: actionsTakeItem, primary: true });
	if (ready && kind === SITE.SKILL) list.push({ label: 'Train ' + SKILL_NAME[sites.res[i]], enabled: true, run: actionsTrain, primary: true });
	if (ready && kind === SITE.TASK) {
		const gated = sites.trust[i] === 1 && !party.unlocks.trust;
		list.push({ label: gated ? 'Task needs local trust' : 'Attempt the task', enabled: !gated, run: actionsAttemptTask, primary: true });
	}
	if (mapeIsSettlement(idx)) {
		list.push({ label: 'Sell all resources', enabled: economyHasCargo(), run: actionsSellAll, primary: true });
		list.push({ label: 'Sell a relic', enabled: party.items > 0, run: actionsSellItem });
		list.push({ label: 'Buy 5 supplies (' + SUPPLY_PRICE * 5 + ' funds)', enabled: party.funds >= SUPPLY_PRICE * 5 && mapeCanBuySupplies(idx, 5), run: actionsBuySupplies });
		list.push({ label: 'Hire member (' + partyHireCost() + ' funds)', enabled: party.funds >= partyHireCost() && mapeCanHire(idx), run: actionsHire });
	}
	list.push({ label: 'Provision 5 supplies from 5 food', enabled: economy.inventory[RES.FOOD] >= 5, run: actionsProvision });
	list.push({ label: 'Process field goods (1 ore + 1 fuel)', enabled: economyCanProcess(), run: actionsProcess });
	list.push({ label: 'Restore land here', enabled: land.disturbed[idx] > 0 && party.funds >= LAND_RESTORE_FUNDS, run: actionsRestore });
	list.push({ label: 'Dismiss member', enabled: party.members.length > 1, run: actionsDismiss });
	list.push({ label: victory.result === 0 ? 'Victory declared' : 'Declare victory', enabled: victory.result !== 0, run: actionsDeclareVictory, primary: true });
	return list;
}

function hudUpdateActions(force) {
	const key = hudActionKey();
	if (!force && key === hud.key) return;
	hud.key = key;
	const host = hud.actionsEl;
	host.textContent = '';
	const list = hudActionList();
	for (let k = 0; k < list.length; k++) {
		const item = list[k];
		host.appendChild(hudButton(item.label, item.enabled, item.run, item.primary ? 'ui-act primary' : 'ui-act'));
	}
}
