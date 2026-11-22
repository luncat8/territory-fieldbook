// owns: per-cell transport speed, edge conductance and bounded travel-time search
// edit for: terrain speed table, harmonic-mean edges, max-1.0 normalization, step cost

// Reserve 1.0 for roads and future ships (twice meadow); water stays blocked for now.
// Above-cap tuning normalizes the whole map, keeping D·max(c)·dt within the same budget.
const TRANSPORT_SPEED_BY_TERRAIN = [0.5, 0.2, 0, 0.05, 0.1, 0.4];
const TRANSPORT_TUNE_BY_TERRAIN = ['groundMeadow', 'groundForest', null, 'groundSwamp', 'groundHills', 'groundDesert'];

// Travel time is counted in meadow steps (cost = meadow speed / c), so an all-meadow map keeps
// its step distances: forest steps cost 2.5, swamp 10, a road 0.5.
const TRANSPORT_STEP_REF = TRANSPORT_SPEED_BY_TERRAIN[0];

const transport = {
	speed: null,
	condR: null,
	condD: null,
	maxSpeed: 1,
	maxCond: 1,
	time: null,
	order: null,
	seen: null,
	done: null,
	stamp: 0,
	heapKey: null,
	heapCell: null
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
	if (transport.time && transport.time.length === n) return;
	transport.time = new Float64Array(n);
	transport.order = new Int32Array(n);
	transport.seen = new Uint32Array(n);
	transport.done = new Uint32Array(n);
	transport.stamp = 0;
	transport.heapKey = new Float64Array(4 * n + 1);
	transport.heapCell = new Int32Array(4 * n + 1);
}

function transportHeapPush(count, key, cell) {
	const keys = transport.heapKey;
	const cells = transport.heapCell;
	let k = count;
	while (k > 0) {
		const up = (k - 1) >> 1;
		if (keys[up] <= key) break;
		keys[k] = keys[up];
		cells[k] = cells[up];
		k = up;
	}
	keys[k] = key;
	cells[k] = cell;
	return count + 1;
}

// Removes the root; the caller has already read it.
function transportHeapPop(count) {
	const keys = transport.heapKey;
	const cells = transport.heapCell;
	const last = count - 1;
	const key = keys[last];
	const cell = cells[last];
	let k = 0;
	for (;;) {
		let child = 2 * k + 1;
		if (child >= last) break;
		if (child + 1 < last && keys[child + 1] < keys[child]) child++;
		if (keys[child] >= key) break;
		keys[k] = keys[child];
		cells[k] = cells[child];
		k = child;
	}
	keys[k] = key;
	cells[k] = cell;
	return last;
}

function transportRelax(count, from, to, c, budget, stamp) {
	if (c <= 0 || transport.done[to] === stamp) return count;
	const t = transport.time[from] + TRANSPORT_STEP_REF / c;
	if (t > budget) return count;
	if (transport.seen[to] === stamp && transport.time[to] <= t) return count;
	transport.seen[to] = stamp;
	transport.time[to] = t;
	return transportHeapPush(count, t, to);
}

// Dijkstra over edge conductance from one cell, stopping at the budget (meadow steps). Settled
// cells land in transport.order by arrival time and keep their time in transport.time until the
// next search; returns how many settled. Lazy deletion: stale heap entries are skipped.
function transportTravel(start, budget) {
	const size = world.size;
	const end = size - 1;
	const { condR, condD, time, order, seen, done } = transport;
	const stamp = ++transport.stamp;
	seen[start] = stamp;
	time[start] = 0;
	let heap = transportHeapPush(0, 0, start);
	let count = 0;
	while (heap > 0) {
		const i = transport.heapCell[0];
		const t = transport.heapKey[0];
		heap = transportHeapPop(heap);
		if (done[i] === stamp || t > time[i]) continue;
		done[i] = stamp;
		order[count++] = i;
		const x = i % size;
		if (x > 0) heap = transportRelax(heap, i, i - 1, condR[i - 1], budget, stamp);
		if (x < end) heap = transportRelax(heap, i, i + 1, condR[i], budget, stamp);
		if (i >= size) heap = transportRelax(heap, i, i - size, condD[i - size], budget, stamp);
		if (i < world.n - size) heap = transportRelax(heap, i, i + size, condD[i], budget, stamp);
	}
	return count;
}

if (typeof module !== 'undefined') {
	module.exports = { transport, transportBuild, transportRebuild, transportEdge, transportTravel, TRANSPORT_SPEED_BY_TERRAIN, TRANSPORT_STEP_REF };
}
