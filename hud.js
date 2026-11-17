// owns: the side panel: clock, stats, skills, members, site, actions, feed
// edit for: panel content, action buttons, formatting

const HUD_REFRESH_SECONDS = 0.2;
const HUD_LOG_LINES = 8;
const HUD_SPEED_LABEL = ['pause', '1×', '2×', '4×'];

const hud = {
	clockEl: null,
	statsEl: null,
	skillsEl: null,
	membersEl: null,
	siteEl: null,
	actionsEl: null,
	viewsEl: null,
	timeEl: null,
	victoryEl: null,
	statusEl: null,
	logEl: null,
	timeButtons: [],
	viewButtons: [],
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
	hud.actionsEl = $('ui-actions');
	hud.viewsEl = $('ui-views');
	hud.timeEl = $('ui-time');
	hud.victoryEl = $('ui-victory');
	hud.statusEl = $('ui-status');
	hud.logEl = $('ui-log');
	hudBuildTime();
	hudBuildViews();
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

function hudBuildViews() {
	const host = hud.viewsEl;
	host.textContent = '';
	hud.viewButtons.length = 0;
	for (let k = 0; k < VIEW_NAME.length; k++) {
		const view = k;
		const button = hudButton(VIEW_NAME[k], true, function () { render.view = view; hudRefresh(true); }, 'ui-chip');
		host.appendChild(button);
		hud.viewButtons.push(button);
	}
}

function hudTick(dt) {
	hud.acc += dt;
	if (hud.acc < HUD_REFRESH_SECONDS) return;
	hud.acc = 0;
	hudRefresh(false);
}

function hudPad(value) {
	return value < 10 ? '0' + value : '' + value;
}

function hudRefresh(force) {
	if (!hud.clockEl) return;
	hudUpdateClock();
	hudUpdateStats();
	hudUpdateSkills();
	hudUpdateMembers();
	hudUpdateSite();
	hudUpdateVictory();
	hudUpdateLog(force);
	hudUpdateStatus();
	hudUpdateActions(force);
}

function hudUpdateClock() {
	const total = Math.floor(clock.hours * 60);
	const day = Math.floor(total / 1440) + 1;
	const hour = Math.floor((total % 1440) / 60);
	const minute = total % 60;
	const speedText = clock.speed === 0 ? 'paused' : HUD_SPEED_LABEL[clock.speed];
	let text = 'day ' + day + ' · ' + hudPad(hour) + ':' + hudPad(minute) + ' · ' + speedText;
	if (!party.alive) text += ' · lost';
	hud.clockEl.textContent = text;
	for (let k = 0; k < hud.timeButtons.length; k++) hud.timeButtons[k].className = clock.speed === k ? 'ui-chip on' : 'ui-chip';
	for (let k = 0; k < hud.viewButtons.length; k++) hud.viewButtons[k].className = render.view === k ? 'ui-chip on' : 'ui-chip';
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
		'Wages ' + (PARTY_WAGE * members * 24).toFixed(0) + '/day · Supplies ' + (PARTY_SUPPLY_USE * members * 24).toFixed(0) + '/day';
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
	if (i < 0) return 'Open ' + TERRAIN_NAME[world.terrain[idx]] + ' at ' + party.x + ',' + party.y + '. Nothing recorded here.';
	const kind = sites.kind[i];
	const state = sites.state[i];
	if (state === SITE_STATE.MARKED) {
		const chance = sites.discover[i] * investigation.progress[idx];
		if (chance < 0.02) return 'Unidentified trace at ' + party.x + ',' + party.y + '. Investigate this cell.';
		return 'Unidentified trace. Identify chance ' + Math.round(chance * 100) + '% per hour.';
	}
	if (state === SITE_STATE.DONE) return 'Spent: ' + sitesName(i) + '.';
	if (state === SITE_STATE.GONE) return 'Open ' + TERRAIN_NAME[world.terrain[idx]] + '.';
	if (kind === SITE.TOWN) return hudTownText(i);
	if (kind === SITE.DEPOSIT) {
		let text = 'Deposit: ' + RES_NAME[sites.res[i]] + '. ';
		if (party.unlocks.assay) text += 'Stock ' + sites.stock[i].toFixed(1) + ' of ' + SITE_DEPOSIT_STOCK[sites.res[i]] + '.';
		else text += 'Stock unassessed — field assay would read it.';
		return text + hudClaimText(i);
	}
	if (kind === SITE.GATHER) return 'Cache: ' + sites.stock[i].toFixed(1) + ' ' + RES_NAME[sites.res[i]] + '.' + hudClaimText(i);
	if (kind === SITE.ITEM) return 'A relic, worth ' + ITEM_VALUE + ' funds at a town.' + hudClaimText(i);
	if (kind === SITE.SKILL) return 'Field school: trains ' + SKILL_NAME[sites.res[i]] + '.' + hudClaimText(i);
	let text = 'Local task, reward ' + sites.stock[i].toFixed(0) + ' funds. Checks ' + SKILL_NAME[sites.res[i]] + '.';
	if (sites.trust[i] && !party.unlocks.trust) text += ' Needs local trust.';
	return text + hudClaimText(i);
}

function hudClaimText(i) {
	const owner = sitesOwner(i);
	if (owner < 0) return '';
	if (owner === FACTION_PLAYER) return ' Ours.';
	return ' Held by ' + FACTION_NAME[owner] + '.';
}

function hudTownText(i) {
	const town = sites.town[i];
	let text = 'Town. Market funds ' + Math.round(economy.townMoney[town]) + ' · supplies ' + SUPPLY_PRICE + ' each.';
	for (let r = 0; r < RES_COUNT; r++) {
		if (economy.inventory[r] < 0.01) continue;
		text += '\n' + RES_NAME[r] + ' ' + economy.inventory[r].toFixed(1) + ' @ ' + economyPrice(r, town).toFixed(1);
	}
	if (party.items > 0) text += '\nrelic @ ' + ITEM_VALUE;
	if (territory.share[FACTION_PLAYER] > 0) text += '\nOurs ' + Math.round(territory.share[FACTION_PLAYER] * 1000) / 10 + '% of the map.';
	return text;
}

function hudUpdateSite() {
	hud.siteEl.textContent = hudSiteText(sitesAt(party.x, party.y));
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
	const i = sitesAt(party.x, party.y);
	let key = party.x + ':' + party.y + ':' + (party.camped ? 1 : 0) + (party.working ? 1 : 0) + ':' + investigation.radius;
	key += ':' + Math.round(party.funds) + ':' + party.members.length + ':' + (party.unlocks.trust ? 1 : 0) + (party.alive ? 1 : 0);
	key += ':' + Math.round(party.supplies) + ':' + party.items;
	key += ':' + Math.round(land.disturbed[party.y * world.size + party.x] * 10);
	key += ':' + Math.round(economy.inventory[RES.ORE]) + '.' + Math.round(economy.inventory[RES.FUEL]) + '.' + Math.round(economy.inventory[RES.FOOD]);
	if (i < 0) return key;
	key += ':' + i + ':' + sites.state[i] + ':' + sites.kind[i] + ':' + Math.round(sites.stock[i] * 10) + ':' + sites.claim[i];
	if (sites.kind[i] === SITE.TOWN) key += ':' + Math.round(economy.townMoney[sites.town[i]] / 10);
	return key;
}

function hudActionList() {
	const list = [];
	if (!party.alive) {
		list.push({ label: 'The party is lost', enabled: false, run: null });
		list.push({ label: 'New survey', enabled: true, run: actionsNewSurvey, primary: true });
		return list;
	}
	const i = actionsHere();
	const state = i >= 0 ? sites.state[i] : SITE_STATE.GONE;
	const kind = i >= 0 ? sites.kind[i] : -1;
	const ready = state === SITE_STATE.VISIBLE && sitesWorkable(i);
	list.push({ label: party.camped ? 'Break camp' : 'Make camp', enabled: true, run: actionsCamp, primary: true });
	list.push({ label: 'Investigation area ' + (investigation.radius === 1 ? '3×3' : '5×5'), enabled: true, run: actionsCycleInvestigation });
	if (ready && kind === SITE.DEPOSIT) list.push({ label: party.working ? 'Stop working the deposit' : 'Work the deposit', enabled: true, run: actionsToggleWork, primary: true });
	if (ready && kind === SITE.GATHER) list.push({ label: 'Gather ' + RES_NAME[sites.res[i]], enabled: true, run: actionsGather, primary: true });
	if (ready && kind === SITE.ITEM) list.push({ label: 'Take the relic', enabled: true, run: actionsTakeItem, primary: true });
	if (ready && kind === SITE.SKILL) list.push({ label: 'Train ' + SKILL_NAME[sites.res[i]], enabled: true, run: actionsTrain, primary: true });
	if (ready && kind === SITE.TASK) {
		const gated = sites.trust[i] === 1 && !party.unlocks.trust;
		list.push({ label: gated ? 'Task needs local trust' : 'Attempt the task', enabled: !gated, run: actionsAttemptTask, primary: true });
	}
	if (kind === SITE.TOWN) {
		list.push({ label: 'Sell all resources', enabled: true, run: actionsSellAll, primary: true });
		list.push({ label: 'Sell a relic', enabled: party.items > 0, run: actionsSellItem });
		list.push({ label: 'Buy 5 supplies (' + SUPPLY_PRICE * 5 + ' funds)', enabled: party.funds >= SUPPLY_PRICE * 5, run: actionsBuySupplies });
	}
	list.push({ label: 'Provision 5 supplies from 5 food', enabled: economy.inventory[RES.FOOD] >= 5, run: actionsProvision });
	list.push({ label: 'Process field goods (1 ore + 1 fuel)', enabled: economyCanProcess(), run: actionsProcess });
	const idx = party.y * world.size + party.x;
	list.push({ label: 'Restore land here', enabled: land.disturbed[idx] > 0 && party.funds >= LAND_RESTORE_FUNDS, run: actionsRestore });
	list.push({ label: 'Hire member (' + partyHireCost() + ' funds)', enabled: party.funds >= partyHireCost(), run: actionsHire });
	list.push({ label: 'Dismiss member', enabled: party.members.length > 1, run: actionsDismiss });
	list.push({ label: 'Declare victory', enabled: true, run: actionsDeclareVictory, primary: true });
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
