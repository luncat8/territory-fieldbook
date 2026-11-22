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
transportRebuild();
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

// Migration moves people between towns to fill work, and never changes how many people the map
// holds. It reads staffing, not traffic: a town with vacant job slots receives residents from a
// town whose people are already at work. Traffic itself cannot drive it — every town exports fresh
// effort on its first step and no town receives another's export.
mape.jobSlots = 6;
mape.pop[shore] = mape.pop[meadow] = 30;
mape.wfMigration.fill(0);
mape.jobFilled.fill(0);
mape.jobVacant.fill(0);
mape.wfFresh.fill(0);
mape.wfFresh[meadow] = 30;
mapeRebuildSettlements();
mape.initialPop = mape.totalPop;
mape.popDelta = 0;

// No vacancy anywhere means nobody moves, however much traffic the fields report.
mape.jobFilled[meadow] = 6;
mape.wfBalance.fill(0);
mape.wfBalance[shore] = 2 * SIM_STEP_SEC;
mapeFluidMigrate(SIM_STEP_SEC);
assert.equal(mape.pop[shore], 30, 'traffic alone moves nobody');
assert.equal(mape.pop[meadow], 30);

// A town that cannot staff its work receives from a town that can; the map total is unchanged.
mape.jobVacant[shore] = 6;
mape.jobFilled[shore] = 0;
mape.jobFilled[meadow] = 6;
mape.wfFresh[meadow] = 30;
mape.wfFresh[shore] = 0;
const before = mape.pop[shore];
mapeFluidMigrate(1);
assert.ok(mape.pop[shore] > before, 'a starved town draws residents in');
assert.ok(mape.pop[meadow] < 30, 'the staffed town sends them');
assert.ok(Math.abs(mapePopResidual()) < 1e-4, 'migration conserves the map population');

// With jobs but no spare residents anywhere, nothing moves either.
mape.pop[shore] = MAPE_SETTLE_KEEP;
mape.pop[meadow] = MAPE_SETTLE_KEEP + 6;
mape.jobFilled.fill(0);
mape.jobVacant.fill(0);
mape.jobVacant[shore] = 6;
mape.jobFilled[meadow] = 6;
mape.wfFresh[meadow] = mape.pop[meadow];
const kept = mape.pop[meadow];
mapeFluidMigrate(10);
assert.ok(mape.pop[meadow] >= kept - 1e-6, 'a town is never stripped below the keep floor');

// No job slot anywhere means no migration at all, and the traffic average is forgotten.
mape.jobSlots = 0;
mape.pop[shore] = mape.pop[meadow] = 30;
const idle = mape.pop[shore];
mape.wfMigration[shore] = 1;
mape.wfBalance.fill(0);
mape.wfBalance[shore] = 2 * SIM_STEP_SEC;
mapeFluidMigrate(30);
assert.equal(mape.pop[shore], idle, 'no job slot anywhere means no migration at all');
assert.ok(Math.abs(mape.wfMigration[shore]) < 1e-2, 'traffic average forgets while idle');
mape.jobSlots = 6;

const earlier = mape.pop[meadow];
mape.wfFresh.fill(0);
mape.wfBalance.fill(0);
mapeFluidGenerate(1, world.terrain, mape.pop, mape.wfFresh);
assert.ok(Math.abs(mape.wfFresh[meadow] - earlier * MAPE_WF_GEN) < 1e-5, 'smaller settlement dispatches less');
mape.pop[shore] = shoreCap - 0.01;
mape.pop[meadow] = 60;
mape.jobVacant[shore] = 20;
mape.jobFilled[shore] = 0;
mape.jobFilled[meadow] = 6;
mape.wfFresh[meadow] = 60;
mapeFluidMigrate(60);
assert.ok(mape.pop[shore] <= shoreCap + 1e-5, 'inflow cannot exceed capacity');
mape.jobVacant.fill(0);
mape.jobFilled.fill(0);
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
