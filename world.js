// owns: seeded terrain, cell geometry and continuous observation
// edit for: world generation, terrain rates and investigation falloff
'use strict';

const WORLD_SIZE = 64;
const CELL_COUNT = WORLD_SIZE * WORLD_SIZE;
const TERRAINS = [
	{ name: 'Water', color: '#5496ad', search: 0.65, recovery: 0.0002 },
	{ name: 'Swamp', color: '#698c70', search: 0.7, recovery: 0.0005 },
	{ name: 'Forest', color: '#376d50', search: 0.8, recovery: 0.0008 },
	{ name: 'Meadow', color: '#a7bd75', search: 1, recovery: 0.001 },
	{ name: 'Desert', color: '#d8bd80', search: 1.1, recovery: 0.0001 },
	{ name: 'Hills', color: '#9a927d', search: 0.9, recovery: 0.0002 }
];

function hashValue(x, y, seed) {
	let h = Math.imul(x ^ seed, 374761393) + Math.imul(y, 668265263);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smoothNoise(x, y, seed, scale) {
	const gx = x / scale, gy = y / scale;
	const ix = Math.floor(gx), iy = Math.floor(gy);
	let fx = gx - ix, fy = gy - iy;
	fx = fx * fx * (3 - 2 * fx);
	fy = fy * fy * (3 - 2 * fy);
	const a = hashValue(ix, iy, seed), b = hashValue(ix + 1, iy, seed);
	const c = hashValue(ix, iy + 1, seed), d = hashValue(ix + 1, iy + 1, seed);
	return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

function makeWorld(seed) {
	const terrain = new Uint8Array(CELL_COUNT);
	for (let y = 0; y < WORLD_SIZE; y++) for (let x = 0; x < WORLD_SIZE; x++) {
		const height = smoothNoise(x, y, seed, 10) * 0.75 + smoothNoise(x, y, seed + 3, 4) * 0.25;
		const wet = smoothNoise(x, y, seed + 19, 13);
		terrain[y * WORLD_SIZE + x] = height < 0.29 ? 0 : height > 0.69 ? 5 : wet > 0.68 ? 1 : wet > 0.48 ? 2 : wet < 0.27 ? 4 : 3;
	}
	terrain[8 * WORLD_SIZE + 8] = 3;
	terrain[55 * WORLD_SIZE + 55] = 3;
	return { terrain, disturbance: new Float32Array(CELL_COUNT), influence: [new Float32Array(CELL_COUNT), new Float32Array(CELL_COUNT)], control: new Int8Array(CELL_COUNT).fill(-1) };
}

function observationRadius(terrain) {
	return terrain === 2 ? 1.9 : terrain === 5 ? 3.5 : 2.7;
}

function observationWeight(distance, radius, hill) {
	if (distance >= radius) return 0;
	const t = Math.max(0, 1 - distance / radius);
	const smooth = t * t * (3 - 2 * t);
	return hill ? Math.min(1, smooth + smooth * (1 - smooth) * 0.35) : smooth;
}

function investigate(world, party, skill) {
	const centre = Math.floor(party.y) * WORLD_SIZE + Math.floor(party.x);
	const terrain = world.terrain[centre];
	const radius = observationRadius(terrain);
	const minX = Math.max(0, Math.floor(party.x - radius)), maxX = Math.min(WORLD_SIZE - 1, Math.floor(party.x + radius));
	const minY = Math.max(0, Math.floor(party.y - radius)), maxY = Math.min(WORLD_SIZE - 1, Math.floor(party.y + radius));
	for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
		const i = y * WORLD_SIZE + x;
		if (world.control[i] !== -1 && world.control[i] !== party.id) continue;
		const weight = observationWeight(Math.hypot(x + 0.5 - party.x, y + 0.5 - party.y), radius, terrain === 5);
		party.search[i] = Math.min(100, party.search[i] + weight * TERRAINS[world.terrain[i]].search * (3 + skill * 0.15));
	}
}

if (typeof module !== 'undefined') module.exports = { WORLD_SIZE, CELL_COUNT, TERRAINS, makeWorld, observationRadius, observationWeight, investigate };
