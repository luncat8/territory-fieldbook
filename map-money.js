// owns: money — the shared money interface the whole game reads and the active engine writes.
// edit for: the money container, price slot layout, and the read/access helpers.
//
// The default money economy is map-money-gold.js (the price-model-b gold engine). This file keeps
// only what every consumer needs: the mapeMoney container, its allocation/reset, the price-slot
// constants, and the accessors the HUD, trade, industry and render call. The old minted-money
// engine is separated and preserved in archive/map-money-legacy.js; its step/mint/bill/settle body
// is no longer loaded, so it does not cost context. mapeMoneyStep is a no-op stub — select the
// gold engine (mape.moneyEngine = 'gold', the default) to drive the economy.

const MAPE_PAY = { BUY: 0, WAGE: 1 };
const MAPE_PRICE_SLOTS = 6;
// CO2 is never bought, so its slot carries the price of labour (per worker-second).
const MAPE_PRICE_LABOUR = 5;
const MAPE_PRICE_BASE = [1.0, 1.0, 1.2, 0.5, 1.0, 0.05];
const MAPE_PRICE_MIN = 0.2;
const MAPE_PRICE_MAX = 4;
const MAPE_VIEW_MONEY_MAX = 4000;

// Shared money container. The active engine (gold) writes price/buy/hire/view/pay/money; the HUD,
// trade and render read them. These fields are the contract between the engine and the world.
const mapeMoney = {
	price: null,
	priceView: null,
	pay: null,
	earn: null,
	earnAcc: null,
	buy: null,
	hire: null,
	view: null,
	pullView: null,
	initial: 0,
	minted: 0,
	worn: 0,
	playerIn: 0,
	playerOut: 0,
	mintRate: 0
};

function mapeMoneyPrepare() {
	const n = world.n;
	if (mapeMoney.price && mapeMoney.view.length === n) return;
	mapeMoney.price = new Float32Array(MAPE_PRICE_SLOTS * n);
	mapeMoney.priceView = new Array(MAPE_PRICE_SLOTS);
	for (let s = 0; s < MAPE_PRICE_SLOTS; s++) mapeMoney.priceView[s] = mapeMoney.price.subarray(s * n, (s + 1) * n);
	mapeMoney.pay = new Float64Array(2 * n);
	mapeMoney.earn = new Float32Array(2 * n);
	mapeMoney.earnAcc = new Float64Array(2 * n);
	mapeMoney.buy = new Float32Array(n);
	mapeMoney.hire = new Float32Array(n);
	mapeMoney.view = new Float32Array(n);
	mapeMoney.pullView = new Float32Array(n);
}

function mapeMoneyReset() {
	for (const field of ['price', 'pay', 'earn', 'earnAcc', 'view', 'pullView']) mapeMoney[field].fill(0);
	mapeMoney.buy.fill(1);
	mapeMoney.hire.fill(1);
	mapeMoney.initial = mapeMoney.minted = mapeMoney.worn = mapeMoney.playerIn = mapeMoney.playerOut = mapeMoney.mintRate = 0;
}

function mapeMoneyFinishSetup() {
	mapeMoney.initial = mapeMoneyTotal();
}

function mapeMoneyBuy(i) {
	return mapeMoney.buy[i];
}

function mapeMoneyHire(i) {
	return mapeMoney.hire[i];
}

function mapeMoneyPriceSlot(item) {
	if (item === MAPE_VIEW_ITEM.PRICE_COAL) return MAPE_RES.COAL;
	if (item === MAPE_VIEW_ITEM.PRICE_GOODS) return MAPE_RES.GOODS;
	if (item === MAPE_VIEW_ITEM.PRICE_FOOD) return MAPE_RES.FOOD;
	return item === MAPE_VIEW_ITEM.WAGE ? MAPE_PRICE_LABOUR : -1;
}

function mapeMoneyPriceRatio(r, i) {
	const price = mapeMoney.price[r * world.n + i];
	return price > 0 ? price / MAPE_PRICE_BASE[r] : 1;
}

// Output is a claim, not cash: the site is owed what it made at today's local price. The gold
// engine bills from real consumption instead, but industry/farm still post this claim; it is
// accumulated harmlessly (the legacy pull that consumed it is archived).
function mapeMoneyEarn(site, r, units) {
	if (units <= 0) return;
	mapeMoney.earnAcc[MAPE_PAY.BUY * world.n + site] += units * mapeMoney.price[r * world.n + site];
}

// Cash crossing the map edge to the player's party: trade is the only external money flow.
function mapeMoneyPlayer(idx, delta) {
	mape.money[idx] += delta;
	if (delta > 0) mapeMoney.playerIn += delta;
	else mapeMoney.playerOut -= delta;
}

function mapeMoneyTotal() {
	const money = mape.money;
	const pay = mapeMoney.pay;
	const n = world.n;
	let sum = 0;
	for (let i = 0; i < n; i++) sum += money[i] + pay[i] + pay[n + i];
	return sum;
}

function mapeMoneyTransit() {
	const pay = mapeMoney.pay;
	let sum = 0;
	for (let p = 0; p < pay.length; p++) sum += pay[p];
	return sum;
}

function mapeMoneyResidual() {
	const m = mapeMoney;
	return mapeMoneyTotal() - (m.initial + m.minted + m.playerIn - m.playerOut - m.worn);
}

// No-op: the legacy minted-money engine is archived in archive/map-money-legacy.js. The default
// gold engine (map-money-gold.js) is dispatched by map-economy.js's mapeStepMoney.
function mapeMoneyStep(dt) {
}

if (typeof module !== 'undefined') {
	module.exports = {
		mapeMoney, mapeMoneyStep, mapeMoneyEarn, mapeMoneyPlayer, mapeMoneyResidual, mapeMoneyTotal, mapeMoneyTransit,
		mapeMoneyPriceRatio, mapeMoneyBuy, mapeMoneyHire, MAPE_PAY, mapeMoneyPriceSlot, MAPE_PRICE_BASE, MAPE_PRICE_LABOUR, MAPE_PRICE_MIN, MAPE_PRICE_MAX
	};
}
