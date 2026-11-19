// owns: headless smoke run of the whole survey in browser script order
// run: node experiments/smoke.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g), match => match[1]);

for (const file of scripts) {
	const code = fs.readFileSync(path.join(root, file), 'utf8');
	vm.runInThisContext(code, { filename: file });
}

function run(code) {
	return vm.runInThisContext(code);
}

const result = run(`
(function () {
	function findSite(kind, state) {
		for (let i = 0; i < SITE_CAP; i++) {
			if (sites.kind[i] === kind && sites.state[i] === state) return i;
		}
		return -1;
	}
	function countState(state) {
		let total = 0;
		for (let i = 0; i < SITE_CAP; i++) if (sites.state[i] === state) total++;
		return total;
	}
	function countClaims(faction) {
		let total = 0;
		for (let i = 0; i < SITE_CAP; i++) if (sites.claim[i] === faction + 1) total++;
		return total;
	}
	function countDisturbed() {
		let total = 0;
		for (let i = 0; i < world.n; i++) if (land.disturbed[i] > 0.01) total++;
		return total;
	}
	function move(x, y) {
		partyMoveTo(x, y);
		party.condition = 90;
		party.supplies = 45;
		party.funds += 40;
	}

	main.setup(20261117);
	const terrain = [0, 0, 0, 0, 0, 0];
	for (let i = 0; i < world.n; i++) terrain[world.terrain[i]]++;
	const startX = party.x;
	const startY = party.y;

	const settleCount = mape.settleCount;
	let settleWater = 0;
	let settlePopOut = 0;
	for (let k = 0; k < settleCount; k++) {
		const idx = mape.settleCells[k];
		if (world.terrain[idx] === TERRAIN.WATER) settleWater++;
		const p = mape.pop[idx];
		if (p < MAPE_POP_SEED_MIN || p > MAPE_POP_SEED_MAX) settlePopOut++;
	}
	const itemSpreads = [];
	for (let r = 0; r < MAPE_R; r++) {
		const d = mapeField(MAPE_FIELD.DEMAND, r);
		const g = mapeField(MAPE_FIELD.GOODS, r);
		let pos = 0;
		let neg = 0;
		let stock = 0;
		for (let i = 0; i < world.n; i++) {
			if (d[i] > 0.01) pos++;
			else if (d[i] < -0.01) neg++;
			if (g[i] > 0.01) stock++;
		}
		itemSpreads.push({ pos: pos, neg: neg, stock: stock });
	}
	const mineCount = mape.mineCount;
	let unlockedStart = 0;
	for (let m = 0; m < mineCount; m++) if (mape.mineUnlocked[m]) unlockedStart++;

	const visibleBefore = countState(SITE_STATE.VISIBLE);
	const markedBefore = countState(SITE_STATE.MARKED);
	const hiddenBefore = countState(SITE_STATE.HIDDEN);
	const deposit = findSite(SITE.DEPOSIT, SITE_STATE.VISIBLE);

	main.step(40);
	const progressHere = investigation.progress[party.y * world.size + party.x];
	const near = ((party.y + 2) * world.size) + (party.x + 2);
	const progressNear = investigation.progress[near];
	const farX = (party.x + 30) % world.size;
	const farY = (party.y + 30) % world.size;
	const progressFar = investigation.progress[farY * world.size + farX];
	const visibleAfterScout = countState(SITE_STATE.VISIBLE);

	const depositStockStart = sites.stock[deposit];
	move(sites.x[deposit], sites.y[deposit]);
	party.working = true;
	const disturbedBefore = land.disturbed[sites.y[deposit] * world.size + sites.x[deposit]];
	main.step(30);
	const depositStockEnd = sites.stock[deposit];
	const disturbedAfter = land.disturbed[sites.y[deposit] * world.size + sites.x[deposit]];
	const inventory = economy.inventory[RES.TIMBER];
	const massResidual = economy.massIn - economy.massOut;
	const miningResidual = economy.miningMass - economy.miningOre - economy.miningLeft;

	let markedSite = -1;
	let markedDistance = Infinity;
	for (let i = 0; i < SITE_CAP; i++) {
		if (sites.state[i] !== SITE_STATE.MARKED) continue;
		const dx = sites.x[i] - party.x;
		const dy = sites.y[i] - party.y;
		const d = dx * dx + dy * dy;
		if (d >= markedDistance) continue;
		markedDistance = d;
		markedSite = i;
	}
	move(sites.x[markedSite], sites.y[markedSite]);
	main.step(60);
	const markedDiscovered = sites.state[markedSite] === SITE_STATE.VISIBLE || sites.state[markedSite] === SITE_STATE.DONE;

	// Unlock a coal deposit by recording its cell to 100%; verify workers arrive, mine extracts and coal spreads.
	let coalMine = -1;
	let coalDistance = Infinity;
	for (let m = 0; m < mape.mineCount; m++) {
		if (mape.mineRes[m] !== MAPE_RES.COAL || sites.claim[mape.mineSite[m]] !== 0) continue;
		const dx = mape.mineX[m] - world.startX;
		const dy = mape.mineY[m] - world.startY;
		const distance = dx * dx + dy * dy;
		if (distance >= coalDistance) continue;
		coalDistance = distance;
		coalMine = m;
	}
	const mineSlot = mape.mineSite[coalMine];
	const mineIdx = mape.mineY[coalMine] * world.size + mape.mineX[coalMine];
	const nearForCoal = mapeNearestSettlement(mape.mineX[coalMine], mape.mineY[coalMine]);
	const nearCoalBefore = mape.goods[MAPE_RES.COAL * world.n + nearForCoal];
	sites.state[mineSlot] = SITE_STATE.VISIBLE;
	sites.claim[mineSlot] = 0;
	move(mape.mineX[coalMine], mape.mineY[coalMine]);
	main.step(60);
	const mineUnlockedAfter = mape.mineUnlocked[coalMine] === 1;
	const mineWorkersAfter = (typeof mapeWorkPresent === 'function' ? mapeWorkPresent(mineIdx) : mape.pop[mineIdx]);
	const minedAfter = mape.minedTotal;
	const exportedAfter = minedAfter - mape.goods[MAPE_RES.COAL * world.n + mineIdx];
	const nearCoalAfter = mape.goods[MAPE_RES.COAL * world.n + nearForCoal];
	const transportWorkAfter = mape.transportWork;

	// Trade ore, buy supplies and hire at the nearest settlement.
	economyAddResource(RES.ORE, 4);
	let settle = -1;
	let marketDistance = Infinity;
	for (let k = 0; k < mape.settleCount; k++) {
		const candidate = mape.settleCells[k];
		if (mape.goods[MAPE_RES.GOODS * world.n + candidate] < MAPE_SUPPLY_GOODS * 5) continue;
		const dx = candidate % world.size - party.x;
		const dy = ((candidate / world.size) | 0) - party.y;
		const distance = dx * dx + dy * dy;
		if (distance >= marketDistance) continue;
		marketDistance = distance;
		settle = candidate;
	}
	if (settle < 0) settle = mapeNearestSettlement(party.x, party.y);
	move(settle % world.size, (settle / world.size) | 0);
	const fundsBefore = party.funds;
	const moneyBefore = mape.money[settle];
	const ironBefore = mape.goods[MAPE_RES.IRON * world.n + settle];
	actionsSellAll();
	const fundsAfter = party.funds;
	const moneyAfter = mape.money[settle];
	const ironAfter = mape.goods[MAPE_RES.IRON * world.n + settle];
	const goodsBefore = mape.goods[MAPE_RES.GOODS * world.n + settle];
	actionsBuySupplies();
	const goodsAfter = mape.goods[MAPE_RES.GOODS * world.n + settle];
	const popBeforeHire = mape.pop[settle];
	const membersBefore = party.members.length;
	actionsHire();
	const popAfterHire = mape.pop[settle];
	const membersAfter = party.members.length;
	const mapeResidual = mapeLedgerResidual();
	const popResidual = mapePopResidual();

	party.camped = true;
	main.step(240);
	party.camped = false;

	const rivalClaims = countClaims(FACTION_A) + countClaims(FACTION_B);
	const disturbedCells = countDisturbed();
	victoryEvaluate();
	const failCount = victory.failCount;
	const declared = victoryDeclare();
	const shareSum = territory.share[0] + territory.share[1] + territory.share[2];

	return {
		terrain: terrain,
		start: [startX, startY],
		clockSec: clock.seconds,
		settleCount: settleCount,
		settlePct: settleCount / world.n * 100,
		settleWater: settleWater,
		settlePopOut: settlePopOut,
		totalPop: mape.totalPop,
		mineCount: mineCount,
		unlockedStart: unlockedStart,
		mineUnlockedAfter: mineUnlockedAfter,
		mineWorkersAfter: mineWorkersAfter,
		minedAfter: minedAfter,
		exportedAfter: exportedAfter,
		nearCoalBefore: nearCoalBefore,
		nearCoalAfter: nearCoalAfter,
		transportWorkAfter: transportWorkAfter,
		itemSpreads: itemSpreads,
		visibleBefore: visibleBefore,
		markedBefore: markedBefore,
		hiddenBefore: hiddenBefore,
		visibleAfterScout: visibleAfterScout,
		progressHere: progressHere,
		progressNear: progressNear,
		progressFar: progressFar,
		depositStockStart: depositStockStart,
		depositStockEnd: depositStockEnd,
		disturbedBefore: disturbedBefore,
		disturbedAfter: disturbedAfter,
		inventoryTimber: inventory,
		markedDiscovered: markedDiscovered,
		massResidual: massResidual,
		miningResidual: miningResidual,
		mapeResidual: mapeResidual,
		popResidual: popResidual,
		fundsBefore: fundsBefore,
		fundsAfter: fundsAfter,
		moneyBefore: moneyBefore,
		moneyAfter: moneyAfter,
		ironBefore: ironBefore,
		ironAfter: ironAfter,
		goodsBefore: goodsBefore,
		goodsAfter: goodsAfter,
		popBeforeHire: popBeforeHire,
		popAfterHire: popAfterHire,
		membersBefore: membersBefore,
		membersAfter: membersAfter,
		rivalClaims: rivalClaims,
		disturbedCells: disturbedCells,
		victoryDeclared: declared,
		victoryFailCount: failCount,
		oxygenProduced: economy.oxygenProduced,
		oxygenUsed: economy.oxygenUsed,
		sharePlayer: territory.share[0],
		shareSum: shareSum,
		partyAlive: party.alive,
		condition: party.condition,
		supplies: party.supplies
	};
})()
`);

