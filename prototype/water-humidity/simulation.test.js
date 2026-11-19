// Owns: regression checks for the standalone water/humidity model.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
	WaterLab, WATER_PARAMS, WATER_DT, WATER_SEED, WATER_SCENARIOS,
	SEA_DEPTH, WET_LEVEL, RIVER_LEVEL, RAIN_G_MIN, waterIndex, waterMetrics
} = require('./simulation.js');

function run(model, seconds, dt) {
	const step = dt || WATER_DT;
	const count = Math.round(seconds / step);
	for (let k = 0; k < count; k++) model.step(step);
	return model;
}

function sum(values) {
	let total = 0;
	for (let i = 0; i < values.length; i++) total += values[i];
	return total;
}

function finite(model) {
	for (let i = 0; i < model.n; i++) {
		assert.ok(Number.isFinite(model.water[i]) && model.water[i] >= -1e-9, 'water ' + i);
		assert.ok(Number.isFinite(model.group[i]) && model.group[i] >= 0 && model.group[i] <= 1, 'group ' + i);
		assert.ok(Number.isFinite(model.humidity[i]) && model.humidity[i] >= -1e-9, 'humidity ' + i);
		assert.ok(Number.isFinite(model.rain[i]) && model.rain[i] >= 0, 'rain ' + i);
	}
}

function coast(seconds) {
	const model = new WaterLab({ scenario: 'coast' });
	run(model, seconds || 120);
	return model;
}

test('depression filling gives every land cell a downhill path to the sea', () => {
	for (const scenario of ['coast', 'valleys', 'islands', 'flat']) {
		const model = new WaterLab({ scenario });
		const w = model.width;
		const reachable = new Uint8Array(model.n);
		for (let i = 0; i < model.n; i++) if (model.sea[i]) reachable[i] = 1;
		for (let pass = 0; pass < w + model.rows + 8; pass++) {
			let changed = false;
			for (let i = 0; i < model.n; i++) {
				if (reachable[i] || model.sea[i]) continue;
				const x = i % w;
				const y = (i / w) | 0;
				const neighbours = [];
				if (x > 0) neighbours.push(i - 1);
				if (x < w - 1) neighbours.push(i + 1);
				if (y > 0) neighbours.push(i - w);
				if (y < model.rows - 1) neighbours.push(i + w);
				for (let k = 0; k < neighbours.length; k++) {
					const j = neighbours[k];
					if (model.filled[j] <= model.filled[i] + 1e-9 && reachable[j]) { reachable[i] = 1; changed = true; break; }
				}
			}
			if (!changed) break;
		}
		let blocked = 0;
		for (let i = 0; i < model.n; i++) if (!model.sea[i] && !reachable[i]) blocked++;
		assert.equal(blocked, 0, scenario + ' has ' + blocked + ' land cells with no path to sea');
		for (let i = 0; i < model.n; i++) assert.ok(model.filled[i] >= model.elev[i] - 1e-9);
	}
});

test('the moisture ledger closes on every scenario and at two timesteps', () => {
	for (const scenario of WATER_SCENARIOS) {
		for (const dt of [WATER_DT, WATER_DT / 2]) {
			const model = new WaterLab({ scenario });
			run(model, 40, dt);
			const r = waterMetrics(model);
			assert.ok(Math.abs(r.ledgerResidual) < 1e-6, scenario + ' dt=' + dt + ' residual=' + r.ledgerResidual);
			finite(model);
		}
	}
});

test('sea cells never build grouping demand and never receive rain', () => {
	const model = coast(120);
	let seaCells = 0;
	for (let i = 0; i < model.n; i++) {
		if (!model.sea[i]) continue;
		seaCells++;
		assert.equal(model.group[i], 0, 'group on sea cell ' + i);
		assert.equal(model.rain[i], 0, 'rain on sea cell ' + i);
		assert.equal(model.water[i], SEA_DEPTH, 'sea depth ' + i);
	}
	assert.ok(seaCells > 0);
	assert.equal(waterMetrics(model).rainOnSea, 0);
});

test('rain is gated by grouping demand and concentrated on channels', () => {
	const model = coast(120);
	const r = waterMetrics(model);
	assert.ok(r.rainTotal > 0.01, 'no rain at all: ' + r.rainTotal);
	assert.ok(r.groupedRainShare > 0.85, 'rain escaped the channels: ' + r.groupedRainShare);
	let belowGate = 0;
	for (let i = 0; i < model.n; i++) {
		if (model.sea[i] || model.rain[i] === 0) continue;
		assert.ok(model.group[i] > RAIN_G_MIN, 'rain below gate at ' + i);
		if (model.group[i] <= RAIN_G_MIN) belowGate++;
	}
	assert.equal(belowGate, 0);
});

