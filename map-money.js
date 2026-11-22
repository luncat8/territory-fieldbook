// owns: money — big-town minting, local prices, household bills, wages, payment flow, purses, investment and the money ledger
// edit for: price law, wage base, mint rule, purse floors, payment speed and wear

// Payments travel as two stocks so no payer ever sits on its own sink: households pay
// industry (BUY), industry pays towns (WAGE). Each stock flows up the pull of who is owed.
const MAPE_PAY = { BUY: 0, WAGE: 1 };
const MAPE_PRICE_SLOTS = 6;
// CO2 is never bought, so its slot carries the price of labour (per worker-second).
const MAPE_PRICE_LABOUR = 5;
const MAPE_PRICE_BASE = [1.0, 1.0, 1.2, 0.5, 1.0, 0.05];
// Ease 0.5 keeps empty, unwanted land at 1×; at 0.2 every stockless cell read as dear.
const MAPE_PRICE_EASE = 0.5;
const MAPE_PRICE_MIN = 0.2;
const MAPE_PRICE_MAX = 4;
const MAPE_PRICE_STOCK_REF = 4;
const MAPE_PRICE_STAFF_REF = 16;
const MAPE_PRICE_SIGNED_REF = 1;
const MAPE_MINT_POP = 25;
const MAPE_MINT_RATE = 0.05;
const MAPE_MINT_RESERVE = 40;
const MAPE_PURSE_SEC = 30;
const MAPE_BUY_FLOOR = 0.4;
const MAPE_HIRE_FLOOR = 0.35;
const MAPE_HIRE_MAX = 1.5;
const MAPE_INVEST_RATE = 0.05;
const MAPE_INVEST_PURSE = 0.5;
const MAPE_DIVIDEND_RATE = 0.1;
const MAPE_SITE_CASH_MIN = 20;
const MAPE_PAY_FLOW = 3.6;
const MAPE_PAY_GRAD_REF = 0.005;
const MAPE_PAY_SIGNAL = 0.9;
const MAPE_PAY_DECAY = 0.02;
const MAPE_PAY_WEAR = 0.02;
// Coins below this stay put and only wear: pushing dust across the whole pull halo doubles the pass.
const MAPE_PAY_MOVE_MIN = 0.002;
const MAPE_EARN_TIME = 5;
const MAPE_EARN_REF = 0.5;
const MAPE_VIEW_MONEY_MAX = 4000;

const mapeMoney = {
	price: null,
	priceView: null,
	pay: null,
	payNext: null,
	pull: null,
	pullNext: null,
	earn: null,
	earnAcc: null,
	flowX: null,
	flowY: null,
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
	mapeMoney.payNext = new Float64Array(2 * n);
	mapeMoney.pull = new Float32Array(2 * n);
	mapeMoney.pullNext = new Float32Array(2 * n);
	mapeMoney.earn = new Float32Array(2 * n);
	mapeMoney.earnAcc = new Float64Array(2 * n);
	mapeMoney.flowX = new Float32Array(2 * n);
	mapeMoney.flowY = new Float32Array(2 * n);
	mapeMoney.buy = new Float32Array(n);
	mapeMoney.hire = new Float32Array(n);
	mapeMoney.view = new Float32Array(n);
	mapeMoney.pullView = new Float32Array(n);
}

function mapeMoneyReset() {
	for (const field of ['price', 'pay', 'payNext', 'pull', 'pullNext', 'earn', 'earnAcc', 'flowX', 'flowY', 'view', 'pullView']) mapeMoney[field].fill(0);
	mapeMoney.buy.fill(1);
	mapeMoney.hire.fill(1);
	mapeMoney.initial = mapeMoney.minted = mapeMoney.worn = mapeMoney.playerIn = mapeMoney.playerOut = mapeMoney.mintRate = 0;
}

