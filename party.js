// owns: party members, shared values, skills, movement and camping
// edit for: member traits, skill domains, costs, unlock thresholds

const SKILL = { NAV: 0, FIELD: 1, OBS: 2, KNOW: 3, COMM: 4, LOG: 5 };
const SKILL_COUNT = 6;
const SKILL_NAME = ['navigation', 'fieldcraft', 'observation', 'knowledge', 'communication', 'logistics'];
const UNLOCK_ROUTE = 7;
const UNLOCK_ASSAY = 7;
const UNLOCK_TRUST = 7;
const UNLOCK_NAME = { route: 'route charting', assay: 'field assay', trust: 'local trust' };

const PARTY_NAMES = ['Iri', 'Pell', 'Sable', 'Rook', 'Wren', 'Tarn', 'Juno', 'Bex', 'Holm', 'Mira', 'Kestrel', 'Vale'];
const PARTY_SUPPLY_USE = 0.09;
const PARTY_WAGE = 0.30;
const PARTY_BASE_DRAIN = 0.18;
const PARTY_TRAVEL_DRAIN = 0.12;
const PARTY_SUPPLY_DRAIN = 0.50;
const PARTY_RECOVERY = 0.18;
const PARTY_MORALE_TARGET = 50;
const PARTY_MORALE_PULL = 0.02;
const PARTY_HIRE_BASE = 50;
const PARTY_HIRE_STEP = 25;
const PARTY_SPAWN_MEMBERS = 3;

// indexed by world terrain id: meadow, forest, water, swamp, hills, desert
const PARTY_TERRAIN_EFFORT = [1.0, 1.4, 0, 1.8, 1.6, 1.3];

const party = {
	x: 0,
	y: 0,
	condition: 70,
	morale: 60,
	funds: 80,
	supplies: 45,
	items: 0,
	alive: true,
	camped: false,
	working: false,
	members: [],
	skills: new Float32Array(SKILL_COUNT),
	unlocks: { route: false, assay: false, trust: false },
	warnSupplies: false,
	warnCondition: false,
	workFactor: partyWorkFactor,
	investigateFactor: partyInvestigateFactor
};

function partySpawn(x, y) {
	party.x = x;
	party.y = y;
	party.condition = 70;
	party.morale = 60;
	party.funds = 80;
	party.supplies = 45;
	party.items = 0;
	party.alive = true;
	party.camped = false;
	party.working = false;
	party.members.length = 0;
	party.warnSupplies = false;
	party.warnCondition = false;
	for (let k = 0; k < PARTY_SPAWN_MEMBERS; k++) party.members.push(partyMakeMember());
	partyRecalculateSkills();
}

function partyMakeMember() {
	const member = {
		name: PARTY_NAMES[randomInt(PARTY_NAMES.length)],
		learning: randomRange(0.7, 1.4),
		physical: randomRange(0.7, 1.3),
		recovery: randomRange(0.7, 1.3),
		potential: randomRange(1.0, 1.6),
		skills: new Float32Array(SKILL_COUNT)
	};
	for (let d = 0; d < SKILL_COUNT; d++) member.skills[d] = randomRange(0, 0.9);
	member.skills[SKILL.NAV] += 0.6;
	member.skills[SKILL.OBS] += 0.6;
	return member;
}

function partyAddMorale(delta) {
	const morale = party.morale + delta;
	party.morale = morale > 100 ? 100 : morale < 0 ? 0 : morale;
}

function partyAddCondition(delta) {
	const condition = party.condition + delta;
	party.condition = condition > 100 ? 100 : condition < 0 ? 0 : condition;
}

function partyAddSupplies(delta) {
	const supplies = party.supplies + delta;
	party.supplies = supplies < 0 ? 0 : supplies;
}

function partyAddFunds(delta) {
	const funds = party.funds + delta;
	party.funds = funds < 0 ? 0 : funds;
}

function partyAddItem(delta) {
	const items = party.items + delta;
	party.items = items < 0 ? 0 : items;
}

function partyWorkFactor() {
	return 0.6 + party.condition / 250 + party.morale / 500;
}

function partyInvestigateFactor() {
	const base = 0.45 + party.condition / 220 + party.morale / 500;
	return party.working ? base * 0.5 : base;
}

function partyRecoveryRate() {
	let rate = 0;
	for (let k = 0; k < party.members.length; k++) {
		const member = party.members[k];
		rate += member.recovery * (0.6 + member.physical * 0.4);
	}
	return rate * PARTY_RECOVERY;
}

