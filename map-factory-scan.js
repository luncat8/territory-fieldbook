// owns: engine factory placement scan — region need, site choice and kind selection
// edit for: scan cadence, thresholds, siting weights and kind rules

const MAPE_SCAN_SEC = 5;
const MAPE_FACTORY_THRESHOLD = 6.0;   // min region score (unmet persons, 1/d²-weighted)
const MAPE_FACTORY_SPACING = 4;       // min cells between factories
const MAPE_FACTORY_SNAP = 2;          // cells: centroid snapped to the best buildable cell nearby
const MAPE_FACTORY_POP_WEIGHT = 0.35; // workforce weight against the deposit stock weight of 1
const MAPE_REGION_REACH = 12;         // cells: settlements whose unmet need forms a region
const MAPE_SAWMILL_MIN_COVER = 0.45;  // minimum forest cover in the 5×5 to site a mill
const MAPE_DISTURB_PENALTY = 10;      // site score cost per unit of disturbed land

function mapeScanStep(dt) {
	// Scenes are manual testbeds and scanOn is the unit-test escape hatch: the
	// engine never places where a test measures the map undisturbed.
	if (dt <= 0 || mapScene.id || !mape.scanOn) return;
	mape.scanAcc += dt;
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
	// A sawmill's site must be wooded: forest is both its material and its working area.
	if (kind === MAPE_FACTORY_KIND.SAWMILL && mapeForestCover(x, y) < MAPE_SAWMILL_MIN_COVER) return false;
	return true;
}

// Site score: closer to deposits is better, closer to the workforce is better,
// disturbed land costs. A log-fed plant has no deposit term — the town centre alone.
function mapeScanSiteScore(x, y, towns, deposits) {
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
	for (let t = 0; t < towns.length; t++) {
		const town = towns[t];
		const dx = (town % size) - x;
		const dy = ((town / size) | 0) - y;
		score += MAPE_FACTORY_POP_WEIGHT * mape.pop[town] / (1 + Math.sqrt(dx * dx + dy * dy));
	}
	return score;
}

