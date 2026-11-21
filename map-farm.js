// owns: farm sites — field clearing by sawmill visits, seasonal whole-field harvest, food output
// edit for: farm field rules, crew sizing, moisture yield and waste

const MAPE_FARM_RADIUS = 2;
const MAPE_FARM_TILL_SEC = 2;            // worker-seconds per clearing visit, hit or miss
const MAPE_FARM_SEASON_SEC = 8;          // the whole field is brought in at once, this often
const MAPE_FARM_YIELD = 3;               // food per quality-1 farmland cell per season
const MAPE_FARM_MOISTURE_OPTIMUM = 0.6;  // wetter than the forest optimum: river plains farm best
const MAPE_FARM_MOISTURE_WIDTH = 0.3;
const MAPE_FARM_MIN_FIELD = 0.35;        // mean potential quality to site a farm
const MAPE_FARM_MAX_DISTURB = 0.2;       // waste stops new clearing on a cell
const MAPE_FARM_WASTE_PER_FOOD = 0.0004;
// The 24 cells at Chebyshev distance 3: each harvest pushes waste onto one random ring cell.
const MAPE_FARM_RING_DX = new Int8Array([-3, -2, -1, 0, 1, 2, 3, 3, 3, 3, 3, 3, 2, 1, 0, -1, -2, -3, -3, -3, -3, -3, -3, -3]);
const MAPE_FARM_RING_DY = new Int8Array([-3, -3, -3, -3, -3, -3, -3, -2, -1, 0, 1, 2, 3, 3, 3, 3, 3, 3, 2, 1, 0, -1, -2, -3]);

// Farmland is owned, never shared: the count is the crew the farm asks for (one worker per cell).
function mapeFarmCells(f) {
	const size = world.size;
	const owner = f + 1;
	let count = 0;
	for (let dy = -MAPE_FARM_RADIUS; dy <= MAPE_FARM_RADIUS; dy++) {
		const y = mape.factoryY[f] + dy;
		if (y < 0 || y >= size) continue;
		for (let dx = -MAPE_FARM_RADIUS; dx <= MAPE_FARM_RADIUS; dx++) {
			const x = mape.factoryX[f] + dx;
			if (x < 0 || x >= size) continue;
			if (mape.farmOwner[y * size + x] === owner) count++;
		}
	}
	return count;
}

function mapeFarmNeed(f) {
	return Math.max(1, mapeFarmCells(f));
}

function mapeFarmCellQuality(i) {
	const moisture = hydrology.soil[i];
	return Math.max(0, 1 - Math.abs(moisture - MAPE_FARM_MOISTURE_OPTIMUM) / MAPE_FARM_MOISTURE_WIDTH);
}

// Mean potential quality of the field: forest counts because it will be cleared, water does not.
function mapeFarmFieldQuality(x, y) {
	const size = world.size;
	let sum = 0;
	for (let dy = -MAPE_FARM_RADIUS; dy <= MAPE_FARM_RADIUS; dy++) {
		for (let dx = -MAPE_FARM_RADIUS; dx <= MAPE_FARM_RADIUS; dx++) {
			const cx = x + dx;
			const cy = y + dy;
			if (cx < 0 || cy < 0 || cx >= size || cy >= size) continue;
			const i = cy * size + cx;
			if (world.terrain[i] === TERRAIN.WATER) continue;
			sum += mapeFarmCellQuality(i);
		}
	}
	return sum / ((MAPE_FARM_RADIUS * 2 + 1) * (MAPE_FARM_RADIUS * 2 + 1));
}

function mapeFarmClearable(x, y) {
	const size = world.size;
	if (x < 0 || y < 0 || x >= size || y >= size) return -1;
	const idx = y * size + x;
	const t = world.terrain[idx];
	if (t === TERRAIN.WATER || t === TERRAIN.SWAMP) return -1;
	if (mape.pop[idx] > 0 || mapeIsIndustry(idx) || sitesAt(x, y) >= 0) return -1;
	if (mape.farmOwner[idx] !== 0 || land.disturbed[idx] >= MAPE_FARM_MAX_DISTURB) return -1;
	return idx;
}

function mapeFarmSampleCell(f) {
	const width = MAPE_FARM_RADIUS * 2 + 1;
	const pick = randomInt(width * width);
	return mapeFarmClearable(mape.factoryX[f] + pick % width - MAPE_FARM_RADIUS,
		mape.factoryY[f] + (pick / width | 0) - MAPE_FARM_RADIUS);
}

