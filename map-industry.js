// owns: mine and factory registration, mine unlocks, storage markers and production
// edit for: industrial sources and stock output

const MAPE_MINE_RATE = 2.4;
const MAPE_MINE_MIN_WORKERS = 0.1;
const MAPE_MINE_WASTE = 0.0016;
const MAPE_FACTORY_IDLE_SEC = 40;
const MAPE_WORKSHOP_RATE = 0.9;
const MAPE_WORKSHOP_STOCK = 4;
const MAPE_SAWMILL_RATE = 1.1;
const MAPE_SAWMILL_SEARCH_SEC = 1;
// Half-cell cuts at twice the cadence: same logs/s, smaller haul bursts, and no bald cells.
const MAPE_SAWMILL_CUT_SHARE = 0.5;
const MAPE_SAWMILL_SEARCH_RADIUS = 2;
const MAPE_SAWMILL_MIN_FOREST = 0.08;
const MAPE_SAWMILL_MIN_PULL = 0.015;
const MAPE_SAWMILL_FOREST_PER_LOG = 0.025;
const MAPE_FORESTRY_INPUT = 0.55;
const MAPE_CHARCOAL_YIELD = 0.8;
const MAPE_CHARCOAL_CO2 = 0.2;
const MAPE_WOOD_YIELD = 1.0;

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

function mapeAddFactory(x, y, state, kind = MAPE_FACTORY_KIND.GENERAL) {
	if (mape.factoryCount >= MAPE_FACTORY_CAP) return -1;
	const f = mape.factoryCount;
	mape.factoryX[f] = x;
	mape.factoryY[f] = y;
	mape.factoryState[f] = state;
	mape.factoryKind[f] = kind;
	mape.factoryProgress[f] = state === MAPE_FACTORY_STATE.ACTIVE ? 1 : 0;
	mape.factoryStarved[f] = 0;
	mape.factoryHarvestWork[f] = 0;
	mape.factoryCoal[f] = 0;
	mape.factoryIron[f] = 0;
	mape.factoryGoods[f] = 0;
	mape.factoryCo2[f] = 0;
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
	for (let m = 0; m < mape.mineCount; m++) {
		if (!mapeMineActive(m)) continue;
		const idx = mape.mineY[m] * size + mape.mineX[m];
		const workers = mapeWorkPresent(idx);
		if (workers < MAPE_MINE_MIN_WORKERS) continue;
		const staff = workers >= MAPE_MINE_WORKERS ? 1 : workers / MAPE_MINE_WORKERS;
		const units = sitesExtract(mape.mineSite[m], MAPE_MINE_RATE * staff * dt, -1);
		if (units <= 0) continue;
		mape.minedTotal += mapeProduceStock(mape.mineRes[m], idx, units);
		// Spoil heaps land beside the shaft; the pit itself keeps the productivity its yield reads.
		landDisturbRing(idx, MAPE_MINE_WASTE * dt);
	}
}

function mapeFactoryAt(x, y) {
	for (let f = 0; f < mape.factoryCount; f++) {
		if (mape.factoryX[f] === x && mape.factoryY[f] === y && mape.factoryState[f] !== MAPE_FACTORY_STATE.GONE) return f;
	}
	return -1;
}

