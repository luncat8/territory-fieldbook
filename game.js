// owns: game lifecycle, simulation ordering, rival and victory checks
// edit for: ticks, commands and game-wide rules
'use strict';

function addEvent(game, text) {
	game.events.unshift(`${game.tick}: ${text}`);
	if (game.events.length > 12) game.events.pop();
}

function newGame(seed) {
	const number = Number(seed);
	const game = { seed: Number.isFinite(number) ? number | 0 : 1, randomState: (number | 0) || 1, tick: 0, running: false, won: false, events: [], territory: [0, 0], townOre: 0, townFunds: 1000 };
	game.world = makeWorld(game.seed);
	game.parties = [makeParty(0, 8, 8), makeParty(1, 55, 55)];
	game.economy = makeEconomy();
	game.sites = makeSites(game);
	addEvent(game, 'Select a cell and move there. Run time to investigate and record sites.');
	return game;
}

function rivalTick(game) {
	const rival = game.parties[1];
	if (rival.failed) return;
	let target = null, best = Infinity;
	for (const site of game.sites) {
		if (!site.present || site.owner !== -1 || site.type === 3) continue;
		const control = game.world.control[siteIndex(site)];
		if (control === 0) continue;
		const distance = Math.hypot(site.x + 0.5 - rival.x, site.y + 0.5 - rival.y);
		if (distance < best) { best = distance; target = site; }
	}
	if (target) {
		if (Math.floor(rival.x) !== target.x || Math.floor(rival.y) !== target.y) moveParty(rival, target.x, target.y);
		else if (recordSite(game, rival, target) && target.type === 4) target.mining = true;
	}
	const suppliesCost = supplyPrice(game, rival);
	if (rival.supplies < 10 && rival.funds >= suppliesCost) { rival.funds -= suppliesCost; game.townFunds += suppliesCost; rival.supplies += 15; }
	const price = orePrice(game);
	if (rival.ore >= 5 && game.townFunds >= price) { rival.ore -= 5; game.townOre += 5; rival.funds += price; game.townFunds -= price; }
}

function tickGame(game) {
	if (game.parties[0].failed) return;
	game.tick++;
	for (const site of game.sites) {
		if (site.present && site.expires && site.owner < 0 && game.tick >= site.expires) {
			site.present = false;
			if (site.discovered[0]) addEvent(game, `Opportunity at ${site.x}, ${site.y} expired.`);
		}
	}
	updateInfluence(game);
	for (const party of game.parties) {
		if (party.failed) continue;
		if (!party.rest) {
			investigate(game.world, party, partySkill(party, 2));
			party.members[0].skills[2] = Math.min(10, party.members[0].skills[2] + 0.002 * party.members[0].learning);
		}
		discoverSites(game, party);
	}
	rivalTick(game);
	updateInfluence(game, false);
	economyTick(game);
	for (const party of game.parties) {
		if (party.failed) continue;
		const funds = party.funds;
		partyUpkeep(party, game.economy.oxygen);
		game.townFunds += funds - party.funds;
		if (party.failed) addEvent(game, `${party.id ? 'Rival' : 'Your party'} failed: ${party.reason}.`);
	}
	const player = game.parties[0];
	let damage = 0;
	for (let i = 0; i < CELL_COUNT; i++) if (game.world.control[i] === 0) damage += game.world.disturbance[i];
	player.history.push({ energy: player.energy, mined: player.flows.mined, renewable: player.flows.renewable, damage });
	if (player.history.length > 31) player.history.shift();
	if (player.failed) game.running = false;
}

function victoryChecks(game) {
	const party = game.parties[0], history = party.history;
	let mined = 0, renewable = 0, damageIncreased = false;
	for (let i = 1; i < history.length; i++) { mined += history[i].mined; renewable += history[i].renewable; if (history[i].damage > history[i - 1].damage + 0.000001) damageIncreased = true; }
	const enough = history.length >= 31;
	const noMining = enough && mined < 0.000001;
	const energy = enough && game.economy.renewable[0] && history[history.length - 1].renewable > 0 && renewable > 0 && history[history.length - 1].energy >= history[0].energy - 0.000001;
	const activeMining = game.sites.some(site => site.owner === 0 && site.mining && site.stock > 0);
	const land = enough && !activeMining && !damageIncreased;
	return [
		{ label: 'Largest territory', ok: game.territory[0] > game.territory[1], detail: `${game.territory[0]} vs ${game.territory[1]} cells` },
		{ label: 'No finite extraction for 30 ticks', ok: noMining, detail: enough ? `${mined.toFixed(1)} extracted` : `${Math.max(0, history.length - 1)}/30 ticks` },
		{ label: 'Renewable energy and nonnegative balance', ok: energy, detail: enough ? `renewable ${renewable.toFixed(1)}, energy Δ ${(history[history.length - 1].energy - history[0].energy).toFixed(1)}` : 'Needs 30 ticks of history' },
		{ label: 'No unmanaged disturbance', ok: land, detail: enough ? (activeMining ? 'Extraction still active' : damageIncreased ? 'Disturbance increased during the window' : `land Δ ${(history[history.length - 1].damage - history[0].damage).toFixed(2)}`) : 'Needs 30 ticks of history' },
		{ label: 'Party surviving', ok: !party.failed && party.supplies > 0 && party.energy > 0 && game.economy.oxygen > 0, detail: party.failed ? party.reason : 'Requires supplies, oxygen and energy' }
	];
}

function declareVictory(game) {
	if (!victoryChecks(game).every(check => check.ok)) { addEvent(game, 'Declaration failed. See victory checks.'); return false; }
	game.won = true; game.running = false; addEvent(game, 'Victory declared! You can continue playing.');
	return true;
}

if (typeof module !== 'undefined') module.exports = { newGame, tickGame, victoryChecks, declareVictory };
