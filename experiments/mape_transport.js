// owns: transport speed map gate — all-1 reproduction, swamp delay/detour, ledger, water
// barrier, road bound, pull reach sqrt(c), mix budget, travel-time catchments and scan fields
// run: node experiments/mape_transport.js

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const [, file] of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
	vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}

let failures = 0;
function check(name, ok, extra) {
	console.log('check_' + name + '=' + (ok ? 'pass' : 'fail') + (extra ? ' ' + extra : ''));
	if (!ok) failures++;
}

const size = 64;
const n = size * size;
const meadow = new Uint8Array(n).fill(TERRAIN.MEADOW);
const center = 32 * size + 32;

// The absolute scale leaves headroom for roads/ships even on maps without meadow.
{
	const terr = new Uint8Array([TERRAIN.MEADOW, TERRAIN.DESERT, TERRAIN.FOREST, TERRAIN.HILLS, TERRAIN.SWAMP, TERRAIN.WATER, TERRAIN.MEADOW, TERRAIN.MEADOW, TERRAIN.MEADOW]);
	const built = transportBuild(terr, 3);
	const expected = [0.5, 0.4, 0.2, 0.1, 0.05, 0];
	check('terrain_speed_scale', expected.every((v, i) => Math.abs(built.speed[i] - v) < 1e-7) && built.maxSpeed === 0.5);
	check('harmonic_edges', Math.abs(built.condR[0] - 2 * 0.5 * 0.4 / 0.9) < 1e-7 && built.condD[2] === 0 && built.condR[5] === 0);
}

// Budget: max stays 1.0 by normalization, so every shipped D stays inside MAPE_MIX_MAX.
{
	const built = transportBuild(meadow, size);
	const shipped = [MAPE_DIFFUSE, MAPE_CO2_DIFFUSE, MAPE_CATCHMENT_DIFFUSE, MAPE_QUEUE_DIFFUSE, MAPE_WF_DIFFUSE];
	let ok = built.maxSpeed <= 1 + 1e-12 && built.maxCond <= 1 + 1e-12;
	for (const d of shipped) {
		if (!(d * built.maxCond * SIM_STEP_SEC <= MAPE_MIX_MAX + 1e-12)) ok = false;
	}
	check('mix_budget_holds', ok, 'maxSpeed=' + built.maxSpeed.toFixed(3) + ' maxCond=' + built.maxCond.toFixed(3));
}

// All-1 map reproduces the old kernels bit for bit.
{
	const built = transportBuild(meadow, size, { groundMeadow: 2 });
	const mk = () => ({
		demand: new Float64Array(n),
		demandNext: new Float64Array(n),
		goods: new Float64Array(n),
		goodsNext: new Float64Array(n),
		pop: new Float64Array(n),
		work: new Float64Array(n),
		workNext: new Float64Array(n)
	});
	const a = mk();
	const b = mk();
	for (const s of [a, b]) {
		s.demand[center + 2] = 5;
		s.goods[center] = 100;
		s.pop[center] = 20;
	}
	for (let t = 0; t < 20; t++) {
		mapeKernelStep(size, 1, meadow, a.demand, a.demandNext, a.goods, a.goodsNext, a.pop, a.work, a.workNext, SIM_STEP_SEC);
		mapeKernelStep(size, 1, meadow, b.demand, b.demandNext, b.goods, b.goodsNext, b.pop, b.work, b.workNext, SIM_STEP_SEC, built);
	}
	let maxDiff = 0;
	for (let i = 0; i < n; i++) {
		maxDiff = Math.max(maxDiff, Math.abs(a.demand[i] - b.demand[i]), Math.abs(a.goods[i] - b.goods[i]), Math.abs(a.work[i] - b.work[i]));
	}
	check('all_one_reproduces', maxDiff === 0, 'maxDiff=' + maxDiff.toExponential(2));
}