function mapeStepFactoryBuild(f, idx, dt, staff) {
	const n = world.n;
	mape.factoryCoal[f] = mape.factoryIron[f] = mape.factoryGoods[f] = mape.factoryCo2[f] = 0;
	const kind = mape.factoryKind[f];
	// Wood is the currency of construction: logs hauled to the site, or raw forest
	// on a sawmill's own footprint (forest is both its material and its working area).
	let rate = MAPE_BUILD_WOOD_RATE;
	let paid = false;
	if (kind === MAPE_FACTORY_KIND.SAWMILL) {
		rate = MAPE_BUILD_SAWMILL_RATE;
		const want = rate * staff * dt;
		if (staff > 0 && economy.biomass[idx] >= want) {
			economy.biomass[idx] -= want;
			paid = true;
		}
	} else {
		const slot = MAPE_RES.LOGS * n + idx;
		const want = rate * staff * dt;
		if (staff > 0 && mape.goods[slot] >= want) {
			mape.goods[slot] -= want;
			mape.massOut += want;
			paid = true;
		}
	}
	if (paid) {
		mape.factoryProgress[f] += staff * dt / MAPE_FACTORY_BUILD_SEC;
		mape.factoryIron[f] = rate * staff;
		landDisturbAround(idx, MAPE_FACTORY_BUILD_DISTURB * staff * dt);
	} else {
		mape.factoryStarved[f] += dt;
		mape.factoryIron[f] = 0;
	}
	if (mape.factoryProgress[f] >= 1) {
		mape.factoryProgress[f] = 1;
		mape.factoryState[f] = MAPE_FACTORY_STATE.ACTIVE;
		eventsAdd(MAPE_FACTORY_KIND_NAME[kind] + ' at ' + mape.factoryX[f] + ',' + mape.factoryY[f] + ' is online.');
	}
}

function mapeStepFactories(dt) {
	const size = world.size;
	const n = world.n;
	const goods = mape.goods;
	const coalOff = MAPE_RES.COAL * n;
	const ironOff = MAPE_RES.IRON * n;
	const goodsOff = MAPE_RES.GOODS * n;
	const co2Off = MAPE_RES.CO2 * n;
	for (let f = 0; f < mape.factoryCount; f++) {
		const st = mape.factoryState[f];
		if (st === MAPE_FACTORY_STATE.GONE) continue;
		const idx = mape.factoryY[f] * size + mape.factoryX[f];
		const need = mapeFactoryWorkers(st);
		const staff = need > 0 ? Math.min(1, mapeWorkPresent(idx) / need) : 0;
		const kind = mape.factoryKind[f];
		if (st === MAPE_FACTORY_STATE.BUILDING) {
			mapeStepFactoryBuild(f, idx, dt, staff);
			continue;
		}
		if (st === MAPE_FACTORY_STATE.IDLE) {
			// Not a job site: the pull left. Wake on the first tick that has inputs on hand.
			if (goods[coalOff + idx] > 0 && goods[ironOff + idx] > 0) {
				mape.factoryState[f] = MAPE_FACTORY_STATE.ACTIVE;
				mape.factoryStarved[f] = 0;
			}
			mape.factoryCoal[f] = mape.factoryIron[f] = mape.factoryGoods[f] = mape.factoryCo2[f] = 0;
			continue;
		}
		if (staff <= 0) {
			mape.factoryCoal[f] = mape.factoryIron[f] = mape.factoryGoods[f] = mape.factoryCo2[f] = 0;
			continue;
		}
		if (kind !== MAPE_FACTORY_KIND.GENERAL) {
			mapeStepForestryFactory(f, idx, dt, staff);
			continue;
		}
		const coalWant = MAPE_FACTORY_COAL * staff * dt;
		const ironWant = MAPE_FACTORY_IRON * staff * dt;
		const k = Math.min(1, goods[coalOff + idx] / coalWant, goods[ironOff + idx] / ironWant);
		if (k < 1) mape.factoryStarved[f] += dt;
		// An idled plant stops counting as a job site, so the workforce pull moves on to live work.
		if (mape.factoryStarved[f] >= MAPE_FACTORY_IDLE_SEC) mape.factoryState[f] = MAPE_FACTORY_STATE.IDLE;
		if (k <= 0) {
			mape.factoryCoal[f] = mape.factoryIron[f] = mape.factoryGoods[f] = mape.factoryCo2[f] = 0;
			continue;
		}
		if (mape.factoryState[f] === MAPE_FACTORY_STATE.IDLE) {
			mape.factoryState[f] = MAPE_FACTORY_STATE.ACTIVE;
			mape.factoryStarved[f] = 0;
		}
		goods[coalOff + idx] -= coalWant * k;
		goods[ironOff + idx] -= ironWant * k;
		mape.massOut += coalWant * k + ironWant * k;
		const made = MAPE_FACTORY_YIELD * staff * k * dt;
		const co2 = MAPE_FACTORY_CO2 * staff * k * dt;
		const before = goods[goodsOff + idx];
		goods[goodsOff + idx] = before + made;
		goods[co2Off + idx] += co2;
		mape.massIn += made + co2;
		landDisturbAround(idx, MAPE_FACTORY_DISTURB * staff * k * dt);
		mape.factoryCoal[f] = MAPE_FACTORY_COAL * staff * k;
		mape.factoryIron[f] = MAPE_FACTORY_IRON * staff * k;
		mape.factoryGoods[f] = MAPE_FACTORY_YIELD * staff * k;
		mape.factoryCo2[f] = MAPE_FACTORY_CO2 * staff * k;
	}
}

