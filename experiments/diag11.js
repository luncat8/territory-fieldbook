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

// income split wraps (installed before the run)
const incB = { tax: 0, rest: 0, owner: 0 }, incI = { tax: 0, rest: 0, owner: 0 };
const oCT = model.money.collectTax.bind(model.money);
model.money.collectTax = function (i, c) { const before = model.money.taxes; const r = oCT(i, c); if (i === between) incB.tax += model.money.taxes - before; if (i === idle) incI.tax += model.money.taxes - before; return r; };
const oPRT = model.money.payRestTax.bind(model.money);
model.money.payRestTax = function (i, t) { if (i === between) incB.rest += t; if (i === idle) incI.rest += t; return oPRT(i, t); };
const oCO = model.money.creditOwner.bind(model.money);
model.money.creditOwner = function (owner, cash) { if (owner === between) incB.owner += cash; if (owner === idle) incI.owner += cash; return oCO(owner, cash); };
let lastProfitB = 0, lastProfitI = 0;
function sampleWithDelta(t) {
	sample(t);
	console.log(`  dProfit since prev: b=${(model.profit[between] - lastProfitB).toFixed(4)} i=${(model.profit[idle] - lastProfitI).toFixed(4)}`);
	lastProfitB = model.profit[between]; lastProfitI = model.profit[idle];
}
function run(t) { for (let s = 0; s < Math.round(t / DT); s++) model.step(); }
run(15); sampleWithDelta(15); printInc(15);
run(15); sampleWithDelta(30); printInc(30);
run(15); sampleWithDelta(45); printInc(45);
function printInc(t) {
	const w = 15;
	console.log(`  income/s b: tax=${(incB.tax / w).toFixed(3)} rest=${(incB.rest / w).toFixed(3)} ownerPay=${(incB.owner / w).toFixed(3)} | i: tax=${(incI.tax / w).toFixed(3)} rest=${(incI.rest / w).toFixed(3)} ownerPay=${(incI.owner / w).toFixed(3)}`);
	incB.tax = incB.rest = incB.owner = incI.tax = incI.rest = incI.owner = 0;
}

// extended probe: firms, founding, income split
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
console.log(`labor slope from between town=${(() => { const ok = model.workers.steer.sampleGradient(model.priceLabor, null, 0, between, -Infinity); return ok ? model.workers.steer.grad[2].toPrecision(3) : 'none'; })()} (threshold ${vm.runInContext('WORKER_DOCK_SLOPE', ctx)})`);
console.log(`unemploymentTotal=${model.workers.unemploymentTotal.toFixed(2)} facilityDemand=${model.workers.facilityDemand()}`);

// coal particle trace + factory finance at t=45
console.log('--- coal particle trace (t=45) ---');
const pa = model.particles;
let shown = 0;
for (let p = 0; p < pa.count && shown < 14; p++) {
	if (pa.kind[p] !== 0 || pa.amount[p] <= 0) continue;
	shown++;
	const x = pa.x[p].toFixed(1), y = pa.y[p].toFixed(1);
	console.log(`  at(${x},${y}) amt=${pa.amount[p].toFixed(3)} ask=${pa.priceOf(p).toFixed(4)} vx=${pa.vx[p].toFixed(3)} vy=${pa.vy[p].toFixed(3)} owner=${pa.owner[p]} fCost=${pa.factoryCost[p].toFixed(3)} tCost=${pa.transportCost[p].toFixed(3)}`);
}
console.log(`coal particles=${shown}f shown of total=${pa.count}`);
console.log(`factory purse=${model.money.purse[factory].toFixed(3)} owedTransport=${model.money.owedTransport[factory].toFixed(3)} owedWage=${model.money.owedWage[factory].toFixed(3)} siteStock coal=${model.siteStockAt(0, factory).toFixed(3)} spawnAt coal=${pa.spawnAt(0, factory).toFixed(3)} goodsSpawn=${pa.spawnAt(1, factory).toFixed(3)}`);
console.log(`factory coalBid=${model.optimizer.factoryCoalBid(factory).toPrecision(3)} goodsBid=${model.optimizer.factoryGoodsBid ? model.optimizer.factoryGoodsBid(factory).toPrecision(3) : 'n/a'}`);
console.log(`mine purse=${model.money.purse[mine].toFixed(3)} mine depleted=${model.depleted[mine].toFixed(3)} factory depleted=${model.depleted[factory].toFixed(3)}`);

