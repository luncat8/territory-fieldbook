// owns: engine factory placement scan — region need, site choice and kind selection
// edit for: scan cadence, thresholds, siting weights and kind rules

const MAPE_SCAN_SEC = 5;
const MAPE_FACTORY_THRESHOLD = 6.0;   // min region score (unmet persons, 1/d²-weighted)
const MAPE_FACTORY_SPACING = 4;       // min cells between factories
const MAPE_FACTORY_SNAP = 2;          // cells: centroid snapped to the best buildable cell nearby
const MAPE_FACTORY_SNAP_WIDE = 5;     // cells: second search when the near box is full (> spacing, one plant cannot fill it)
const MAPE_SAWMILL_SNAP = 6;          // cells: a mill walks out of town to the forest it cuts
const MAPE_SAWMILL_COVER_WEIGHT = 10; // site score per unit forest cover around a mill
const MAPE_SCAN_ANCHOR_GAP = 6;       // cells: anchors closer than this to a tried one describe the same towns
const MAPE_SCAN_STAFF_MIN = 0.5;      // a region whose plants are staffed below this share waits for workers
const MAPE_FACTORY_POP_WEIGHT = 0.35; // workforce weight against the deposit stock weight of 1
const MAPE_REGION_REACH = 12;         // cells: settlements whose unmet need forms a region
const MAPE_SAWMILL_MIN_COVER = 0.45;  // minimum forest cover in the 5×5 to site a mill
const MAPE_DISTURB_PENALTY = 10;      // site score cost per unit of disturbed land

function mapeScanStep(dt) {
	// Scenes are manual testbeds and scanOn is the unit-test escape hatch: the
	// engine never places where a test measures the map undisturbed.
	if (dt <= 0 || mapScene.id || !mape.scanOn) return;
	mape.scanAcc += dt * tune.siting;
	if (mape.scanAcc < MAPE_SCAN_SEC) return;
	mape.scanAcc = 0;
	mapeScanRun();
}

// The plan measures unmet goods need as pop·rate − delivered; against the
// satisfaction signal that is exactly pop·(1 − satGoods) once normalised by the
// rate, so the threshold reads as "people's worth of uncovered goods need".
function mapeScanUnmetGoods(idx) {
	return mape.pop[idx] * (1 - mape.satGoods[idx]);
}

function mapeScanUnmetFood(idx) {
	return mape.pop[idx] * (1 - mape.satFood[idx]);
}

function mapeScanUnmetCoal(idx) {
	return mape.pop[idx] * (1 - mape.satCoal[idx]);
}

// Walking distance from one cell over the land the market hauls across: 4-neighbour,
// water blocks. The field doubles as the haul term for both the deposit anchor and
// the snap score's stock term.
function mapeScanWalkField(sx, sy) {
	const size = world.size;
	const n = world.n;
	const dist = new Int32Array(n).fill(-1);
	const queue = new Int32Array(n);
	const start = sy * size + sx;
	if (world.terrain[start] === TERRAIN.WATER) return dist;
	let head = 0;
	let tail = 0;
	dist[start] = 0;
	queue[tail++] = start;
	while (head < tail) {
		const i = queue[head++];
		const x = i % size;
		const y = (i / size) | 0;
		const d = dist[i] + 1;
		if (x > 0 && dist[i - 1] < 0 && world.terrain[i - 1] !== TERRAIN.WATER) { dist[i - 1] = d; queue[tail++] = i - 1; }
		if (x + 1 < size && dist[i + 1] < 0 && world.terrain[i + 1] !== TERRAIN.WATER) { dist[i + 1] = d; queue[tail++] = i + 1; }
		if (y > 0 && dist[i - size] < 0 && world.terrain[i - size] !== TERRAIN.WATER) { dist[i - size] = d; queue[tail++] = i - size; }
		if (y + 1 < size && dist[i + size] < 0 && world.terrain[i + size] !== TERRAIN.WATER) { dist[i + size] = d; queue[tail++] = i + size; }
	}
	return dist;
}

