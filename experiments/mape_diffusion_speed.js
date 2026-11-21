// owns: diffusion speed gate — any coefficient or step stays stable and conservative, reach follows sqrt(D / decay)
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

// Pass count: even for ping-pong fields, per-pass mix never above the stable bound.
let passOk = true;
for (const rate of [0.5, MAPE_DIFFUSE, 16, 24, 100, 1000]) {
	for (const dt of [0.01, 0.05, 0.2, 1]) {
		const passes = mapeDiffusePasses(rate, dt);
		if (passes % 2 !== 0 || rate * dt / passes > MAPE_MIX_MAX + 1e-12) passOk = false;
	}
}
check('passes_even_and_bounded', passOk && mapeDiffusePasses(0, 0.2) === 0 && mapeDiffusePasses(1, 0.2, 1) === 1);

function spread(rate, decay, seconds, dt, terrain, source) {
	const field = new Float64Array(n);
	const scratch = new Float64Array(n);
	if (!source) field[center] = 1000;
	for (let t = 0; t < Math.round(seconds / dt); t++) {
		if (source) field[center] += source * dt;
		mapeDiffuseSlice(field, scratch, 0, size, terrain, true, rate, decay, dt);
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

// 50x the shipped speed on the long reference step: no blow-up, no negative ripple, mass kept.
const fast = stats(spread(50 * MAPE_DIFFUSE, 0, 4, MAPE_MAX_STEP, meadow));
check('fast_speed_stable', fast.min >= -1e-12 && fast.max <= 1000 && Math.abs(fast.sum - 1000) < 1e-6,
	'min=' + fast.min.toExponential(2) + ' max=' + fast.max.toFixed(3) + ' sum=' + fast.sum.toFixed(6));

// Speed is a real knob: four times the coefficient spreads four times the variance.
const slow = stats(spread(MAPE_DIFFUSE, 0, 4, 0.05, meadow));
const quad = stats(spread(4 * MAPE_DIFFUSE, 0, 4, 0.05, meadow));
const ratio = quad.variance / slow.variance;
check('variance_scales_with_speed', Math.abs(ratio - 4) < 0.4, 'ratio=' + ratio.toFixed(3));

// Reach is an outcome of speed and fade, not a cutoff: 4x D doubles the e-folding distance.
function reach(field) {
	const peak = field[center];
	for (let d = 1; d < 30; d++) {
		if (field[center + d] < peak / Math.E) return d - 1 + (Math.log(field[center + d - 1]) - Math.log(peak / Math.E)) / (Math.log(field[center + d - 1]) - Math.log(field[center + d]));
	}
	return 30;
}
const decay = 0.5;
const nearReach = reach(spread(MAPE_DIFFUSE, decay, 30, 0.05, meadow, 10));
const farReach = reach(spread(4 * MAPE_DIFFUSE, decay, 30, 0.05, meadow, 10));
check('reach_follows_speed', Math.abs(farReach / nearReach - 2) < 0.3,
	'reach=' + nearReach.toFixed(2) + '->' + farReach.toFixed(2) + ' sqrt(D/k)=' + Math.sqrt(MAPE_DIFFUSE / decay).toFixed(2));

// Water stays a zero-flux wall at any speed.
const walled = new Uint8Array(meadow);
for (let y = 0; y < size; y++) walled[y * size + 40] = TERRAIN.WATER;
const wall = spread(50 * MAPE_DIFFUSE, 0, 4, MAPE_MAX_STEP, walled);
let beyond = 0;
for (let y = 0; y < size; y++) {
	for (let x = 40; x < size; x++) beyond += wall[y * size + x];
}
check('water_wall_holds_at_speed', beyond === 0, 'beyond=' + beyond);

// The bounded market pull keeps its 0–1 range on a step four times the market step.
main.setup(START_SEED, '', 0, MAPE_ENGINE.CATCHMENT);
for (let s = 0; s < 50; s++) mapeUpdateMarketFields(4 * MAPE_MARKET_STEP);
const goods = mape.demandView[MAPE_RES.GOODS];
let lo = Infinity;
let hi = -Infinity;
for (let i = 0; i < n; i++) {
	if (world.terrain[i] === TERRAIN.WATER) continue;
	if (goods[i] < lo) lo = goods[i];
	if (goods[i] > hi) hi = goods[i];
}
check('market_pull_bounded_on_long_step', lo >= 0 && hi <= 1 + 1e-6, 'range=' + lo.toFixed(4) + '..' + hi.toFixed(4));

console.log('diffusion_speed_checks=' + (failures === 0 ? 'pass' : 'FAIL') + ' failures=' + failures);
if (failures > 0) process.exitCode = 1;
