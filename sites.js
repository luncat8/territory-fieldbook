// owns: the site pool, discovery, claims, extraction and site payouts
// edit for: site kinds, placement counts, discovery and payout rules

const SITE_CAP = 96;
const SITE = { GATHER: 0, ITEM: 1, SKILL: 2, TASK: 3, DEPOSIT: 4 };
const SITE_STATE = { HIDDEN: 0, MARKED: 1, VISIBLE: 2, DONE: 3, GONE: 4 };
const SITE_DEPOSIT_STOCK = [50, 55, 1400, 25, 1400, 0];
const SITE_REVEAL_PROGRESS = 0.2;
const SITE_SOURCE_STRENGTH = 0.8;
const SITE_SOURCE_RADIUS = 3.5;
const SITE_SOURCE_DECAY = 0.0004;
const SITE_TIMED_CHANCE = 0.035;
const SITE_TIMED_KINDS = [SITE.GATHER, SITE.ITEM, SITE.TASK];
const SITE_MAX_TRUST = 0.4;

const sites = {
	x: new Uint8Array(SITE_CAP),
	y: new Uint8Array(SITE_CAP),
	kind: new Uint8Array(SITE_CAP),
	state: new Uint8Array(SITE_CAP),
	res: new Uint8Array(SITE_CAP),
	stock: new Float64Array(SITE_CAP),
	claim: new Uint8Array(SITE_CAP),
	life: new Float32Array(SITE_CAP),
	discover: new Float32Array(SITE_CAP),
	trust: new Uint8Array(SITE_CAP),
	version: 0,
	initialStock: 0,
	remainingStock: 0
};

function sitesReset() {
	sites.state.fill(SITE_STATE.GONE);
	sites.claim.fill(0);
	sites.life.fill(0);
	sites.stock.fill(0);
	sites.discover.fill(0);
	sites.trust.fill(0);
	sites.version++;
	sites.initialStock = 0;
	sites.remainingStock = 0;
}

function sitesPopulate() {
	sitesReset();
	randomSeed(world.seed ^ 0x51ed270b);
	sitesPlaceStarter();
	sitesPlaceDeposits();
	sitesPlaceOneShots();
}

function sitesFreeSlot() {
	for (let i = 0; i < SITE_CAP; i++) if (sites.state[i] === SITE_STATE.GONE) return i;
	return -1;
}

function sitesPlace(kind, idx, res, stock, state, life, discover) {
	const slot = sitesFreeSlot();
	if (slot < 0 || idx < 0) return -1;
	sites.x[slot] = idx % MAP_SIZE;
	sites.y[slot] = (idx / MAP_SIZE) | 0;
	sites.kind[slot] = kind;
	sites.state[slot] = state;
	sites.res[slot] = res;
	sites.stock[slot] = stock;
	sites.life[slot] = life;
	sites.discover[slot] = discover;
	sites.claim[slot] = 0;
	sites.trust[slot] = 0;
	sites.version++;
	return slot;
}

function sitesPlaceDeposit(idx, res, state, discover = 0) {
	const stock = SITE_DEPOSIT_STOCK[res];
	const slot = sitesPlace(SITE.DEPOSIT, idx, res, stock, state, 0, discover);
	if (slot >= 0) {
		sites.initialStock += stock;
		sites.remainingStock += stock;
	}
	return slot;
}

function sitesRemoveDeposit(slot) {
	sites.initialStock -= sites.stock[slot];
	sites.remainingStock -= sites.stock[slot];
	sites.stock[slot] = 0;
	sites.claim[slot] = 0;
	sites.state[slot] = SITE_STATE.GONE;
	sites.version++;
}

function sitesFindCellNear(cx, cy, radius, terrainWanted) {
	for (let r = 0; r <= radius; r++) {
		for (let dy = -r; dy <= r; dy++) {
			for (let dx = -r; dx <= r; dx++) {
				if (Math.max(dx < 0 ? -dx : dx, dy < 0 ? -dy : dy) !== r) continue;
				const x = cx + dx;
				const y = cy + dy;
				if (!worldWalkableAt(x, y)) continue;
				const idx = y * MAP_SIZE + x;
				if (terrainWanted >= 0 && world.terrain[idx] !== terrainWanted) continue;
				if (sitesAt(x, y) >= 0) continue;
				return idx;
			}
		}
	}
	return -1;
}