let failures = 0;
function check(name, ok, detail) {
	if (!ok) failures++;
	console.log('check_' + name + '=' + (ok ? 'pass' : 'fail') + (detail ? ' ' + detail : ''));
}

const totalCells = result.terrain.reduce((sum, value) => sum + value, 0);
for (let t = 0; t < 6; t++) {
	const pct = result.terrain[t] / totalCells * 100;
	console.log('terrain_' + t + '=' + pct.toFixed(1) + 'pct');
}
console.log('start=' + result.start.join(',') + ' clock_sec=' + result.clockSec.toFixed(1));
console.log('settlements=' + result.settleCount + ' settle_pct=' + result.settlePct.toFixed(2) + ' total_pop=' + result.totalPop.toFixed(1));
console.log('mines=' + result.mineCount + ' unlocked_start=' + result.unlockedStart +
	' unlocked_after=' + (result.mineUnlockedAfter ? 1 : 0) +
	' mine_workers=' + result.mineWorkersAfter.toFixed(1) +
	' mined=' + result.minedAfter.toFixed(1) +
	' near_coal=' + result.nearCoalBefore.toFixed(1) + '->' + result.nearCoalAfter.toFixed(1) +
	' transport_work=' + result.transportWorkAfter.toFixed(1));
console.log('sites_visible_before=' + result.visibleBefore + ' sites_marked_before=' + result.markedBefore + ' sites_hidden_before=' + result.hiddenBefore);
console.log('sites_visible_after_scout=' + result.visibleAfterScout);
console.log('progress_here=' + result.progressHere.toFixed(3) + ' progress_near=' + result.progressNear.toFixed(3) + ' progress_far=' + result.progressFar.toFixed(3));
console.log('deposit_stock=' + result.depositStockStart.toFixed(1) + '->' + result.depositStockEnd.toFixed(1));
console.log('disturbed_cell=' + result.disturbedBefore.toFixed(3) + '->' + result.disturbedAfter.toFixed(3));
console.log('inventory_timber=' + result.inventoryTimber.toFixed(2));
console.log('marked_site_discovered=' + (result.markedDiscovered ? 1 : 0));
console.log('mass_residual=' + result.massResidual.toFixed(6) + ' mining_residual=' + result.miningResidual.toFixed(6) +
	' mape_residual=' + result.mapeResidual.toFixed(6) + ' pop_residual=' + result.popResidual.toFixed(6));
