// owns: disturbed fraction per cell, productivity, waste spreading around sources, recovery and restoration
// edit for: recovery rates, waste costs, spreading, restoration effect

// indexed by world terrain id: meadow, forest, water, swamp, hills, desert (per second)
const LAND_RECOVERY = [0.00020, 0.00028, 0, 0.00014, 0.00008, 0.00006];
const LAND_DISTURB_PER_UNIT = 0.006;
const LAND_MINE_DISTURB_PER_UNIT = 0.00025;
const LAND_RESTORE_AMOUNT = 0.25;
const LAND_RESTORE_FUNDS = 12;
const LAND_RESTORE_SUPPLIES = 2;
const LAND_DISTURB_LIMIT = 0.25;
// Waste is land: the source keeps most of it and the rest lands on walkable neighbours.
const LAND_WASTE_SOURCE_SHARE = 0.55;
const LAND_WASTE_SPREAD = 0.0012;
const LAND_DIR_X = [-1, 1, 0, 0];
const LAND_DIR_Y = [0, 0, -1, 1];

const land = {
	disturbed: null,
	wasteNext: null
};
const landNeighbourScratch = new Uint32Array(4);

function landInit() {
	land.disturbed = new Float32Array(world.n);
	land.wasteNext = new Float32Array(world.n);
}

function landProductivity(i) {
	return 1 - land.disturbed[i];
}

function landDisturb(i, amount) {
	if (amount <= 0) return;
	const d = land.disturbed[i] + amount;
	land.disturbed[i] = d > 1 ? 1 : d;
}

function landWalkableNeighbours(i, out) {
	const size = world.size;
	const terrain = world.terrain;
	const water = TERRAIN.WATER;
	const x = i % size;
	const y = (i / size) | 0;
	let count = 0;
	for (let k = 0; k < 4; k++) {
		const nx = x + LAND_DIR_X[k];
		const ny = y + LAND_DIR_Y[k];
		if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
		const n = ny * size + nx;
		if (terrain[n] === water) continue;
		out[count++] = n;
	}
	return count;
}

function landDisturbRing(i, amount) {
	if (amount <= 0) return;
	const neighbours = landNeighbourScratch;
	const count = landWalkableNeighbours(i, neighbours);
	if (count === 0) return;
	const share = amount / count;
	for (let k = 0; k < count; k++) landDisturb(neighbours[k], share);
}

// Household and factory waste settles around the source instead of piling on one cell.
function landDisturbAround(i, amount) {
	if (amount <= 0) return;
	const neighbours = landNeighbourScratch;
	const count = landWalkableNeighbours(i, neighbours);
	if (count === 0) {
		landDisturb(i, amount);
		return;
	}
	const ring = amount * (1 - LAND_WASTE_SOURCE_SHARE) / count;
	landDisturb(i, amount - ring * count);
	for (let k = 0; k < count; k++) landDisturb(neighbours[k], ring);
}

// Leachate creeps to neighbouring land; water carries no waste.
function landSpread(seconds) {
	const mix = LAND_WASTE_SPREAD * seconds;
	if (mix <= 0) return;
	const d = land.disturbed;
	const next = land.wasteNext;
	const terrain = world.terrain;
	const size = world.size;
	const water = TERRAIN.WATER;
	const end = size - 1;
	for (let y = 0; y < size; y++) {
		const row = y * size;
		for (let x = 0; x < size; x++) {
			const i = row + x;
			if (terrain[i] === water) {
				next[i] = 0;
				continue;
			}
			const cur = d[i];
			let sum = 0;
			let count = 0;
			if (x > 0 && terrain[i - 1] !== water) { sum += d[i - 1]; count++; }
			if (x < end && terrain[i + 1] !== water) { sum += d[i + 1]; count++; }
			if (y > 0 && terrain[i - size] !== water) { sum += d[i - size]; count++; }
			if (y < end && terrain[i + size] !== water) { sum += d[i + size]; count++; }
			const value = cur + mix * (sum - count * cur);
			next[i] = value > 0 ? (value > 1 ? 1 : value) : 0;
		}
	}
	d.set(next);
}

function landRestore(i) {
	const before = land.disturbed[i];
	if (before <= 0) return false;
	land.disturbed[i] = before > LAND_RESTORE_AMOUNT ? before - LAND_RESTORE_AMOUNT : 0;
	eventsAdd('Restored ground at ' + (i % MAP_SIZE) + ',' + ((i / MAP_SIZE) | 0) + '.');
	return true;
}

function landStep(seconds) {
	const disturbed = land.disturbed;
	const terrain = world.terrain;
	for (let i = 0; i < world.n; i++) {
		const d = disturbed[i];
		if (d <= 0) continue;
		// Recovery scales with (1 - d): d = 1 never recovers on its own, and active waste outruns it.
		const rate = LAND_RECOVERY[terrain[i]] * (1 - d);
		const next = d - rate * seconds;
		disturbed[i] = next > 0 ? next : 0;
	}
	landSpread(seconds);
}

if (typeof module !== 'undefined') module.exports = { land, landInit, landProductivity, landDisturb, landDisturbAround, landDisturbRing, landSpread, landStep };