// Water at c = 0 matches the old water barrier bit for bit.
{
	const walled = new Uint8Array(meadow);
	for (let y = 0; y < size; y++) walled[y * size + 40] = TERRAIN.WATER;
	const built = transportBuild(walled, size, { groundMeadow: 2 });
	const spread = (cond) => {
		const field = new Float64Array(n);
		const scratch = new Float64Array(n);
		field[center] = 1000;
		for (let t = 0; t < 80; t++) mapeDiffuseSlice(field, scratch, 0, size, walled, true, MAPE_DIFFUSE, 0, SIM_STEP_SEC, cond);
		return field;
	};
	const oldF = spread(null);
	const newF = spread(built);
	let maxDiff = 0;
	let beyond = 0;
	for (let i = 0; i < n; i++) {
		maxDiff = Math.max(maxDiff, Math.abs(oldF[i] - newF[i]));
	}
	for (let y = 0; y < size; y++) {
		for (let x = 40; x < size; x++) beyond += newF[y * size + x];
	}
	check('water_barrier_bit_for_bit', maxDiff === 0 && beyond === 0, 'maxDiff=' + maxDiff.toExponential(2) + ' beyond=' + beyond);
}

// RMS pull reach has no grid-threshold bias: for a homogeneous medium it scales as sqrt(c).
{
	const swamp = new Uint8Array(n).fill(TERRAIN.SWAMP);
	const reachOf = (terrain) => {
		const cond = transportBuild(terrain, size);
		const field = new Float64Array(n);
		const scratch = new Float64Array(n);
		for (let t = 0; t < 600; t++) {
			field[center] += 10 * SIM_STEP_SEC;
			mapeDiffuseSlice(field, scratch, 0, size, terrain, true, MAPE_DIFFUSE, 0.05, SIM_STEP_SEC, cond);
		}
		let sum = 0;
		let moment = 0;
		for (let i = 0; i < n; i++) {
			const dx = i % size - 32;
			const dy = Math.floor(i / size) - 32;
			sum += field[i];
			moment += field[i] * (dx * dx + dy * dy);
		}
		return Math.sqrt(moment / sum);
	};
	const ratio = reachOf(swamp) / reachOf(meadow);
	const expect = Math.sqrt(0.1);
	check('pull_reach_sqrt_c', Math.abs(ratio - expect) < 0.01, 'ratio=' + ratio.toFixed(3) + ' expect=' + expect.toFixed(3));
}

// Haul prefers the fast route: a swamp cell east of the source takes less than the meadow west.
{
	const terr = new Uint8Array(n).fill(TERRAIN.MEADOW);
	terr[32 * size + 33] = TERRAIN.SWAMP;
	const built = transportBuild(terr, size);
	const run = (cond) => {
		const demand = new Float64Array(n);
		const demandNext = new Float64Array(n);
		const goods = new Float64Array(n);
		const goodsNext = new Float64Array(n);
		const pop = new Float64Array(n);
		const work = new Float64Array(n);
		const workNext = new Float64Array(n);
		demand[32 * size + 34] = 1;
		demand[32 * size + 30] = 1;
		goods[center] = 100;
		pop[center] = 20;
		mapeKernelStep(size, 1, terr, demand, demandNext, goods, goodsNext, pop, work, workNext, SIM_STEP_SEC, cond);
		return { east: goods[32 * size + 33], west: goods[32 * size + 31] };
	};
	const plain = run(null);
	const slowed = run(built);
	const plainShare = plain.east / (plain.east + plain.west);
	const slowedShare = slowed.east / (slowed.east + slowed.west);
	check('haul_prefers_fast_route', slowedShare < plainShare - 0.05, 'plain=' + plainShare.toFixed(3) + ' slowed=' + slowedShare.toFixed(3));
}