console.log('settle_sale_funds=' + result.fundsBefore.toFixed(1) + '->' + result.fundsAfter.toFixed(1) + ' iron=' + result.ironBefore.toFixed(1) + '->' + result.ironAfter.toFixed(1));
console.log('settle_supply_goods=' + result.goodsBefore.toFixed(1) + '->' + result.goodsAfter.toFixed(1) + ' hire_pop=' + result.popBeforeHire.toFixed(1) + '->' + result.popAfterHire.toFixed(1));
console.log('rival_claims=' + result.rivalClaims + ' disturbed_cells=' + result.disturbedCells);
console.log('victory_fails=' + result.victoryFailCount + ' declared=' + (result.victoryDeclared ? 1 : 0));
console.log('oxygen_produced=' + result.oxygenProduced.toFixed(2) + ' used=' + result.oxygenUsed.toFixed(2));
console.log('share_player=' + result.sharePlayer.toFixed(4) + ' share_sum=' + result.shareSum.toFixed(4));
console.log('party_alive=' + (result.partyAlive ? 1 : 0) + ' condition=' + result.condition.toFixed(1) + ' supplies=' + result.supplies.toFixed(1));

check('terrain_all_present', result.terrain.every(value => value > 0));
check('settlements_seeded', result.settlePct >= 1.8 && result.settlePct <= 2.2 && result.settleWater === 0 && result.settlePopOut === 0);
check('mape_fields_seeded',
	[0, 2, 3].every(r => result.itemSpreads[r].stock > 0 && (result.itemSpreads[r].pos > 0 || result.itemSpreads[r].neg > 0)) &&
	result.itemSpreads[1].stock === 0 && result.itemSpreads[1].pos === 0 && result.itemSpreads[1].neg === 0);
