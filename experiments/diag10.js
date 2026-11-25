// diag10: post-removal rerun of the diag8 test-16 probe test-16 scenario — coal transport gate + town profit breakdown
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

// extended probe: firms, founding, town income split
const ECONOMY_MINE = 1, ECONOMY_FACTORY = 2, ECONOMY_TOWN = 3;
console.log('\n=== actor map (t=45) ===');
for (let i = 0; i < model.actors.length; i++) {
	if (!model.actors[i]) continue;
	const x = i % 74, y = Math.floor(i / 74);
	console.log(`  (${x},${y}) actor=${model.actors[i]} (${['', 'MINE', 'FACTORY', 'TOWN'][model.actors[i]]})`);
}
console.log(`founded=${model.settlements.founded}`);
for (const [name, c] of [['mine', mine], ['factory', factory]]) {
	const opt = model.optimizer;
	const recipe = opt.recipes[model.actors[c]];
	console.log(`${name}: labor=${model.labor[c].toFixed(3)} pool=${opt.firmLaborPool(c, recipe).toFixed(3)} laborBid=${(model.actors[c] === ECONOMY_MINE ? opt.mineLaborBid(c) : opt.factoryLaborBid(c)).toPrecision(3)} scale=${model.scale[c].toFixed(2)} profit=${model.profit[c].toFixed(3)} queue=${model.workers.queuedAt(c).toFixed(2)} coalStock=${model.coal[c].toFixed(3)} goodsStock=${model.goods[c].toFixed(3)}`);
}
console.log(`settle intent around between town: labor slope from town=${(() => { const ok = model.workers.steer.sampleGradient(model.priceLabor, null, 0, between, -Infinity); return ok ? model.workers.steer.grad[2].toPrecision(3) : 'none'; })()} (threshold ${vm.runInContext('WORKER_DOCK_SLOPE', ctx)})`);
console.log(`unemploymentTotal=${model.workers.unemploymentTotal.toFixed(2)} facilityDemand=${model.workers.facilityDemand()}`);

// income split probe: wrap money flows per town
const incB = { tax: 0, rest: 0, owner: 0 }, incI = { tax: 0, rest: 0, owner: 0 };
const oCT = model.money.collectTax.bind(model.money);
model.money.collectTax = function (i, c) { const r = oCT(i, c); if (i === between) incB.tax += model.money.taxes; if (i === idle) incI.tax += model.money.taxes; return r; };
const oPRT = model.money.payRestTax.bind(model.money);
model.money.payRestTax = function (i, t) { if (i === between) incB.rest += t; if (i === idle) incI.rest += t; return oPRT(i, t); };
const oCO = model.money.creditOwner.bind(model.money);
model.money.creditOwner = function (owner, cash) { if (owner === between) incB.owner += cash; if (owner === idle) incI.owner += cash; return oCO(owner, cash); };
const marks = [15, 30, 45];
let mi = 0;
const oStep = model.step.bind(model);
model.step = function () { oStep(); if (mi < marks.length && Math.abs(model.ticks * DT - marks[mi]) < 1e-9) { const w = 15; console.log(`window ending t=${marks[mi]}: between tax=${(incB.tax / w).toFixed(3)} rest=${(incB.rest / w).toFixed(3)} ownerPay=${(incB.owner / w).toFixed(3)} earned=${model.earned[between].toFixed(3)} | idle tax=${(incI.tax / w).toFixed(3)} rest=${(incI.rest / w).toFixed(3)} ownerPay=${(incI.owner / w).toFixed(3)} earned=${model.earned[idle].toFixed(3)}`); incB.tax = incB.rest = incB.owner = incI.tax = incI.rest = incI.owner = 0; mi++; } };
// re-run from scratch with wraps active
const model2 = null;
