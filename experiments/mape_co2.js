// owns: CO2 cycle gate — waste/factory/population sources, forest sink, mass identity,
// diffusion reach and the flow-overlay slices
// run: node experiments/mape_co2.js

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
for (const [, file] of fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"><\/script>/g)) {
	vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}

let failures = 0;
function check(name, ok, extra) {
	console.log('check_' + name + '=' + (ok ? 'pass' : 'fail') + (extra ? ' ' + extra : ''));
	if (!ok) failures++;
}

const dt = SIM_STEP_SEC;
const n = world.n;
const off = MAPE_RES.CO2 * n;
const center = 32 * world.size + 32;

// Waste cell outgasses the exact amount the demand signal promises.
{
	main.setup(START_SEED, '', 0, MAPE_ENGINE.DIFFUSION);
	mape.pop.fill(0);
	const cell = world.terrain.findIndex(t => t !== TERRAIN.WATER);
	const before = mape.goods[off + cell];
	const massBefore = mape.massIn;
	land.disturbed[cell] = 0.5;
	mapeEmitWasteCo2(dt);
	const emitted = mape.goods[off + cell] - before;
	check('waste_unit_emit', Math.abs(emitted - 0.5 * MAPE_WASTE_CO2 * dt) < 1e-12 &&
		Math.abs((mape.massIn - massBefore) - emitted) < 1e-12, 'emitted=' + emitted.toExponential(3));
	// Tilled ground holds no forest, so the only disturbed-dependent term left is the dump signal.
	economy.tilled[cell] = 1;
	economy.biomass[cell] = 0;
	mape.demand.fill(0);
	land.disturbed[cell] = 0;
	mapeInjectDemand(dt);
	const clean = mape.demand[off + cell];
	mape.demand.fill(0);
	land.disturbed[cell] = 0.5;
	mapeInjectDemand(dt);
	const dirty = mape.demand[off + cell];
	check('waste_demand_signal', Math.abs((dirty - clean) + 0.5 * MAPE_WASTE_CO2 * MAPE_DEMAND_GAIN * dt) < 1e-4,
		'delta=' + (dirty - clean).toFixed(5));
}

