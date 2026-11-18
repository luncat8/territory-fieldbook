// owns: the in-game scene replay, visible transport, mine lifetime and reroute gates
// run: node experiments/mape_scenes.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const [, file] of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
	vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}

function advance(seconds) {
	for (let k = 0, ticks = Math.round(seconds / SIM_STEP_SEC); k < ticks; k++) main.step(SIM_STEP_SEC);
}

function validateScene() {
	assert.ok(Math.abs(mapeLedgerResidual()) < 1e-7);
	assert.ok(Math.abs(mapePopResidual()) < 1e-7);
	assert.ok(Math.abs(sites.initialStock - sites.remainingStock - mape.minedTotal) < 1e-7);
	assert.ok(mape.goods.every(v => Number.isFinite(v) && v >= 0));
	for (const r of [MAPE_RES.COAL, MAPE_RES.GOODS]) assert.ok(mape.demandView[r].every(v => v >= 0 && v <= 1));
}

function replay(id, fill) {
	main.setup(START_SEED, id, fill);
	assert.equal(mape.engine, mapSceneEngine(id));
	assert.equal(clock.speed, CLOCK_DEFAULT_SPEED);
	assert.equal(clock.seconds, 0);
	assert.equal(mapeGoodsTotal(), 0);
	assert.equal(mape.workshopCount, 0);
	assert.ok(mape.flowX.every(v => v === 0) && mape.flowY.every(v => v === 0));
	assert.ok(mape.demandView[MAPE_RES.COAL].every(v => v === fill));
	assert.deepEqual(Array.from({ length: mape.mineCount }, (_, m) => [mape.mineX[m], mape.mineY[m]]), MAPE_SCENE_LAYOUTS[id].mines);
	assert.equal(mape.settleCount, MAPE_SCENE_LAYOUTS[id].towns.length);
	for (const [x, y] of MAPE_SCENE_LAYOUTS[id].towns) assert.ok(mapeIsSettlement(y * world.size + x));
	advance(6);
	const flowCells = mape.flowX.reduce((count, x, i) => count + (Math.hypot(x, mape.flowY[i]) > mape.flowDt * 0.06), 0);
	assert.ok(flowCells > 30 && mape.massOut > 1, 'visible supply arrives within 1.5 real seconds at 4×');
	validateScene();
	console.log(`scene=${id} fill=${fill} active_flow_cells_6s=${flowCells} used_6s=${mape.massOut.toFixed(2)}`);
	return mape.goods.slice();
}

function edit(tool, x, y) {
	mapScene.tool = tool;
	mapSceneEdit(x, y);
}

function verifyReroute() {
	main.setup(START_SEED, 'a');
	for (const [x, y] of [...MAPE_SCENE_LAYOUTS.a.mines, ...MAPE_SCENE_LAYOUTS.a.towns]) edit(3, x, y);
	const source = 32 * world.size + 26;
	edit(1, 26, 32);
	advance(2);
	assert.equal(mapeGoodsTotal(), mape.goodsView[MAPE_RES.COAL][source]);
	mape.localPressure = true;
	advance(1);
	assert.ok(mapeGoodsTotal() - mape.goodsView[MAPE_RES.COAL][source] > 0.1, 'local pressure spreads stock without a town');
	mape.localPressure = false;
	edit(2, 42, 32);
	advance(8);
	const east = mape.flowX[source] / mape.flowDt;
	edit(3, 42, 32);
	edit(2, 18, 32);
	advance(1);
	const west = mape.flowX[source] / mape.flowDt;
	assert.ok(east > 0.1 && west < -0.1, 'replacing the buyer reverses the actual shipments');
	const stored = mapeGoodsTotal();
	edit(3, 26, 32);
	assert.equal(mapeGoodsTotal(), stored);
	assert.equal(mape.mineCount, 0);
	validateScene();
	console.log(`reroute_net_east_units_per_s=${east.toFixed(2)} reroute_net_after_1s=${west.toFixed(2)}`);
}

for (const id of ['a', 'b']) {
	replay(id, 0.5);
	const first = replay(id, 0);
	assert.deepEqual(replay(id, 0), first);
	advance(114);
	const site = mape.mineSite[0];
	const left = sites.stock[site] / SITE_DEPOSIT_STOCK[RES.FUEL];
	assert.ok(left > 0.75 && left < 0.85);
	assert.ok(mape.massOut > mape.minedTotal * 0.7, 'the reference layout keeps serving stock at 4×');
	assert.equal(sites.state[site], SITE_STATE.VISIBLE);
	validateScene();
	console.log(`scene=${id} deposit_fraction_120s=${left.toFixed(3)} used_120s=${mape.massOut.toFixed(2)}`);
}
verifyReroute();

main.setup(START_SEED, '', 0, MAPE_ENGINE.CATCHMENT);
advance(8);
assert.ok(mape.workshopCount > 0 && mape.massIn > 20, 'workshops run before any coal mine unlocks');
assert.equal(mape.minedTotal, 0);
assert.ok(mape.flowX.subarray(MAPE_RES.GOODS * world.n, (MAPE_RES.GOODS + 1) * world.n).some(v => v > 0));
assert.ok(Math.abs(mapeLedgerResidual()) < 1e-7);
console.log(`mape_scene_checks=pass survey_workshop_output_8s=${mape.massIn.toFixed(2)}`);