function sitesVisibility() {
	const roll = randomNext();
	if (roll < 0.35) return SITE_STATE.VISIBLE;
	if (roll < 0.7) return SITE_STATE.MARKED;
	return SITE_STATE.HIDDEN;
}

function sitesPlaceStarter() {
	const sx = world.startX;
	const sy = world.startY;
	const food = sitesFindCellNear(sx, sy, 6, TERRAIN.MEADOW);
	if (food >= 0) sitesPlace(SITE.GATHER, food, RES.FOOD, randomRange(10, 18), SITE_STATE.VISIBLE, 0, 0);
	const timber = sitesFindCellNear(sx, sy, 8, TERRAIN.FOREST);
	if (timber >= 0) sitesPlaceDeposit(timber, RES.TIMBER, SITE_STATE.VISIBLE);
	const task = sitesFindCellNear(sx, sy, 5, -1);
	if (task >= 0) sitesPlace(SITE.TASK, task, randomInt(SKILL_COUNT), randomRange(28, 45), SITE_STATE.VISIBLE, 0, 0);
	const coal = sitesFindCellNear(sx, sy, 4, -1);
	if (coal >= 0) sitesPlaceDeposit(coal, RES.FUEL, SITE_STATE.MARKED, 0.08);
}

function sitesPlaceDeposits() {
	const order = [RES.FOOD, RES.TIMBER, RES.FUEL, RES.CRYSTAL, RES.FUEL];
	const wanted = [TERRAIN.MEADOW, TERRAIN.FOREST, TERRAIN.SWAMP, TERRAIN.HILLS, TERRAIN.SWAMP];
	for (let k = 0; k < 12; k++) {
		const res = order[k % order.length];
		const anchor = worldRandomWalkable();
		const ax = anchor % MAP_SIZE;
		const ay = (anchor / MAP_SIZE) | 0;
		let idx = sitesFindCellNear(ax, ay, 6, wanted[k % wanted.length]);
		if (idx < 0) idx = sitesFindCellNear(ax, ay, 8, -1);
		if (idx < 0) continue;
		sitesPlaceDeposit(idx, res, sitesVisibility(), randomRange(0.05, 0.10));
	}
}

function sitesPlaceOneShots() {
	for (let k = 0; k < 10; k++) {
		const idx = worldRandomWalkable();
		sitesPlace(SITE.GATHER, idx, randomInt(RES_COUNT), randomRange(8, 20), sitesVisibility(), 0, randomRange(0.04, 0.09));
	}
	for (let k = 0; k < 5; k++) {
		const idx = worldRandomWalkable();
		sitesPlace(SITE.ITEM, idx, RES.GOODS, 1, sitesVisibility(), 0, randomRange(0.04, 0.09));
	}
	for (let k = 0; k < 4; k++) {
		const idx = worldRandomWalkable();
		sitesPlace(SITE.SKILL, idx, randomInt(SKILL_COUNT), 1, sitesVisibility(), 0, randomRange(0.05, 0.10));
	}
	for (let k = 0; k < 5; k++) {
		const idx = worldRandomWalkable();
		const slot = sitesPlace(SITE.TASK, idx, randomInt(SKILL_COUNT), randomRange(25, 70), sitesVisibility(), 0, randomRange(0.05, 0.10));
		if (slot >= 0 && randomNext() < SITE_MAX_TRUST) sites.trust[slot] = 1;
	}
}

function sitesAt(x, y) {
	for (let i = 0; i < SITE_CAP; i++) {
		if (sites.state[i] === SITE_STATE.GONE) continue;
		if (sites.x[i] === x && sites.y[i] === y) return i;
	}
	return -1;
}

function sitesOwner(i) {
	return sites.claim[i] - 1;
}

function sitesWorkable(i) {
	const claim = sites.claim[i];
	if (claim === 0 || claim === FACTION_PLAYER + 1) return true;
	return territoryContest(sites.y[i] * MAP_SIZE + sites.x[i], FACTION_PLAYER) >= 1;
}

