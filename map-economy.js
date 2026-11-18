// owns: settlements, settlement markets, demand/goods/workforce fields, mines, factories and engine switch
// edit for: map-economy rates, field steps, settlement market rules, deposit unlock rules

const MAPE_R = 4;
const MAPE_RES = { COAL: 0, IRON: 1, GOODS: 2, CO2: 3 };
const MAPE_RES_NAME = ['coal', 'iron', 'goods', 'co2'];
const MAPE_ENGINE = { DIFFUSION: 0, SITES: 1 };
const MAPE_ENGINE_NAME = ['diffusion', 'sites'];
const MAPE_FIELD = { DEMAND: 0, GOODS: 1, POP: 2, WORKFORCE: 3 };
const MAPE_FACTORY_STATE = { GONE: 0, BUILDING: 1, ACTIVE: 2, IDLE: 3 };

// All rates are per sim-second; on 1x speed, 1 s = 1 real second = 1 storyline day.
const MAPE_SETTLE_TARGET = 0.02;
const MAPE_SETTLE_MIN = 1;
const MAPE_HIRE_MIN_POP = 2;
const MAPE_POP_CAP = 120;
const MAPE_POP_SEED_MIN = 8;
const MAPE_POP_SEED_MAX = 20;
const MAPE_FACTORY_CAP = 32;
const MAPE_MINE_CAP = 32;
const MAPE_MINE_SEED_STOCK = 18;
const MAPE_STORAGE_CAP = 96;
const MAPE_CO2_INIT = 0.4;
const MAPE_MONEY_PER_POP = 25;
const MAPE_MONEY_REGEN = 0.04;
const MAPE_SUPPLY_GOODS = 0.2;
const MAPE_VIEW_DEMAND_MAX = 6;
const MAPE_VIEW_GOODS_MAX = 20;
const MAPE_VIEW_WORK_MAX = 4;

const mape = {
	engine: MAPE_ENGINE.DIFFUSION,
	viewItem: MAPE_RES.GOODS,
	sitesReady: false,
	pop: null,
	demand: null,
	demandNext: null,
	goods: null,
	goodsNext: null,
	workforce: null,
	money: null,
	settleCells: null,
	settleCount: 0,
	totalPop: 0,
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
	initialGoods: 0,
	massIn: 0,
	massOut: 0,
	dissipated: 0
};

function mapeInit(mode) {
	const n = world.n;
	if (!mape.pop || mape.pop.length !== n) {
		mape.pop = new Float32Array(n);
		mape.demand = new Float32Array(MAPE_R * n);
		mape.demandNext = new Float32Array(MAPE_R * n);
		mape.goods = new Float32Array(MAPE_R * n);
		mape.goodsNext = new Float32Array(MAPE_R * n);
		mape.workforce = new Float32Array(n);
		mape.money = new Float32Array(n);
		mape.settleCells = new Uint16Array(n);
	}
	if (mode !== undefined) mape.engine = mode;
	mapeReset();
}

function mapeReset() {
	mape.pop.fill(0);
	mape.demand.fill(0);
	mape.demandNext.fill(0);
	mape.goods.fill(0);
	mape.goodsNext.fill(0);
	mape.workforce.fill(0);
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
	mape.massIn = 0;
	mape.massOut = 0;
	mape.dissipated = 0;
	// Isolated stream so re-seeding on engine switch never shifts world, sites or rivals.
	randomSeed(world.seed ^ 0x4a9e1c3d);
	mapeSeedSettlements();
	mapeSeedMines();
	mapeRebuildSettlements();
	mapeSeedPreview();
	mape.initialGoods = mapeGoodsTotal();
}

function mapeSetEngine(mode) {
	if (mode !== MAPE_ENGINE.DIFFUSION && mode !== MAPE_ENGINE.SITES) return false;
	mape.engine = mode;
	mapeReset();
	return true;
}

