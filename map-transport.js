// owns: per-cell transport speed and edge conductance
// edit for: terrain speed table, harmonic-mean edges, max-1.0 normalization

// Reserve 1.0 for roads and future ships (twice meadow); water stays blocked for now.
// Above-cap tuning normalizes the whole map, keeping D·max(c)·dt within the same budget.
const TRANSPORT_SPEED_BY_TERRAIN = [0.5, 0.2, 0, 0.05, 0.1, 0.4];
const TRANSPORT_TUNE_BY_TERRAIN = ['groundMeadow', 'groundForest', null, 'groundSwamp', 'groundHills', 'groundDesert'];

const transport = {
	speed: null,
	condR: null,
	condD: null,
	maxSpeed: 1,
	maxCond: 1
};

function transportEdge(a, b) {
	if (a <= 0 || b <= 0) return 0;
	return 2 * a * b / (a + b);
}

// Pure build for any terrain/size (experiments use synthetic grids); the live map
// copies the result into the preallocated global buffers via transportRebuild.
function transportBuild(terrain, size, multipliers) {
	const n = size * size;
	const speed = new Float32Array(n);
	const condR = new Float32Array(n);
	const condD = new Float32Array(n);
	const mult = [1, 1, 1, 1, 1, 1];
	const tuning = multipliers || tune;
	if (tuning) {
		for (let t = 0; t < 6; t++) {
			const id = TRANSPORT_TUNE_BY_TERRAIN[t];
			if (id && tuning[id] !== undefined) mult[t] = tuning[id];
		}
	}
	let maxSpeed = 0;
	for (let i = 0; i < n; i++) {
		const s = TRANSPORT_SPEED_BY_TERRAIN[terrain[i]] * mult[terrain[i]];
		speed[i] = s;
		if (s > maxSpeed) maxSpeed = s;
	}
	if (maxSpeed > 1) {
		for (let i = 0; i < n; i++) speed[i] /= maxSpeed;
		maxSpeed = 1;
	}
	let maxCond = 0;
	for (let y = 0; y < size; y++) {
		const row = y * size;
		for (let x = 0; x < size; x++) {
			const i = row + x;
			if (x + 1 < size) {
				const c = transportEdge(speed[i], speed[i + 1]);
				condR[i] = c;
				if (c > maxCond) maxCond = c;
			}
			if (y + 1 < size) {
				const c = transportEdge(speed[i], speed[i + size]);
				condD[i] = c;
				if (c > maxCond) maxCond = c;
			}
		}
	}
	return { speed, condR, condD, maxSpeed, maxCond };
}

function transportRebuild() {
	const size = world.size;
	const n = world.n;
	if (!transport.speed || transport.speed.length !== n) {
		transport.speed = new Float32Array(n);
		transport.condR = new Float32Array(n);
		transport.condD = new Float32Array(n);
	}
	const built = transportBuild(world.terrain, size);
	transport.speed.set(built.speed);
	transport.condR.set(built.condR);
	transport.condD.set(built.condD);
	transport.maxSpeed = built.maxSpeed;
	transport.maxCond = built.maxCond;
}

if (typeof module !== 'undefined') {
	module.exports = { transport, transportBuild, transportRebuild, transportEdge, TRANSPORT_SPEED_BY_TERRAIN };
}