function mapeMoneyFinishSetup() {
	mapeMoneyPrices();
	mapeMoneyViews();
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

// Output is a claim, not cash: the site is owed what it made at today's local price, and the
// claim only steers payments toward it. Cash arrives when a household payment reaches the site.
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

// Price is local scarcity: how hard a cell pulls against how much it already holds.
function mapeMoneyRatio(want, have) {
	const ratio = (want + MAPE_PRICE_EASE) / (have + MAPE_PRICE_EASE);
	return ratio < MAPE_PRICE_MIN ? MAPE_PRICE_MIN : ratio > MAPE_PRICE_MAX ? MAPE_PRICE_MAX : ratio;
}

function mapeMoneyPrices() {
	const n = world.n;
	const terrain = world.terrain;
	const water = TERRAIN.WATER;
	const demand = mape.demand;
	const goods = mape.goods;
	const price = mapeMoney.price;
	const bounded = mapeMarketEngine();
	for (let r = 0; r < MAPE_RES.CO2; r++) {
		const off = r * n;
		const base = MAPE_PRICE_BASE[r];
		const market = bounded && mapeIsMarketItem(r);
		for (let i = 0; i < n; i++) {
			if (terrain[i] === water) continue;
			const d = demand[off + i];
			const want = d <= 0 ? 0 : market ? (d > 1 ? 1 : d) : d / (d + MAPE_PRICE_SIGNED_REF);
			const s = goods[off + i];
			price[off + i] = base * mapeMoneyRatio(want, s / (s + MAPE_PRICE_STOCK_REF));
		}
	}
	const off = MAPE_PRICE_LABOUR * n;
	const base = MAPE_PRICE_BASE[MAPE_PRICE_LABOUR];
	const pull = mape.workforce;
	const present = mape.workforceMode === MAPE_WORKFORCE_MODE.FLUID ? mape.wfFresh : mape.pop;
	for (let i = 0; i < n; i++) {
		if (terrain[i] === water) continue;
		const w = pull[i] > 0 ? pull[i] : 0;
		const p = present[i];
		price[off + i] = base * mapeMoneyRatio(w / (w + MAPE_VIEW_PULL_REF), p / (p + MAPE_PRICE_STAFF_REF));
	}
}

function mapeMoneyFill(cash, full) {
	if (full <= 0 || cash >= full) return 1;
	return cash > 0 ? cash / full : 0;
}

// "Big towns make money": a town past the size line mints while its treasury is short of a
// reserve, so the money supply follows the large markets instead of growing without bound.
function mapeMoneyMint(dt) {
	const money = mape.money;
	const pop = mape.pop;
	let minted = 0;
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		const p = pop[i];
		if (p <= MAPE_MINT_POP) continue;
		const room = p * MAPE_MINT_RESERVE - money[i];
		if (room <= 0) continue;
		const add = Math.min(room, MAPE_MINT_RATE * (p - MAPE_MINT_POP) * dt);
		money[i] += add;
		minted += add;
	}
	mapeMoney.minted += minted;
	mapeMoney.mintRate = dt > 0 ? minted / dt : 0;
}

// Households pay for what they ate at the local price. Need backed by cash is the demand the
// map sees: a purse below a month of full needs weakens the town's import pull.
function mapeMoneyHouseholds(dt) {
	const n = world.n;
	const money = mape.money;
	const pay = mapeMoney.pay;
	const price = mapeMoney.price;
	const goodsOff = MAPE_RES.GOODS * n;
	const coalOff = MAPE_RES.COAL * n;
	const foodOff = MAPE_RES.FOOD * n;
	const needGoods = mapePopulationRate(MAPE_RES.GOODS);
	const needCoal = mapePopulationRate(MAPE_RES.COAL);
	const needFood = mapePopulationRate(MAPE_RES.FOOD);
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		const pg = price[goodsOff + i], pc = price[coalOff + i], pf = price[foodOff + i];
		const bill = mape.usedGoods[i] * pg + mape.usedCoal[i] * pc + mape.usedFood[i] * pf;
		const paid = bill < money[i] ? bill : money[i];
		if (paid > 0) {
			money[i] -= paid;
			pay[MAPE_PAY.BUY * n + i] += paid;
		}
		const full = mape.pop[i] * (needGoods * pg + needCoal * pc + needFood * pf) * MAPE_PURSE_SEC;
		mapeMoney.buy[i] = MAPE_BUY_FLOOR + (1 - MAPE_BUY_FLOOR) * mapeMoneyFill(money[i], full);
	}
}

// Capital above what a site needs goes home as profit: the towns own the work.
function mapeMoneyDividend(idx, keep, dt) {
	const extra = mape.money[idx] - keep;
	if (extra <= 0) return;
	const out = extra * Math.min(1, MAPE_DIVIDEND_RATE * dt);
	mape.money[idx] -= out;
	mapeMoney.pay[MAPE_PAY.WAGE * world.n + idx] += out;
}