// 600 s of the seeded survey: every source fires, the field stays in the visible band,
// the carbon identity holds and the CO2 flow slice carries real flux.
{
	main.setup(START_SEED, '', 0, MAPE_ENGINE.DIFFUSION);
	const steps = Math.round(600 / dt);
	let popEmit = 0;
	let facEmit = 0;
	let wasteEmit = 0;
	let fixUp = 0;
	let fixDown = 0;
	let coverBefore = 0;
	for (let i = 0; i < n; i++) coverBefore += economy.biomass[i];
	let totalBefore = 0;
	for (let i = 0; i < n; i++) totalBefore += mape.goods[off + i];
	let bandMin = Infinity;
	let bandMax = -Infinity;
	let demandMin = Infinity;
	let demandMax = -Infinity;
	let flowMax = 0;
	for (let s = 0; s < steps; s++) {
		mapeStep(dt);
		for (let i = 0; i < n; i++) {
			popEmit += mape.usedCoal[i];
			wasteEmit += land.disturbed[i] * MAPE_WASTE_CO2 * dt;
		}
		for (let f = 0; f < mape.factoryCount; f++) facEmit += mape.factoryCo2[f] * dt;
		let cover = 0;
		for (let i = 0; i < n; i++) cover += economy.biomass[i];
		const fixed = (cover - coverBefore) * BIO_CARBON_PER_COVER;
		if (fixed >= 0) fixUp += fixed;
		else fixDown -= fixed;
		coverBefore = cover;
		if (s % Math.round(100 / dt) !== 0) continue;
		let total = 0;
		for (let i = 0; i < n; i++) {
			const v = mape.goods[off + i];
			total += v;
			if (world.terrain[i] === TERRAIN.WATER) continue;
			if (v < bandMin) bandMin = v;
			if (v > bandMax) bandMax = v;
		}
		const d = mape.demandView[MAPE_RES.CO2];
		for (let i = 0; i < n; i++) {
			if (d[i] < demandMin) demandMin = d[i];
			if (d[i] > demandMax) demandMax = d[i];
		}
		for (let i = 0; i < n; i++) {
			const fx = mape.flowX[off + i];
			const fy = mape.flowY[off + i];
			const len = Math.sqrt(fx * fx + fy * fy);
			if (len > flowMax) flowMax = len;
		}
		console.log('co2_sample_t=' + ((s + 1) * dt).toFixed(0) + ' total=' + total.toFixed(2) +
			' min=' + bandMin.toFixed(3) + ' max=' + bandMax.toFixed(3) + ' flow_max=' + flowMax.toFixed(4));
	}
	let totalAfter = 0;
	for (let i = 0; i < n; i++) totalAfter += mape.goods[off + i];
	const identityErr = Math.abs((totalAfter - totalBefore) + fixUp - fixDown - (popEmit + facEmit + wasteEmit));
	console.log('co2_sources_pop=' + popEmit.toFixed(3) + ' fac=' + facEmit.toFixed(3) +
		' waste=' + wasteEmit.toFixed(3) + ' fix_up=' + fixUp.toFixed(3) + ' fix_down=' + fixDown.toFixed(3));
	console.log('co2_band land min=' + bandMin.toFixed(3) + ' max=' + bandMax.toFixed(3) +
		' demand ' + demandMin.toFixed(3) + '..' + demandMax.toFixed(3) +
		' flow_max=' + flowMax.toFixed(4) + ' identity_err=' + identityErr.toFixed(4));
	const tops = [];
	for (let i = 0; i < n; i++) {
		if (world.terrain[i] === TERRAIN.WATER) continue;
		tops.push([mape.goods[off + i], i]);
	}
	tops.sort((a, b) => b[0] - a[0]);
	for (let k = 0; k < 5; k++) {
		console.log('co2_top' + k + '=' + tops[k][0].toFixed(3) + ' at ' + (tops[k][1] % world.size) + ',' + ((tops[k][1] / world.size) | 0));
	}
	check('co2_sources_present', popEmit > 1 && facEmit > 1 && wasteEmit > 0.5,
		'pop=' + popEmit.toFixed(2) + ' fac=' + facEmit.toFixed(2) + ' waste=' + wasteEmit.toFixed(2));
	check('co2_visible_band', bandMin > 0.02 && bandMax > 0.7 && bandMax <= RENDER_CO2_MAX,
		'min=' + bandMin.toFixed(3) + ' max=' + bandMax.toFixed(3));
	check('co2_demand_signed', demandMin < -0.1 && demandMax > 0.1,
		'min=' + demandMin.toFixed(3) + ' max=' + demandMax.toFixed(3));
	check('co2_flow_active', flowMax > 0.003, 'flow_max=' + flowMax.toFixed(4));
	check('co2_flow_overlay_enabled', renderHasFlowItem(MAPE_RES.CO2) === true);
	check('co2_ledger_holds', Math.abs(mapeLedgerResidual()) < 0.01, 'res=' + mapeLedgerResidual().toExponential(2));
}

// A point plume on a still field crosses 8 cells within 60 s — the visible-reach budget
// behind MAPE_CO2_DIFFUSE (rms = sqrt(2 · D · t) ≈ 14.7 cells).
{
	main.setup(START_SEED, '', 0, MAPE_ENGINE.DIFFUSION);
	const goods = mape.goods;
	const scratch = mape.goodsNext;
	for (let i = 0; i < n; i++) goods[off + i] = 0;
	goods[off + center] = 100;
	const seconds = 60;
	for (let s = 0; s < Math.round(seconds / dt); s++) {
		scratch.set(goods);
		mapeDiffuseCo2Stock(goods, scratch, off, world.size, dt);
		goods.set(scratch);
	}
	const size = world.size;
	let beyond = 0;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (Math.max(Math.abs(x - 32), Math.abs(y - 32)) <= 8) continue;
			beyond += goods[off + y * size + x];
		}
	}
	console.log('co2_reach_60s_beyond8=' + beyond.toFixed(3));
	check('co2_reach_8_cells_60s', beyond > 0.5, 'beyond=' + beyond.toFixed(3));
}

console.log('co2_checks=' + (failures === 0 ? 'pass' : 'FAIL') + ' failures=' + failures);
if (failures > 0) process.exitCode = 1;
