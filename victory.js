// owns: victory conditions, declaration and feedback
// edit for: win thresholds, condition list

const VICTORY_MIN_SHARE = 0.05;
const VICTORY_MARGIN = 0;
const VICTORY_STOCK_FLOOR = 0.25;
// Population has to hold its own against the peak it reached; a town that shrank back to a
// hamlet is a settlement that lost its people, not a stable one.
const VICTORY_POP_DROP = 0.5;
const VICTORY_CHECK_COUNT = 6;
const VICTORY_CHECK_NAME = ['territory lead', 'resource base', 'disturbance under control', 'biosphere balance', 'population steady', 'industry under control'];

const victory = {
	result: -1,
	failCount: 0,
	fails: new Uint8Array(VICTORY_CHECK_COUNT)
};

function victoryReset() {
	victory.result = -1;
	victory.failCount = 0;
	victory.fails.fill(0);
}

function victoryAddFail(index) {
	victory.fails[index] = 1;
	victory.failCount++;
}

function victoryDisturbanceOpen() {
	const control = territory.control;
	const disturbed = land.disturbed;
	for (let i = 0; i < world.n; i++) {
		if (disturbed[i] < LAND_DISTURB_LIMIT) continue;
		if (control[i] === FACTION_PLAYER) continue;
		return true;
	}
	return false;
}

// An unmanaged plant is one the player never unlocked and never controls: rival-run industry
// digging past the disturbance floor is a territory that has lost its grip, not a mine it chose.
function victoryIndustryOpen() {
	const control = territory.control;
	const disturbed = land.disturbed;
	for (let f = 0; f < mape.factoryCount; f++) {
		const idx = mape.factoryY[f] * world.size + mape.factoryX[f];
		if (disturbed[idx] < LAND_DISTURB_LIMIT) continue;
		if (control[idx] === FACTION_PLAYER) continue;
		return true;
	}
	for (let m = 0; m < mape.mineCount; m++) {
		if (!mape.mineUnlocked[m]) continue;
		const idx = mape.mineY[m] * world.size + mape.mineX[m];
		if (disturbed[idx] < LAND_DISTURB_LIMIT) continue;
		if (control[idx] === FACTION_PLAYER) continue;
		return true;
	}
	return false;
}

function victoryEvaluate() {
	victory.fails.fill(0);
	victory.failCount = 0;
	const share = territory.share;
	const rivalBest = share[FACTION_A] > share[FACTION_B] ? share[FACTION_A] : share[FACTION_B];
	if (share[FACTION_PLAYER] <= rivalBest + VICTORY_MARGIN || share[FACTION_PLAYER] < VICTORY_MIN_SHARE) victoryAddFail(0);
	if (sites.initialStock <= 0 || sites.remainingStock / sites.initialStock < VICTORY_STOCK_FLOOR) victoryAddFail(1);
	if (victoryDisturbanceOpen()) victoryAddFail(2);
	if (economy.oxygenProduced < economy.oxygenUsed) victoryAddFail(3);
	if (mape.popPeak > 0 && mape.totalPop < mape.popPeak * (1 - VICTORY_POP_DROP)) victoryAddFail(4);
	if (victoryIndustryOpen()) victoryAddFail(5);
	return victory.failCount;
}

function victoryFailText() {
	let text = '';
	for (let i = 0; i < VICTORY_CHECK_COUNT; i++) {
		if (!victory.fails[i]) continue;
		text = text === '' ? VICTORY_CHECK_NAME[i] : text + ', ' + VICTORY_CHECK_NAME[i];
	}
	return text;
}

function victoryDeclare() {
	if (victory.result === 0) return true;
	if (!party.alive) {
		victory.result = 2;
		eventsStatus('The party did not survive the survey.');
		return false;
	}
	if (victoryEvaluate() > 0) {
		victory.result = 1;
		eventsAdd('Victory refused: ' + victoryFailText() + '.');
		return false;
	}
	victory.result = 0;
	eventsAdd('Victory declared: the fieldbook is complete.');
	return true;
}

if (typeof module !== 'undefined') module.exports = { victory, victoryEvaluate, victoryDeclare };
