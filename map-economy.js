// owns: settlements, settlement markets, map-economy fields, mine/factory/storage pools and ledger
// edit for: map-economy data tables, seeding, deposit unlock rules, settlement market actions

const MAPE_R = 6;
const MAPE_RES = { COAL: 0, IRON: 1, GOODS: 2, LOGS: 3, FOOD: 4, CO2: 5 };
const MAPE_RES_NAME = ['coal', 'iron', 'goods', 'logs', 'food', 'co2'];
const MAPE_VIEW_ITEM = { POPULATION: 6, FRESH: 7, JOBS: 8, DEPLETED: 9, WASTE: 10, FOREST: 11, SOIL: 12, HUMIDITY: 13, WATER: 14 };
const MAPE_VIEW_ITEM_NAME = ['coal', 'iron', 'goods', 'logs', 'food', 'co2', 'population', 'fresh', 'jobs', 'depleted', 'waste', 'forest', 'soil moisture', 'air humidity', 'surface water'];
const MAPE_VIEW_ITEM_LABEL = ['coal', 'iron', 'goods', 'logs', 'food', 'co2', 'population', 'workforce · fresh', 'jobs', 'workforce · depleted', 'waste', 'forest cover', 'soil moisture', 'air humidity', 'surface water'];
const MAPE_VIEW_AMOUNT_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14];
const MAPE_VIEW_DEMAND_IDS = [0, 1, 2, 3, 4, 5, 8, 7, 9];
const MAPE_VIEW_AMOUNT_NAMES = MAPE_VIEW_AMOUNT_IDS.map(id => MAPE_VIEW_ITEM_NAME[id]);
const MAPE_VIEW_DEMAND_NAMES = MAPE_VIEW_DEMAND_IDS.map(id => MAPE_VIEW_ITEM_NAME[id]);
const MAPE_ENGINE = { DIFFUSION: 0, CATCHMENT: 1, QUEUE: 2, SITES: 3 };
const MAPE_ENGINE_NAME = ['Diffusion', 'A · Catchment', 'B · Queue', 'Sites'];
const MAPE_WORKFORCE_MODE = { RESIDENTS: 0, FLUID: 1 };
const MAPE_WORKFORCE_MODE_NAME = ['Residents', 'Fluid field'];
const MAPE_FIELD = { DEMAND: 0, GOODS: 1, POP: 2, WORKFORCE: 3 };
const MAPE_FACTORY_STATE = { GONE: 0, BUILDING: 1, ACTIVE: 2, IDLE: 3 };
const MAPE_FACTORY_STATE_NAME = ['gone', 'building', 'active', 'idle'];
const MAPE_FACTORY_KIND = { GENERAL: 0, SAWMILL: 1, CHARCOAL: 2, WOOD: 3, FARM: 4 };
const MAPE_FACTORY_KIND_NAME = ['Factory', 'Sawmill', 'Charcoal works', 'Wood works', 'Farm'];
const MAPE_CELL_INDUSTRY = 128;

