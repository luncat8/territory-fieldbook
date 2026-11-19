// owns: survey terrain compatibility, water reset, and the wet-bank/forest coupling gate
// run: node experiments/hydrology.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const root = path.join(__dirname, '..');
for (const [, file] of fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"><\/script>/g)) {
	vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}
const digest = field => createHash('sha256').update(field).digest('hex');
main.setup();
assert.equal(digest(world.terrain), '0b2e33e477de0fd13e86404d546105016f5ac749c498bb864bf1950bdac3b6cb');
assert.equal(digest(world.height), 'cc979920af48302f52689ead7c1e962e0b15a42f9280a728b9103853e7cf0bbf');
assert.equal(digest(economy.biomass), '303afa0a6216a400b19dfb7b6039b03799b0a133d4a27271b3181a740fedaa23');
const model = hydrology.model;
for (let k = 0; k < 600; k++) hydrologyStep(HYDRO_INTERVAL);
assert.ok(model.seaEvap > 0 && model.evaporated > 0 && model.rained > 0);
assert.ok(Math.abs(model.ledgerResidual()) < 1e-6);
let wet = 0, wetDelta = 0, dry = 0, dryDelta = 0, targetChanges = 0;
for (let i = 0; i < world.n; i++) {
	const soil = hydrology.soil[i];
	assert.ok(soil >= 0 && soil <= 1);
	if (model.sea[i]) {
		assert.equal(soil, 0);
		assert.equal(model.rain[i], 0);
		continue;
	}
	const delta = soil - world.soilBaseline[i];
	if (model.water[i] > RIVER_LEVEL) { wet++; wetDelta += delta; }
	if (model.water[i] < WET_LEVEL) { dry++; dryDelta += delta; }
	if (Math.abs(0.65 * economyForestTarget(i, 0.4) - economy.biomass[i]) > 0.05) targetChanges++;
}
assert.ok(wet > 0 && dry > wet && targetChanges > wet);
assert.ok(wetDelta / wet > dryDelta / dry + 0.05);
const evolved = digest(hydrology.soil);
main.setup(START_SEED, 'a');
main.step(HYDRO_INTERVAL);
assert.equal(hydrology.model.springCount, 0);
assert.ok(hydrology.soil.every(v => v === 0.5));
main.setup();
hydrologyStep(120);
assert.equal(digest(hydrology.soil), evolved);
// Equal weather and equal seeded soil isolate the terrain's retention response.
const hill = world.terrain.indexOf(TERRAIN.HILLS), meadow = world.terrain.indexOf(TERRAIN.MEADOW);
hydrology.model.water.fill(0.5);
hydrology.model.humidity.fill(0.1);
hydrology.soil.fill(0.5);
world.soilBaseline.fill(0.5);
hydrologySoil();
assert.ok(hydrology.soil[meadow] > hydrology.soil[hill]);
console.log(`hydro_survey_seconds=120 channel_cells=${wet} dry_cells=${dry} channel_soil_delta=${(wetDelta / wet).toFixed(3)} dry_soil_delta=${(dryDelta / dry).toFixed(3)}`);
