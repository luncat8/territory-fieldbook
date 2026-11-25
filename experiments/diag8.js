// diag8: test-16 scenario — coal transport gate + town profit breakdown
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'prototype/particle-transfer');
const ctx = vm.createContext({ console, Math, JSON, Float64Array, Int16Array, Uint8Array, Int32Array, Array, Object, Number, String, Boolean, Map, Set, NaN, Infinity });
function load(file) {
	const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
	vm.runInContext(src, ctx, { filename: file });
}
load('simulation.js'); load('land.js'); load('track.js'); load('particles.js'); load('steering.js'); load('gold.js'); load('actors.js');
load('worker-lifecycle.js'); load('workers.js'); load('workforce.js'); load('settlement.js');
const { PriceEconomy, economyIndex } = vm.runInContext('({ PriceEconomy, economyIndex })', ctx);
const DT = 1 / 60;

const model = new PriceEconomy();
model.actors.fill(0);
model.pop.fill(0);
model.scale.fill(0);
model.taxMult.fill(0);
model.workLoad.fill(0);
model.laborFlow.gold.fill(0);
model.depletedFlow.gold.fill(0);
model.particles.reset();
model.money.reset();
model.settlements.reset();
// neutralLand
const TERRAIN_FOREST = vm.runInContext('TERRAIN_FOREST', ctx);
const FOREST_TERRAIN = vm.runInContext('FOREST_TERRAIN', ctx);
model.land.terrain.fill(TERRAIN_FOREST);
model.land.refresh();
model.settlements.forestCap.fill(FOREST_TERRAIN);
model.settlements.forest.fill(FOREST_TERRAIN);
const mine = economyIndex(10, 14);
const between = economyIndex(12, 14);
const factory = economyIndex(14, 14);
const idle = economyIndex(40, 14);
model.setActor(mine, 1); model.setActor(between, 3); model.setActor(factory, 2); model.setActor(idle, 3);

// wrap collectTax for per-town tax income
const taxSum = { between: 0, idle: 0 };
const origCollect = model.money.collectTax.bind(model.money);
model.money.collectTax = function (i, comfort) {
	const before = this.purse[i] === undefined ? 0 : 0;
	const r = origCollect(i, comfort);
	if (i === between) taxSum.between += model.earned[i]; // not exact; use profit delta below instead
	return r;
};

function sample(t) {
	const cells = [];
	for (let x = 10; x <= 15; x++) cells.push(economyIndex(x, 14));
	console.log(`\n--- t=${t}s ---`);
	console.log('coal line x=10..15:');
	console.log('  stock : ' + cells.map(i => model.coal[i].toFixed(3)).join(' '));
	console.log('  price : ' + cells.map(i => model.priceCoal[i].toFixed(4)).join(' '));
	const price = model.priceCoal;
	const sell = model.particles.sellAt(0, mine);
	const minThere0 = Math.max(price[mine], sell);
	const NEIGHBORS = vm.runInContext('NEIGHBORS', ctx);
	const base = mine * 8;
	const neigh = [];
	for (let k = 0; k < 8; k++) {
		const to = NEIGHBORS[base + k];
		if (to < 0) continue;
		neigh.push(`${to}:${price[to].toFixed(4)}${price[to] > minThere0 ? '*' : ''}`);
	}
	console.log(`  mine gate: price=${price[mine].toFixed(4)} sell=${sell.toFixed(4)} minThere=${minThere0.toFixed(4)} neighbors ${neigh.join(' ')}`);
	console.log(`  mine spawn=${model.particles.spawnAt(0, mine).toFixed(3)} idle=${model.particles.spawnIdle[mine].toFixed(2)} | factory coal=${model.coal[factory].toFixed(3)} town coal=${model.coal[between].toFixed(3)} inFlight=${model.particles.inFlightTotal(0).toFixed(3)}`);
	console.log(`  pLabor m/t/f=${model.priceLabor[mine].toFixed(5)}/${model.priceLabor[between].toFixed(5)}/${model.priceLabor[factory].toFixed(5)} | pGoods t=${model.priceGoods[between].toFixed(5)} pCoal t=${model.priceCoal[between].toFixed(4)}`);
	console.log(`  pop b=${model.pop[between].toFixed(2)} i=${model.pop[idle].toFixed(2)} | taxMult b=${(model.taxMult[between] || 1).toFixed(2)} i=${(model.taxMult[idle] || 1).toFixed(2)} | profit b=${model.profit[between].toFixed(4)} i=${model.profit[idle].toFixed(4)}`);
	console.log(`  purse b=${model.money.purse[between].toFixed(2)} wPurse=${model.money.workerPurse[between].toFixed(3)} | i=${model.money.purse[idle].toFixed(2)} wPurse=${model.money.workerPurse[idle].toFixed(3)}`);
	console.log(`  sat b: coal=${model.satCoal[between].toFixed(2)} goods=${model.satGoods[between].toFixed(2)} | i: coal=${model.satCoal[idle].toFixed(2)} goods=${model.satGoods[idle].toFixed(2)}`);
	console.log(`  producedGoods=${model.producedGoods.toFixed(2)} producedCoal=${model.producedCoal.toFixed(2)} unemp(b)=${model.unemployedAt(between).toFixed(2)} unemp(i)=${model.unemployedAt(idle).toFixed(2)}`);
	// profit deltas since last sample handled by caller
	// worker dock states at both towns
	for (const [name, c] of [['between', between], ['idle', idle]]) {
		let f = 0, d = 0, q = 0;
		const wk = model.workers;
		for (let p = 0; p < wk.count; p++) {
			if (wk.dockCell[p] !== c) continue;
			if (wk.state[p] === 0) f += wk.amount[p]; else d += wk.amount[p];
		}
		q = model.workers.queuedAt ? model.workers.queuedAt(c) : 0;
		console.log(`  ${name} town dockF=${f.toFixed(2)} dockD=${d.toFixed(2)} queue=${q.toFixed(2)} labor=${model.labor[c].toFixed(3)} depl=${model.depleted[c].toFixed(3)}`);
	}
}
let lastProfitB = 0, lastProfitI = 0;
function run(t) { for (let s = 0; s < Math.round(t / DT); s++) model.step(); }
function sampleWithDelta(t) {
	sample(t);
	console.log(`  dProfit since prev: b=${(model.profit[between] - lastProfitB).toFixed(4)} i=${(model.profit[idle] - lastProfitI).toFixed(4)}`);
	lastProfitB = model.profit[between]; lastProfitI = model.profit[idle];
}
run(15); sampleWithDelta(15);
run(15); sampleWithDelta(30);
run(15); sampleWithDelta(45);