// All rates are per sim-second; on 1x speed, 1 s = 1 real second = 1 storyline day.
const MAPE_SETTLE_TARGET = 0.02;
const MAPE_SETTLE_MIN = 3;
const MAPE_HIRE_MIN_POP = 4;
const MAPE_POP_CAP = 600;
const MAPE_POP_SEED_MIN = 8;
const MAPE_POP_SEED_MAX = 20;
const MAPE_FACTORY_CAP = 32;
const MAPE_MINE_CAP = 32;
const MAPE_STORAGE_CAP = 96;
const MAPE_WORKSHOP_CAP = 4;
const MAPE_NEED_GOODS = 0.03;
const MAPE_NEED_COAL = 0.02;
const MAPE_NEED_LOGS = 0.005;
const MAPE_NEED_FOOD = 0.03;
// Subsistence is what the land gives without trade. MAX is the ceiling at perfect ground;
// NEUTRAL is the intake a town needs before it grows, so own ground never reaches it: the seeded
// map holds its people on a deficit and imports are the only path to growth. Measured on the
// 82-town map: no supply 1165 -> 1165 over 600 s; mines and haulage grow the served towns +46.
const MAPE_SUBSIST_MAX = 0.62;
const MAPE_SUBSIST_NEUTRAL = 0.82;
const MAPE_SUBSIST_FAMINE = 0.15;
const MAPE_SETTLE_VALUE_MIN = 0.3;
// Waste per consumed goods; scaled with the 5x pop cap so the disturbance curve of a dense town is unchanged.
const MAPE_SETTLE_DISTURB = 0.00048;
const MAPE_GROWTH = 0.008;
const MAPE_DEATH = 0.015;
const MAPE_MIGRATE = 0.01;
const MAPE_MIGRATE_BIAS = 0.04;
const MAPE_SAT_SCALE = 4;
const MAPE_MINE_WORKERS = 12;
const MAPE_BUILD_WOOD_RATE = 0.10;     // logs/s consumed per builder
const MAPE_BUILD_SAWMILL_RATE = 0.02;  // biomass/s felled per builder on its own footprint
const MAPE_BUILD_LOG_RESERVE = 8;      // logs a region keeps back for its next build
const MAPE_FACTORY_BUILD_WORKERS = 8;
const MAPE_FACTORY_COAL = 0.5;
const MAPE_FACTORY_IRON = 0.5;
const MAPE_FACTORY_CO2 = 0.5;
const MAPE_FACTORY_WORKERS = 16;
const MAPE_FACTORY_BUILD_SEC = 20;
const MAPE_FACTORY_YIELD = 1.0;
const MAPE_FACTORY_DISTURB = 0.004;
const MAPE_FACTORY_BUILD_DISTURB = 0.0015;
const MAPE_WORKFORCE_PER_UNIT = 0.4;
const MAPE_CO2_INIT = 0.4;
const MAPE_MONEY_PER_POP = 25;
const MAPE_MONEY_REGEN = 0.04;
const MAPE_SUPPLY_GOODS = 0.2;
const MAPE_VIEW_POP_MAX = 200;
const MAPE_VIEW_JOB_MAX = 16;
const MAPE_VIEW_PULL_REF = 0.25;
const MAPE_VIEW_POOL_MAX = 40;

const mape = {
	engine: MAPE_ENGINE.CATCHMENT,
	workforceMode: MAPE_WORKFORCE_MODE.FLUID,
	surplusFeedback: true,
	localPressure: false,
	marketFill: 0,
	marketSignal: null,
	fixedResidents: false,
	scanOn: true,
	scanAcc: 0,
	viewItem: MAPE_RES.GOODS,
	viewItemDemand: MAPE_RES.GOODS,
	pop: null,
	popNext: null,
	demand: null,
	demandNext: null,
	goods: null,
	goodsNext: null,
	flowX: null,
	flowY: null,
	wfFlowX: null,
	wfFlowY: null,
	flowDt: 0,
	demandView: null,
	goodsView: null,
	workforce: null,
	workforceNext: null,
	wfFresh: null,
	wfFreshNext: null,
	wfDepleted: null,
	wfDepletedNext: null,
	wfRestPull: null,
	wfRestPullNext: null,
	wfMigration: null,
	wfBalance: null,
	wfWanted: null,
	fluidRested: 0,
	fluidTired: 0,
	fluidSpent: 0,
	fluidSpawned: 0,
	fluidGenerated: 0,
	usedGoods: null,
	usedCoal: null,
	usedFood: null,
	satGoods: null,
	satCoal: null,
	satFood: null,
	jobNeed: null,
	jobSlots: 0,
	cellExport: null,
	money: null,
	settleCells: null,
	settleCount: 0,
	totalPop: 0,
	initialPop: 0,
	popDelta: 0,
	factoryX: new Uint8Array(MAPE_FACTORY_CAP),
	factoryY: new Uint8Array(MAPE_FACTORY_CAP),
	factoryState: new Uint8Array(MAPE_FACTORY_CAP),
	factoryKind: new Uint8Array(MAPE_FACTORY_CAP),
	factoryProgress: new Float32Array(MAPE_FACTORY_CAP),
	factoryHarvestWork: new Float64Array(MAPE_FACTORY_CAP),
	factoryStarved: new Float32Array(MAPE_FACTORY_CAP),
	factoryCoal: new Float32Array(MAPE_FACTORY_CAP),
	factoryIron: new Float32Array(MAPE_FACTORY_CAP),
	factoryGoods: new Float32Array(MAPE_FACTORY_CAP),
	factoryCo2: new Float32Array(MAPE_FACTORY_CAP),
	factoryCrop: new Float32Array(MAPE_FACTORY_CAP),
	factoryClock: new Float32Array(MAPE_FACTORY_CAP),
	farmOwner: null,
	factoryCount: 0,
	mineX: new Uint8Array(MAPE_MINE_CAP),
	mineY: new Uint8Array(MAPE_MINE_CAP),
	mineSite: new Uint8Array(MAPE_MINE_CAP),
	mineRes: new Uint8Array(MAPE_MINE_CAP),
	mineUnlocked: new Uint8Array(MAPE_MINE_CAP),
	mineCount: 0,
	storageX: new Uint8Array(MAPE_STORAGE_CAP),
	storageY: new Uint8Array(MAPE_STORAGE_CAP),
	storageSite: new Uint8Array(MAPE_STORAGE_CAP),
	storageCount: 0,
	workshopCells: new Uint16Array(MAPE_WORKSHOP_CAP),
	workshopCount: 0,
	transportWork: 0,
	minedTotal: 0,
	initialGoods: 0,
	massIn: 0,
	massOut: 0,
	transit: 0,
	dissipated: 0
};