// Both routes end at the same buyer: count actual transfers across the swamp and meadow bypass.
{
	const sz = 17;
	const cells = sz * sz;
	const terr = new Uint8Array(cells).fill(TERRAIN.WATER);
	for (let x = 2; x <= 14; x++) terr[8 * sz + x] = x >= 6 && x <= 10 ? TERRAIN.SWAMP : TERRAIN.MEADOW;
	for (let x = 4; x <= 12; x++) terr[5 * sz + x] = TERRAIN.MEADOW;
	for (let y = 5; y <= 8; y++) terr[y * sz + 4] = terr[y * sz + 12] = TERRAIN.MEADOW;
	const cond = transportBuild(terr, sz);
	const pull = new Float64Array(cells);
	const scratch = new Float64Array(cells);
	const source = 8 * sz + 2;
	const buyer = 8 * sz + 14;
	for (let t = 0; t < 6000; t++) {
		pull[buyer] = 1;
		pull[source] = 0;
		mapeDiffuseSlice(pull, scratch, 0, sz, terr, true, MAPE_CATCHMENT_DIFFUSE, 0, SIM_STEP_SEC, cond);
	}
	pull[buyer] = 1;
	pull[source] = 0;
	const goods = new Float64Array(cells);
	const next = new Float64Array(cells);
	const pop = new Float64Array(cells).fill(100);
	const work = new Float64Array(cells);
	const effort = new Float64Array(cells);
	const flowX = new Float64Array(cells);
	const flowY = new Float64Array(cells);
	goods[source] = 100;
	let swampFlow = 0;
	let detourFlow = 0;
	for (let t = 0; t < 6000; t++) {
		next.set(goods);
		flowX.fill(0);
		mapeTransportSlice(0, sz, terr, pull, goods, next, pop, work, effort, SIM_STEP_SEC, false, flowX, flowY, cond);
		goods.set(next);
		swampFlow += flowX[8 * sz + 8];
		detourFlow += flowX[5 * sz + 8];
	}
	const sum = goods.reduce((a, b) => a + b, 0);
	const share = detourFlow / (swampFlow + detourFlow);
	check('meadow_detour_to_same_buyer', share > 0.6 && goods[buyer] > 90 && Math.abs(sum - 100) < 1e-6,
		'detourShare=' + share.toFixed(3) + ' delivered=' + goods[buyer].toFixed(2));
}

// Per-unit haul effort is 1/c, independent of gradient size or total stock.
{
	const sz = 3;
	const terr = new Uint8Array(9).fill(TERRAIN.SWAMP);
	const cond = transportBuild(terr, sz);
	const pull = new Float64Array(9);
	const next = new Float64Array(9);
	pull[5] = 1;
	next[4] = 100;
	const effort = mapePushUpGradient(1, 1, 4, 4, sz, terr, pull, next, 10, MAPE_GRAD_REF, 0, null, null, null, false, cond);
	const expected = next[5] / cond.condR[4] * MAPE_WORKFORCE_PER_UNIT;
	check('haul_effort_inverse_c', next[5] > 0 && Math.abs(effort - expected) < 1e-9);
}

// First arrival through swamp is delayed.
{
	const line = (terrain) => {
		const demand = new Float64Array(n);
		const demandNext = new Float64Array(n);
		const goods = new Float64Array(n);
		const goodsNext = new Float64Array(n);
		const pop = new Float64Array(n);
		const work = new Float64Array(n);
		const workNext = new Float64Array(n);
		const built = transportBuild(terrain, size);
		demand[center + 5] = 1;
		goods[center] = 100;
		pop[center] = 20;
		for (let t = 1; t <= 600; t++) {
			mapeKernelStep(size, 1, terrain, demand, demandNext, goods, goodsNext, pop, work, workNext, SIM_STEP_SEC, built);
			if (goods[center + 5] > 1e-6) return t;
		}
		return 601;
	};
	const meadowLine = new Uint8Array(n).fill(TERRAIN.MEADOW);
	const swampLine = new Uint8Array(n).fill(TERRAIN.MEADOW);
	for (let x = 33; x <= 37; x++) swampLine[32 * size + x] = TERRAIN.SWAMP;
	const tMeadow = line(meadowLine);
	const tSwamp = line(swampLine);
	check('swamp_delays_arrival', tMeadow < 601 && tSwamp < 601 && tSwamp > 2 * tMeadow, 'meadow=' + tMeadow + ' swamp=' + tSwamp);
}