function mapeScanRun() {
	if (mape.factoryCount >= MAPE_FACTORY_CAP) return;
	const size = world.size;
	const n = world.n;
	const cells = mape.settleCells;
	const count = mape.settleCount;
	if (count <= 0) return;
	// 1. What gets built: the region whose unmet goods need, weighted 1/d² from
	// each settlement anchor, clears the threshold. The nearest town dominates.
	let anchor = -1;
	let score = 0;
	let unmet = 0;
	let coal = 0;
	let cx = 0;
	let cy = 0;
	let towns = null;
	for (let a = 0; a < count; a++) {
		const from = cells[a];
		const fx = from % size;
		const fy = (from / size) | 0;
		let s = 0;
		let sum = 0;
		let coalSum = 0;
		let wx = 0;
		let wy = 0;
		let found = null;
		for (let t = 0; t < count; t++) {
			const idx = cells[t];
			const dx = (idx % size) - fx;
			const dy = ((idx / size) | 0) - fy;
			const d2 = dx * dx + dy * dy;
			if (d2 > MAPE_REGION_REACH * MAPE_REGION_REACH) continue;
			const need = mapeScanUnmetGoods(idx);
			const w = 1 / Math.max(1, d2);
			s += need * w;
			sum += need;
			coalSum += mapeScanUnmetCoal(idx);
			wx += need * (idx % size);
			wy += need * ((idx / size) | 0);
			if (!found) found = [];
			found.push(idx);
		}
		if (s <= score || sum <= 0) continue;
		anchor = from;
		score = s;
		unmet = sum;
		coal = coalSum;
		cx = wx / sum;
		cy = wy / sum;
		towns = found;
	}
	if (anchor < 0 || score < MAPE_FACTORY_THRESHOLD || !towns) return;
	// 2. Regional stocks over the region disc: logs gate the log-fed kinds, and
	// coal plus iron on hand is the surplus a general plant needs to start.
	const ax = anchor % size;
	const ay = (anchor / size) | 0;
	const reach2 = MAPE_REGION_REACH * MAPE_REGION_REACH;
	const logsOff = MAPE_RES.LOGS * n;
	const coalOff = MAPE_RES.COAL * n;
	const ironOff = MAPE_RES.IRON * n;
	let logs = 0;
	let coalStock = 0;
	let ironStock = 0;
	for (let i = 0; i < n; i++) {
		const dx = (i % size) - ax;
		const dy = ((i / size) | 0) - ay;
		if (dx * dx + dy * dy > reach2) continue;
		logs += mape.goods[logsOff + i];
		coalStock += mape.goods[coalOff + i];
		ironStock += mape.goods[ironOff + i];
	}
	// 3. Kind selection. GENERAL needs deposits of both inputs with stock and a
	// hauled surplus of both on hand — no ORE-bound mine means it is never chosen
	// (it would build and then starve). Otherwise wood has to exist before wood can
	// be spent: below the reserve only a sawmill may be sited, above it the log-fed
	// works the region is shorter of, ties toward coal.
	const deposits = coalStock > 0 && ironStock > 0 ? mapeScanDepositFields() : null;
	let hasIron = false;
	let hasCoal = false;
	if (deposits) {
		for (let d = 0; d < deposits.length; d++) {
			if (deposits[d].res === MAPE_RES.IRON) hasIron = true;
			else hasCoal = true;
		}
	}
	const general = deposits && hasIron && hasCoal;
	const kind = general ? MAPE_FACTORY_KIND.GENERAL
		: logs < MAPE_BUILD_LOG_RESERVE ? MAPE_FACTORY_KIND.SAWMILL
			: coal >= unmet ? MAPE_FACTORY_KIND.CHARCOAL : MAPE_FACTORY_KIND.WOOD;
	// 4. Where it sits. Sites scores the region disc by margin instead of the centroid.
	if (mape.engine === MAPE_ENGINE.SITES) {
		const site = mapeSitesScanSite(anchor, kind);
		if (site >= 0) mapeScanPlace(site, kind);
		return;
	}
	// A deposit-fed plant anchors on the haul-weighted deposits of
	// its inputs; a log-fed plant has no anchor and uses the town-weighted centre.
	let px = cx;
	let py = cy;
	if (general) {
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
		if (wsum <= 0) return;
		px = wx / wsum;
		py = wy / wsum;
	}
	const sx = Math.round(px);
	const sy = Math.round(py);
	let best = -1;
	let bestScore = -Infinity;
	for (let dy = -MAPE_FACTORY_SNAP; dy <= MAPE_FACTORY_SNAP; dy++) {
		for (let dx = -MAPE_FACTORY_SNAP; dx <= MAPE_FACTORY_SNAP; dx++) {
			const x = sx + dx;
			const y = sy + dy;
			if (!mapeScanLegal(x, y, kind)) continue;
			const s = mapeScanSiteScore(x, y, towns, general ? deposits : null);
			if (s <= bestScore) continue;
			bestScore = s;
			best = y * size + x;
		}
	}
	if (best < 0) return;
	mapeScanPlace(best, kind);
}

function mapeScanPlace(idx, kind) {
	const x = idx % world.size;
	const y = (idx / world.size) | 0;
	if (mapeAddFactory(x, y, MAPE_FACTORY_STATE.BUILDING, kind) < 0) return;
	eventsAdd(MAPE_FACTORY_KIND_NAME[kind] + ' planned at ' + x + ',' + y + '.');
}

if (typeof module !== 'undefined') {
	module.exports = { mapeScanStep, mapeScanRun, MAPE_SCAN_SEC, MAPE_FACTORY_THRESHOLD, MAPE_REGION_REACH, MAPE_FACTORY_SNAP, MAPE_FACTORY_SPACING, MAPE_SAWMILL_MIN_COVER };
}