function mapeInit(mode, fixedResidents = false) {
	const n = world.n;
	if (!mape.pop || mape.pop.length !== n) {
		mape.pop = new Float64Array(n);
		mape.popNext = new Float64Array(n);
		mape.demand = new Float32Array(MAPE_R * n);
		mape.demandNext = new Float32Array(MAPE_R * n);
		mape.goods = new Float64Array(MAPE_R * n);
		mape.goodsNext = new Float64Array(MAPE_R * n);
		mape.marketSignal = new Float32Array(MAPE_R * n);
		mape.flowX = new Float32Array(MAPE_VIEW_ITEM.DEPLETED * n + n);
		mape.flowY = new Float32Array(MAPE_VIEW_ITEM.DEPLETED * n + n);
		mape.wfFlowX = [mape.flowX.subarray(MAPE_VIEW_ITEM.FRESH * n, (MAPE_VIEW_ITEM.FRESH + 1) * n), mape.flowX.subarray(MAPE_VIEW_ITEM.DEPLETED * n)];
		mape.wfFlowY = [mape.flowY.subarray(MAPE_VIEW_ITEM.FRESH * n, (MAPE_VIEW_ITEM.FRESH + 1) * n), mape.flowY.subarray(MAPE_VIEW_ITEM.DEPLETED * n)];
		mape.workforce = new Float32Array(n);
		mape.workforceNext = new Float32Array(n);
		mape.wfFresh = new Float32Array(n);
		mape.wfFreshNext = new Float32Array(n);
		mape.wfDepleted = new Float32Array(n);
		mape.wfDepletedNext = new Float32Array(n);
		mape.wfRestPull = new Float32Array(n);
		mape.wfRestPullNext = new Float32Array(n);
		mape.wfMigration = new Float32Array(n);
		mape.wfBalance = new Float32Array(n);
		mape.wfWanted = new Float32Array(n);
		mape.jobFilled = new Float32Array(n);
		mape.jobVacant = new Float32Array(n);
		mape.wfDonor = new Float32Array(n);
		mape.wfTaker = new Float32Array(n);
		mape.usedGoods = new Float64Array(n);
		mape.usedCoal = new Float64Array(n);
		mape.usedFood = new Float64Array(n);
		mape.satGoods = new Float32Array(n);
		mape.satCoal = new Float32Array(n);
		mape.satFood = new Float32Array(n);
		mape.farmOwner = new Uint8Array(n);
		mape.jobNeed = new Float32Array(n);
		mape.cellExport = new Uint8Array(n);
		mape.money = new Float32Array(n);
		mape.settleCells = new Uint16Array(n);
		mape.demandView = new Array(MAPE_R);
		mape.goodsView = new Array(MAPE_R);
		for (let r = 0; r < MAPE_R; r++) {
			mape.demandView[r] = mape.demand.subarray(r * n, (r + 1) * n);
			mape.goodsView[r] = mape.goods.subarray(r * n, (r + 1) * n);
		}
	}
	// Sites runs from setup only; runtime switching lands with the HUD toggle (Phase 5).
	if (mode === MAPE_ENGINE.SITES || mapeEngineAvailable(mode)) mape.engine = mode;
	mape.fixedResidents = fixedResidents;
	mapeReset();
	mapeMarketFlowPrepare();
	mapeSitesPrepare();
}