test('grouping demand needs both moving and deep water', () => {
	const model = new WaterLab({ scenario: 'blank' });
	model.rainMode = 'off';
	let i = waterIndex(20, 20, model.width);
	const emit = (depth, flux) => {
		model.water.fill(0);
		model.group.fill(0);
		model.fluxRate.fill(0);
		model.water[i] = depth;
		model.fluxRate[i] = flux;
		for (let k = 0; k < 100; k++) model.updateGroup(WATER_DT);
		return model.group[i];
	};
	const still = emit(2, 0);
	const thin = emit(0.02, 1.5);
	const river = emit(0.5, 1.5);
	assert.equal(still, 0, 'a still lake must not emit demand');
	assert.ok(thin < 0.15, 'a thin film must not emit demand: ' + thin);
	assert.ok(river > 0.2, 'a fast deep stream must emit demand: ' + river);
	assert.ok(river > thin * 4, 'demand must separate streams from films');
	const sea = new WaterLab({ scenario: 'flat' });
	const s = waterIndex(10, sea.rows - 1, sea.width);
	assert.equal(sea.sea[s], 1);
	sea.water[s] = SEA_DEPTH;
	sea.fluxRate[s] = 100;
	for (let k = 0; k < 100; k++) sea.updateGroup(WATER_DT);
	assert.equal(sea.group[s], 0, 'the sea emits demand through inflow');
});

test('humidity diffuses and conserves mass when sources and sinks are off', () => {
	const model = new WaterLab({
		scenario: 'blank',
		params: { seaEvap: 0, humDecay: 0, evapRate: 0, filmRate: 0, springRate: 0, windX: 0 }
	});
	model.wind = false;
	model.rainMode = 'off';
	const i = waterIndex(30, 30, model.width);
	model.humidity[i] = 1;
	model.initialMass = model.sumWater() + model.sumHumidity();
	const before = sum(model.humidity);
	run(model, 10);
	assert.ok(Math.abs(sum(model.humidity) - before) < 1e-8, 'diffusion must conserve humidity');
	assert.ok(model.humidity[i] < 0.4, 'the blob did not spread: ' + model.humidity[i]);
	assert.ok(model.humidity[i + 1] > 0 && model.humidity[i + model.width] > 0, 'neighbours stayed dry');
	assert.equal(model.humidityLost, 0);
});

test('wind advects humidity downwind and the loss is tracked', () => {
	const model = new WaterLab({
		scenario: 'blank',
		params: { seaEvap: 0, humDecay: 0, evapRate: 0, filmRate: 0, springRate: 0, windX: 2 }
	});
	model.rainMode = 'off';
	const i = waterIndex(20, 30, model.width);
	model.humidity[i] = 1;
	model.initialMass = model.sumWater() + model.sumHumidity();
	run(model, 4);
	let centroid = 0;
	for (let j = 0; j < model.n; j++) centroid += (j % model.width) * model.humidity[j];
	centroid /= sum(model.humidity) || 1;
	assert.ok(centroid > 21, 'moisture did not travel downwind: ' + centroid);
	assert.ok(Math.abs(model.ledgerResidual()) < 1e-8, 'wind export must be in the ledger');
});

test('transport conserves water and follows the heightmap downhill', () => {
	const model = new WaterLab({
		scenario: 'flat',
		params: { flowK: 150, groupFlow: 0, springRate: 0, evapRate: 0, filmRate: 0, seaEvap: 0, surfacePull: 0 }
	});
	model.grouping = false;
	model.rainMode = 'off';
	const i = waterIndex(model.width >> 1, 5, model.width);
	model.water[i] = 1;
	const before = sum(model.water);
	model.transportWater(WATER_DT);
	assert.ok(Math.abs(sum(model.water) - before) < 1e-9, 'transport created or destroyed water');
	assert.ok(model.water[i + model.width] > 0, 'water did not move downhill');
	assert.equal(model.water[i - model.width], 0, 'water moved uphill');
});

test('water below the retention threshold is immobile', () => {
	const model = new WaterLab({ scenario: 'flat', params: { springRate: 0, flowK: 300, groupFlow: 0 } });
	model.grouping = false;
	const i = waterIndex(model.width >> 1, 5, model.width);
	model.water[i] = model.params.retention * 0.5;
	model.transportWater(WATER_DT);
	assert.equal(model.water[i + model.width], 0);
	assert.equal(model.fluxRate[i], 0);
});

