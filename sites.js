// owns: site generation, discovery, recording and influence
// edit for: site lifecycle, ownership and territory competition
'use strict';

const SITE_TYPES = ['Cache', 'Item', 'Experience', 'Task', 'Deposit'];

function randomNext(game) {
	let value = game.randomState;
	value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
	game.randomState = value >>> 0;
	return game.randomState / 4294967296;
}

function makeSites(game) {
	const sites = [];
	const positions = [[8, 8], [11, 8], [8, 11], [12, 12], [15, 9], [55, 55], [52, 55], [55, 52], [51, 51], [48, 54]];
	for (let i = 0; i < positions.length; i++) {
		const type = i % 5;
		sites.push({ id: i, x: positions[i][0], y: positions[i][1], type, visibility: i % 3, present: i !== 7 || randomNext(game) < 0.8, expires: i === 7 ? 220 : 0, discovered: [i % 3 === 0, i % 3 === 0], owner: -1, collected: false, mining: false, stock: type === 4 ? 40 : 0 });
	}
	return sites;
}

function siteIndex(site) { return site.y * WORLD_SIZE + site.x; }

function discoverSites(game, party) {
	for (const site of game.sites) {
		if (!site.present || site.discovered[party.id]) continue;
		const progress = party.search[siteIndex(site)];
		const distance = Math.hypot(site.x + 0.5 - party.x, site.y + 0.5 - party.y);
		const chart = capability(party, 'chart') && distance < observationRadius(game.world.terrain[Math.floor(party.y) * WORLD_SIZE + Math.floor(party.x)]) + 1;
		if (progress <= 0 && !chart) continue;
		if (randomNext(game) >= Math.min(0.35, 0.006 + progress * 0.002 + partySkill(party, 2) * 0.001)) continue;
		site.discovered[party.id] = true;
		if (party.id === 0) addEvent(game, `${SITE_TYPES[site.type]} discovered at ${site.x}, ${site.y}.`);
	}
}

function recordSite(game, party, site) {
	if (!site || !site.present || !site.discovered[party.id] || site.owner !== -1) return false;
	const index = siteIndex(site);
	if (Math.floor(party.x) !== site.x || Math.floor(party.y) !== site.y || party.search[index] < 100) return false;
	if (game.world.control[index] !== -1 && game.world.control[index] !== party.id) return false;
	if (site.type === 3 && !capability(party, 'trust')) return false;
	site.owner = party.id;
	if (!site.collected && site.type === 0) { party.supplies += 15; site.collected = true; }
	if (!site.collected && site.type === 1) { party.items++; site.collected = true; }
	if (!site.collected && site.type === 2) { party.members[0].skills[2] += party.members[0].learning; site.collected = true; }
	if (!site.collected && site.type === 3) { const reward = Math.min(20, game.townFunds); game.townFunds -= reward; party.funds += reward; site.collected = true; }
	party.morale = Math.min(100, party.morale + 3);
	addEvent(game, `${party.id ? 'Rival' : 'You'} recorded ${SITE_TYPES[site.type]} at ${site.x}, ${site.y}.`);
	return true;
}

function updateInfluence(game, decay = true) {
	const world = game.world;
	if (decay) for (let i = 0; i < CELL_COUNT; i++) {
		world.influence[0][i] *= 0.98;
		world.influence[1][i] *= 0.98;
	}
	for (const site of game.sites) {
		if (site.owner < 0 || !site.present) continue;
		const influence = world.influence[site.owner];
		for (let y = Math.max(0, site.y - 7); y <= Math.min(63, site.y + 7); y++) for (let x = Math.max(0, site.x - 7); x <= Math.min(63, site.x + 7); x++) {
			const d = Math.hypot(x - site.x, y - site.y);
			const value = Math.max(0, 1 - d / 7);
			const index = y * WORLD_SIZE + x;
			influence[index] = Math.max(influence[index], value * value * (3 - 2 * value));
		}
	}
	game.territory[0] = 0; game.territory[1] = 0;
	for (let i = 0; i < CELL_COUNT; i++) {
		const a = world.influence[0][i], b = world.influence[1][i];
		const owner = Math.max(a, b) < 0.02 || Math.abs(a - b) < 0.00001 ? -1 : a > b ? 0 : 1;
		world.control[i] = owner;
		if (owner >= 0) game.territory[owner]++;
	}
}

if (typeof module !== 'undefined') module.exports = { SITE_TYPES, makeSites, discoverSites, recordSite, updateInfluence };