function mapeReset() {
	mape.pop.fill(0);
	mape.popNext.fill(0);
	mape.demand.fill(0);
	mape.demandNext.fill(0);
	mape.goods.fill(0);
	mape.goodsNext.fill(0);
	mape.marketSignal.fill(0);
	mape.flowX.fill(0);
	mape.flowY.fill(0);
	mape.flowDt = 0;
	mape.workforce.fill(0);
	mape.workforceNext.fill(0);
	for (const field of ['wfFresh', 'wfFreshNext', 'wfDepleted', 'wfDepletedNext', 'wfRestPull', 'wfRestPullNext', 'wfMigration', 'wfBalance', 'wfWanted', 'jobFilled', 'jobVacant', 'wfDonor', 'wfTaker']) mape[field].fill(0);
	for (const field of ['fluidRested', 'fluidTired', 'fluidSpent', 'fluidSpawned', 'fluidGenerated']) mape[field] = 0;
	for (const field of ['usedGoods', 'usedCoal', 'usedFood', 'satGoods', 'satCoal', 'satFood', 'farmOwner', 'jobNeed', 'cellExport', 'money',
		'factoryState', 'factoryKind', 'factoryProgress', 'factoryHarvestWork', 'factoryStarved', 'factoryCoal', 'factoryIron', 'factoryGoods', 'factoryCo2', 'factoryCrop', 'factoryClock', 'mineUnlocked']) mape[field].fill(0);
	mape.factoryCount = 0;
	mape.mineCount = 0;
	mape.storageCount = 0;
	mape.workshopCount = 0;
	mape.transportWork = 0;
	mape.minedTotal = 0;
	mape.popDelta = 0;
	mape.massIn = 0;
	mape.massOut = 0;
	mape.transit = 0;
	mape.dissipated = 0;
	mapeSitesReset();
}

function mapeSeedSurvey() {
	// Keep the settlement layout independent of random draws elsewhere in the game.
	const savedSeed = random.seed;
	randomSeed(world.seed ^ 0x4a9e1c3d);
	mapeSeedSettlements();
	mapeSeedMines();
	mapeSeedAtmosphere();
	mapeRebuildSettlements();
	mapeSeedWorkshops();
	random.seed = savedSeed;
}

function mapeFinishSetup(fill, warm) {
	if (mape.workforceMode === MAPE_WORKFORCE_MODE.FLUID) {
		// Day one opens with the workforce residents already are.
		const pop = mape.pop;
		const fresh = mape.wfFresh;
		for (let i = 0; i < world.n; i++) fresh[i] = pop[i];
	}
	mapeRebuildSettlements();
	mape.initialPop = mape.totalPop;
	mape.initialGoods = mapeGoodsTotal();
	mape.marketFill = fill;
	mapeResetMarketFields(fill);
	if (warm) mapeWarmDemand();
}

function mapeEngineAvailable(mode) {
	return mode === MAPE_ENGINE.DIFFUSION || mode === MAPE_ENGINE.CATCHMENT || mode === MAPE_ENGINE.QUEUE;
}