console.log('--- all actors (t=45): idx(kind@x,y) purse profit coal goods labor depl spawnC spawnG owedT owedO ---');
const W = vm.runInContext('ECONOMY_WIDTH', ctx);
const KIND = ['', 'MINE', 'FACT', 'TOWN'];
for (let i = 0; i < model.actors.length; i++) {
	const a = model.actors[i];
	if (!a) continue;
	console.log(`  ${i} ${KIND[a]}@(${i % W},${Math.floor(i / W)}) purse=${model.money.purse[i].toFixed(2)} prof=${model.profit[i].toFixed(3)} coal=${model.coal[i].toFixed(3)} goods=${model.goods[i].toFixed(3)} lab=${model.labor[i].toFixed(2)} depl=${model.depleted[i].toFixed(2)} spC=${model.particles.spawnAt(0, i).toFixed(3)} spG=${model.particles.spawnAt(1, i).toFixed(3)} owedT=${model.money.owedTransport[i].toFixed(2)}`);
}

console.log('--- town bid/cap audit (t=45) ---');
const opt = model.optimizer, SET = model.settlements;
for (const [name, c] of [['between', between], ['idle', idle]]) {
	const tax = opt.townTaxRate(c);
	const ceiling = SET.bidFactor(c) * 0.96;
	const maxCoal = (0.2 / 0.01) * tax * ceiling;
	const maxGoods = (0.8 / 0.034) * tax * ceiling;
	const share = opt.townShare(c);
	const coolG = model.money.townCool(c, share * tax * model.pop[c] * vm.runInContext('PURSE_SECONDS', ctx));
	console.log(`${name}: tax=${tax.toPrecision(4)} bidFactor=${SET.bidFactor(c).toFixed(3)} maxCoal=${maxCoal.toFixed(3)} maxGoods=${maxGoods.toFixed(3)} | pCoal=${model.priceCoal[c].toFixed(4)} pGoods=${model.priceGoods[c].toFixed(4)} | coalBid=${opt.townCoalBid(c).toFixed(4)} goodsBid=${opt.townGoodsBid(c).toFixed(4)} cool=${coolG.toPrecision(3)} stockG=${model.goods[c].toFixed(3)} targetG=${opt.townGoodsTarget(c).toFixed(3)}`);
}

console.log('--- coal price field x=8..17, y=11..16 (t=45) ---');
let hdr = '      ';
for (let x = 8; x <= 17; x++) hdr += `x${x}   `;
console.log(hdr);
for (let y = 11; y <= 16; y++) {
	let row = `y${y}: `;
	for (let x = 8; x <= 17; x++) {
		const i = economyIndex(x, y);
		const a = model.actors[i];
		const tag = a ? ['', 'M', 'F', 'T'][a] : '.';
		row += model.priceCoal[i].toFixed(2) + tag + '  ';
	}
	console.log(row);
}
let inWindow = 0, dest = {};
for (let p = 0; p < pa.count; p++) {
	if (pa.kind[p] !== 0 || pa.amount[p] <= 0) continue;
	const x = pa.x[p], y = pa.y[p];
	if (x >= 7 && x <= 18 && y >= 10 && y <= 17) { inWindow++; dest[pa.owner[p]] = (dest[pa.owner[p]] || 0) + pa.amount[p]; }
}
console.log(`coal particles in main window: ${inWindow}, by owner: ${JSON.stringify(dest)}`);

console.log('--- spawn gate audit for stuck buffers (685, 713) ---');
const SPAWN_UNIT = vm.runInContext('SPAWN_UNIT', ctx), SELL_MARGIN_ = vm.runInContext('SELL_MARGIN', ctx), PRICE_GATE_ = vm.runInContext('PRICE_GATE', ctx);
for (const c of [685, 713, 682]) {
	const amt = model.particles.spawnAt(0, c);
	const cost = model.particles.spawnCostAt(0, c);
	const unitCost = amt > 0 ? cost / amt : 0;
	const floor = Math.max(PRICE_GATE_, unitCost * (1 + SELL_MARGIN_));
	const minThere = Math.max(model.priceCoal[c], floor);
	const ok = model.particles.steer.sampleGradient(model.priceCoal, null, 0, c, minThere + 1e-12);
	console.log(`cell ${c}: amt=${amt.toFixed(3)} cost=${cost.toFixed(3)} unitCost=${unitCost.toFixed(4)} floor=${floor.toFixed(4)} price=${model.priceCoal[c].toFixed(4)} minThere=${minThere.toFixed(4)} sample=${ok ? 'yes grad=' + model.particles.steer.grad[2].toFixed(4) + ' to=(' + model.particles.steer.grad[0].toFixed(2) + ',' + model.particles.steer.grad[1].toFixed(2) + ')' : 'NO'}`);
}
console.log(`PARTICLE_CAP=${vm.runInContext('PARTICLE_CAP', ctx)} count=${model.particles.count}`);

