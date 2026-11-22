// owns: money gates — ledger conservation, big-town minting, payment flow both ways, price spread, purse and wage-offer effects
// run: node experiments/mape_money.js

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const [, file] of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
	vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}
const run = code => vm.runInThisContext(code);

let failures = 0;
function check(name, ok) {
	console.log('check_' + name + '=' + (ok ? 'pass' : 'FAIL'));
	if (!ok) failures++;
}

run(`
function moneyAdvance(seconds) {
	for (let k = 0, count = Math.round(seconds / SIM_STEP_SEC); k < count; k++) main.step(SIM_STEP_SEC);
}
function moneySample() {
	const n = world.n;
	let towns = 0, townCash = 0, siteCash = 0, minting = 0, broke = 0, offerLo = Infinity, offerHi = 0;
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		towns++;
		townCash += mape.money[i];
		if (mape.pop[i] > MAPE_MINT_POP) minting++;
		if (mapeMoneyBuy(i) < 0.99) broke++;
	}
	for (let i = 0; i < n; i++) {
		if (!mapeIsIndustry(i)) continue;
		siteCash += mape.money[i];
		if (mape.jobNeed[i] <= 0) continue;
		offerLo = Math.min(offerLo, mapeMoneyHire(i));
		offerHi = Math.max(offerHi, mapeMoneyHire(i));
	}
	let lo = Infinity, hi = 0;
	const price = mapeMoney.priceView[MAPE_RES.GOODS];
	for (let i = 0; i < n; i++) {
		if (world.terrain[i] === TERRAIN.WATER) continue;
		const r = price[i] / MAPE_PRICE_BASE[MAPE_RES.GOODS];
		if (r < lo) lo = r;
		if (r > hi) hi = r;
	}
	let buyFlow = 0, wageFlow = 0;
	for (let p = 0; p < n; p++) {
		buyFlow += Math.hypot(mapeMoney.flowX[p], mapeMoney.flowY[p]);
		wageFlow += Math.hypot(mapeMoney.flowX[n + p], mapeMoney.flowY[n + p]);
	}
	return { towns, townCash, siteCash, minting, broke, offerLo: offerLo === Infinity ? 0 : offerLo, offerHi,
		lo, hi, buyFlow: mape.flowDt ? buyFlow / mape.flowDt : 0, wageFlow: mape.flowDt ? wageFlow / mape.flowDt : 0, total: mapeMoneyTotal(), transit: mapeMoneyTransit(),
		minted: mapeMoney.minted, worn: mapeMoney.worn, residual: mapeMoneyResidual(), pop: mape.totalPop };
}
`);

function line(engine, t, s) {
	console.log('engine=' + engine + ' t=' + t + ' money=' + s.total.toFixed(0) + ' town_cash=' + s.townCash.toFixed(0) + ' site_cash=' + s.siteCash.toFixed(0) +
		' transit=' + s.transit.toFixed(1) + ' minted=' + s.minted.toFixed(0) + ' worn=' + s.worn.toFixed(0) + ' minting_towns=' + s.minting +
		' short_purse_towns=' + s.broke + '/' + s.towns + ' hire_lo=' + s.offerLo.toFixed(2) + ' hire_hi=' + s.offerHi.toFixed(2) +
		' goods_price_lo=' + s.lo.toFixed(2) + ' goods_price_hi=' + s.hi.toFixed(2) + ' buy_flow=' + s.buyFlow.toFixed(2) + ' wage_flow=' + s.wageFlow.toFixed(2) +
		' pop=' + s.pop.toFixed(0) + ' residual=' + s.residual.toExponential(1));
}

for (const [name, mode] of [['catchment', 'MAPE_ENGINE.CATCHMENT'], ['diffusion', 'MAPE_ENGINE.DIFFUSION']]) {
	run('main.setup(START_SEED, "", 0, ' + mode + ')');
	const start = run('moneySample()');
	line(name, 0, start);
	let last = start;
	let sawMint = false, sawBuy = false, sawWage = false, worstResidual = 0;
	for (let t = 60; t <= 240; t += 60) {
		run('moneyAdvance(60)');
		last = run('moneySample()');
		line(name, t, last);
		sawMint = sawMint || last.minted > 0;
		sawBuy = sawBuy || last.buyFlow > 0;
		sawWage = sawWage || last.wageFlow > 0;
		worstResidual = Math.max(worstResidual, Math.abs(last.residual) / Math.max(1, last.total));
	}
	check(name + '_ledger_conserved', worstResidual < 1e-9);
	check(name + '_big_towns_mint', sawMint);
	check(name + '_purchases_flow', sawBuy);
	check(name + '_wages_flow', sawWage);
	check(name + '_sites_hold_cash', last.siteCash > 0);
	check(name + '_prices_spread', last.hi > 2 * last.lo);
}

run('main.setup(START_SEED, "", 0, MAPE_ENGINE.CATCHMENT)');
const purse = run(`(function () {
	const i = mape.settleCells[0];
	mape.money[i] = 0;
	moneyAdvance(0.5);
	const poor = mapeMoneyBuy(i);
	mape.money[i] = 1e6;
	moneyAdvance(0.5);
	return { poor, rich: mapeMoneyBuy(i) };
})()`);
console.log('purse_poor=' + purse.poor.toFixed(2) + ' purse_rich=' + purse.rich.toFixed(2));
check('purse_backs_demand', purse.poor < 0.5 && purse.rich === 1);

const trade = run(`(function () {
	const i = mape.settleCells[0];
	const before = mapeMoneyResidual();
	economy.inventory[RES.ORE] = 5;
	const revenue = mapeSell(RES.ORE, i);
	return { revenue, drift: Math.abs(mapeMoneyResidual() - before) };
})()`);
console.log('trade_revenue=' + trade.revenue.toFixed(2) + ' trade_drift=' + trade.drift.toExponential(1));
check('player_trade_ledgered', trade.revenue > 0 && trade.drift < 1e-6);

console.log('money_failures=' + failures);
process.exitCode = failures ? 1 : 0;