// Exercise the real builder under extreme tuning, not a hand-normalized test field.
{
	const terr = new Uint8Array(n).fill(TERRAIN.FOREST);
	for (let x = 0; x < size; x++) terr[32 * size + x] = TERRAIN.MEADOW;
	const built = transportBuild(terr, size, { groundMeadow: 50 });
	const field = new Float64Array(n);
	const scratch = new Float64Array(n);
	field[center] = 1000;
	for (let t = 0; t < 80; t++) mapeDiffuseSlice(field, scratch, 0, size, terr, true, MAPE_CATCHMENT_DIFFUSE, 0, SIM_STEP_SEC, built);
	let lo = Infinity;
	let hi = -Infinity;
	let sum = 0;
	for (let i = 0; i < n; i++) {
		lo = Math.min(lo, field[i]);
		hi = Math.max(hi, field[i]);
		sum += field[i];
	}
	check('road_50x_bounded', built.maxSpeed === 1 && built.maxCond <= 1 && lo >= 0 && hi <= 1000 && Math.abs(sum - 1000) < 1e-6,
		'lo=' + lo.toExponential(2) + ' hi=' + hi.toFixed(3) + ' residual=' + Math.abs(sum - 1000).toExponential(2));
}

// Exercise both workforce modes and all field engines with the shipped terrain table.
for (const engine of [MAPE_ENGINE.DIFFUSION, MAPE_ENGINE.CATCHMENT, MAPE_ENGINE.QUEUE]) {
	for (const mode of [MAPE_WORKFORCE_MODE.RESIDENTS, MAPE_WORKFORCE_MODE.FLUID]) {
		main.setup(START_SEED, '', 0, engine);
		mapeSetWorkforceMode(mode);
		for (let t = 0; t < 200; t++) mapeStep(SIM_STEP_SEC);
		const residual = Math.abs(mapeLedgerResidual());
		check('ledger_engine_' + engine + '_workforce_' + mode, residual < 1e-6 && Math.abs(mapePopResidual()) < 1e-6 && mape.goods.every(v => Number.isFinite(v) && v >= 0),
			'residual=' + residual.toExponential(2));
	}
}

// Live tuning rebuilds immediately, preserves buffer identity and survives a new setup.
{
	main.setup(START_SEED, 'a');
	const buffer = transport.speed;
	tuneSet('groundMeadow', 0.5);
	check('tuning_rebuilds_live', transport.speed === buffer && transport.speed[center] === 0.25 && transport.condR[center] === 0.25);
	main.setup(START_SEED, 'b');
	check('setup_preserves_tuning', transport.speed[center] === 0.25);
	tuneReset();
	check('tuning_reset', transport.speed[center] === 0.5);
}

// A/B Jacobi and queue admission use the same conductance, including 1/c queue effort.
{
	const terr = new Uint8Array(meadow);
	terr[center + 1] = TERRAIN.SWAMP;
	const cond = transportBuild(terr, size);
	const src = new Float64Array(n);
	const dst = new Float64Array(n);
	src[center] = 1;
	mapeMarketJacobi(src, dst, 0, 0.15, cond);
	const c = cond.condR[center];
	check('market_pull_uses_conductance', Math.abs(dst[center + 1] - 0.15 * c) < 1e-12 && dst[center - 1] > 4 * dst[center + 1]);
	mape.demand.fill(0);
	mape.demand[center - 1] = mape.demand[center + 1] = 1;
	mape.goods.fill(0);
	mape.goods[center] = 100;
	mape.goodsNext.set(mape.goods);
	mapeMarketFlow.room.fill(-1);
	mapeMarketFlow.requests.fill(0);
	mapeMarketFlow.accepted.fill(0);
	mapeRequestQueueTransfers(center, 0, 0.1, cond);
	const effort = mapeApplyQueueTransfers(center, 0, cond);
	const east = mape.goodsNext[center + 1];
	const west = mape.goodsNext[center - 1];
	const expected = (east / c + west / cond.condR[center - 1]) * MAPE_WORKFORCE_PER_UNIT;
	check('queue_routes_and_charges_effort', west > 4 * east && east > 0 && Math.abs(effort - expected) < 1e-9 && Math.abs(mape.goodsNext.reduce((a, b) => a + b, 0) - 100) < 1e-9);
}