// Every stock-carrying deposit of the inputs a general plant consumes, each with
// its walking-distance field. Population enters the anchor through the haul term.
function mapeScanDepositFields() {
	const out = [];
	for (let m = 0; m < mape.mineCount; m++) {
		const r = mape.mineRes[m];
		if (r !== MAPE_RES.COAL && r !== MAPE_RES.IRON) continue;
		const site = mape.mineSite[m];
		const stock = sites.stock[site];
		if (stock <= 0) continue;
		const x = mape.mineX[m];
		const y = mape.mineY[m];
		out.push({ res: r, x: x, y: y, stock: stock, field: mapeScanWalkField(x, y) });
	}
	return out;
}

function mapeScanLegal(x, y, kind) {
	if (!worldWalkableAt(x, y)) return false;
	const idx = y * world.size + x;
	if (mapeIsSettlement(idx)) return false;
	if (sitesAt(x, y) >= 0) return false;
	const spacing2 = MAPE_FACTORY_SPACING * MAPE_FACTORY_SPACING;
	for (let f = 0; f < mape.factoryCount; f++) {
		if (mape.factoryState[f] === MAPE_FACTORY_STATE.GONE) continue;
		const dx = mape.factoryX[f] - x;
		const dy = mape.factoryY[f] - y;
		if (dx * dx + dy * dy < spacing2) return false;
	}
	// A farm's site must carry a field: mean potential quality of its 5×5 clears the floor.
	if (kind === MAPE_FACTORY_KIND.SAWMILL && mapeForestCover(x, y) < MAPE_SAWMILL_MIN_COVER) return false;
	if (kind === MAPE_FACTORY_KIND.FARM && mapeFarmFieldQuality(x, y) < MAPE_FARM_MIN_FIELD) return false;
	return true;
}

// Site score: closer to deposits is better, closer to the workforce is better,
// disturbed land costs. A log-fed plant has no deposit term — the town centre alone; a mill
// also scores the forest it will cut.
function mapeScanSiteScore(x, y, towns, deposits, kind) {
	const size = world.size;
	const idx = y * size + x;
	let score = -MAPE_DISTURB_PENALTY * land.disturbed[idx];
	if (deposits) {
		for (let d = 0; d < deposits.length; d++) {
			const dist = deposits[d].field[idx];
			if (dist < 0) continue;
			score += deposits[d].stock / (1 + dist);
		}
	}
	if (kind === MAPE_FACTORY_KIND.FARM) score += mapeFarmFieldQuality(x, y);
	if (kind === MAPE_FACTORY_KIND.SAWMILL) score += MAPE_SAWMILL_COVER_WEIGHT * mapeForestCover(x, y);
	for (let t = 0; t < towns.length; t++) {
		const town = towns[t];
		const dx = (town % size) - x;
		const dy = ((town / size) | 0) - y;
		score += MAPE_FACTORY_POP_WEIGHT * mape.pop[town] / (1 + Math.sqrt(dx * dx + dy * dy));
	}
	return score;
}

// Scan scratch, refilled per anchor; the scan runs every few seconds, never per frame.
const mapeScanRegion = { anchor: -1, score: 0, unmet: 0, foodUnmet: 0, coal: 0, cx: 0, cy: 0, towns: [] };
const mapeScanStock = { logs: 0, coal: 0, iron: 0 };
const mapeScanAnchorAt = { x: 0, y: 0 };
const mapeScanCensus = { mills: 0, works: 0, need: 0, present: 0, building: null };

