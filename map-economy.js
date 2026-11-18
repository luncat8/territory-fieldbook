// owns: settlements, settlement markets, map-economy fields, mine/factory/storage pools and ledger
// edit for: map-economy data tables, seeding, deposit unlock rules, settlement market actions

const MAPE_R = 4;
const MAPE_RES = { COAL: 0, IRON: 1, GOODS: 2, CO2: 3 };
const MAPE_RES_NAME = ['coal', 'iron', 'goods', 'co2'];
const MAPE_ENGINE = { DIFFUSION: 0, CATCHMENT: 1, QUEUE: 2, SITES: 3 };
const MAPE_ENGINE_NAME = ['Diffusion', 'A · Catchment', 'B · Queue', 'Sites'];
const MAPE_FIELD = { DEMAND: 0, GOODS: 1, POP: 2, WORKFORCE: 3 };
const MAPE_FACTORY_STATE = { GONE: 0, BUILDING: 1, ACTIVE: 2, IDLE: 3 };
const MAPE_CELL_INDUSTRY = 128;

// All rates are per sim-second; on 1x speed, 1 s = 1 real second = 1 storyline day.
const MAPE_SETTLE_TARGET = 0.02;
const MAPE_SETTLE_MIN = 3;
const MAPE_HIRE_MIN_POP = 4;
const MAPE_POP_CAP = 120;
const MAPE_POP_SEED_MIN = 8;
const MAPE_POP_SEED_MAX = 20;
const MAPE_FACTORY_CAP = 32;
const MAPE_MINE_CAP = 32;
const MAPE_STORAGE_CAP = 96;
const MAPE_NEED_GOODS = 0.02;
const MAPE_NEED_COAL = 0.005;
const MAPE_MINE_RATE = 0.6;
const MAPE_MINE_WORKERS = 6;
const MAPE_FACTORY_BUILD_IRON = 0.2;
const MAPE_FACTORY_BUILD_WORKERS = 4;
const MAPE_FACTORY_COAL = 0.5;
const MAPE_FACTORY_IRON = 0.5;
const MAPE_FACTORY_CO2 = 0.5;
const MAPE_FACTORY_WORKERS = 8;
const MAPE_WORKFORCE_PER_UNIT = 0.4;
const MAPE_CO2_INIT = 0.4;
const MAPE_FOREST_CO2 = 0.004;
const MAPE_MONEY_PER_POP = 25;
const MAPE_MONEY_REGEN = 0.04;
const MAPE_SUPPLY_GOODS = 0.2;
const MAPE_VIEW_DEMAND_MAX = 6;
const MAPE_VIEW_MARKET_DEMAND_MAX = 1.5;
const MAPE_VIEW_GOODS_MAX = 20;
const MAPE_VIEW_WORK_MAX = 4;

const mape = {
	engine: MAPE_ENGINE.DIFFUSION,
	surplusFeedback: true,
	viewItem: MAPE_RES.GOODS,
	pop: null,
	popNext: null,
	demand: null,
	demandNext: null,
	goods: null,
	goodsNext: null,
	demandView: null,
	goodsView: null,
	workforce: null,
	workforceNext: null,
	jobNeed: null,
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
	factoryProgress: new Float32Array(MAPE_FACTORY_CAP),
	factoryStarved: new Float32Array(MAPE_FACTORY_CAP),
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
	scanTimer: 0,
	transportWork: 0,
	minedTotal: 0,
	initialGoods: 0,
	massIn: 0,
	massOut: 0,
	dissipated: 0
};