// The centered square is shared by site scoring and harvest sampling.
// Out-of-map and water cells lower cover rather than shrinking the denominator.
function mapeForestCover(x, y) {
	const size = world.size;
	const radius = MAPE_SAWMILL_SEARCH_RADIUS;
	let sum = 0;
	let count = 0;
	for (let dy = -radius; dy <= radius; dy++) {
		for (let dx = -radius; dx <= radius; dx++) {
			const cx = x + dx;
			const cy = y + dy;
			count++;
			if (cx < 0 || cy < 0 || cx >= size || cy >= size) continue;
			const idx = cy * size + cx;
			if (world.terrain[idx] === TERRAIN.WATER) continue;
			sum += Math.min(1, economy.biomass[idx]);
		}
	}
	return count > 0 ? sum / count : 0;
}

function mapeSampleForestCutCell(x, y) {
	// A miss costs search effort; never scan the rest of the patch.
	const size = world.size;
	const radius = MAPE_SAWMILL_SEARCH_RADIUS;
	const width = radius * 2 + 1;
	const sample = randomInt(width * width);
	const cx = x + sample % width - radius;
	const cy = y + (sample / width | 0) - radius;
	if (cx < 0 || cy < 0 || cx >= size || cy >= size) return -1;
	const idx = cy * size + cx;
	if (world.terrain[idx] === TERRAIN.WATER || economy.biomass[idx] < MAPE_SAWMILL_MIN_FOREST ||
		mape.demandView[MAPE_RES.LOGS][idx] < MAPE_SAWMILL_MIN_PULL) return -1;
	return idx;
}

