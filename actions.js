// owns: player verbs that span several features
// edit for: action gates, costs and rewards

const actions = {
	lastSpeed: 1
};

function actionsMoveTo(x, y) {
	if (!party.alive) return false;
	return partyMoveTo(x, y);
}

function actionsTogglePause() {
	actionsSetSpeed(clock.speed === 0 ? actions.lastSpeed : 0);
}

function actionsSetSpeed(speed) {
	if (clock.speed !== 0) actions.lastSpeed = clock.speed;
	clock.speed = speed;
	hudRefresh(true);
}

function actionsCycleInvestigation() {
	investigation.radius = investigation.radius === 1 ? 2 : 1;
	eventsStatus('Investigation area: ' + (investigation.radius === 1 ? '3×3' : '5×5') + '.');
	hudRefresh(true);
}

function actionsCamp() {
	if (!party.alive) return;
	partySetCamp(!party.camped);
	eventsStatus(party.camped ? 'Camped. Condition recovers with supplies.' : 'Camp broken.');
	hudRefresh(true);
}

function actionsHere() {
	return sitesAt(party.x, party.y);
}

function actionsToggleWork() {
	const i = actionsHere();
	if (i < 0 || sites.kind[i] !== SITE.DEPOSIT || sites.state[i] !== SITE_STATE.VISIBLE || !sitesWorkable(i)) {
		eventsStatus('No workable deposit here.');
		return;
	}
	party.working = !party.working;
	eventsStatus(party.working ? 'Working the ' + sitesName(i) + '.' : 'Stopped work.');
	hudRefresh(true);
}

function actionsGather() {
	if (sitesGather(actionsHere())) return;
	eventsStatus('Nothing to gather here.');
}

function actionsTakeItem() {
	if (sitesTakeItem(actionsHere())) return;
	eventsStatus('Nothing to recover here.');
}

function actionsTrain() {
	if (sitesTrain(actionsHere())) return;
	eventsStatus('No field school here.');
}

function actionsAttemptTask() {
	const result = sitesAttempt(actionsHere());
	if (result === 2) eventsStatus('This task needs local trust.');
	else if (result === 0) eventsStatus('The task is not settled.');
}

function actionsTown() {
	const i = actionsHere();
	if (i < 0 || sites.kind[i] !== SITE.TOWN) {
		eventsStatus('No market here.');
		return -1;
	}
	return sites.town[i];
}

function actionsSellAll() {
	const town = actionsTown();
	if (town < 0) return;
	let revenue = 0;
	for (let r = 0; r < RES_COUNT; r++) revenue += economySell(r, town);
	if (revenue < 0.01) {
		eventsStatus('The market will not take our goods at this price.');
		return;
	}
	partyAddFunds(revenue);
	eventsAdd('Sold goods for ' + revenue.toFixed(0) + ' funds.');
	hudRefresh(true);
}

function actionsSellItem() {
	const town = actionsTown();
	if (town < 0) return;
	if (party.items < 1) {
		eventsStatus('No relic to sell.');
		return;
	}
	const revenue = economyAcceptItem(town);
	if (revenue <= 0) {
		eventsStatus('The market cannot pay for a relic.');
		return;
	}
	partyAddItem(-1);
	partyAddFunds(revenue);
	eventsAdd('Sold a relic for ' + revenue + ' funds.');
	hudRefresh(true);
}

function actionsBuySupplies() {
	const town = actionsTown();
	if (town < 0) return;
	const units = 5;
	const cost = units * SUPPLY_PRICE;
	if (party.funds < cost) {
		eventsStatus('Supplies need ' + cost + ' funds.');
		return;
	}
	if (economyBuySupplies(town, units) < 0) {
		eventsStatus('The town has no food to sell.');
		return;
	}
	partyAddFunds(-cost);
	partyAddSupplies(units);
	eventsAdd('Bought ' + units + ' supplies for ' + cost + ' funds.');
	hudRefresh(true);
}

function actionsProvision() {
	const units = 5;
	if (economy.inventory[RES.FOOD] < units) {
		eventsStatus('Provisioning needs ' + units + ' food.');
		return;
	}
	economy.inventory[RES.FOOD] -= units;
	partyAddSupplies(units);
	eventsAdd('Provisioned ' + units + ' supplies from food.');
	hudRefresh(true);
}

function actionsProcess() {
	if (!economyProcess()) {
		eventsStatus('Field goods need 1 ore, 1 fuel and oxygen.');
		return;
	}
	partyAddMorale(1);
	eventsAdd('Processed 2 goods from ore and fuel.');
	hudRefresh(true);
}

function actionsRestore() {
	const idx = party.y * world.size + party.x;
	if (land.disturbed[idx] <= 0) {
		eventsStatus('This ground is already intact.');
		return;
	}
	if (party.funds < LAND_RESTORE_FUNDS) {
		eventsStatus('Restoration needs ' + LAND_RESTORE_FUNDS + ' funds.');
		return;
	}
	if (party.supplies < LAND_RESTORE_SUPPLIES) {
		eventsStatus('Restoration needs ' + LAND_RESTORE_SUPPLIES + ' supplies.');
		return;
	}
	partyAddFunds(-LAND_RESTORE_FUNDS);
	partyAddSupplies(-LAND_RESTORE_SUPPLIES);
	landRestore(idx);
	hudRefresh(true);
}

function actionsHire() {
	if (partyHire()) hudRefresh(true);
}

function actionsDismiss() {
	partyDismiss();
	hudRefresh(true);
}

function actionsDeclareVictory() {
	victoryDeclare();
	hudRefresh(true);
}

function actionsNewSurvey() {
	mainSetup((world.seed + 1) >>> 0);
	render.markX = -1;
	render.markY = -1;
	hudRefresh(true);
}
