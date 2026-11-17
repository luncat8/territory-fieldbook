// owns: resources, town stocks, prices, recipes, biosphere and the conservation ledger
// edit for: resource tables, price formula, recipe data, biosphere rates

const RES = { FOOD: 0, TIMBER: 1, ORE: 2, CRYSTAL: 3, FUEL: 4, GOODS: 5 };
const RES_COUNT = 6;
const RES_NAME = ['food', 'timber', 'ore', 'crystal', 'fuel', 'goods'];
const RES_BASE_VALUE = [3, 4, 7, 12, 5, 18];
const RES_REF_STOCK = [40, 30, 15, 6, 12, 8];
const DEPOSIT_RATE = [3.0, 3.0, 2.2, 1.4, 2.4, 0];
const EXTRACT_SHARE = 0.6;

const TOWN_CAP = 4;
const TOWN_STOCK_INIT = [40, 25, 8, 2, 10, 5];
const TOWN_MONEY_START = 380;
const TOWN_MONEY_CAP = 760;
const TOWN_MONEY_REGEN = 1.5;
const TOWN_FOOD_USE = 0.8;
const TOWN_FUEL_USE = 0.04;
const TOWN_RESTOCK = 0.02;
const SUPPLY_PRICE = 5;
const SUPPLY_FOOD_COST = 0.5;
const ITEM_VALUE = 14;

const BIO_START = [0.35, 0.85, 0, 0.55, 0, 0];
const BIO_FIX = [0.00020, 0.00030, 0, 0.00022, 0.00002, 0.00001];
const BIO_GROWTH = [0.004, 0.010, 0, 0.007, 0.0005, 0.0002];
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
	townStock: new Float32Array(TOWN_CAP * RES_COUNT),
	townMoney: new Float32Array(TOWN_CAP),
	demand: new Float32Array(RES_COUNT),
	townCount: 0,
	biomass: null,
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
	economyReset();
}

function economyReset() {
	economy.inventory.fill(0);
	economy.townStock.fill(0);
	economy.townMoney.fill(0);
	economy.demand.fill(0);
	economy.townCount = 0;
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
	for (let i = 0; i < world.n; i++) biomass[i] = BIO_START[world.terrain[i]];
}

function economyAddTown() {
	const id = economy.townCount;
	if (id >= TOWN_CAP) return -1;
	economy.townCount = id + 1;
	const offset = id * RES_COUNT;
	for (let r = 0; r < RES_COUNT; r++) economy.townStock[offset + r] = TOWN_STOCK_INIT[r];
	economy.townMoney[id] = TOWN_MONEY_START;
	return id;
}

function economyPrice(res, town) {
	const stock = economy.townStock[town * RES_COUNT + res];
	const base = RES_BASE_VALUE[res];
	let price = base * RES_REF_STOCK[res] / (stock + 1) * (1 + economy.demand[res]);
	if (price < base * 0.35) price = base * 0.35;
	if (price > base * 3) price = base * 3;
	return price;
}

function economyAddResource(res, amount) {
	economy.inventory[res] += amount;
}

function economySell(res, town) {
	const have = economy.inventory[res];
	if (have < 0.01) return 0;
	const price = economyPrice(res, town);
	const units = Math.min(have, economy.townMoney[town] / price);
	if (units < 0.05) return 0;
	const revenue = units * price;
	economy.inventory[res] = have - units;
	economy.townStock[town * RES_COUNT + res] += units;
	economy.townMoney[town] -= revenue;
	return revenue;
}

function economyAcceptItem(town) {
	if (economy.townMoney[town] < ITEM_VALUE) return 0;
	economy.townMoney[town] -= ITEM_VALUE;
	return ITEM_VALUE;
}

function economyBuySupplies(town, units) {
	const offset = town * RES_COUNT;
	if (economy.townStock[offset + RES.FOOD] < units * SUPPLY_FOOD_COST) return -1;
	economy.townStock[offset + RES.FOOD] -= units * SUPPLY_FOOD_COST;
	economy.townMoney[town] += units * SUPPLY_PRICE;
	return units * SUPPLY_PRICE;
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

function economyBiosphere(hours) {
	const biomass = economy.biomass;
	const disturbed = land.disturbed;
	let fixedTotal = 0;
	for (let i = 0; i < world.n; i++) {
		const terrain = world.terrain[i];
		const fix = BIO_FIX[terrain];
		const b = biomass[i];
		if (fix > 0 && b > 0) fixedTotal += b * fix * (1 - disturbed[i]) * hours;
		const growth = BIO_GROWTH[terrain];
		if (growth <= 0) continue;
		const next = b + growth * (1 - disturbed[i]) * hours;
		biomass[i] = next > 1 ? 1 : next;
	}
	if (fixedTotal <= 0) return;
	const oxygen = fixedTotal * BIO_OXYGEN_SHARE;
	economy.oxygen += oxygen;
	economy.oxygenProduced += oxygen;
	economy.carbon -= fixedTotal;
	if (economy.carbon < 0) economy.carbon = 0;
	economy.energySun += fixedTotal * BIO_SUN_VALUE;
}

function economyStep(minutes) {
	const hours = minutes / 60;
	const towns = economy.townCount;
	for (let t = 0; t < towns; t++) {
		const offset = t * RES_COUNT;
		const food = economy.townStock[offset + RES.FOOD] - TOWN_FOOD_USE * hours;
		economy.townStock[offset + RES.FOOD] = food > 0 ? food : 0;
		economy.demand[RES.FOOD] += TOWN_FOOD_USE * hours / RES_REF_STOCK[RES.FOOD];
		for (let r = 0; r < RES_COUNT; r++) {
			const i = offset + r;
			const ref = RES_REF_STOCK[r];
			const stock = economy.townStock[i];
			if (stock >= ref) continue;
			economy.townStock[i] = stock + (ref - stock) * TOWN_RESTOCK * hours;
		}
		const money = economy.townMoney[t] + TOWN_MONEY_REGEN * hours;
		economy.townMoney[t] = money > TOWN_MONEY_CAP ? TOWN_MONEY_CAP : money;
		economyBurnFuel(TOWN_FUEL_USE * hours);
	}
	for (let r = 0; r < RES_COUNT; r++) {
		const demand = economy.demand[r] * (1 - 0.02 * hours);
		economy.demand[r] = demand < 0.0001 ? 0 : demand;
	}
	economyBiosphere(hours);
}

if (typeof module !== 'undefined') module.exports = { economy, economyInit, economyStep, RES, RES_COUNT, economyPrice };
