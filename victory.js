// owns: victory conditions, declaration and feedback
// edit for: win thresholds, condition list

const VICTORY_MIN_SHARE = 0.05;
const VICTORY_MARGIN = 0;
const VICTORY_STOCK_FLOOR = 0.25;
const VICTORY_CHECK_COUNT = 4;
const VICTORY_CHECK_NAME = ['territory lead', 'resource base', 'disturbance under control', 'biosphere balance'];

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

function victoryEvaluate() {
	victory.fails.fill(0);
	victory.failCount = 0;
	const share = territory.share;
	const rivalBest = share[FACTION_A] > share[FACTION_B] ? share[FACTION_A] : share[FACTION_B];
	if (share[FACTION_PLAYER] <= rivalBest + VICTORY_MARGIN || share[FACTION_PLAYER] < VICTORY_MIN_SHARE) victoryAddFail(0);
	if (sites.initialStock <= 0 || sites.remainingStock / sites.initialStock < VICTORY_STOCK_FLOOR) victoryAddFail(1);
	if (victoryDisturbanceOpen()) victoryAddFail(2);
	if (economy.oxygenProduced < economy.oxygenUsed) victoryAddFail(3);
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