// Saved capital is what lets a new site hire: a liquid town backs the work next door.
function mapeMoneyInvest(site, town, seed, dt) {
	const money = mape.money;
	if (town < 0 || money[site] >= seed) return;
	if (mapeMoney.buy[town] < MAPE_BUY_FLOOR + (1 - MAPE_BUY_FLOOR) * MAPE_INVEST_PURSE) return;
	const give = Math.min(seed - money[site], money[town] * MAPE_INVEST_RATE * dt);
	if (give <= 0) return;
	money[town] -= give;
	money[site] += give;
}

// Wages are owed to the town the crew is credited to (the job tabulation's nearest town) and
// paid from the site's cash; a site that can pay a month of full wages pulls labour harder.
function mapeMoneySite(x, y, need, dt) {
	const n = world.n;
	const idx = y * world.size + x;
	const money = mape.money;
	const wage = mapeMoney.price[MAPE_PRICE_LABOUR * n + idx];
	const present = mapeWorkPresent(idx);
	const bill = (present < need ? present : need) * wage * dt;
	const paid = bill < money[idx] ? bill : money[idx];
	if (paid > 0) {
		money[idx] -= paid;
		mapeMoney.pay[MAPE_PAY.WAGE * n + idx] += paid;
	}
	const town = mapeNearestSettlement(x, y);
	if (town >= 0) mapeMoney.earnAcc[MAPE_PAY.WAGE * n + town] += bill;
	const full = need * wage * MAPE_PURSE_SEC;
	mapeMoneyInvest(idx, town, full * 0.5, dt);
	mapeMoney.hire[idx] = MAPE_HIRE_FLOOR + (MAPE_HIRE_MAX - MAPE_HIRE_FLOOR) * mapeMoneyFill(money[idx], full);
	mapeMoneyDividend(idx, Math.max(MAPE_SITE_CASH_MIN, 2 * full), dt);
}

function mapeMoneySites(dt) {
	for (let m = 0; m < mape.mineCount; m++) {
		if (mapeMineActive(m)) mapeMoneySite(mape.mineX[m], mape.mineY[m], MAPE_MINE_WORKERS, dt);
	}
	for (let f = 0; f < mape.factoryCount; f++) {
		const need = mapeFactoryWorkers(f);
		if (need > 0) mapeMoneySite(mape.factoryX[f], mape.factoryY[f], need, dt);
	}
	for (let k = 0; k < mape.workshopCount; k++) mapeMoneyDividend(mape.workshopCells[k], MAPE_SITE_CASH_MIN, dt);
}

// Owed pull: each sink relaxes toward its smoothed claim rate, then one Jacobi pass per tick
// (units rule, units-and-scales.md) spreads it; reach sqrt(MAPE_DIFFUSE / decay) ≈ 9 cells.
function mapeMoneyPull(dt) {
	const n = world.n;
	const { earn, earnAcc, pull } = mapeMoney;
	const blend = 1 - Math.exp(-dt / MAPE_EARN_TIME);
	const response = 1 - Math.exp(-MAPE_PAY_SIGNAL * dt);
	const invDt = 1 / dt;
	for (let p = 0; p < earn.length; p++) {
		earn[p] += (earnAcc[p] * invDt - earn[p]) * blend;
		earnAcc[p] = 0;
	}
	const exp = mape.cellExport;
	for (let i = 0; i < n; i++) {
		if ((exp[i] & MAPE_CELL_INDUSTRY) !== 0) mapeMoneyRelax(i, response);
	}
	for (let k = 0; k < mape.settleCount; k++) mapeMoneyRelax(n + mape.settleCells[k], response);
	mapeDiffuseSlice(pull, mapeMoney.pullNext, 0, world.size, world.terrain, true, MAPE_DIFFUSE, MAPE_PAY_DECAY, dt, transport);
	mapeDiffuseSlice(pull, mapeMoney.pullNext, n, world.size, world.terrain, true, MAPE_DIFFUSE, MAPE_PAY_DECAY, dt, transport);
}