function mapeField(kind, r) {
	const n = world.n;
	if (kind === MAPE_FIELD.DEMAND) return mape.demand.subarray(r * n, (r + 1) * n);
	if (kind === MAPE_FIELD.GOODS) return mape.goods.subarray(r * n, (r + 1) * n);
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

function mapeSeedMines() {
	const n = world.n;
	for (let i = 0; i < SITE_CAP; i++) {
		if (sites.state[i] === SITE_STATE.GONE || sites.kind[i] !== SITE.DEPOSIT) continue;
		const mr = mapeResOf(sites.res[i]);
		if (mr !== MAPE_RES.COAL && mr !== MAPE_RES.IRON) continue;
		if (mape.mineCount >= MAPE_MINE_CAP) break;
		const m = mape.mineCount;
		const x = sites.x[i];
		const y = sites.y[i];
		mape.mineX[m] = x;
		mape.mineY[m] = y;
		mape.mineSite[m] = i;
		mape.mineRes[m] = mr;
		mape.mineUnlocked[m] = 0;
		mape.mineCount = m + 1;
		mapeAddStorage(x, y, i);
		mape.goods[mr * n + y * world.size + x] += MAPE_MINE_SEED_STOCK;
	}
}

function mapeAddRadial(field, offset, cx, cy, radius, peak, landOnly) {
	const size = world.size;
	const r2 = radius * radius;
	const span = Math.ceil(radius);
	const x0 = cx - span < 0 ? 0 : cx - span;
	const x1 = cx + span >= size ? size - 1 : cx + span;
	const y0 = cy - span < 0 ? 0 : cy - span;
	const y1 = cy + span >= size ? size - 1 : cy + span;
	for (let y = y0; y <= y1; y++) {
		const dy = y - cy;
		const row = y * size;
		for (let x = x0; x <= x1; x++) {
			const dx = x - cx;
			const d2 = dx * dx + dy * dy;
			if (d2 >= r2) continue;
			const i = row + x;
			if (landOnly && world.terrain[i] === TERRAIN.WATER) continue;
			field[offset + i] += peak * (1 - d2 / r2);
		}
	}
}

// Phase 0 seeds static gradients from real settlements, mines and forests so every view reads before P1 dynamics.
function mapeSeedPreview() {
	const n = world.n;
	const size = world.size;
	const demand = mape.demand;
	const goods = mape.goods;
	const work = mape.workforce;
	const co2Demand = MAPE_RES.CO2 * n;
	const co2Goods = MAPE_RES.CO2 * n;
	for (let k = 0; k < mape.settleCount; k++) {
		const idx = mape.settleCells[k];
		const x = idx % size;
		const y = (idx / size) | 0;
		const p = mape.pop[idx];
		mapeAddRadial(demand, MAPE_RES.GOODS * n, x, y, 7, p * 0.22, true);
		mapeAddRadial(demand, MAPE_RES.COAL * n, x, y, 6, p * 0.09, true);
		mapeAddRadial(demand, co2Demand, x, y, 6, p * 0.06, false);
		mapeAddRadial(work, 0, x, y, 3, p * 0.06, true);
	}
	for (let m = 0; m < mape.mineCount; m++) {
		const x = mape.mineX[m];
		const y = mape.mineY[m];
		mapeAddRadial(demand, mape.mineRes[m] * n, x, y, 9, -5.5, true);
		mapeAddRadial(work, 0, x, y, 5, 1.8, true);
	}
	for (let i = 0; i < n; i++) {
		const b = economy.biomass[i];
		goods[co2Goods + i] = world.terrain[i] === TERRAIN.WATER ? MAPE_CO2_INIT * 0.5 : MAPE_CO2_INIT * (0.6 + b * 0.8);
		if (world.terrain[i] === TERRAIN.FOREST) demand[co2Demand + i] -= 2.2 * b;
	}
}

function mapeRebuildSettlements() {
	const pop = mape.pop;
	const cells = mape.settleCells;
	let count = 0;
	let sum = 0;
	for (let i = 0; i < world.n; i++) {
		const p = pop[i];
		if (p <= 0) continue;
		sum += p;
		if (p < MAPE_SETTLE_MIN) continue;
		cells[count] = i;
		count++;
	}
	mape.settleCount = count;
	mape.totalPop = sum;
}

function mapeSyncLocks() {
	const size = world.size;
	const progress = investigation.progress;
	for (let m = 0; m < mape.mineCount; m++) {
		if (mape.mineUnlocked[m]) continue;
		const slot = mape.mineSite[m];
		if (sites.state[slot] !== SITE_STATE.VISIBLE) continue;
		if (sites.claim[slot] !== FACTION_PLAYER + 1) continue;
		const idx = mape.mineY[m] * size + mape.mineX[m];
		if (progress[idx] < 1) continue;
		if (territoryContest(idx, FACTION_PLAYER) < 1) continue;
		mape.mineUnlocked[m] = 1;
		eventsAdd('Unlocked ' + MAPE_RES_NAME[mape.mineRes[m]] + ' deposit at ' + mape.mineX[m] + ',' + mape.mineY[m] + ' for mining.');
	}
}

function mapeRecoverMoney(seconds) {
	const cells = mape.settleCells;
	const money = mape.money;
	const pop = mape.pop;
	const rate = MAPE_MONEY_REGEN * seconds;
	for (let k = 0; k < mape.settleCount; k++) {
		const idx = cells[k];
		const cap = pop[idx] * MAPE_MONEY_PER_POP;
		const cur = money[idx];
		if (cur >= cap) continue;
		const next = cur + (cap - cur) * rate;
		money[idx] = next > cap ? cap : next;
	}
}

function mapeStepDiffusion(seconds) {
	mapeSyncLocks();
	mapeRecoverMoney(seconds);
}

function mapeStepSites(seconds) {
	mapeSyncLocks();
	mapeRecoverMoney(seconds);
}

function mapeStep(seconds) {
	if (mape.engine === MAPE_ENGINE.SITES) mapeStepSites(seconds);
	else mapeStepDiffusion(seconds);
}

function mapeIsSettlement(idx) {
	return idx >= 0 && mape.pop[idx] >= MAPE_SETTLE_MIN;
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
	mape.pop[idx] -= 1;
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

if (typeof module !== 'undefined') {
	module.exports = {
		mape, mapeInit, mapeStep, mapeField, mapeSetEngine,
		MAPE_R, MAPE_RES, MAPE_RES_NAME, MAPE_ENGINE, MAPE_ENGINE_NAME, MAPE_FIELD
	};
}
