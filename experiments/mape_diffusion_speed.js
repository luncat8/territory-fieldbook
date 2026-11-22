// owns: single-pass diffusion gate — shipped rates sit inside the mix budget, one pass stays
// stable/conservative, reach follows sqrt(D / decay), market pull keeps 0..1
// run: node experiments/mape_diffusion_speed.js

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
const MAX_RATE = MAPE_MIX_MAX / SIM_STEP_SEC; // largest legal coefficient at the canonical tick
// Kernels require conductance tables; this file audits rates at c = 1, so all-1.
const ones = { condR: new Float32Array(n).fill(1), condD: new Float32Array(n).fill(1) };

// Units audit: every shipped diffusion rate at the canonical tick stays inside the budget, the
// budget itself sits below the hard 0.25 bound, and the A/B pull reaches are unchanged from the
// pre-rescale era (D and decay were scaled together, sqrt(D / decay) preserved).
const shipped = {
	MAPE_DIFFUSE, MAPE_CO2_DIFFUSE, MAPE_CATCHMENT_DIFFUSE, MAPE_QUEUE_DIFFUSE, MAPE_WF_DIFFUSE
};
let budgetOk = MAPE_MIX_MAX < 0.25 && MAPE_MIX_MAX <= 0.15 + 1e-12;
let worst = 0;
for (const name of Object.keys(shipped)) {
	const mix = shipped[name] * SIM_STEP_SEC;
	worst = Math.max(worst, mix);
	if (!(mix <= MAPE_MIX_MAX + 1e-12)) budgetOk = false;
}
const reachA = Math.sqrt(MAPE_CATCHMENT_DIFFUSE / MAPE_CATCHMENT_DECAY);
const reachB = Math.sqrt(MAPE_QUEUE_DIFFUSE / MAPE_QUEUE_DECAY);
budgetOk = budgetOk && Math.abs(reachA - Math.sqrt(24 / 0.8)) < 0.05 && Math.abs(reachB - Math.sqrt(16 / 0.8)) < 0.05;
check('shipped_rates_within_mix_budget', budgetOk,
	'maxMix=' + worst.toFixed(4) + '/' + MAPE_MIX_MAX + ' reachA=' + reachA.toFixed(2) + ' reachB=' + reachB.toFixed(2));

function spread(rate, decay, seconds, dt, terrain, source, cond = ones) {
	const field = new Float64Array(n);
	const scratch = new Float64Array(n);
	if (!source) field[center] = 1000;
	for (let t = 0; t < Math.round(seconds / dt); t++) {
		if (source) field[center] += source * dt;
		mapeDiffuseSlice(field, scratch, 0, size, terrain, true, rate, decay, dt, cond);
	}
	return field;
}

function stats(field) {
	let sum = 0;
	let min = Infinity;
	let max = -Infinity;
	let variance = 0;
	for (let i = 0; i < n; i++) {
		const v = field[i];
		sum += v;
		if (v < min) min = v;
		if (v > max) max = v;
		const dx = (i % size) - 32;
		variance += v * dx * dx;
	}
	return { sum, min, max, variance: variance / sum };
}

// The largest legal coefficient on one pass: no blow-up, no negative ripple, mass kept.
const fast = stats(spread(MAX_RATE, 0, 4, SIM_STEP_SEC, meadow));
check('max_rate_single_pass_stable', fast.min >= -1e-12 && fast.max <= 1000 && Math.abs(fast.sum - 1000) < 1e-6,
	'min=' + fast.min.toExponential(2) + ' max=' + fast.max.toFixed(3) + ' sum=' + fast.sum.toFixed(6));

// Speed stays a real knob inside the legal range: double the coefficient, double the variance.
const slow = stats(spread(MAX_RATE / 2, 0, 4, SIM_STEP_SEC, meadow));
const fastVar = stats(spread(MAX_RATE, 0, 4, SIM_STEP_SEC, meadow));
const ratio = fastVar.variance / slow.variance;
check('variance_scales_with_speed', Math.abs(ratio - 2) < 0.25, 'ratio=' + ratio.toFixed(3));

// Reach is an outcome of speed and fade, not a cutoff: 2x D grows it by sqrt(2).
function reach(field) {
	const peak = field[center];
	for (let d = 1; d < 30; d++) {
		if (field[center + d] < peak / Math.E) return d - 1 + (Math.log(field[center + d - 1]) - Math.log(peak / Math.E)) / (Math.log(field[center + d - 1]) - Math.log(field[center + d]));
	}
	return 30;
}
const decay = 0.05;
const nearReach = reach(spread(MAX_RATE / 2, decay, 30, SIM_STEP_SEC, meadow, 10));
const farReach = reach(spread(MAX_RATE, decay, 30, SIM_STEP_SEC, meadow, 10));
check('reach_follows_speed', Math.abs(farReach / nearReach - Math.SQRT2) < 0.3,
	'reach=' + nearReach.toFixed(2) + '->' + farReach.toFixed(2) + ' sqrt(D/k)=' + Math.sqrt(MAX_RATE / decay).toFixed(2));

// Water stays a zero-flux wall at the fastest legal rate — c = 0 comes from the
// built conductance table, not from a terrain check inside the kernel.
const walled = new Uint8Array(meadow);
for (let y = 0; y < size; y++) walled[y * size + 40] = TERRAIN.WATER;
const wall = spread(MAX_RATE, 0, 4, SIM_STEP_SEC, walled, 0, transportBuild(walled, size));
let beyond = 0;
for (let y = 0; y < size; y++) {
	for (let x = 40; x < size; x++) beyond += wall[y * size + x];
}
check('water_wall_holds_at_max_rate', beyond === 0, 'beyond=' + beyond);

// A live settlement's pull stays inside 0..1 across many canonical ticks (the field used to
// explode when a long step fed it one big mix).
main.setup(START_SEED, '', 0, MAPE_ENGINE.CATCHMENT);
mapePlaceSettlement(center, 20, false);
mapeFinishSetup(0, true);
for (let s = 0; s < 100; s++) mapeUpdateMarketFields(SIM_STEP_SEC);
const goods = mape.demandView[MAPE_RES.GOODS];
let lo = Infinity;
let hi = -Infinity;
for (let i = 0; i < n; i++) {
	if (world.terrain[i] === TERRAIN.WATER) continue;
	if (goods[i] < lo) lo = goods[i];
	if (goods[i] > hi) hi = goods[i];
}
check('market_pull_stays_bounded', lo >= -1e-9 && hi <= 1 + 1e-6 && hi > 0.01,
	'range=' + lo.toFixed(4) + '..' + hi.toFixed(4));

console.log('diffusion_speed_checks=' + (failures === 0 ? 'pass' : 'FAIL') + ' failures=' + failures);
if (failures > 0) process.exitCode = 1;
