// owns: resources, recipes, biosphere and the party conservation ledger
// edit for: resource tables, recipe data, biosphere rates

const RES = { FOOD: 0, TIMBER: 1, ORE: 2, CRYSTAL: 3, FUEL: 4, GOODS: 5 };
const RES_COUNT = 6;
const RES_NAME = ['food', 'timber', 'ore', 'crystal', 'fuel', 'goods'];
const RES_BASE_VALUE = [3, 4, 7, 12, 5, 18];
const RES_REF_STOCK = [40, 30, 15, 6, 12, 8];
const DEPOSIT_RATE = [0.30, 0.30, 0.22, 0.14, 0.24, 0];
const EXTRACT_SHARE = 0.6;

const SUPPLY_PRICE = 5;
const ITEM_VALUE = 14;

const BIO_RESPONSE = 0.08;
const BIO_CARBON_PER_COVER = 0.7;
const BIO_SOIL_OPTIMUM = 0.5;

const BIO_OXYGEN_SHARE = 0.5;
const BIO_SUN_VALUE = 8;

const RECIPES = [
	{
		name: 'field goods',
		inputRes: [RES.ORE, RES.FUEL],
		inputQty: [1, 1],
		outputRes: [RES.GOODS],
		outputQty: [2],
		oxygen: 1,
		energy: 2
	}
];

const economy = {
	inventory: new Float32Array(RES_COUNT),
	biomass: null,
	tilled: null,
	oxygen: 100,
	carbon: 20,
	oxygenProduced: 0,
	oxygenUsed: 0,
	energySun: 0,
	energyFuel: 0,
	massIn: 0,
	massOut: 0,
	miningMass: 0,
	miningOre: 0,
	miningLeft: 0
};

function economyInit() {
	economy.biomass = new Float32Array(world.n);
	economy.tilled = new Uint8Array(world.n);
	economyReset();
}

function economyReset() {
	economy.inventory.fill(0);
	economy.tilled.fill(0);
	economy.oxygen = 100;
	economy.carbon = 20;
	economy.oxygenProduced = 0;
	economy.oxygenUsed = 0;
	economy.energySun = 0;
	economy.energyFuel = 0;
	economy.massIn = 0;
	economy.massOut = 0;
	economy.miningMass = 0;
	economy.miningOre = 0;
	economy.miningLeft = 0;
	const biomass = economy.biomass;
	for (let i = 0; i < world.n; i++) biomass[i] = world.terrain[i] === TERRAIN.WATER ? 0 : 0.65 * economyForestTarget(i, 0.4);
}

function economyAddResource(res, amount) {
	economy.inventory[res] += amount;
}

function economyHasCargo() {
	for (let r = 0; r < RES_COUNT; r++) if (economy.inventory[r] >= 0.05) return true;
	return false;
}

function economyDepositRate(res) {
	return DEPOSIT_RATE[res];
}

function economyAccountMining(units) {
	economy.miningMass += units;
	economy.miningOre += units * EXTRACT_SHARE;
	economy.miningLeft += units * (1 - EXTRACT_SHARE);
	economy.massIn += units;
	economy.massOut += units;
}

function economyCanProcess() {
	const recipe = RECIPES[0];
	for (let k = 0; k < recipe.inputRes.length; k++) {
		if (economy.inventory[recipe.inputRes[k]] < recipe.inputQty[k]) return false;
	}
	return economy.oxygen >= recipe.oxygen;
}

function economyProcess() {
	const recipe = RECIPES[0];
	if (!economyCanProcess()) return false;
	let mass = 0;
	for (let k = 0; k < recipe.inputRes.length; k++) {
		economy.inventory[recipe.inputRes[k]] -= recipe.inputQty[k];
		mass += recipe.inputQty[k];
	}
	for (let k = 0; k < recipe.outputRes.length; k++) economy.inventory[recipe.outputRes[k]] += recipe.outputQty[k];
	economy.oxygen -= recipe.oxygen;
	economy.carbon += recipe.oxygen;
	economy.oxygenUsed += recipe.oxygen;
	economy.energyFuel += recipe.energy;
	economy.massIn += mass + recipe.oxygen;
	economy.massOut += recipe.outputQty[0] + recipe.oxygen;
	return true;
}

function economyBurnFuel(amount) {
	if (amount <= 0) return;
	economy.oxygen -= amount;
	if (economy.oxygen < 0) economy.oxygen = 0;
	economy.carbon += amount;
	economy.oxygenUsed += amount;
	economy.energyFuel += amount * 4;
}

function economyTill(i, on) {
	economy.tilled[i] = on ? 1 : 0;
}

// Farmland grows no forest: a tilled cell's target cover is zero, and releasing it
// hands regrowth back to the ordinary humidity/CO2 model without a special mechanic.
function economyForestTarget(i, co2) {
	if (economy.tilled[i]) return 0;
	const width = 0.055 + 0.38 * co2 / (co2 + 0.25);
	const suitability = Math.max(0, 1 - Math.abs(hydrology.soil[i] - BIO_SOIL_OPTIMUM) / width);
	return suitability * co2 / (co2 + 0.025) * (1 - land.disturbed[i]);
}

function economyForestRate(i, co2) {
	if (world.terrain[i] === TERRAIN.WATER) return 0;
	return BIO_RESPONSE * (economyForestTarget(i, co2) - economy.biomass[i]);
}

function economyBiosphere(seconds) {
	const biomass = economy.biomass;
	const co2 = mape.goodsView[MAPE_RES.CO2];
	for (let i = 0; i < world.n; i++) {
		if (world.terrain[i] === TERRAIN.WATER) continue;
		const before = biomass[i];
		const change = Math.max(-before, Math.min(1 - before, economyForestRate(i, co2[i]) * seconds, co2[i] / BIO_CARBON_PER_COVER));
		biomass[i] = before + change;
		const carbon = (biomass[i] - before) * BIO_CARBON_PER_COVER;
		const stockBefore = co2[i];
		co2[i] = Math.max(0, stockBefore - carbon);
		const fixed = stockBefore - co2[i];
		if (fixed >= 0) mape.massOut += fixed;
		else mape.massIn -= fixed;
		const oxygen = fixed * BIO_OXYGEN_SHARE;
		economy.oxygen = Math.max(0, economy.oxygen + oxygen);
		if (oxygen > 0) economy.oxygenProduced += oxygen;
		else economy.oxygenUsed -= oxygen;
		if (fixed > 0) economy.energySun += fixed * BIO_SUN_VALUE;
	}
}

function economyStep(seconds) {
	economyBiosphere(seconds);
}

if (typeof module !== 'undefined') module.exports = { economy, economyInit, economyStep, RES, RES_COUNT };