// One clearing visit, the sawmill rule: random cell, a miss costs the visit, a hit fells all
// forest into logs on the site and marks the cell farmland. No log-pull gate — the farm clears
// for its field, not for the log market.
function mapeFarmClear(f, idx, dt, crew) {
	const effort = crew * landProductivity(idx) * dt;
	if (effort <= 0) return;
	mape.factoryHarvestWork[f] -= effort;
	if (mape.factoryHarvestWork[f] > 0) return;
	mape.factoryHarvestWork[f] += MAPE_FARM_TILL_SEC;
	const cell = mapeFarmSampleCell(f);
	if (cell < 0) return;
	const felled = economy.biomass[cell];
	if (felled > 0) {
		mape.factoryHarvestWork[f] += felled * MAPE_SAWMILL_FELL_SEC;
		economy.biomass[cell] = 0;
		mapeProduceStock(MAPE_RES.LOGS, idx, felled / MAPE_SAWMILL_FOREST_PER_LOG);
	}
	economyTill(cell, true);
	mape.farmOwner[cell] = f + 1;
}

// Construction clears its own field and pays for itself in felled logs: a wooded site builds
// without haulage, a bare one needs logs brought in while its visits still till farmland.
function mapeStepFarmBuild(f, idx, dt, staff) {
	mapeFarmClear(f, idx, dt, mapeWorkPresent(idx));
	mapeStepFactoryBuild(f, idx, dt, staff);
}

function mapeStepFarm(f, idx, dt) {
	mape.factoryCoal[f] = mape.factoryIron[f] = mape.factoryGoods[f] = mape.factoryCo2[f] = 0;
	if (dt <= 0) return;
	const cells = mapeFarmCells(f);
	const present = mapeWorkPresent(idx);
	mape.factoryCrop[f] += Math.min(present, cells) * dt;
	mapeFarmClear(f, idx, dt, present - cells);
	mape.factoryClock[f] += dt;
	if (mape.factoryClock[f] < MAPE_FARM_SEASON_SEC) return;
	mape.factoryClock[f] -= MAPE_FARM_SEASON_SEC;
	mapeFarmHarvest(f);
}

// The whole field comes in at once. Worked cell-seconds over the season set how much of it the
// crop comes in from; an undermanned field harvests a smaller share but never shrinks — farmland
// stays until the farm itself is removed and the forest field regrows on its own terms.
function mapeFarmHarvest(f) {
	const size = world.size;
	const cells = mapeFarmCells(f);
	const w = cells > 0 ? Math.min(1, mape.factoryCrop[f] / (cells * MAPE_FARM_SEASON_SEC)) : 0;
	mape.factoryCrop[f] = 0;
	const owner = f + 1;
	let food = 0;
	for (let dy = -MAPE_FARM_RADIUS; dy <= MAPE_FARM_RADIUS; dy++) {
		const y = mape.factoryY[f] + dy;
		if (y < 0 || y >= size) continue;
		for (let dx = -MAPE_FARM_RADIUS; dx <= MAPE_FARM_RADIUS; dx++) {
			const x = mape.factoryX[f] + dx;
			if (x < 0 || x >= size) continue;
			const i = y * size + x;
			if (mape.farmOwner[i] !== owner) continue;
			const share = MAPE_FARM_YIELD * mapeFarmCellQuality(i) * landProductivity(i) * w;
			if (share <= 0) continue;
			mapeProduceStock(MAPE_RES.FOOD, i, share);
			food += share;
		}
	}
	mape.factoryGoods[f] = food / MAPE_FARM_SEASON_SEC;
	mapeFarmRingWaste(mape.factoryX[f], mape.factoryY[f], food);
}

// Waste lands just outside the field, one random ring cell per harvest; a tiled neighbour's
// farmland can take it and degrades like any other disturbed cell. Water or off-map picks drop it.
function mapeFarmRingWaste(cx, cy, food) {
	const amount = MAPE_FARM_WASTE_PER_FOOD * food;
	if (amount <= 0) return;
	const pick = randomInt(MAPE_FARM_RING_DX.length);
	const size = world.size;
	const x = cx + MAPE_FARM_RING_DX[pick];
	const y = cy + MAPE_FARM_RING_DY[pick];
	if (x < 0 || y < 0 || x >= size || y >= size) return;
	const i = y * size + x;
	if (world.terrain[i] === TERRAIN.WATER) return;
	landDisturb(i, amount);
}

// A removed farm stops tilling; released cells regrow on the ordinary forest model.
function mapeFarmRelease(f, x, y) {
	const size = world.size;
	for (let dy = -MAPE_FARM_RADIUS; dy <= MAPE_FARM_RADIUS; dy++) {
		const py = y + dy;
		if (py < 0 || py >= size) continue;
		for (let dx = -MAPE_FARM_RADIUS; dx <= MAPE_FARM_RADIUS; dx++) {
			const px = x + dx;
			if (px < 0 || px >= size) continue;
			const i = py * size + px;
			if (mape.farmOwner[i] !== f + 1) continue;
			mape.farmOwner[i] = 0;
			economyTill(i, false);
		}
	}
}

if (typeof module !== 'undefined') {
	module.exports = { mapeFarmCells, mapeFarmNeed, mapeFarmFieldQuality, mapeFarmCellQuality };
}