test('localized rain keeps land channelized; uniform rain floods it', () => {
	const local = coast(120);
	const localR = waterMetrics(local);
	assert.ok(localR.wetFraction < 0.25, 'a thin sheet covers the land: ' + localR.wetFraction);
	assert.ok(localR.riverShare > 0.7, 'water is not grouped into channels: ' + localR.riverShare);
	let grouped = 0;
	for (let i = 0; i < local.n; i++) if (!local.sea[i] && local.group[i] > 0.35) grouped++;
	assert.ok(grouped / localR.landCells < 0.2, 'grouping demand spread over the whole map');
	const uniform = new WaterLab({ scenario: 'coast' });
	uniform.rainMode = 'uniform';
	run(uniform, 60);
	const uniformR = waterMetrics(uniform);
	assert.ok(uniformR.wetFraction > 0.9, 'uniform rain should flood the land');
	assert.ok(uniformR.landWater > localR.landWater * 5, 'uniform rain should dwarf local rain');
	assert.ok(Math.abs(uniformR.ledgerResidual) < 1e-3);
	finite(uniform);
});

test('rivers persist and still discharge into the sea', () => {
	const model = coast(120);
	let channels = 0;
	let rainyChannels = 0;
	for (let i = 0; i < model.n; i++) {
		if (model.sea[i] || model.water[i] <= RIVER_LEVEL) continue;
		channels++;
		if (model.group[i] > 0.4) rainyChannels++;
	}
	assert.ok(channels > 40, 'no channels survived: ' + channels);
	assert.ok(rainyChannels > channels * 0.5, 'channels lost their grouping demand');
	assert.ok(model.seaDrain > 1, 'no river reaches the sea: ' + model.seaDrain);
});

test('grouping off removes grouping rain; rain off removes all rain', () => {
	const noGroup = new WaterLab({ scenario: 'coast' });
	noGroup.grouping = false;
	run(noGroup, 60);
	assert.equal(waterMetrics(noGroup).rainTotal, 0);
	assert.equal(waterMetrics(noGroup).groupMax, 0);
	for (let i = 0; i < noGroup.n; i++) assert.equal(noGroup.group[i], 0);
	const noRain = new WaterLab({ scenario: 'coast' });
	noRain.rainMode = 'off';
	run(noRain, 60);
	assert.equal(waterMetrics(noRain).rainTotal, 0);
	assert.ok(waterMetrics(noRain).landWater > 0, 'springs still feed rivers');
});

test('springs are the seed: without them no grouping and no rain appear', () => {
	const model = new WaterLab({ scenario: 'coast', params: { springRate: 0 } });
	run(model, 60);
	assert.equal(waterMetrics(model).landWater, 0);
	assert.equal(waterMetrics(model).rainTotal, 0);
	assert.equal(waterMetrics(model).groupMax, 0);
});

test('the same seed replays exactly, a different seed does not', () => {
	const a = new WaterLab({ scenario: 'coast', seed: WATER_SEED });
	const b = new WaterLab({ scenario: 'coast', seed: WATER_SEED });
	const c = new WaterLab({ scenario: 'coast', seed: WATER_SEED + 1 });
	run(a, 40);
	run(b, 40);
	run(c, 40);
	assert.deepEqual(Array.from(a.water), Array.from(b.water));
	assert.notDeepEqual(Array.from(a.water), Array.from(c.water));
});

test('fields stay bounded across scenarios, seeds and a long run', () => {
	for (const scenario of ['coast', 'valleys', 'islands', 'basin', 'flat']) {
		const model = new WaterLab({ scenario, seed: 991 });
		run(model, 80);
		finite(model);
		assert.ok(Math.abs(waterMetrics(model).ledgerResidual) < 1e-6, scenario);
		for (let i = 0; i < model.n; i++) assert.ok(model.water[i] < 1e4, scenario + ' water exploded at ' + i);
	}
});

test('WET_LEVEL and RIVER_LEVEL are ordered and used by the metrics', () => {
	assert.ok(WET_LEVEL < RIVER_LEVEL);
	const model = coast(60);
	const r = waterMetrics(model);
	assert.ok(r.landCells > 0 && r.landCells < model.n);
	assert.ok(r.wetFraction >= 0 && r.wetFraction <= 1);
	assert.ok(r.riverShare >= 0 && r.riverShare <= 1);
});
