// owns: headless smoke run of the whole prototype through one VM context
// run: node experiments/smoke.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g), match => match[1]);
const context = vm.createContext({ console: console });

for (const file of scripts) {
	const code = fs.readFileSync(path.join(root, file), 'utf8');
	vm.runInContext(code, context, { filename: file });
}

function run(code) {
	return vm.runInContext(code, context);
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
	const visibleBefore = countState(2);
	const markedBefore = countState(1);
	const hiddenBefore = countState(0);
	const deposit = findSite(4, 2);

	main.step(240);
	const progressHere = investigation.progress[party.y * world.size + party.x];
	const near = ((party.y + 2) * world.size) + (party.x + 2);
	const progressNear = investigation.progress[near];
	const farX = (party.x + 30) % world.size;
	const farY = (party.y + 30) % world.size;
	const progressFar = investigation.progress[farY * world.size + farX];
	const visibleAfterScout = countState(2);

	const depositStockStart = sites.stock[deposit];
	move(sites.x[deposit], sites.y[deposit]);
	party.working = true;
	const disturbedBefore = land.disturbed[sites.y[deposit] * world.size + sites.x[deposit]];
	main.step(180);
	const depositStockEnd = sites.stock[deposit];
	const disturbedAfter = land.disturbed[sites.y[deposit] * world.size + sites.x[deposit]];
	const inventory = economy.inventory[1];
	const massResidual = economy.massIn - economy.massOut;
	const miningResidual = economy.miningMass - economy.miningOre - economy.miningLeft;

	let markedSite = -1;
	let markedDistance = Infinity;
	for (let i = 0; i < SITE_CAP; i++) {
		if (sites.state[i] !== 1) continue;
		const dx = sites.x[i] - party.x;
		const dy = sites.y[i] - party.y;
		const d = dx * dx + dy * dy;
		if (d >= markedDistance) continue;
		markedDistance = d;
		markedSite = i;
	}
	move(sites.x[markedSite], sites.y[markedSite]);
	const markedKind = sites.kind[markedSite];
	const markedRes = sites.res[markedSite];
	main.step(360);
	const markedDiscovered = sites.state[markedSite] === 2 || sites.state[markedSite] === 3;

	const town = findSite(5, 2);
	move(sites.x[town], sites.y[town]);
	const fundsBefore = party.funds;
	const townStockBefore = economy.townStock[sites.town[town] * RES_COUNT + 1];
	actionsSellAll();
	const fundsAfter = party.funds;
	const townStockAfter = economy.townStock[sites.town[town] * RES_COUNT + 1];

	party.camped = true;
	main.step(1440);
	party.camped = false;

	const rivalClaims = countClaims(1) + countClaims(2);
	const disturbedCells = countDisturbed();
	const fails = victoryEvaluate();
	const failCount = victory.failCount;
	const declared = victoryDeclare();
	const shootOxygen = economy.oxygenProduced >= 0;
	const shareSum = territory.share[0] + territory.share[1] + territory.share[2];

	return {
		terrain: terrain,
		start: [startX, startY],
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
		markedKind: markedKind,
		markedRes: markedRes,
		massResidual: massResidual,
		miningResidual: miningResidual,
		fundsBefore: fundsBefore,
		fundsAfter: fundsAfter,
		townStockBefore: townStockBefore,
		townStockAfter: townStockAfter,
		rivalClaims: rivalClaims,
		disturbedCells: disturbedCells,
		victoryFails: fails,
		victoryDeclared: declared,
		victoryFailCount: failCount,
		oxygenProduced: economy.oxygenProduced,
		oxygenUsed: economy.oxygenUsed,
		sharePlayer: territory.share[0],
		shareSum: shareSum,
		partyAlive: party.alive,
		condition: party.condition,
		supplies: party.supplies,
		cleared: shootOxygen
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
console.log('start=' + result.start.join(','));
console.log('sites_visible_before=' + result.visibleBefore + ' sites_marked_before=' + result.markedBefore + ' sites_hidden_before=' + result.hiddenBefore);
console.log('sites_visible_after_scout=' + result.visibleAfterScout);
console.log('progress_here=' + result.progressHere.toFixed(3) + ' progress_near=' + result.progressNear.toFixed(3) + ' progress_far=' + result.progressFar.toFixed(3));
console.log('deposit_stock=' + result.depositStockStart.toFixed(1) + '->' + result.depositStockEnd.toFixed(1));
console.log('disturbed_cell=' + result.disturbedBefore.toFixed(3) + '->' + result.disturbedAfter.toFixed(3));
console.log('inventory_timber=' + result.inventoryTimber.toFixed(2));
console.log('marked_site_discovered=' + (result.markedDiscovered ? 1 : 0));
console.log('mass_residual=' + result.massResidual.toFixed(6) + ' mining_residual=' + result.miningResidual.toFixed(6));
console.log('town_sale_funds=' + result.fundsBefore.toFixed(1) + '->' + result.fundsAfter.toFixed(1));
console.log('town_stock_timber=' + result.townStockBefore.toFixed(1) + '->' + result.townStockAfter.toFixed(1));
console.log('rival_claims=' + result.rivalClaims + ' disturbed_cells=' + result.disturbedCells);
console.log('victory_fails=' + result.victoryFailCount + ' declared=' + (result.victoryDeclared ? 1 : 0));
console.log('oxygen_produced=' + result.oxygenProduced.toFixed(2) + ' used=' + result.oxygenUsed.toFixed(2));
console.log('share_player=' + result.sharePlayer.toFixed(4) + ' share_sum=' + result.shareSum.toFixed(4));
console.log('party_alive=' + (result.partyAlive ? 1 : 0) + ' condition=' + result.condition.toFixed(1) + ' supplies=' + result.supplies.toFixed(1));

check('terrain_all_present', result.terrain.every(value => value > 0));
check('investigation_local', result.progressHere > 0.2 && result.progressHere <= 1);
check('investigation_far_zero', result.progressFar === 0);
check('discovery_progresses', result.visibleAfterScout >= result.visibleBefore);
check('deposit_extracted', result.depositStockEnd < result.depositStockStart && result.inventoryTimber > 0.1);
check('disturbance_recorded', result.disturbedAfter > result.disturbedBefore);
check('marked_site_discovered', result.markedDiscovered);
check('mass_balanced', Math.abs(result.massResidual) < 1e-6 && Math.abs(result.miningResidual) < 1e-6);
check('sale_moved_money', result.fundsAfter > result.fundsBefore && result.townStockAfter > result.townStockBefore);
check('rivals_active', result.rivalClaims > 0 && result.disturbedCells > 0);
check('victory_rejected_early', result.victoryDeclared === false);
check('share_bounded', result.shareSum <= 1.0001 && result.sharePlayer >= 0);
check('party_survived', result.partyAlive);

if (failures > 0) {
	console.log('smoke_failures=' + failures);
	process.exit(1);
}
console.log('smoke_failures=0');
