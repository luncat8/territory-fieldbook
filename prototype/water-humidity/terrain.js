// owns: seeded heightmap scenarios, depression filling and spring placement
// edit for: terrain shapes, sea rules, spring selection
'use strict';

var SEA_LEVEL = 0.36;
var SEA_DEPTH = 3;
var SEA_HEIGHT = SEA_LEVEL - 0.08;
const SPRING_COUNT = 9;
const SPRING_GAP = 7;

var waterIndex = function waterIndex(x, y, width) {
	return y * width + x;
};

var waterHash = function waterHash(x, y, seed) {
	let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

var waterNoise = function waterNoise(x, y, seed, freq) {
	const fx = x * freq;
	const fy = y * freq;
	const x0 = Math.floor(fx);
	const y0 = Math.floor(fy);
	const tx = fx - x0;
	const ty = fy - y0;
	const sx = tx * tx * (3 - 2 * tx);
	const sy = ty * ty * (3 - 2 * ty);
	const a = waterHash(x0, y0, seed);
	const b = waterHash(x0 + 1, y0, seed);
	const c = waterHash(x0, y0 + 1, seed);
	const d = waterHash(x0 + 1, y0 + 1, seed);
	const top = a + (b - a) * sx;
	const bottom = c + (d - c) * sx;
	return top + (bottom - top) * sy;
};

var waterFbm = function waterFbm(x, y, seed, octaves, freq) {
	let sum = 0;
	let amp = 1;
	let norm = 0;
	for (let o = 0; o < octaves; o++) {
		sum += waterNoise(x, y, seed + o * 7919, freq) * amp;
		norm += amp;
		amp *= 0.5;
		freq *= 2;
	}
	return sum / norm;
};

var waterBuild = function waterBuild(lab, scenario, seed) {
	const w = lab.width;
	const h = lab.rows;
	const elev = lab.elev;
	const sea = lab.sea;
	sea.fill(0);
	lab.springCount = 0;
	let rnd = (seed ^ 0x9e3779b9) >>> 0;
	const rand = () => {
		rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0;
		return rnd / 4294967296;
	};
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			let value;
			if (scenario === 'coast') value = 0.34 + 0.4 * x / (w - 1) + 0.2 * (waterFbm(x, y, seed, 4, 0.045) - 0.5);
			else if (scenario === 'valleys') value = 0.34 + 0.4 * x / (w - 1) + 0.2 * (waterFbm(x * 0.35, y, seed, 4, 0.05) - 0.5) + 0.04 * (waterFbm(x, y, seed + 77, 3, 0.05) - 0.5);
			else if (scenario === 'islands') value = waterFbm(x, y, seed, 4, 0.04);
			else if (scenario === 'basin') {
				const dx = (x - w * 0.5) / (w * 0.5);
				const dy = (y - h * 0.5) / (h * 0.5);
				value = 0.72 - 0.45 * Math.exp(-2.4 * (dx * dx + dy * dy)) + 0.09 * (waterFbm(x, y, seed, 3, 0.06) - 0.5);
			}
			else if (scenario === 'flat') value = 0.95 - 0.5 * y / (h - 1);
			else value = 0.5;
			const isSea = scenario === 'flat' ? y === h - 1 :
				scenario === 'blank' || scenario === 'basin' ? false :
				scenario === 'coast' || scenario === 'valleys' ? x < 5 : value < SEA_LEVEL;
			sea[i] = isSea ? 1 : 0;
			elev[i] = isSea ? SEA_HEIGHT : Math.max(value, SEA_LEVEL + 0.02);
		}
	}
	waterFill(lab);
	for (let i = 0; i < lab.n; i++) {
		lab.water[i] = sea[i] ? SEA_DEPTH : 0;
	}
	const count = scenario === 'flat' ? 1 : scenario === 'blank' ? 0 : SPRING_COUNT;
	for (let k = 0; k < count; k++) {
		if (scenario === 'flat') {
			lab.springs[lab.springCount++] = waterIndex(w >> 1, 2, w);
			continue;
		}
		let best = -1;
		let bestValue = -1;
		for (let t = 0; t < 160; t++) {
			const x = 2 + Math.floor(rand() * (w - 4));
			const y = 2 + Math.floor(rand() * (h - 4));
			const i = y * w + x;
			if (sea[i]) continue;
			let far = true;
			for (let s = 0; s < lab.springCount; s++) {
				const sx = lab.springs[s] % w;
				const sy = (lab.springs[s] / w) | 0;
				if ((x - sx) * (x - sx) + (y - sy) * (y - sy) < SPRING_GAP * SPRING_GAP) { far = false; break; }
			}
			if (!far) continue;
			const score = elev[i] + rand() * 0.03;
			if (score > bestValue) { bestValue = score; best = i; }
		}
		if (best < 0) continue;
		lab.springs[lab.springCount++] = best;
	}
};

// Priority flood: drainage elevation is the lowest crest on any path to the sea.
// max(e, min neighbour) leaves whole depressions unfilled; min(max(e, neighbour)) is the flood.
var waterFill = function waterFill(lab) {
	const w = lab.width;
	const h = lab.rows;
	const elev = lab.elev;
	const filled = lab.filled;
	const sea = lab.sea;
	let hasSea = false;
	for (let i = 0; i < lab.n; i++) if (sea[i]) { hasSea = true; break; }
	if (!hasSea) { filled.set(elev); return; }
	for (let i = 0; i < lab.n; i++) filled[i] = sea[i] ? SEA_HEIGHT : Infinity;
	for (let pass = 0; pass < w + h + 8; pass++) {
		let changed = false;
		for (let y = 0; y < h; y++) {
			const row = y * w;
			for (let x = 0; x < w; x++) {
				const i = row + x;
				if (sea[i]) continue;
				let best = filled[i];
				if (x > 0) best = Math.min(best, Math.max(elev[i], filled[i - 1]));
				if (x < w - 1) best = Math.min(best, Math.max(elev[i], filled[i + 1]));
				if (y > 0) best = Math.min(best, Math.max(elev[i], filled[i - w]));
				if (y < h - 1) best = Math.min(best, Math.max(elev[i], filled[i + w]));
				if (best < filled[i] - 1e-12) { filled[i] = best; changed = true; }
			}
		}
		if (!changed) break;
	}
	for (let i = 0; i < lab.n; i++) if (!Number.isFinite(filled[i])) filled[i] = elev[i];
};

if (typeof module !== 'undefined') {
	module.exports = { SEA_LEVEL, SEA_DEPTH, SEA_HEIGHT, SPRING_COUNT, SPRING_GAP, waterIndex, waterHash, waterNoise, waterFbm, waterBuild, waterFill };
};