// Bounded 0–1 import-pull engines; Diffusion and Sites carry signed fields instead.
function mapeMarketEngine() {
	return mape.engine === MAPE_ENGINE.CATCHMENT || mape.engine === MAPE_ENGINE.QUEUE;
}

function mapeSetEngine(mode) {
	if (mode === mape.engine || !mapeEngineAvailable(mode)) return false;
	// Stock in flight must land before the routing changes or the ledger loses it.
	if (mape.engine === MAPE_ENGINE.SITES) mapeSitesSettle();
	mape.engine = mode;
	mapeResetMarketFields(mape.marketFill);
	mapeWarmDemand(true);
	return true;
}

function mapeSetWorkforceMode(mode) {
	if (mode === mape.workforceMode || (mode !== MAPE_WORKFORCE_MODE.RESIDENTS && mode !== MAPE_WORKFORCE_MODE.FLUID)) return false;
	// Residents ignore the pools, so their rest pull must not linger on the demand side.
	mape.workforceMode = mode;
	mape.wfMigration.fill(0);
	mape.wfBalance.fill(0);
	if (mode === MAPE_WORKFORCE_MODE.RESIDENTS) {
		mape.wfRestPull.fill(0);
		for (let k = 0; k < 2; k++) { mape.wfFlowX[k].fill(0); mape.wfFlowY[k].fill(0); }
	}
	return true;
}

function mapeWorkPresent(idx) {
	return mape.workforceMode === MAPE_WORKFORCE_MODE.FLUID ? mape.wfFresh[idx] : mape.pop[idx];
}

// Farm crews follow the field (one worker per farmland cell); every other site keeps a fixed crew.
function mapeFactoryWorkers(f) {
	const state = mape.factoryState[f];
	if (state === MAPE_FACTORY_STATE.BUILDING) return MAPE_FACTORY_BUILD_WORKERS;
	if (state === MAPE_FACTORY_STATE.ACTIVE) {
		return mape.factoryKind[f] === MAPE_FACTORY_KIND.FARM ? mapeFarmNeed(f) : MAPE_FACTORY_WORKERS;
	}
	// An idled plant is no longer a job site, so the workforce pull leaves it for live work.
	return 0;
}

function mapeField(kind, r) {
	if (kind === MAPE_FIELD.DEMAND) return mape.demandView[r];
	if (kind === MAPE_FIELD.GOODS) return mape.goodsView[r];
	if (kind === MAPE_FIELD.POP) return mape.pop;
	return mape.workforce;
}

function mapeResOf(res) {
	if (res === RES.FUEL) return MAPE_RES.COAL;
	if (res === RES.ORE) return MAPE_RES.IRON;
	if (res === RES.GOODS) return MAPE_RES.GOODS;
	if (res === RES.FOOD) return MAPE_RES.FOOD;
	return -1;
}

function mapePlaceSettlement(idx, p = randomRange(MAPE_POP_SEED_MIN, MAPE_POP_SEED_MAX), stock = true) {
	const n = world.n;
	mape.pop[idx] = p;
	mape.money[idx] = p * MAPE_MONEY_PER_POP;
	if (!stock) {
		const pCoal = MAPE_RES.COAL * n + idx;
		const pGoods = MAPE_RES.GOODS * n + idx;
		mape.marketSignal[pCoal] = mape.demand[pCoal];
		mape.marketSignal[pGoods] = mape.demand[pGoods];
		return;
	}
	mape.goods[MAPE_RES.GOODS * n + idx] = p * (0.18 + 0.1 * (idx % 4));
	mape.goods[MAPE_RES.COAL * n + idx] = p * 0.15;
}

function mapeFindStarterSettlement() {
	const sx = world.startX;
	const sy = world.startY;
	for (let r = 2; r <= 6; r++) {
		for (let dy = -r; dy <= r; dy++) {
			for (let dx = -r; dx <= r; dx++) {
				if (Math.max(dx < 0 ? -dx : dx, dy < 0 ? -dy : dy) !== r) continue;
				const x = sx + dx;
				const y = sy + dy;
				if (!worldWalkableAt(x, y) || sitesAt(x, y) >= 0) continue;
				return y * world.size + x;
			}
		}
	}
	return -1;
}