// Speeds are absolute: uniformly slow ground sends c-times less on a steep gradient, in the
// field haul and in queue admission alike (a weighted denominator would cancel c here).
{
	const sent = (terr) => {
		const cond = transportBuild(terr, size);
		const demand = new Float64Array(n);
		const goods = new Float64Array(n);
		for (const k of [center - 1, center + 1, center - size, center + size]) demand[k] = 1;
		goods[center] = 100;
		mapeKernelStep(size, 1, terr, demand, new Float64Array(n), goods, new Float64Array(n), new Float64Array(n).fill(20), new Float64Array(n), new Float64Array(n), SIM_STEP_SEC, cond);
		return 100 - goods[center];
	};
	const swampAll = new Uint8Array(n).fill(TERRAIN.SWAMP);
	const fieldRatio = sent(swampAll) / sent(meadow);
	const queued = (terr) => {
		const cond = transportBuild(terr, size);
		mape.demand.fill(0);
		for (let d = 0; d < MAPE_LAND_LINKS; d++) mape.demand[mapeMarketFlow.links[center * MAPE_LAND_LINKS + d]] = 1;
		mape.demand[center] = 0;
		mape.goods.fill(0);
		mape.goods[center] = 100;
		mape.goodsNext.set(mape.goods);
		mapeMarketFlow.room.fill(-1);
		mapeMarketFlow.requests.fill(0);
		mapeMarketFlow.accepted.fill(0);
		mapeRequestQueueTransfers(center, 0, 0.1, cond);
		mapeApplyQueueTransfers(center, 0, cond);
		return 100 - mape.goodsNext[center];
	};
	const queueRatio = queued(swampAll) / queued(meadow);
	const expect = TRANSPORT_SPEED_BY_TERRAIN[TERRAIN.SWAMP] / TRANSPORT_SPEED_BY_TERRAIN[TERRAIN.MEADOW];
	check('uniform_slow_ground_sends_less', Math.abs(fieldRatio - expect) < 0.02 && Math.abs(queueRatio - expect) < 0.02,
		'field=' + fieldRatio.toFixed(3) + ' queue=' + queueRatio.toFixed(3) + ' expect=' + expect.toFixed(3));
}

// Fresh and depleted movement share the map, conserve pools, and respect zero-speed edges.
{
	const terr = new Uint8Array(meadow);
	terr[center + 1] = TERRAIN.SWAMP;
	const cond = transportBuild(terr, size);
	const pull = new Float64Array(n);
	pull[center + 1] = pull[center - 1] = 1;
	const fresh = new Float64Array(n);
	const next = new Float64Array(n);
	fresh[center] = 100;
	mapeFluidAdvect(SIM_STEP_SEC, size, terr, pull, fresh, next, cond);
	check('fresh_prefers_fast_ground', fresh[center - 1] > 4 * fresh[center + 1] && Math.abs(fresh.reduce((a, b) => a + b, 0) - 100) < 1e-9);
	const depleted = new Float64Array(n);
	depleted[center] = 100;
	mapeFluidDiffuse(SIM_STEP_SEC, size, terr, depleted, next, cond);
	check('depleted_uses_conductance', depleted[center - 1] > 4 * depleted[center + 1] && Math.abs(depleted.reduce((a, b) => a + b, 0) - 100) < 1e-9);
	terr[center + 1] = TERRAIN.WATER;
	const blocked = transportBuild(terr, size);
	fresh.fill(0);
	fresh[center] = 100;
	mapeFluidAdvect(SIM_STEP_SEC, size, terr, pull, fresh, next, blocked);
	check('workers_do_not_cross_water', fresh[center + 1] === 0);
}

