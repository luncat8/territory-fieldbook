// owns: landscape capacity, rest pull and smoothed workforce migration regressions
// run: node experiments/mape_fluid_migration.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const [, file] of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
	vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}

main.setup(START_SEED, 'a', 0, MAPE_ENGINE.CATCHMENT);
mapeSetWorkforceMode(MAPE_WORKFORCE_MODE.FLUID);
world.terrain.fill(TERRAIN.MEADOW);
const shore = 15 * world.size + 15;
const meadow = 30 * world.size + 30;
const swamp = 45 * world.size + 45;
world.terrain[shore + 1] = TERRAIN.WATER;
world.terrain[swamp] = TERRAIN.SWAMP;
worldSettleValues();
land.disturbed.fill(0);
mape.pop.fill(0);
mape.cellExport.fill(0);
for (const i of [shore, meadow, swamp]) mape.pop[i] = 10;
mapeRebuildSettlements();
const shoreCap = mapeFluidCapacity(shore);
const meadowCap = mapeFluidCapacity(meadow);
const swampCap = mapeFluidCapacity(swamp);
assert.ok(shoreCap > meadowCap && meadowCap > swampCap && swampCap > 10);
mape.wfRestPull.fill(0);
const diffuse = mapeDiffuseSlice;
mapeDiffuseSlice = () => 0;
mapeFluidRestPull(0.05, world.size, world.terrain);
mapeDiffuseSlice = diffuse;
const pullShore = mape.wfRestPull[shore];
const pullMeadow = mape.wfRestPull[meadow];
const pullSwamp = mape.wfRestPull[swamp];
assert.ok(pullShore > pullMeadow && pullMeadow > pullSwamp);
assert.ok(Math.abs(pullShore / pullMeadow - (shoreCap - 10) / (meadowCap - 10)) < 1e-5);
land.disturbed[meadow] = 0.5;
assert.ok(mapeFluidCapacity(meadow) < meadowCap * 0.51);
land.disturbed[meadow] = 0;
mape.pop[meadow] = meadowCap + 1;
assert.equal(mapeFluidFreeSpace(meadow), 0);
mape.wfDepleted.fill(0);
mape.wfDepleted[meadow] = 10;
mapeFluidRest(1, mape.wfDepleted, mape.wfFresh);
assert.equal(mape.wfDepleted[meadow], 10);

// Local generation, tiring and rest are not migration; only crossing a town boundary counts.
mape.pop[shore] = mape.pop[meadow] = 30;
mape.wfFresh.fill(0);
mape.wfDepleted.fill(0);
mape.wfMigration.fill(0);
mape.wfBalance.fill(0);
mapeRebuildSettlements();
mapeFluidGenerate(0.05, world.terrain, mape.pop, mape.wfFresh);
mapeFluidTire(0.05, mape.wfFresh, mape.wfDepleted);
mapeFluidRest(0.05, mape.wfDepleted, mape.wfFresh);
assert.equal(mape.wfBalance[shore], 0);
assert.equal(mape.wfBalance[meadow], 0);
mapeFluidMigrate(0.05);
assert.equal(mape.pop[shore], 30);
assert.equal(mape.pop[meadow], 30);

mape.wfBalance.fill(0);
mape.wfFresh.fill(0);
mape.workforce.fill(0);
mape.wfFresh[meadow] = 10;
mape.workforce[meadow + 1] = 1;
mapeFluidAdvect(0.05, world.size, world.terrain, mape.workforce, mape.wfFresh, mape.wfFreshNext);
assert.ok(mape.wfBalance[meadow] < 0, 'fresh departure debits the town');
assert.ok(Math.abs(mape.wfBalance[meadow] + mape.wfFresh[meadow + 1]) < 1e-6);
mape.wfBalance.fill(0);
mape.wfDepleted.fill(0);
mape.wfDepleted[shore - 1] = 10;
mape.wfRestPull.fill(0);
mape.wfRestPull[shore] = 1;
mapeFluidAdvectDepleted(0.05, world.size, world.terrain, mape.wfDepleted, mape.wfDepletedNext);
assert.ok(mape.wfBalance[shore] > 0, 'depleted arrival credits the town');
assert.ok(Math.abs(mape.wfBalance[shore] - mape.wfDepleted[shore]) < 1e-6);
mape.wfBalance.fill(0);
mape.wfDepleted.fill(0);
mape.wfDepleted[shore - 1] = 10;
mapeFluidDiffuse(0.05, world.size, world.terrain, mape.wfDepleted, mape.wfDepletedNext);
assert.ok(mape.wfBalance[shore] > 0, 'diffusion across the boundary is counted');

function migrate(rate, seconds, dt = 0.05) {
	for (let k = 0; k < Math.round(seconds / dt); k++) {
		mape.wfBalance.fill(0);
		mape.wfBalance[shore] = rate * dt;
		mape.wfBalance[meadow] = -rate * dt;
		mapeFluidMigrate(dt);
	}
}
mape.pop[shore] = mape.pop[meadow] = 30;
mape.wfMigration.fill(0);
mapeRebuildSettlements();
mape.initialPop = mape.totalPop;
mape.popDelta = 0;
migrate(2, 1);
assert.ok(mape.pop[shore] > 30 && mape.pop[shore] < 30.02, 'one transient is smoothed');
assert.ok(mape.pop[meadow] < 30 && mape.pop[meadow] > 29.98);
migrate(2, 40);
assert.ok(mape.pop[shore] > 35 && mape.pop[meadow] < 25, 'sustained net inflow grows one town and outflow shrinks the other');
assert.ok(Math.abs(mapePopResidual()) < 1e-4);
const earlier = mape.pop[meadow];
mape.wfFresh.fill(0);
mape.wfBalance.fill(0);
mapeFluidGenerate(1, world.terrain, mape.pop, mape.wfFresh);
assert.ok(Math.abs(mape.wfFresh[meadow] - earlier * MAPE_WF_GEN) < 1e-5, 'smaller settlement dispatches less');
const afterFlow = mape.wfMigration[shore];
migrate(0, 30);
assert.ok(mape.wfMigration[shore] < afterFlow * 0.06, 'average forgets old traffic');
mape.pop[shore] = shoreCap - 0.01;
mape.wfMigration[shore] = 10;
mape.wfBalance.fill(0);
mapeFluidMigrate(1);
assert.ok(mape.pop[shore] <= shoreCap + 1e-5, 'inflow cannot exceed capacity');
mape.pop[shore] = shoreCap + 10;
mapeFluidMigrate(1);
assert.ok(mape.pop[shore] > shoreCap, 'existing over-cap town is not instantly erased');
mapeSetWorkforceMode(MAPE_WORKFORCE_MODE.RESIDENTS);
assert.ok(mape.wfMigration.every(v => v === 0));
mapeSetWorkforceMode(MAPE_WORKFORCE_MODE.FLUID);
assert.ok(mape.wfMigration.every(v => v === 0));
for (const engine of [MAPE_ENGINE.DIFFUSION, MAPE_ENGINE.CATCHMENT, MAPE_ENGINE.QUEUE]) {
	main.setup(START_SEED, 'a', 0, engine);
	for (let k = 0; k < 200; k++) main.step(0.05);
	assert.ok(mape.pop.every(p => Number.isFinite(p) && p >= 0));
	assert.ok(Math.abs(mapePopResidual()) < 1e-3);
}
console.log(`capacity_shore=${shoreCap.toFixed(1)} capacity_meadow=${meadowCap.toFixed(1)} capacity_swamp=${swampCap.toFixed(1)} pull_ratio=${(pullShore / pullMeadow).toFixed(3)} migration_checks=pass`);