// The region around one anchor: settlements within reach, their unmet need weighted 1/d² so the
// nearest town dominates. Goods or food, whichever weighs more, sets the score and the centroid.
function mapeScanMeasureRegion(from, region) {
	const size = world.size;
	const cells = mape.settleCells;
	const fx = from % size;
	const fy = (from / size) | 0;
	const towns = region.towns;
	let s = 0;
	let fs = 0;
	let sum = 0;
	let foodSum = 0;
	let coalSum = 0;
	let wx = 0;
	let wy = 0;
	let fwx = 0;
	let fwy = 0;
	towns.length = 0;
	for (let t = 0; t < mape.settleCount; t++) {
		const idx = cells[t];
		const px = idx % size;
		const py = (idx / size) | 0;
		const d2 = (px - fx) * (px - fx) + (py - fy) * (py - fy);
		if (d2 > MAPE_REGION_REACH * MAPE_REGION_REACH) continue;
		const need = mapeScanUnmetGoods(idx);
		const food = mapeScanUnmetFood(idx);
		const w = 1 / Math.max(1, d2);
		s += need * w;
		fs += food * w;
		sum += need;
		foodSum += food;
		coalSum += mapeScanUnmetCoal(idx);
		wx += need * px;
		wy += need * py;
		fwx += food * px;
		fwy += food * py;
		towns.push(idx);
	}
	const byFood = fs > s;
	const total = byFood ? foodSum : sum;
	region.anchor = from;
	region.unmet = sum;
	region.foodUnmet = foodSum;
	region.coal = coalSum;
	region.score = total > 0 ? (byFood ? fs : s) : 0;
	region.cx = total > 0 ? (byFood ? fwx : wx) / total : fx;
	region.cy = total > 0 ? (byFood ? fwy : wy) / total : fy;
	return region.score;
}

function mapeScanNearTried(from, tried) {
	const size = world.size;
	const gap2 = MAPE_SCAN_ANCHOR_GAP * MAPE_SCAN_ANCHOR_GAP;
	for (let k = 0; k < tried.length; k++) {
		const dx = (tried[k] % size) - (from % size);
		const dy = ((tried[k] / size) | 0) - ((from / size) | 0);
		if (dx * dx + dy * dy < gap2) return true;
	}
	return false;
}

function mapeScanRun() {
	if (mape.factoryCount >= MAPE_FACTORY_CAP) return;
	const cells = mape.settleCells;
	const count = mape.settleCount;
	const region = mapeScanRegion;
	const scores = new Float64Array(count);
	const ranked = [];
	for (let a = 0; a < count; a++) {
		scores[a] = mapeScanMeasureRegion(cells[a], region);
		if (scores[a] >= MAPE_FACTORY_THRESHOLD) ranked.push(a);
	}
	ranked.sort((a, b) => scores[b] - scores[a] || a - b);
	// Neediest region first, then the next: a region with no legal cell for its kind — its centre
	// taken by an earlier plant, its forest cleared — must not stall industry on the whole map.
	const tried = [];
	for (let k = 0; k < ranked.length; k++) {
		const from = cells[ranked[k]];
		if (mapeScanNearTried(from, tried)) continue;
		tried.push(from);
		mapeScanMeasureRegion(from, region);
		if (mapeScanTryRegion(region)) return;
	}
}

// Free logs gate the log-fed kinds; logs on a plant's cell are its working buffer or build
// material, already spoken for. Coal plus iron on hand, mine heaps included, is the surplus a
// general plant needs.
function mapeScanCountStock(anchor, stock) {
	const size = world.size;
	const n = world.n;
	const ax = anchor % size;
	const ay = (anchor / size) | 0;
	const reach2 = MAPE_REGION_REACH * MAPE_REGION_REACH;
	stock.logs = stock.coal = stock.iron = 0;
	for (let i = 0; i < n; i++) {
		const dx = (i % size) - ax;
		const dy = ((i / size) | 0) - ay;
		if (dx * dx + dy * dy > reach2) continue;
		if (!mapeIsIndustry(i)) stock.logs += mape.goods[MAPE_RES.LOGS * n + i];
		stock.coal += mape.goods[MAPE_RES.COAL * n + i];
		stock.iron += mape.goods[MAPE_RES.IRON * n + i];
	}
}

