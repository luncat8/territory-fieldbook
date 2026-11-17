// owns: members, party capabilities, upkeep and training
// edit for: hiring, skills, rest and survival pressures
'use strict';

const SKILLS = ['Navigation', 'Fieldcraft', 'Observation', 'Knowledge', 'Communication', 'Logistics'];
const RECRUITS = [
	{ name: 'Ari', skills: [2, 2, 3, 1, 1, 2], learning: 1.1, physical: 75, recovery: 1.1, potential: 90, wage: 0.04 },
	{ name: 'Bea', skills: [1, 2, 1, 3, 2, 2], learning: 1, physical: 70, recovery: 1, potential: 85, wage: 0.04 },
	{ name: 'Cato', skills: [2, 1, 2, 1, 3, 1], learning: 1.2, physical: 65, recovery: 0.9, potential: 80, wage: 0.05 },
	{ name: 'Dara', skills: [1, 3, 1, 2, 1, 3], learning: 0.9, physical: 80, recovery: 1.2, potential: 95, wage: 0.05 }
];

function copyMember(template) {
	return { ...template, skills: template.skills.slice() };
}

function makeParty(id, x, y) {
	return { id, x: x + 0.5, y: y + 0.5, members: [copyMember(RECRUITS[0]), copyMember(RECRUITS[1])], search: new Float32Array(CELL_COUNT), funds: 30, supplies: 60, condition: 85, morale: 80, ore: 0, items: 0, energy: 30, rest: false, hunger: 0, shortage: 0, failed: false, reason: '', history: [], flows: { mined: 0, disturbance: 0, renewable: 0, energy: 0 } };
}

function partySkill(party, index) {
	let result = 0;
	for (const member of party.members) result += member.skills[index];
	return result;
}

function capability(party, name) {
	if (name === 'chart') return partySkill(party, 0) + partySkill(party, 2) >= 10;
	if (name === 'assay') return partySkill(party, 3) + partySkill(party, 5) >= 10;
	return partySkill(party, 1) + partySkill(party, 4) >= 10;
}

function moveParty(party, x, y) {
	if (party.failed) return false;
	const cost = Math.max(0.1, 0.6 - partySkill(party, 0) * 0.03);
	if (party.supplies < cost) return false;
	party.supplies -= cost;
	party.x = x + 0.5;
	party.y = y + 0.5;
	party.members[0].skills[0] = Math.min(10, party.members[0].skills[0] + 0.01 * party.members[0].learning);
	return true;
}

function hireMember(party, index) {
	const recruit = RECRUITS[index];
	if (!recruit || party.members.some(member => member.name === recruit.name) || party.funds < 5) return false;
	party.funds -= 5;
	party.members.push(copyMember(recruit));
	return true;
}

function trainMember(party, index, skill) {
	const member = party.members[index];
	if (!member || party.funds < 3 || skill < 0 || skill >= SKILLS.length) return false;
	party.funds -= 3;
	member.skills[skill] = Math.min(10, member.skills[skill] + member.learning);
	member.physical = Math.min(member.potential, member.physical + 0.5);
	return true;
}

function partyUpkeep(party, oxygen) {
	const use = Math.max(0.03, 0.14 - partySkill(party, 5) * 0.004);
	party.supplies = Math.max(0, party.supplies - use);
	party.hunger = party.supplies <= 0 ? party.hunger + 1 : 0;
	party.shortage = oxygen <= 0.01 || party.energy <= 0.01 ? party.shortage + 1 : 0;
	let wages = 0, recovery = 0, physical = 0;
	for (const member of party.members) { wages += member.wage; recovery += member.recovery; physical += member.physical; }
	if (party.funds >= wages) party.funds -= wages;
	else { party.funds = 0; party.morale = Math.max(0, party.morale - 0.2); }
	if (party.rest && party.supplies > 0) {
		party.condition = Math.min(100, party.condition + recovery * 0.15);
		party.morale = Math.min(100, party.morale + 0.08);
	} else {
		party.condition = Math.max(0, party.condition - Math.max(0.01, 0.09 - partySkill(party, 1) * 0.003 - physical / party.members.length * 0.0003) - (party.hunger ? 0.4 : 0) - (party.shortage ? 0.1 : 0));
	}
	if (party.condition <= 0 || party.hunger >= 60 || party.shortage >= 120) {
		party.failed = true;
		party.reason = party.condition <= 0 ? 'Condition collapsed' : party.hunger >= 60 ? 'Supplies exhausted' : 'Oxygen or energy shortage';
	}
}

if (typeof module !== 'undefined') module.exports = { SKILLS, RECRUITS, makeParty, partySkill, capability, moveParty, hireMember, trainMember, partyUpkeep };