function mapeInit(mode) {
	const n = world.n;
	if (!mape.pop || mape.pop.length !== n) {
		mape.pop = new Float32Array(n);
		mape.popNext = new Float32Array(n);
		mape.demand = new Float32Array(MAPE_R * n);
		mape.demandNext = new Float32Array(MAPE_R * n);
		mape.goods = new Float32Array(MAPE_R * n);
		mape.goodsNext = new Float32Array(MAPE_R * n);
		mape.workforce = new Float32Array(n);
		mape.workforceNext = new Float32Array(n);
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
	if (mapeEngineAvailable(mode)) mape.engine = mode;
	mapeReset();
}

function mapeReset() {
	mape.pop.fill(0);
	mape.popNext.fill(0);
	mape.demand.fill(0);
	mape.demandNext.fill(0);
	mape.goods.fill(0);
	mape.goodsNext.fill(0);
	mape.workforce.fill(0);
	mape.workforceNext.fill(0);
	mape.jobNeed.fill(0);
	mape.cellExport.fill(0);
	mape.money.fill(0);
	mape.factoryState.fill(MAPE_FACTORY_STATE.GONE);
	mape.factoryProgress.fill(0);
	mape.factoryStarved.fill(0);
	mape.factoryCount = 0;
	mape.mineUnlocked.fill(0);
	mape.mineCount = 0;
	mape.storageCount = 0;
	mape.scanTimer = 0;
	mape.transportWork = 0;
	mape.minedTotal = 0;
	mape.popDelta = 0;
	mape.massIn = 0;
	mape.massOut = 0;
	mape.dissipated = 0;
	// Keep the settlement layout independent of random draws elsewhere in the game.
	const savedSeed = random.seed;
	randomSeed(world.seed ^ 0x4a9e1c3d);
	mapeSeedSettlements();
	mapeSeedMines();
	mapeSeedAtmosphere();
	random.seed = savedSeed;
	mapeRebuildSettlements();
	mape.initialPop = mape.totalPop;
	mape.initialGoods = mapeGoodsTotal();
	mapeMarketFlowPrepare(true);
	mapeWarmDemand();
}

function mapeEngineAvailable(mode) {
	return mode === MAPE_ENGINE.DIFFUSION || mode === MAPE_ENGINE.CATCHMENT || mode === MAPE_ENGINE.QUEUE;
}

function mapeSetEngine(mode) {
	if (mode === mape.engine || !mapeEngineAvailable(mode)) return false;
	mape.engine = mode;
	mapeMarketFlowPrepare();
	for (let r = 0; r < MAPE_R; r++) if (mapeIsMarketItem(r)) mape.demandView[r].fill(0);
	mapeWarmDemand(true);
	return true;
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
	return -1;
}

function mapeAddStorage(x, y, site) {
	for (let k = 0; k < mape.storageCount; k++) {
		if (mape.storageX[k] === x && mape.storageY[k] === y) return k;
	}
	if (mape.storageCount >= MAPE_STORAGE_CAP) return -1;
	const slot = mape.storageCount;
	mape.storageX[slot] = x;
	mape.storageY[slot] = y;
	mape.storageSite[slot] = site === undefined ? 255 : site;
	mape.storageCount = slot + 1;
	return slot;
}

function mapeAddFactory(x, y, state) {
	if (mape.factoryCount >= MAPE_FACTORY_CAP) return -1;
	const f = mape.factoryCount;
	mape.factoryX[f] = x;
	mape.factoryY[f] = y;
	mape.factoryState[f] = state;
	mape.factoryProgress[f] = state === MAPE_FACTORY_STATE.ACTIVE ? 1 : 0;
	mape.factoryStarved[f] = 0;
	mape.factoryCount = f + 1;
	mape.cellExport[y * world.size + x] |= MAPE_CELL_INDUSTRY;
	mapeAddStorage(x, y, 255);
	return f;
}

function mapePlaceSettlement(idx) {
	const n = world.n;
	const p = randomRange(MAPE_POP_SEED_MIN, MAPE_POP_SEED_MAX);
	mape.pop[idx] = p;
	mape.money[idx] = p * MAPE_MONEY_PER_POP;
	mape.goods[MAPE_RES.GOODS * n + idx] = p * 0.5;
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
	const maxTries = target * 20;
	for (let t = 0; t < maxTries && placed < target; t++) {
		const x = randomInt(world.size);
		const y = randomInt(world.size);
		if (!worldWalkableAt(x, y)) continue;
		const idx = y * world.size + x;
		if (mape.pop[idx] > 0 || sitesAt(x, y) >= 0) continue;
		if (x === world.startX && y === world.startY) continue;
		mapePlaceSettlement(idx);
		placed++;
	}
}

// Locked deposits hold zero mined stock and emit no surplus or job demand until discovered and unlocked.
function mapeSeedMines() {
	for (let i = 0; i < SITE_CAP; i++) {
		if (sites.state[i] === SITE_STATE.GONE || sites.kind[i] !== SITE.DEPOSIT) continue;
		const mr = mapeResOf(sites.res[i]);
		if (mr !== MAPE_RES.COAL && mr !== MAPE_RES.IRON) continue;
		if (mape.mineCount >= MAPE_MINE_CAP) break;
		const m = mape.mineCount;
		mape.mineX[m] = sites.x[i];
		mape.mineY[m] = sites.y[i];
		mape.mineSite[m] = i;
		mape.mineRes[m] = mr;
		mape.mineUnlocked[m] = 0;
		mape.mineCount = m + 1;
		mape.cellExport[sites.y[i] * world.size + sites.x[i]] |= MAPE_CELL_INDUSTRY;
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

function mapeUnlockMine(m) {
	if (m < 0 || m >= mape.mineCount || mape.mineUnlocked[m]) return false;
	const x = mape.mineX[m];
	const y = mape.mineY[m];
	mape.mineUnlocked[m] = 1;
	mapeAddStorage(x, y, mape.mineSite[m]);
	eventsAdd('Unlocked ' + MAPE_RES_NAME[mape.mineRes[m]] + ' deposit at ' + x + ',' + y + ' — recruiting workers.');
	return true;
}

function mapeMineActive(m) {
	if (!mape.mineUnlocked[m]) return false;
	const slot = mape.mineSite[m];
	const state = sites.state[slot];
	if (state === SITE_STATE.DONE || state === SITE_STATE.GONE || sites.stock[slot] <= 0) return false;
	return territoryContest(mape.mineY[m] * world.size + mape.mineX[m], FACTION_PLAYER) >= 1;
}

function mapeSyncLocks() {
	const size = world.size;
	const progress = investigation.progress;
	const control = territory.control;
	for (let m = 0; m < mape.mineCount; m++) {
		if (mape.mineUnlocked[m]) continue;
		const slot = mape.mineSite[m];
		if (sites.state[slot] !== SITE_STATE.VISIBLE) continue;
		const idx = mape.mineY[m] * size + mape.mineX[m];
		if (progress[idx] < 1) continue;
		if (sites.claim[slot] !== FACTION_PLAYER + 1 && control[idx] !== FACTION_PLAYER) continue;
		if (territoryContest(idx, FACTION_PLAYER) < 1) continue;
		mapeUnlockMine(m);
	}
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
	if (seconds > 0) mapeStepDiffusion(seconds);
}

function mapeIsSettlement(idx) {
	return idx >= 0 && mape.pop[idx] >= MAPE_SETTLE_MIN && (mape.cellExport[idx] & MAPE_CELL_INDUSTRY) === 0;
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

function mapeMineAt(x, y) {
	for (let m = 0; m < mape.mineCount; m++) {
		if (mape.mineX[m] === x && mape.mineY[m] === y) return m;
	}
	return -1;
}

function mapeDepositState(x, y) {
	const m = mapeMineAt(x, y);
	if (m < 0) return -1;
	if (!mape.mineUnlocked[m]) return 0;
	const slot = mape.mineSite[m];
	if (sites.stock[slot] <= 0 || sites.state[slot] === SITE_STATE.DONE) return 3;
	return territoryContest(y * world.size + x, FACTION_PLAYER) >= 1 ? 1 : 2;
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
	return (mapeGoodsTotal() + mape.massOut) - (mape.initialGoods + mape.massIn);
}

function mapePopResidual() {
	return mape.totalPop - (mape.initialPop + mape.popDelta);
}

if (typeof module !== 'undefined') {
	module.exports = {
		mape, mapeInit, mapeStep, mapeField, mapeSetEngine, mapeEngineAvailable, mapeAddStorage, mapeAddFactory, mapeUnlockMine,
		mapeLedgerResidual, mapePopResidual, MAPE_R, MAPE_RES, MAPE_RES_NAME, MAPE_ENGINE, MAPE_ENGINE_NAME, MAPE_FIELD
	};
}