function mapeScanCountPlants(anchor, census) {
	const size = world.size;
	const ax = anchor % size;
	const ay = (anchor / size) | 0;
	const reach2 = MAPE_REGION_REACH * MAPE_REGION_REACH;
	census.mills = census.works = census.need = census.present = 0;
	if (!census.building) census.building = new Uint8Array(MAPE_FACTORY_KIND_NAME.length);
	census.building.fill(0);
	for (let f = 0; f < mape.factoryCount; f++) {
		const state = mape.factoryState[f];
		if (state === MAPE_FACTORY_STATE.GONE) continue;
		const dx = mape.factoryX[f] - ax;
		const dy = mape.factoryY[f] - ay;
		if (dx * dx + dy * dy > reach2) continue;
		const kind = mape.factoryKind[f];
		const need = mapeFactoryWorkers(f);
		census.need += need;
		census.present += Math.min(need, mapeWorkPresent(mape.factoryY[f] * size + mape.factoryX[f]));
		if (state === MAPE_FACTORY_STATE.BUILDING) census.building[kind]++;
		if (kind === MAPE_FACTORY_KIND.SAWMILL) census.mills++;
		else if (kind === MAPE_FACTORY_KIND.CHARCOAL || kind === MAPE_FACTORY_KIND.WOOD) census.works++;
	}
}

// GENERAL needs deposits of both inputs with stock and a hauled surplus of both on hand — no
// ORE-bound mine means it is never chosen (it would build and then starve). Otherwise wood has to
// exist before wood can be spent: below the reserve only a sawmill may be sited, above it the
// log-fed works the region is shorter of, ties toward coal. Exception: a mill cuts only where log
// demand reaches it and demand comes from the works, so a region's first works sites below the
// reserve — it pulls the first cut.
function mapeScanWoodKind(region, stock, census, deposits) {
	let hasIron = false;
	let hasCoal = false;
	for (let d = 0; deposits && d < deposits.length; d++) {
		if (deposits[d].res === MAPE_RES.IRON) hasIron = true;
		else hasCoal = true;
	}
	if (hasIron && hasCoal) return MAPE_FACTORY_KIND.GENERAL;
	const firstWorks = census.mills > 0 && census.works === 0;
	if (stock.logs < MAPE_BUILD_LOG_RESERVE && !firstWorks) return MAPE_FACTORY_KIND.SAWMILL;
	return region.coal >= region.unmet ? MAPE_FACTORY_KIND.CHARCOAL : MAPE_FACTORY_KIND.WOOD;
}

function mapeScanTryRegion(region) {
	const stock = mapeScanStock;
	const census = mapeScanCensus;
	mapeScanCountStock(region.anchor, stock);
	mapeScanCountPlants(region.anchor, census);
	// Another plant would split a crew the region cannot fill.
	if (census.present < MAPE_SCAN_STAFF_MIN * census.need) return false;
	const deposits = stock.coal > 0 && stock.iron > 0 ? mapeScanDepositFields() : null;
	const woodKind = mapeScanWoodKind(region, stock, census, deposits);
	const general = woodKind === MAPE_FACTORY_KIND.GENERAL;
	// Food dominates the wood chain once goods satisfaction moves. One build per kind per region at
	// a time, so the crew is not split across unfinished sites of the same kind.
	const farm = region.foodUnmet > region.unmet && census.building[MAPE_FACTORY_KIND.FARM] === 0;
	if (!farm && census.building[woodKind] > 0) return false;
	const kind = farm ? MAPE_FACTORY_KIND.FARM : woodKind;
	// A farm with no legal field falls back to the wood chain instead of stalling the scan.
	const fallback = farm && census.building[woodKind] === 0 ? woodKind : -1;
	const at = mapeScanAnchorAt;
	at.x = region.cx;
	at.y = region.cy;
	if (general && mape.engine !== MAPE_ENGINE.SITES && !mapeScanDepositAnchor(region.towns, deposits, at)) return false;
	const dep = general ? deposits : null;
	if (mapeScanPlaceKind(kind, region, at, dep)) return true;
	return fallback >= 0 && mapeScanPlaceKind(fallback, region, at, dep);
}