function sitesName(i) {
	const kind = sites.kind[i];
	if (kind === SITE.DEPOSIT) return RES_NAME[sites.res[i]] + ' deposit';
	if (kind === SITE.GATHER) return RES_NAME[sites.res[i]] + ' cache';
	if (kind === SITE.ITEM) return 'relic';
	if (kind === SITE.SKILL) return 'field school';
	return 'local task';
}

function sitesClaim(i, owner) {
	if (sites.claim[i] !== 0) return false;
	sites.claim[i] = owner + 1;
	territoryAddSource(owner, sites.x[i], sites.y[i], SITE_SOURCE_STRENGTH, SITE_SOURCE_RADIUS, SITE_SOURCE_DECAY);
	sites.version++;
	if (owner === FACTION_PLAYER) eventsAdd('We hold the ' + sitesName(i) + '.');
	return true;
}

function sitesExtract(i, amount, owner) {
	const stock = sites.stock[i];
	if (stock <= 0) return 0;
	const idx = sites.y[i] * MAP_SIZE + sites.x[i];
	const yieldAmount = amount * landProductivity(idx);
	const units = yieldAmount < stock ? yieldAmount : stock;
	sites.stock[i] = stock - units;
	sites.remainingStock -= units;
	const res = sites.res[i];
	const impact = res === RES.FUEL || res === RES.ORE ? LAND_MINE_DISTURB_PER_UNIT : LAND_DISTURB_PER_UNIT;
	landDisturbAround(idx, units * impact);
	economyAccountMining(units);
	if (owner === FACTION_PLAYER) economyAddResource(res, units * EXTRACT_SHARE);
	if (owner >= 0) sitesClaim(i, owner);
	if (sites.stock[i] <= 0) {
		sites.state[i] = SITE_STATE.DONE;
		sites.version++;
		if (party.working && party.x === sites.x[i] && party.y === sites.y[i]) party.working = false;
		eventsAdd(sitesName(i) + ' is exhausted.');
	}
	return units;
}

function sitesTimedSpawn(seconds) {
	if (randomNext() >= SITE_TIMED_CHANCE * seconds) return;
	const kind = SITE_TIMED_KINDS[randomInt(SITE_TIMED_KINDS.length)];
	const idx = worldRandomWalkable();
	const x = idx % MAP_SIZE;
	const y = (idx / MAP_SIZE) | 0;
	if (sitesAt(x, y) >= 0 || mapeIsSettlement(idx)) return;
	const state = randomNext() < 0.45 ? SITE_STATE.VISIBLE : SITE_STATE.MARKED;
	if (kind === SITE.GATHER) {
		sitesPlace(kind, idx, randomInt(RES_COUNT), randomRange(8, 18), state, randomRange(360, 960), randomRange(0.05, 0.10));
		return;
	}
	if (kind === SITE.ITEM) {
		sitesPlace(kind, idx, RES.GOODS, 1, state, randomRange(360, 960), randomRange(0.05, 0.10));
		return;
	}
	const slot = sitesPlace(kind, idx, randomInt(SKILL_COUNT), randomRange(20, 55), state, randomRange(360, 960), randomRange(0.05, 0.10));
	if (slot >= 0 && randomNext() < SITE_MAX_TRUST) sites.trust[slot] = 1;
}

function sitesStep(seconds) {
	if (!party.alive) return;
	const progress = investigation.progress;
	for (let i = 0; i < SITE_CAP; i++) {
		const state = sites.state[i];
		if (state === SITE_STATE.GONE) continue;
		if (sites.life[i] > 0) {
			const life = sites.life[i] - seconds;
			if (life <= 0) {
				if (state === SITE_STATE.VISIBLE) eventsAdd('The chance at a ' + sitesName(i) + ' has passed.');
				sites.state[i] = SITE_STATE.GONE;
				sites.version++;
				continue;
			}
			sites.life[i] = life;
		}
		if (state === SITE_STATE.HIDDEN) {
			if (progress[sites.y[i] * MAP_SIZE + sites.x[i]] < SITE_REVEAL_PROGRESS) continue;
			sites.state[i] = SITE_STATE.MARKED;
			sites.version++;
			eventsAdd('Something remains at ' + sites.x[i] + ',' + sites.y[i] + '.');
			continue;
		}
		if (state === SITE_STATE.MARKED) {
			const amount = sites.discover[i] * progress[sites.y[i] * MAP_SIZE + sites.x[i]] * seconds;
			if (randomNext() < amount) {
				sites.state[i] = SITE_STATE.VISIBLE;
				sites.version++;
				eventsAdd('Identified a ' + sitesName(i) + ' at ' + sites.x[i] + ',' + sites.y[i] + '.');
			}
		}
		if (sites.state[i] !== SITE_STATE.VISIBLE || sites.claim[i] !== 0) continue;
		if (progress[sites.y[i] * MAP_SIZE + sites.x[i]] < 1) continue;
		sitesClaim(i, FACTION_PLAYER);
	}
	const here = sitesAt(party.x, party.y);
	if (party.working && here >= 0) sitesWorkTick(here, seconds);
	sitesTimedSpawn(seconds);
}

