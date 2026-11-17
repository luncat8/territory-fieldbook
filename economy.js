// owns: physical stocks, balanced flows and land recovery
// edit for: extraction, renewable energy, restoration and ledger accounting
'use strict';

const RECIPES = {
	mining: { energy: 0.15, oreShare: 0.8, disturbancePerUnit: 0.006 },
	recycling: { energy: 0.5, recoveredShare: 0.5 },
	restoration: { energy: 1, ore: 0.5, area: 0.08 },
	solarCycle: { carbon: 0.5, biomassShare: 0.5 }
};

function makeEconomy() {
	return { carbon: 300, oxygen: 150, biomass: 150, rubble: 0, heat: 0, sunlight: 0, renewable: [false, false], last: 'No flows yet' };
}

function totalMass(game) {
	let mass = game.townOre + game.economy.carbon + game.economy.oxygen + game.economy.biomass + game.economy.rubble;
	for (const party of game.parties) mass += party.ore;
	for (const site of game.sites) mass += site.stock;
	return mass;
}

function totalEnergy(game) {
	return game.economy.biomass + game.parties[0].energy + game.parties[1].energy + game.economy.heat;
}

function spendEnergy(game, party, amount) {
	if (party.energy < amount) return false;
	party.energy -= amount;
	game.economy.heat += amount;
	return true;
}

function miningRate(game, site, party) {
	const terrain = game.world.terrain[siteIndex(site)];
	const population = terrain === 3 ? 1 : terrain === 0 ? 0.6 : 0.8;
	const supplies = party.supplies > 0 ? 1 : 0.25;
	const oxygen = game.economy.oxygen > 1 ? 1 : 0.25;
	let neighbours = 0;
	for (const other of game.sites) if (other !== site && other.owner === party.id && Math.hypot(other.x - site.x, other.y - site.y) < 8) neighbours++;
	return (0.25 + Math.min(0.15, partySkill(party, 3) * 0.01)) * population * supplies * oxygen * (1 + Math.min(0.2, neighbours * 0.05));
}

function orePrice(game) { return Math.max(4, 10 - Math.floor(game.townOre / 20)); }
function supplyPrice(game, party) { return Math.max(4, Math.min(9, 7 - Math.floor(party.supplies / 30))); }

function economyTick(game) {
	const eco = game.economy;
	for (const party of game.parties) {
		party.flows.mined = 0; party.flows.disturbance = 0; party.flows.renewable = 0;
		const oldEnergy = party.energy;
		const index = Math.floor(party.y) * WORLD_SIZE + Math.floor(party.x);
		const terrain = game.world.terrain[index];
		const eligible = (terrain === 1 || terrain === 2 || terrain === 3) && game.world.disturbance[index] < 0.2;
		if (eco.renewable[party.id] && eligible && eco.carbon >= RECIPES.solarCycle.carbon) {
			const amount = RECIPES.solarCycle.carbon * (1 - game.world.disturbance[index]);
			eco.carbon -= amount; eco.oxygen += amount * (1 - RECIPES.solarCycle.biomassShare); eco.biomass += amount * RECIPES.solarCycle.biomassShare;
			eco.sunlight += amount; eco.heat += amount * (1 - RECIPES.solarCycle.biomassShare);
			const biomass = amount * RECIPES.solarCycle.biomassShare, oxygen = amount - biomass;
			if (eco.biomass >= biomass && eco.oxygen >= oxygen) {
				eco.biomass -= biomass; eco.oxygen -= oxygen; eco.carbon += amount;
				party.energy += biomass;
			}
			party.flows.renewable = amount;
		}
		for (const site of game.sites) {
			if (site.owner !== party.id || !site.mining || site.stock <= 0) continue;
			const cell = siteIndex(site);
			if (game.world.control[cell] !== party.id || party.energy < RECIPES.mining.energy) continue;
			const amount = Math.min(site.stock, miningRate(game, site, party));
			if (!spendEnergy(game, party, RECIPES.mining.energy)) continue;
			site.stock -= amount; party.ore += amount * RECIPES.mining.oreShare; eco.rubble += amount * (1 - RECIPES.mining.oreShare);
			const before = game.world.disturbance[cell];
			game.world.disturbance[cell] = Math.min(1, before + amount * RECIPES.mining.disturbancePerUnit);
			party.flows.mined += amount; party.flows.disturbance += game.world.disturbance[cell] - before;
			if (site.stock <= 0.000001) { site.stock = 0; site.mining = false; addEvent(game, `Deposit at ${site.x}, ${site.y} depleted.`); }
		}
		party.flows.energy = party.energy - oldEnergy;
	}
	for (let i = 0; i < CELL_COUNT; i++) game.world.disturbance[i] = Math.max(0, game.world.disturbance[i] - TERRAINS[game.world.terrain[i]].recovery);
}

function restoreCell(game, party, index) {
	if (game.world.control[index] !== party.id || game.world.disturbance[index] <= 0 || party.ore < RECIPES.restoration.ore) return false;
	const remote = Math.floor(party.y) * WORLD_SIZE + Math.floor(party.x) !== index;
	if (!spendEnergy(game, party, RECIPES.restoration.energy * (remote ? 2 : 1))) return false;
	party.ore -= RECIPES.restoration.ore; game.economy.rubble += RECIPES.restoration.ore;
	game.world.disturbance[index] = Math.max(0, game.world.disturbance[index] - RECIPES.restoration.area);
	return true;
}

function recycle(game, party) {
	const amount = Math.min(1, game.economy.rubble);
	if (amount <= 0 || !spendEnergy(game, party, RECIPES.recycling.energy)) return false;
	game.economy.rubble -= amount * RECIPES.recycling.recoveredShare;
	party.ore += amount * RECIPES.recycling.recoveredShare;
	return true;
}

if (typeof module !== 'undefined') module.exports = { makeEconomy, totalMass, totalEnergy, economyTick, restoreCell, recycle };