console.log('--- field trace at east cells (founding + peaks) ---');
// rerun a fresh model with tracing; must rebuild from scratch — do it inline via new PriceEconomy in this vm ctx
const setup = `(() => {
	const m = new PriceEconomy();
	m.actors.fill(0); m.pop.fill(0); m.scale.fill(0); m.taxMult.fill(0); m.workLoad.fill(0);
	m.laborFlow.gold.fill(0); m.depletedFlow.gold.fill(0); m.particles.reset(); m.money.reset(); m.settlements.reset();
	m.land.terrain.fill(TERRAIN_FOREST); m.land.refresh();
	m.settlements.forestCap.fill(FOREST_TERRAIN); m.settlements.forest.fill(FOREST_TERRAIN);
	m.setActor(economyIndex(10,14),1); m.setActor(economyIndex(12,14),3); m.setActor(economyIndex(14,14),2); m.setActor(economyIndex(40,14),3);
	return m;
})()`;
const m2 = vm.runInContext(setup, ctx);
const watch = [economyIndex(39,14), economyIndex(40,14), economyIndex(41,14), economyIndex(42,14)];
let foundedLog = [];
const oSetActor2 = m2.setActor.bind(m2);
m2.setActor = function (i, kind) { const r = oSetActor2(i, kind); if (kind) foundedLog.push({ i, kind, t: (m2.ticks * DT).toFixed(2), pLab: m2.priceLabor[i].toFixed(3), pCoal: m2.priceCoal[i].toFixed(3), pGoods: m2.priceGoods[i].toFixed(3) }); return r; };
let peakLab = new Float64Array(model.actors.length), peakCoal = new Float64Array(model.actors.length);
for (let s = 0; s < Math.round(45 / DT); s++) {
	m2.step();
	for (const c of watch) { peakLab[c] = Math.max(peakLab[c], m2.priceLabor[c]); peakCoal[c] = Math.max(peakCoal[c], m2.priceCoal[c]); }
}
console.log('foundings:', JSON.stringify(foundedLog));
console.log('east chain founding order + field peaks:');
for (let i = 0; i < m2.actors.length; i++) {
	if (!m2.actors[i]) continue;
	console.log(`  ${i} ${['', 'MINE', 'FACT', 'TOWN'][m2.actors[i]]}@(${i % 48},${Math.floor(i / 48)}) peakLab=${peakLab[i].toFixed(3)} peakCoal=${peakCoal[i].toFixed(3)} bufferC=${m2.particles.spawnAt(0, i).toFixed(3)} unitCostC=${(m2.particles.spawnAt(0, i) > 1e-9 ? m2.particles.spawnCostAt(0, i) / m2.particles.spawnAt(0, i) : 0).toFixed(3)} labCost=${(m2.labor[i] > 1e-9 ? m2.laborFlow.cost[i] / m2.labor[i] : (m2.laborFlow.cost[i] || 0)).toFixed(3)}`);
}

console.log('--- counterfactual: remove founded factory 683 at t=45, run +20s ---');
const m3 = vm.runInContext(setup, ctx);
for (let s = 0; s < Math.round(45 / DT); s++) m3.step();
const fT = economyIndex(14,14), fT2 = economyIndex(12,14);
console.log(`t=45 baseline: pGoods(town)=${m3.priceGoods[fT2].toFixed(3)} profit(town)=${m3.profit[fT2].toFixed(3)} 686coal=${m3.coal[fT].toFixed(3)} 686prof=${m3.profit[fT].toFixed(3)}`);
m3.setActor(economyIndex(11,14), 0); m3.setActor(economyIndex(13,14), 0);
for (let s = 0; s < Math.round(20 / DT); s++) m3.step();
console.log(`t=65 no-683: pGoods(town)=${m3.priceGoods[fT2].toFixed(3)} profit(town)=${m3.profit[fT2].toFixed(3)} goods(town)=${m3.goods[fT2].toFixed(3)} 686coal=${m3.coal[fT].toFixed(3)} 686prof=${m3.profit[fT].toFixed(3)} 686spG=${m3.particles.spawnAt(1, fT).toFixed(3)}`);
console.log(`idle town (unchanged world): profit=${m3.profit[economyIndex(40,14)].toFixed(3)}`);