function mapeSeedSettlements() {
	const target = Math.round(world.n * MAPE_SETTLE_TARGET);
	let placed = 0;
	const starter = mapeFindStarterSettlement();
	if (starter >= 0) {
		mapePlaceSettlement(starter);
		placed = 1;
	}
	// Settle the ground that can carry a town: swamp interior and bare desert cannot farm.
	const maxTries = target * 40;
	for (let t = 0; t < maxTries && placed < target; t++) {
		const x = randomInt(world.size);
		const y = randomInt(world.size);
		if (!worldWalkableAt(x, y)) continue;
		const idx = y * world.size + x;
		if (mape.pop[idx] > 0 || sitesAt(x, y) >= 0) continue;
		if (x === world.startX && y === world.startY) continue;
		if (world.settleValue[idx] < MAPE_SETTLE_VALUE_MIN) continue;
		mapePlaceSettlement(idx);
		placed++;
	}
}

function mapeSeedAtmosphere() {
	const n = world.n;
	const off = MAPE_RES.CO2 * n;
	const goods = mape.goods;
	for (let i = 0; i < n; i++) goods[off + i] = MAPE_CO2_INIT;
}

function mapeRebuildSettlements() {
	const pop = mape.pop;
	const exp = mape.cellExport;
	const cells = mape.settleCells;
	let count = 0;
	let sum = 0;
	for (let i = 0; i < world.n; i++) {
		const p = pop[i];
		if (p <= 0) continue;
		sum += p;
		if (p < MAPE_SETTLE_MIN || (exp[i] & MAPE_CELL_INDUSTRY) !== 0) continue;
		cells[count] = i;
		count++;
	}
	mape.settleCount = count;
	mape.totalPop = sum;
}

function mapeRecoverMoney(seconds) {
	const cells = mape.settleCells;
	const money = mape.money;
	const pop = mape.pop;
	let rate = MAPE_MONEY_REGEN * seconds;
	if (rate > 1) rate = 1;
	for (let k = 0; k < mape.settleCount; k++) {
		const idx = cells[k];
		const cap = pop[idx] * MAPE_MONEY_PER_POP;
		const cur = money[idx];
		if (cur >= cap) continue;
		const next = cur + (cap - cur) * rate;
		money[idx] = next > cap ? cap : next;
	}
}

function mapeStep(seconds) {
	if (seconds > 0) {
		if (mape.engine === MAPE_ENGINE.SITES) mapeStepSites(seconds);
		else mapeStepDiffusion(seconds);
	}
	mapeScanStep(seconds);
}

function mapeIsIndustry(idx) {
	return idx >= 0 && (mape.cellExport[idx] & MAPE_CELL_INDUSTRY) !== 0;
}

function mapeIsSettlement(idx) {
	return idx >= 0 && mape.pop[idx] >= MAPE_SETTLE_MIN && !mapeIsIndustry(idx);
}

function mapeNearestSettlement(x, y) {
	const size = world.size;
	const cells = mape.settleCells;
	let best = -1;
	let bestD = Infinity;
	for (let k = 0; k < mape.settleCount; k++) {
		const idx = cells[k];
		const dx = (idx % size) - x;
		const dy = ((idx / size) | 0) - y;
		const d = dx * dx + dy * dy;
		if (d >= bestD) continue;
		bestD = d;
		best = idx;
	}
	return best;
}

function mapePrice(res, idx) {
	const n = world.n;
	const mr = mapeResOf(res);
	const slot = (mr >= 0 ? mr : MAPE_RES.GOODS) * n + idx;
	const stock = mape.goods[slot];
	let factor = 1 + mape.demand[slot] * 0.05;
	if (factor < 0.5) factor = 0.5;
	if (factor > 2) factor = 2;
	const base = RES_BASE_VALUE[res];
	let price = base * RES_REF_STOCK[res] / (stock + 1) * factor;
	if (price < base * 0.35) price = base * 0.35;
	if (price > base * 3) price = base * 3;
	return price;
}

