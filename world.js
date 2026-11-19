// owns: the 64x64 terrain grid, seeded heightmap generation and map queries
// edit for: terrain rules, palette, generation tuning

const MAP_SIZE = 64;
const MAP_N = MAP_SIZE * MAP_SIZE;

const TERRAIN = { MEADOW: 0, FOREST: 1, WATER: 2, SWAMP: 3, HILLS: 4, DESERT: 5 };
const TERRAIN_NAME = ['meadow', 'forest', 'water', 'swamp', 'hills', 'desert'];
const TERRAIN_RGB = [
	[104, 142, 78],
	[46, 92, 54],
	[44, 88, 132],
	[82, 102, 70],
	[142, 126, 94],
	[196, 172, 116]
];

const MAP_WATER = 0.38;
const MAP_HILLS = 0.66;
const MAP_DESERT = 0.38;
const MAP_FOREST = 0.62;
const MAP_SWAMP = 0.52;

const world = {
	size: MAP_SIZE,
	n: MAP_N,
	seed: 0,
	terrain: new Uint8Array(MAP_N),
	height: new Float32Array(MAP_N),
	settleValue: new Float32Array(MAP_N),
	startX: MAP_SIZE >> 1,
	startY: MAP_SIZE >> 1
};

function worldGenerate(seed) {
	world.seed = seed >>> 0;
	randomSeed(seed);
	for (let y = 0; y < MAP_SIZE; y++) {
		const row = y * MAP_SIZE;
		for (let x = 0; x < MAP_SIZE; x++) {
			const h = worldFbm(x, y, seed, 4, 0.05);
			const m = worldFbm(x, y, seed + 131, 3, 0.07);
			const i = row + x;
			world.height[i] = h;
			world.terrain[i] = worldTerrainOf(h, m);
		}
	}
	worldSettleValues();
	worldPickStart();
}

// How much room a cell offers a settlement; swamp interiors get nothing, open waterfront gets all of it.
const SETTLE_VALUE_SWAMP_EDGE = 0.15;
const SETTLE_VALUE_DESERT = 0.1;
const SETTLE_VALUE_BY_TERRAIN = [/* meadow */ 0.6, /* forest */ 0.35, /* water */ 0, /* swamp */ 0, /* hills */ 0.45, /* desert */ SETTLE_VALUE_DESERT];

function worldSettleValues() {
	const terrain = world.terrain;
	const value = world.settleValue;
	const size = world.size;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const i = y * size + x;
			const t = terrain[i];
			if (t === TERRAIN.WATER) {
				value[i] = 0;
				continue;
			}
			const l = x > 0 ? terrain[i - 1] : t;
			const r = x < size - 1 ? terrain[i + 1] : t;
			const u = y > 0 ? terrain[i - size] : t;
			const d = y < size - 1 ? terrain[i + size] : t;
			const nearWater = l === TERRAIN.WATER || r === TERRAIN.WATER || u === TERRAIN.WATER || d === TERRAIN.WATER;
			if (t === TERRAIN.SWAMP) {
				const edge = nearWater || l !== TERRAIN.SWAMP || r !== TERRAIN.SWAMP || u !== TERRAIN.SWAMP || d !== TERRAIN.SWAMP;
				value[i] = edge ? SETTLE_VALUE_SWAMP_EDGE : 0;
				continue;
			}
			if (nearWater) {
				value[i] = 1;
				continue;
			}
			const forestMeadowEdge = (t === TERRAIN.FOREST || t === TERRAIN.MEADOW) &&
				(l === TERRAIN.FOREST || r === TERRAIN.FOREST || u === TERRAIN.FOREST || d === TERRAIN.FOREST) &&
				(l === TERRAIN.MEADOW || r === TERRAIN.MEADOW || u === TERRAIN.MEADOW || d === TERRAIN.MEADOW);
			value[i] = forestMeadowEdge ? 0.8 : SETTLE_VALUE_BY_TERRAIN[t];
		}
	}
}

function worldTerrainOf(h, m) {
	if (h < MAP_WATER) return TERRAIN.WATER;
	if (h > MAP_HILLS) return TERRAIN.HILLS;
	if (m < MAP_DESERT) return TERRAIN.DESERT;
	if (m > MAP_FOREST) return TERRAIN.FOREST;
	if (m > MAP_SWAMP) return TERRAIN.SWAMP;
	return TERRAIN.MEADOW;
}

function worldSmooth(t) {
	return t * t * (3 - 2 * t);
}

function worldHash(x, y, seed) {
	let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function worldValueNoise(x, y, seed, freq) {
	const fx = x * freq;
	const fy = y * freq;
	const x0 = Math.floor(fx);
	const y0 = Math.floor(fy);
	const tx = worldSmooth(fx - x0);
	const ty = worldSmooth(fy - y0);
	const top = worldHash(x0, y0, seed) + (worldHash(x0 + 1, y0, seed) - worldHash(x0, y0, seed)) * tx;
	const bottom = worldHash(x0, y0 + 1, seed) + (worldHash(x0 + 1, y0 + 1, seed) - worldHash(x0, y0 + 1, seed)) * tx;
	return top + (bottom - top) * ty;
}

function worldFbm(x, y, seed, octaves, freq) {
	let sum = 0;
	let amp = 1;
	let norm = 0;
	for (let o = 0; o < octaves; o++) {
		sum += worldValueNoise(x, y, seed + o * 7919, freq) * amp;
		norm += amp;
		amp *= 0.5;
		freq *= 2;
	}
	return sum / norm;
}

function worldPickStart() {
	for (let r = 0; r < MAP_SIZE; r++) {
		for (let dy = -r; dy <= r; dy++) {
			for (let dx = -r; dx <= r; dx++) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
				const x = (MAP_SIZE >> 1) + dx;
				const y = (MAP_SIZE >> 1) + dy;
				if (!worldWalkableAt(x, y)) continue;
				if (world.terrain[y * MAP_SIZE + x] !== TERRAIN.MEADOW) continue;
				world.startX = x;
				world.startY = y;
				return;
			}
		}
	}
}

function worldWalkableAt(x, y) {
	if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) return false;
	return world.terrain[y * MAP_SIZE + x] !== TERRAIN.WATER;
}

function worldRandomWalkable() {
	for (let t = 0; t < 400; t++) {
		const x = randomInt(MAP_SIZE);
		const y = randomInt(MAP_SIZE);
		if (worldWalkableAt(x, y)) return y * MAP_SIZE + x;
	}
	return world.startY * MAP_SIZE + world.startX;
}

if (typeof module !== 'undefined') module.exports = { world, worldGenerate, worldWalkableAt, worldSettleValues, MAP_SIZE, TERRAIN };