function mapeStepForestryFactory(f, idx, dt, staff) {
	mape.factoryCoal[f] = mape.factoryIron[f] = mape.factoryGoods[f] = mape.factoryCo2[f] = 0;
	if (staff <= 0 || dt <= 0) return;
	const kind = mape.factoryKind[f];
	if (kind === MAPE_FACTORY_KIND.SAWMILL) {
		// Charge each cut as future work, rather than multiplying output by tick frequency.
		const effort = staff * landProductivity(idx) * dt;
		if (effort <= 0) return;
		mape.factoryHarvestWork[f] -= effort;
		if (mape.factoryHarvestWork[f] > 0) return;
		mape.factoryHarvestWork[f] += MAPE_SAWMILL_SEARCH_SEC;
		const cell = mapeSampleForestCutCell(mape.factoryX[f], mape.factoryY[f]);
		if (cell < 0) return;
		const pull = mape.demandView[MAPE_RES.LOGS][cell];
		const demandScale = Math.min(1, pull / (MAPE_SAWMILL_MIN_PULL * 2));
		const cover = mapeForestCover(mape.factoryX[f], mape.factoryY[f]);
		const felled = economy.biomass[cell] * MAPE_SAWMILL_CUT_SHARE;
		const units = felled / MAPE_SAWMILL_FOREST_PER_LOG;
		mape.factoryHarvestWork[f] += units / (MAPE_SAWMILL_RATE * (1 + 0.15 * cover) * demandScale);
		economy.biomass[cell] -= felled;
		mape.factoryGoods[f] = units / dt;
		mapeProduceStock(MAPE_RES.LOGS, cell, units);
		landDisturbRing(cell, 0.00015 * units);
		return;
	}
	const slot = MAPE_RES.LOGS * world.n + idx;
	const wanted = MAPE_FORESTRY_INPUT * staff * dt;
	const used = Math.min(mape.goods[slot], wanted);
	if (used <= 0) {
		mape.factoryStarved[f] += dt;
		return;
	}
	mape.factoryIron[f] = used / dt;
	mape.goods[slot] -= used;
	mape.massOut += used;
	if (kind === MAPE_FACTORY_KIND.CHARCOAL) {
		const coal = used * MAPE_CHARCOAL_YIELD;
		const co2 = used * MAPE_CHARCOAL_CO2;
		mape.factoryCoal[f] = coal / dt;
		mape.factoryCo2[f] = co2 / dt;
		mapeProduceStock(MAPE_RES.COAL, idx, coal);
		mapeProduceStock(MAPE_RES.CO2, idx, co2);
		landDisturbAround(idx, MAPE_FACTORY_DISTURB * staff * dt);
		return;
	}
	const goods = used * MAPE_WOOD_YIELD;
	mape.factoryGoods[f] = goods / dt;
	mapeProduceStock(MAPE_RES.GOODS, idx, goods);
	landDisturbAround(idx, MAPE_FACTORY_DISTURB * staff * dt);
}

function mapeRemoveFactory(f) {
	if (f < 0 || f >= mape.factoryCount) return;
	const x = mape.factoryX[f];
	const y = mape.factoryY[f];
	mape.factoryState[f] = MAPE_FACTORY_STATE.GONE;
	for (let k = 0; k < mape.storageCount; k++) {
		if (mape.storageSite[k] !== 255 || mape.storageX[k] !== x || mape.storageY[k] !== y) continue;
		const last = --mape.storageCount;
		mape.storageX[k] = mape.storageX[last];
		mape.storageY[k] = mape.storageY[last];
		mape.storageSite[k] = mape.storageSite[last];
		break;
	}
}

const mapeJobTotals = { slots: 0, staffed: 0, open: 0, fresh: 0, depleted: 0 };

function mapeJobSummary() {
	const t = mapeJobTotals;
	const size = world.size;
	let slots = 0;
	let staffed = 0;
	for (let m = 0; m < mape.mineCount; m++) {
		if (!mapeMineActive(m)) continue;
		const present = mapeWorkPresent(mape.mineY[m] * size + mape.mineX[m]);
		slots += MAPE_MINE_WORKERS;
		staffed += present >= MAPE_MINE_WORKERS ? MAPE_MINE_WORKERS : present;
	}
	for (let f = 0; f < mape.factoryCount; f++) {
		const need = mapeFactoryWorkers(mape.factoryState[f]);
		if (need === 0) continue;
		const present = mapeWorkPresent(mape.factoryY[f] * size + mape.factoryX[f]);
		staffed += present >= need ? need : present;
		slots += need;
	}
	t.slots = slots;
	t.staffed = staffed;
	t.open = slots > staffed ? slots - staffed : 0;
	if (mape.workforceMode === MAPE_WORKFORCE_MODE.FLUID) {
		let fresh = 0;
		let depleted = 0;
		for (let i = 0; i < world.n; i++) {
			fresh += mape.wfFresh[i];
			depleted += mape.wfDepleted[i];
		}
		t.fresh = fresh;
		t.depleted = depleted;
	} else {
		t.fresh = 0;
		t.depleted = 0;
	}
	return t;
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
	module.exports = { mapeAddStorage, mapeAddFactory, mapeSeedMines, mapeUnlockMine, mapeMineActive, mapeRemoveFactory, mapeStepMines, mapeStepWorkshops, mapeStepFactories, mapeFactoryAt, mapeJobSummary, MAPE_MINE_RATE };
}