function mapeSell(res, idx) {
	if (!mapeIsSettlement(idx)) return 0;
	const have = economy.inventory[res];
	if (have < 0.01) return 0;
	const price = mapePrice(res, idx);
	const units = Math.min(have, mape.money[idx] / price);
	if (units < 0.05) return 0;
	const revenue = units * price;
	economy.inventory[res] = have - units;
	mape.money[idx] -= revenue;
	const mr = mapeResOf(res);
	if (mr >= 0) {
		const slot = mr * world.n + idx;
		const before = mape.goods[slot];
		mape.goods[slot] = before + units;
		mape.massIn += mape.goods[slot] - before;
	}
	return revenue;
}

function mapeAcceptItem(idx) {
	if (!mapeIsSettlement(idx) || mape.money[idx] < ITEM_VALUE) return 0;
	mape.money[idx] -= ITEM_VALUE;
	return ITEM_VALUE;
}

function mapeCanBuySupplies(idx, units) {
	if (!mapeIsSettlement(idx)) return false;
	return mape.goods[MAPE_RES.GOODS * world.n + idx] >= units * MAPE_SUPPLY_GOODS;
}

function mapeBuySupplies(idx, units) {
	if (!mapeCanBuySupplies(idx, units)) return -1;
	const slot = MAPE_RES.GOODS * world.n + idx;
	const before = mape.goods[slot];
	mape.goods[slot] = before - units * MAPE_SUPPLY_GOODS;
	mape.massOut += before - mape.goods[slot];
	const cost = units * SUPPLY_PRICE;
	mape.money[idx] += cost;
	return cost;
}

function mapeCanHire(idx) {
	return mapeIsSettlement(idx) && mape.pop[idx] >= MAPE_HIRE_MIN_POP;
}

function mapeRecruit(idx, fee) {
	if (!mapeCanHire(idx)) return false;
	const before = mape.pop[idx];
	mape.pop[idx] = before - 1;
	mape.popDelta -= before - mape.pop[idx];
	mape.money[idx] += fee;
	mapeRebuildSettlements();
	return true;
}

function mapeGoodsTotal() {
	const goods = mape.goods;
	let sum = 0;
	for (let i = 0; i < goods.length; i++) sum += goods[i];
	return sum;
}

function mapeLedgerResidual() {
	// Transit is material on the map but in no goods slice; without it every shipment reads as loss.
	return (mapeGoodsTotal() + mape.massOut + mape.transit) - (mape.initialGoods + mape.massIn);
}

function mapePopResidual() {
	return mape.totalPop - (mape.initialPop + mape.popDelta);
}

if (typeof module !== 'undefined') {
	module.exports = {
		mape, mapeInit, mapeStep, mapeField, mapeSetEngine, mapeEngineAvailable, mapeMarketEngine, mapeSetWorkforceMode, mapeWorkPresent,
		mapeFinishSetup, mapeSeedSurvey, mapeLedgerResidual, mapePopResidual, MAPE_R, MAPE_RES, MAPE_RES_NAME, MAPE_ENGINE, MAPE_ENGINE_NAME, MAPE_FIELD, MAPE_FACTORY_STATE, MAPE_FACTORY_STATE_NAME, MAPE_FACTORY_KIND, MAPE_FACTORY_KIND_NAME, MAPE_WORKFORCE_MODE, MAPE_WORKFORCE_MODE_NAME, MAPE_FACTORY_WORKERS, MAPE_FACTORY_BUILD_WORKERS, MAPE_FACTORY_BUILD_SEC,
		MAPE_VIEW_ITEM, MAPE_VIEW_ITEM_NAME, MAPE_VIEW_ITEM_LABEL, MAPE_VIEW_AMOUNT_IDS, MAPE_VIEW_DEMAND_IDS, MAPE_VIEW_AMOUNT_NAMES, MAPE_VIEW_DEMAND_NAMES,
		MAPE_VIEW_POP_MAX, MAPE_VIEW_JOB_MAX, MAPE_VIEW_PULL_REF, MAPE_VIEW_POOL_MAX
	};
}