function mapeMoneyRelax(p, response) {
	const e = mapeMoney.earn[p];
	mapeMoney.pull[p] += (e / (e + MAPE_EARN_REF) - mapeMoney.pull[p]) * response;
}

function mapeMoneyAdvect(k, dt) {
	const size = world.size;
	const n = world.n;
	const terrain = world.terrain;
	const { pay, payNext, pull, flowX, flowY } = mapeMoney;
	const off = k * n;
	const end = off + n;
	let frac = MAPE_PAY_FLOW * dt;
	if (frac > MAPE_STEP_FRAC_MAX) frac = MAPE_STEP_FRAC_MAX;
	for (let p = off; p < end; p++) payNext[p] = pay[p];
	for (let y = 0; y < size; y++) {
		const row = y * size;
		for (let x = 0; x < size; x++) {
			const i = row + x;
			const p = off + i;
			if (pay[p] <= MAPE_PAY_MOVE_MIN || terrain[i] === TERRAIN.WATER) continue;
			mapePushUpGradient(x, y, i, p, size, pull, payNext, pay[p] * frac, MAPE_PAY_GRAD_REF, 0, null, flowX, flowY, false, transport);
		}
	}
	for (let p = off; p < end; p++) pay[p] = payNext[p];
}

// Payments land at the first sink of their kind they reach. Cash left on a cell that is no
// longer a town or a site (a town emptied, a plant removed) goes back to circulation as wages.
// Money in transit wears out: the only sink besides the player, so mint and wear set the supply.
function mapeMoneySettle(dt) {
	const n = world.n;
	const money = mape.money;
	const pay = mapeMoney.pay;
	const keep = Math.exp(-MAPE_PAY_WEAR * dt);
	let worn = 0;
	const exp = mape.cellExport;
	const pop = mape.pop;
	for (let i = 0; i < n; i++) {
		const industry = (exp[i] & MAPE_CELL_INDUSTRY) !== 0;
		const town = !industry && pop[i] >= MAPE_SETTLE_MIN;
		const w = n + i;
		if (industry && pay[i] > 0) {
			money[i] += pay[i];
			pay[i] = 0;
		}
		if (town && pay[w] > 0) {
			money[i] += pay[w];
			pay[w] = 0;
		}
		if (!industry && !town && money[i] > 0) {
			pay[w] += money[i];
			money[i] = 0;
		}
		for (let p = i; p <= w; p += n) {
			const before = pay[p];
			if (before <= 0) continue;
			pay[p] = before * keep;
			worn += before - pay[p];
		}
	}
	mapeMoney.worn += worn;
}

function mapeMoneyViews() {
	const n = world.n;
	const { pay, pull, view, pullView } = mapeMoney;
	const money = mape.money;
	for (let i = 0; i < n; i++) {
		view[i] = money[i] + pay[i] + pay[n + i];
		pullView[i] = pull[i] + pull[n + i];
	}
}

function mapeMoneyStep(dt) {
	if (dt <= 0) return;
	const n = world.n;
	mapeMoneyMint(dt);
	mapeMoneyHouseholds(dt);
	mapeMoneySites(dt);
	mapeMoneyPull(dt);
	mapeMoney.flowX.fill(0);
	mapeMoney.flowY.fill(0);
	mapeMoneyAdvect(MAPE_PAY.BUY, dt);
	mapeMoneyAdvect(MAPE_PAY.WAGE, dt);
	const slot = MAPE_VIEW_ITEM.MONEY * n;
	const { flowX, flowY } = mapeMoney;
	for (let i = 0; i < n; i++) {
		mape.flowX[slot + i] = flowX[i] + flowX[n + i];
		mape.flowY[slot + i] = flowY[i] + flowY[n + i];
	}
	mapeMoneySettle(dt);
	mapeMoneyPrices();
	mapeMoneyViews();
}

if (typeof module !== 'undefined') {
	module.exports = {
		mapeMoney, mapeMoneyStep, mapeMoneyEarn, mapeMoneyPlayer, mapeMoneyResidual, mapeMoneyTotal, mapeMoneyTransit,
		mapeMoneyPriceRatio, mapeMoneyBuy, mapeMoneyHire, MAPE_PAY, mapeMoneyPriceSlot, MAPE_PRICE_BASE, MAPE_PRICE_LABOUR, MAPE_PRICE_MIN, MAPE_PRICE_MAX
	};
}
