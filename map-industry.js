// owns: mine and factory registration, mine unlocks, storage markers and production
// edit for: industrial sources and stock output

const MAPE_MINE_RATE = 2.4;
const MAPE_MINE_MIN_WORKERS = 0.1;
const MAPE_WORKSHOP_RATE = 1.8;
const MAPE_WORKSHOP_STOCK = 8;

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

// Locked deposits hold zero mined stock and emit no surplus or job demand until discovered and unlocked.
function mapeSeedMines() {
	for (let i = 0; i < SITE_CAP; i++) {
		if (sites.state[i] === SITE_STATE.GONE || sites.kind[i] !== SITE.DEPOSIT) continue;
		mapeAddMine(i);
	}
}

function mapeAddMine(site) {
	const r = mapeResOf(sites.res[site]);
	if ((r !== MAPE_RES.COAL && r !== MAPE_RES.IRON) || mape.mineCount >= MAPE_MINE_CAP) return -1;
	const m = mape.mineCount++;
	const x = sites.x[site], y = sites.y[site];
	mape.mineX[m] = x;
	mape.mineY[m] = y;
	mape.mineSite[m] = site;
	mape.mineRes[m] = r;
	mape.mineUnlocked[m] = 0;
	mape.cellExport[y * world.size + x] |= MAPE_CELL_INDUSTRY;
	return m;
}

function mapeRemoveMine(m) {
	const site = mape.mineSite[m];
	for (let k = 0; k < mape.storageCount; k++) {
		if (mape.storageSite[k] !== site) continue;
		const last = --mape.storageCount;
		mape.storageX[k] = mape.storageX[last];
		mape.storageY[k] = mape.storageY[last];
		mape.storageSite[k] = mape.storageSite[last];
		break;
	}
	const last = --mape.mineCount;
	mape.mineX[m] = mape.mineX[last];
	mape.mineY[m] = mape.mineY[last];
	mape.mineSite[m] = mape.mineSite[last];
	mape.mineRes[m] = mape.mineRes[last];
	mape.mineUnlocked[m] = mape.mineUnlocked[last];
	sitesRemoveDeposit(site);
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

function mapeStepMines(dt) {
	const size = world.size;
	const pop = mape.pop;
	for (let m = 0; m < mape.mineCount; m++) {
		if (!mapeMineActive(m)) continue;
		const idx = mape.mineY[m] * size + mape.mineX[m];
		const workers = pop[idx];
		if (workers < MAPE_MINE_MIN_WORKERS) continue;
		const staff = workers >= MAPE_MINE_WORKERS ? 1 : workers / MAPE_MINE_WORKERS;
		const units = sitesExtract(mape.mineSite[m], MAPE_MINE_RATE * staff * dt, -1);
		mape.minedTotal += mapeProduceStock(mape.mineRes[m], idx, units);
	}
}

function mapeProduceStock(r, idx, units) {
	if (units <= 0) return 0;
	const p = r * world.n + idx;
	const before = mape.goods[p];
	mape.goods[p] += units;
	const added = mape.goods[p] - before;
	mape.massIn += added;
	return added;
}

function mapeWorkshopRoom(x, y) {
	for (let k = 0; k < mape.workshopCount; k++) {
		const i = mape.workshopCells[k];
		const dx = x - i % world.size, dy = y - ((i / world.size) | 0);
		if (dx * dx + dy * dy < 12 * 12) return false;
	}
	return true;
}

function mapeSeedWorkshops() {
	// Regional producers create haulage before the player's first mine opens.
	for (let k = 0; k < 400 && mape.workshopCount < MAPE_WORKSHOP_CAP; k++) {
		const i = worldRandomWalkable();
		const x = i % world.size, y = (i / world.size) | 0;
		if (mapeIsSettlement(i) || sitesAt(x, y) >= 0 || !mapeWorkshopRoom(x, y)) continue;
		const town = mapeNearestSettlement(x, y);
		if (town < 0) continue;
		const dx = x - town % world.size, dy = y - ((town / world.size) | 0);
		const d2 = dx * dx + dy * dy;
		if (d2 < 5 * 5 || d2 > 10 * 10) continue;
		mape.workshopCells[mape.workshopCount++] = i;
		mape.cellExport[i] |= MAPE_CELL_INDUSTRY;
		mape.goods[MAPE_RES.GOODS * world.n + i] = 3;
	}
}

function mapeStepWorkshops(dt) {
	const stock = mape.goodsView[MAPE_RES.GOODS];
	for (let k = 0; k < mape.workshopCount; k++) {
		const idx = mape.workshopCells[k];
		const units = Math.min(MAPE_WORKSHOP_STOCK - stock[idx], MAPE_WORKSHOP_RATE * landProductivity(idx) * dt);
		mapeProduceStock(MAPE_RES.GOODS, idx, units);
	}
}

if (typeof module !== 'undefined') {
	module.exports = { mapeAddStorage, mapeAddFactory, mapeSeedMines, mapeUnlockMine, mapeStepMines, mapeStepWorkshops };
}