check('deposit_unlocks',
	result.mineCount >= 4 && result.unlockedStart === 0 && result.mineUnlockedAfter &&
	result.mineWorkersAfter >= 2 && result.minedAfter > 5 &&
	result.exportedAfter > 1 && result.transportWorkAfter > 1);
check('investigation_local', result.progressHere > 0.2 && result.progressHere <= 1);
check('investigation_far_zero', result.progressFar === 0);
check('discovery_progresses', result.visibleAfterScout >= result.visibleBefore);
check('deposit_extracted', result.depositStockEnd < result.depositStockStart && result.inventoryTimber > 0.1);
check('disturbance_recorded', result.disturbedAfter > result.disturbedBefore);
check('marked_site_discovered', result.markedDiscovered);
check('mass_balanced',
	Math.abs(result.massResidual) < 1e-6 && Math.abs(result.miningResidual) < 1e-6 &&
	Math.abs(result.mapeResidual) < 1e-4 && Math.abs(result.popResidual) < 1e-4);
check('settlement_market', result.fundsAfter > result.fundsBefore && result.moneyAfter < result.moneyBefore && result.ironAfter > result.ironBefore && result.goodsAfter < result.goodsBefore);
check('settlement_hire', result.membersAfter === result.membersBefore + 1 && Math.abs(result.popBeforeHire - result.popAfterHire - 1) < 1e-5);
check('rivals_active', result.rivalClaims > 0 && result.disturbedCells > 0);
check('victory_rejected_early', result.victoryDeclared === false);
check('share_bounded', result.shareSum <= 1.0001 && result.sharePlayer >= 0);
check('party_survived', result.partyAlive);

if (failures > 0) {
	console.log('smoke_failures=' + failures);
	process.exit(1);
}
console.log('smoke_failures=0');
