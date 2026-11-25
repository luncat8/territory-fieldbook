// diag9-b2: same scenario on B2 (the passing reference) — comparable numbers to diag8
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const B2 = path.join(__dirname, '..', 'prototype', 'price-model-b2');
for (const file of ['simulation.js', 'actors.js', 'gold.js', 'workforce.js', 'land.js', 'settlement.js']) {
	vm.runInThisContext(fs.readFileSync(path.join(B2, file), 'utf8'), { filename: file });
}

const model = new PriceEconomy();
model.actors.fill(0);
model.pop.fill(0);
model.scale.fill(0);
model.taxMult.fill(0);
model.laborFlow.gold.fill(0);
model.depletedFlow.gold.fill(0);
model.money.reset();
const mine = economyIndex(10, 14);
const between = economyIndex(12, 14);
const factory = economyIndex(14, 14);
const idle = economyIndex(40, 14);
model.setActor(mine, 1); model.setActor(between, 3); model.setActor(factory, 2); model.setActor(idle, 3);

const DT = 1 / 60;
function sample(t) {
	const cells = [];
	for (let x = 10; x <= 15; x++) cells.push(economyIndex(x, 14));
	console.log(`\n--- t=${t}s ---`);
	console.log('coal line x=10..15:');
	console.log('  stock : ' + cells.map(i => model.coal[i].toFixed(3)).join(' '));
	console.log('  price : ' + cells.map(i => model.priceCoal[i].toFixed(4)).join(' '));
	console.log(`  factory coal=${model.coal[factory].toFixed(3)} town coal=${model.coal[between].toFixed(3)}`);
	console.log(`  pLabor m/t/f=${model.priceLabor[mine].toFixed(5)}/${model.priceLabor[between].toFixed(5)}/${model.priceLabor[factory].toFixed(5)} | pGoods t=${model.priceGoods[between].toFixed(5)}`);
	console.log(`  pop b=${model.pop[between].toFixed(2)} i=${model.pop[idle].toFixed(2)} | taxMult b=${(model.taxMult[between] || 1).toFixed(2)} i=${(model.taxMult[idle] || 1).toFixed(2)} | profit b=${model.profit[between].toFixed(4)} i=${model.profit[idle].toFixed(4)}`);
	console.log(`  purse b=${model.money.purse[between].toFixed(2)} wPurse=${model.money.workerPurse[between].toFixed(3)} | i=${model.money.purse[idle].toFixed(2)} wPurse=${model.money.workerPurse[idle].toFixed(3)}`);
	console.log(`  labor b=${model.labor[between].toFixed(3)} depl b=${model.depleted[between].toFixed(3)} | labor i=${model.labor[idle].toFixed(3)} depl i=${model.depleted[idle].toFixed(3)}`);
	console.log(`  sat b: coal=${model.satCoal[between].toFixed(2)} goods=${model.satGoods[between].toFixed(2)} | i: coal=${model.satCoal[idle].toFixed(2)} goods=${model.satGoods[idle].toFixed(2)}`);
	console.log(`  producedGoods=${model.producedGoods.toFixed(2)} producedCoal=${model.producedCoal.toFixed(2)}`);
}
function run(t) { for (let s = 0; s < Math.round(t / DT); s++) model.step(); }
run(15); sample(15);
run(15); sample(30);
run(10); sample(40);