function partyRecalculateSkills() {
	const skills = party.skills;
	skills.fill(0);
	for (let k = 0; k < party.members.length; k++) {
		const member = party.members[k];
		for (let d = 0; d < SKILL_COUNT; d++) skills[d] += member.skills[d];
	}
	partyCheckUnlock('route', skills[SKILL.OBS] + skills[SKILL.NAV] >= UNLOCK_ROUTE);
	partyCheckUnlock('assay', skills[SKILL.KNOW] + skills[SKILL.LOG] >= UNLOCK_ASSAY);
	partyCheckUnlock('trust', skills[SKILL.COMM] + skills[SKILL.FIELD] >= UNLOCK_TRUST);
}

function partyCheckUnlock(key, reached) {
	if (!reached || party.unlocks[key]) return;
	party.unlocks[key] = true;
	eventsAdd('Party capability: ' + UNLOCK_NAME[key] + '.');
}

function partyTrain(domain, amount) {
	for (let k = 0; k < party.members.length; k++) {
		const member = party.members[k];
		const cap = 2 + member.potential * 6;
		const next = member.skills[domain] + amount * member.learning;
		member.skills[domain] = next > cap ? cap : next;
	}
	partyRecalculateSkills();
}

function partyStep(minutes) {
	if (!party.alive) return;
	const hours = minutes / 60;
	const members = party.members.length;
	const supplyUse = PARTY_SUPPLY_USE * members * hours;
	party.supplies -= supplyUse;
	if (party.supplies < 0) party.supplies = 0;
	const wage = PARTY_WAGE * members * hours;
	if (party.funds >= wage) party.funds -= wage;
	else {
		party.funds = 0;
		partyAddMorale(-0.3 * hours);
	}
	party.morale += (PARTY_MORALE_TARGET - party.morale) * PARTY_MORALE_PULL * hours;
	if (party.camped && party.supplies > 0) partyAddCondition(partyRecoveryRate() * hours);
	else partyAddCondition(-(PARTY_BASE_DRAIN + PARTY_TRAVEL_DRAIN * PARTY_TERRAIN_EFFORT[world.terrain[party.y * MAP_SIZE + party.x]]) * hours);
	if (party.supplies <= 0) partyAddCondition(-PARTY_SUPPLY_DRAIN * hours);
	party.morale = party.morale < 0 ? 0 : party.morale > 100 ? 100 : party.morale;
	if (party.supplies < 5 && !party.warnSupplies) {
		party.warnSupplies = true;
		eventsAdd('Supplies are running out: provision food or buy at a town.');
	}
	if (party.supplies > 10) party.warnSupplies = false;
	if (party.condition < 15 && !party.warnCondition) {
		party.warnCondition = true;
		eventsAdd('The party is near exhaustion: camp with supplies.');
	}
	if (party.condition > 30) party.warnCondition = false;
	if (party.condition <= 0) {
		party.alive = false;
		eventsAdd('The party is lost to exhaustion.');
		return;
	}
	territoryMaintain(FACTION_PLAYER, party.x, party.y);
}

function partySetCamp(on) {
	party.camped = on;
	if (on) territorySetCamp(FACTION_PLAYER, party.x, party.y);
	else territoryClearCamp(FACTION_PLAYER);
}

function partyMoveTo(x, y) {
	if (!party.alive) return false;
	if (!worldWalkableAt(x, y)) {
		eventsStatus('Water blocks the way.');
		return false;
	}
	const dx = x - party.x;
	const dy = y - party.y;
	if (dx === 0 && dy === 0) return false;
	const dist = Math.sqrt(dx * dx + dy * dy);
	const effort = PARTY_TERRAIN_EFFORT[world.terrain[y * MAP_SIZE + x]];
	partyAddCondition(-dist * (0.18 + effort * 0.12) * (1 - party.condition / 400));
	partyAddSupplies(-dist * 0.25);
	if (party.camped) partySetCamp(false);
	party.working = false;
	party.x = x;
	party.y = y;
	partyTrain(SKILL.NAV, 0.02 * (dist > 6 ? 6 : dist));
	return true;
}

function partyHireCost() {
	return PARTY_HIRE_BASE + PARTY_HIRE_STEP * party.members.length;
}

function partyHire() {
	if (!party.alive) return false;
	const cost = partyHireCost();
	if (party.funds < cost) {
		eventsStatus('Hiring needs ' + cost + ' funds.');
		return false;
	}
	party.funds -= cost;
	const member = partyMakeMember();
	party.members.push(member);
	partyRecalculateSkills();
	eventsAdd('Hired ' + member.name + '.');
	return true;
}

function partyDismiss() {
	if (party.members.length <= 1) {
		eventsStatus('The last member cannot be dismissed.');
		return false;
	}
	const member = party.members.pop();
	partyRecalculateSkills();
	partyAddMorale(-3);
	eventsAdd('Dismissed ' + member.name + '. Their skills leave the party.');
	return true;
}

if (typeof module !== 'undefined') module.exports = { party, partySpawn, partyStep, SKILL, partyWorkFactor };