function sitesWorkTick(i, seconds) {
	if (sites.kind[i] !== SITE.DEPOSIT || sites.state[i] !== SITE_STATE.VISIBLE) return;
	if (sites.res[i] === RES.FUEL || sites.res[i] === RES.ORE) return;
	if (!sitesWorkable(i)) return;
	sitesExtract(i, economyDepositRate(sites.res[i]) * party.workFactor() * seconds, FACTION_PLAYER);
}

function sitesActionable(i, kind) {
	if (i < 0 || sites.kind[i] !== kind) return false;
	if (sites.state[i] !== SITE_STATE.VISIBLE) return false;
	if (party.x !== sites.x[i] || party.y !== sites.y[i]) return false;
	return sitesWorkable(i);
}

function sitesGather(i) {
	if (!sitesActionable(i, SITE.GATHER)) return false;
	const res = sites.res[i];
	const amount = sites.stock[i];
	economyAddResource(res, amount);
	partyAddMorale(3);
	partyTrain(SKILL.OBS, 0.15);
	partyTrain(SKILL.LOG, 0.1);
	sites.stock[i] = 0;
	sites.state[i] = SITE_STATE.DONE;
	sitesClaim(i, FACTION_PLAYER);
	eventsAdd('Collected ' + amount.toFixed(1) + ' ' + RES_NAME[res] + '.');
	return true;
}

function sitesTakeItem(i) {
	if (!sitesActionable(i, SITE.ITEM)) return false;
	partyAddItem(1);
	partyAddMorale(4);
	partyTrain(SKILL.KNOW, 0.2);
	sites.stock[i] = 0;
	sites.state[i] = SITE_STATE.DONE;
	sitesClaim(i, FACTION_PLAYER);
	eventsAdd('Recovered a relic worth ' + ITEM_VALUE + ' funds at a settlement.');
	return true;
}

function sitesTrain(i) {
	if (!sitesActionable(i, SITE.SKILL)) return false;
	const domain = sites.res[i];
	partyTrain(domain, 0.8);
	partyAddMorale(2);
	sites.stock[i] = 0;
	sites.state[i] = SITE_STATE.DONE;
	sitesClaim(i, FACTION_PLAYER);
	eventsAdd('Trained ' + SKILL_NAME[domain] + ' at a field school.');
	return true;
}

function sitesAttempt(i) {
	if (!sitesActionable(i, SITE.TASK)) return 0;
	if (sites.trust[i] && !party.unlocks.trust) return 2;
	const domain = sites.res[i];
	let chance = 0.35 + party.skills[domain] * 0.06 + party.morale * 0.002;
	if (chance > 0.95) chance = 0.95;
	if (randomNext() < chance) {
		partyAddFunds(sites.stock[i]);
		partyAddMorale(8);
		partyTrain(SKILL.COMM, 0.5);
		partyTrain(domain, 0.3);
		eventsAdd('Task settled: +' + sites.stock[i].toFixed(0) + ' funds.');
		sites.stock[i] = 0;
		sites.state[i] = SITE_STATE.DONE;
		sitesClaim(i, FACTION_PLAYER);
		return 1;
	}
	partyAddMorale(-8);
	partyAddCondition(-4);
	partyTrain(domain, 0.2);
	eventsAdd('The task went wrong: morale and condition dropped.');
	return 0;
}

if (typeof module !== 'undefined') module.exports = { sites, sitesPopulate, sitesStep, SITE, SITE_STATE };