// Sites scores the region disc by margin; the field engines snap around the centroid.
function mapeScanPlaceKind(kind, region, at, deposits) {
	const site = mape.engine === MAPE_ENGINE.SITES
		? mapeSitesScanSite(region.anchor, kind)
		: mapeScanSnapSite(kind, Math.round(at.x), Math.round(at.y), region.towns, deposits);
	return site >= 0 && mapeScanPlace(site, kind);
}

// A deposit-fed plant anchors on the haul-weighted deposits of its inputs: deposits weigh more
// because population moves and deposits do not.
function mapeScanDepositAnchor(towns, deposits, out) {
	const n = world.n;
	let wsum = 0;
	let wx = 0;
	let wy = 0;
	for (let d = 0; d < deposits.length; d++) {
		const dep = deposits[d];
		let haul = 0;
		let popsum = 0;
		for (let t = 0; t < towns.length; t++) {
			const town = towns[t];
			const dist = dep.field[town];
			haul += mape.pop[town] * (dist >= 0 ? dist : n);
			popsum += mape.pop[town];
		}
		const w = dep.stock / (1 + (popsum > 0 ? haul / popsum : n));
		wsum += w;
		wx += w * dep.x;
		wy += w * dep.y;
	}
	if (wsum <= 0) return false;
	out.x = wx / wsum;
	out.y = wy / wsum;
	return true;
}

// The centroid snapped to the best legal cell nearby; a mill searches wider for its forest. With
// spacing above the near box, one plant at the centre fills it, so a full box widens once.
function mapeScanSnapSite(kind, sx, sy, towns, deposits) {
	if (kind === MAPE_FACTORY_KIND.SAWMILL) return mapeScanBestInBox(kind, sx, sy, MAPE_SAWMILL_SNAP, towns, deposits);
	const near = mapeScanBestInBox(kind, sx, sy, MAPE_FACTORY_SNAP, towns, deposits);
	return near >= 0 ? near : mapeScanBestInBox(kind, sx, sy, MAPE_FACTORY_SNAP_WIDE, towns, deposits);
}

function mapeScanBestInBox(kind, sx, sy, radius, towns, deposits) {
	const size = world.size;
	let best = -1;
	let bestScore = -Infinity;
	for (let dy = -radius; dy <= radius; dy++) {
		for (let dx = -radius; dx <= radius; dx++) {
			const x = sx + dx;
			const y = sy + dy;
			if (!mapeScanLegal(x, y, kind)) continue;
			const s = mapeScanSiteScore(x, y, towns, deposits, kind);
			if (s <= bestScore) continue;
			bestScore = s;
			best = y * size + x;
		}
	}
	return best;
}

function mapeScanPlace(idx, kind) {
	const x = idx % world.size;
	const y = (idx / world.size) | 0;
	if (mapeAddFactory(x, y, MAPE_FACTORY_STATE.BUILDING, kind) < 0) return false;
	eventsAdd(MAPE_FACTORY_KIND_NAME[kind] + ' planned at ' + x + ',' + y + '.');
	return true;
}

if (typeof module !== 'undefined') {
	module.exports = { mapeScanStep, mapeScanRun, MAPE_SCAN_SEC, MAPE_FACTORY_THRESHOLD, MAPE_REGION_REACH, MAPE_FACTORY_SNAP, MAPE_FACTORY_SNAP_WIDE, MAPE_SAWMILL_SNAP, MAPE_FACTORY_SPACING, MAPE_SAWMILL_MIN_COVER };
}