// Travel-time budgets: meadow reproduces the 4-step diamond and its falloff; slower ground shrinks
// it, faster ground (up to a road) grows it within the stencil, and tuning rebuilds it live.
{
	main.setup(START_SEED, 'a');
	tuneReset();
	const countAt = (i) => mapeMarketFlow.counts[i];
	const base = center * MAPE_CATCHMENT_SIZE;
	let diamond = countAt(center) === 41;
	for (let k = 0; k < countAt(center); k++) {
		const cell = mapeMarketFlow.catchments[base + k];
		const steps = Math.abs(cell % size - 32) + Math.abs(((cell / size) | 0) - 32);
		if (steps > MAPE_CATCHMENT_STEPS || Math.abs(mapeMarketFlow.weights[base + k] - Math.fround(1 - steps / (MAPE_CATCHMENT_STEPS + 1))) > 1e-7) diamond = false;
	}
	check('catchment_meadow_diamond', diamond && countAt(0) === 15, 'center=' + countAt(center) + ' corner=' + countAt(0));
	tuneSet('groundMeadow', 0.5);
	const slow = countAt(center);
	tuneSet('groundMeadow', 2);
	const road = countAt(center);
	tuneReset();
	check('catchment_follows_tuning', slow === 13 && road === MAPE_CATCHMENT_SIZE && countAt(center) === 41,
		'slow=' + slow + ' road=' + road + ' size=' + MAPE_CATCHMENT_SIZE);
	const ground = (t) => {
		world.terrain.fill(t);
		transportRebuild();
		mapeMarketFlowPrepare();
		return countAt(center);
	};
	const forest = ground(TERRAIN.FOREST);
	const swamp = ground(TERRAIN.SWAMP);
	check('catchment_shrinks_on_slow_ground', forest === 5 && swamp === 1, 'forest=' + forest + ' swamp=' + swamp);
}

// Dijkstra agrees with brute-force relaxation on the seeded survey, and a scan field along a
// one-cell causeway sums 0.5 / c per edge, so a swamp stretch costs its extra travel time.
{
	main.setup(START_SEED, '');
	let start = center;
	while (world.terrain[start] === TERRAIN.WATER) start++;
	const count = transportTravel(start, Infinity);
	const fast = new Float64Array(n).fill(-1);
	for (let k = 0; k < count; k++) fast[transport.order[k]] = transport.time[transport.order[k]];
	const brute = new Float64Array(n).fill(Infinity);
	brute[start] = 0;
	for (let changed = true; changed;) {
		changed = false;
		for (let i = 0; i < n; i++) {
			const x = i % size;
			const relax = (j, c) => {
				if (c <= 0) return;
				const t = brute[i] + TRANSPORT_STEP_REF / c;
				if (t < brute[j] - 1e-12) { brute[j] = t; changed = true; }
			};
			if (brute[i] === Infinity) continue;
			if (x > 0) relax(i - 1, transport.condR[i - 1]);
			if (x < size - 1) relax(i + 1, transport.condR[i]);
			if (i >= size) relax(i - size, transport.condD[i - size]);
			if (i < n - size) relax(i + size, transport.condD[i]);
		}
	}
	let maxDiff = 0;
	let sameSet = true;
	for (let i = 0; i < n; i++) {
		if ((fast[i] >= 0) !== (brute[i] < Infinity)) sameSet = false;
		else if (fast[i] >= 0) maxDiff = Math.max(maxDiff, Math.abs(fast[i] - brute[i]));
	}
	check('travel_matches_brute_force', sameSet && maxDiff < 1e-9 && count > 1000, 'settled=' + count + ' maxDiff=' + maxDiff.toExponential(2));
	const causeway = (swampCells) => {
		world.terrain.fill(TERRAIN.WATER);
		for (let x = 10; x <= 40; x++) world.terrain[32 * size + x] = swampCells.includes(x) ? TERRAIN.SWAMP : TERRAIN.MEADOW;
		transportRebuild();
		return mapeScanWalkField(10, 32)[32 * size + 40];
	};
	const plain = causeway([]);
	const slowed = causeway([24, 25, 26, 27, 28]);
	const m = TRANSPORT_SPEED_BY_TERRAIN[TERRAIN.MEADOW];
	const sw = TRANSPORT_SPEED_BY_TERRAIN[TERRAIN.SWAMP];
	const expect = 24 + 2 * m / transportEdge(m, sw) + 4 * m / sw;
	check('scan_field_counts_travel_time', plain === 30 && Math.abs(slowed - expect) < 1e-4 && causeway([]) === 30,
		'meadow=' + plain + ' swamp=' + slowed.toFixed(3) + ' expect=' + expect.toFixed(3));
}

console.log('transport_checks=' + (failures === 0 ? 'pass' : 'FAIL') + ' failures=' + failures);
if (failures > 0) process.exitCode = 1;
