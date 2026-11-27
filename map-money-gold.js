// owns: gold money economy — conserved gold, optimizing buy bids, price diffusion, wages, taxes and payment flow
// edit for: starting gold, bid calibration, payment speed and gold seeding. Replaces map-money.js as the default.
'use strict';

// Gold is the universal money: it is seeded into towns, conserved across bills, wages and taxes,
// and the only external flow is player trade. Prices are not minted from scarcity — firms and
// towns bid a margin-preserving share of marginal value, the bid diffuses and decays, and gold
// payments climb the sellers' asks exactly like goods climb the buyers' bids.
const GOLD_START_GOLD_PER_WORKER = 1;
const GOLD_PURSE_SEC = 15;
const GOLD_WORKER_SEC = 10;
const GOLD_RESERVE_SEC = 4;
const GOLD_INPUT_SHARE = 0.65;
const GOLD_BUFFER_SEC = 1.5;
const GOLD_COAL_COMFORT = 0.2;
const GOLD_GOODS_COMFORT = 0.8;
const GOLD_TOWN_COAL_NEED = 0.02;
const GOLD_TOWN_GOODS_NEED = 0.03;
const GOLD_SAT_RATE = 1.8;
const GOLD_PROFIT_RATE = 1.5;
const GOLD_DIFFUSE = 15;
const GOLD_DECAY = 0.08;
const GOLD_GATE = 0.01;
const GOLD_NEED_RESPONSE = 2;
const GOLD_FLOW_RATE = 7;
const GOLD_GRADIENT_KNEE = 0.006;
const GOLD_STEERING = 1 / 60 / (0.18 + 1 / 60);
const GOLD_MINE_LABOR = 0.25;
const GOLD_FACTORY_LABOR = 0.25;
const GOLD_FACTORY_YIELD = 1;
const GOLD_BUY_FLOOR = 0.4;
const GOLD_HIRE_FLOOR = 0.35;
const GOLD_HIRE_MAX = 1.5;
const GOLD_ASK_LEVEL = 1;
const GOLD_PAYOUT_RATE = 1;
const GOLD_PAY_COAL = 0;
const GOLD_PAY_GOODS = 1;
const GOLD_PAY_WAGE = 2;
const GOLD_DEGREE = 8;
const GOLD_DIR = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]]
	.map(([x, y]) => {
		const inv = x && y ? Math.SQRT1_2 : 1;
		return { x, y, inv, ux: x * inv, uy: y * inv, weight: x && y ? 1 : 4 };
	});
const GOLD_NEIGHBORS = buildGoldNeighbors();

function buildGoldNeighbors() {
	const size = world.size, n = world.n, terrain = world.terrain, water = TERRAIN.WATER;
	const result = new Int16Array(n * GOLD_DEGREE).fill(-1);
	for (let i = 0; i < n; i++) {
		if (terrain[i] === water) continue;
		const x = i % size, y = (i / size) | 0;
		for (let k = 0; k < GOLD_DEGREE; k++) {
			const nx = x + GOLD_DIR[k].x, ny = y + GOLD_DIR[k].y;
			if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
			const ni = ny * size + nx;
			if (terrain[ni] === water) continue;
			result[i * GOLD_DEGREE + k] = ni;
		}
	}
	return result;
}

const mapeGold = {
	actors: null,
	purse: null,
	workerPurse: null,
	coin: null,
	owed: null,
	ask: null,
	nextAsk: null,
	priceCoal: null,
	priceGoods: null,
	priceLabor: null,
	nextPriceCoal: null,
	nextPriceGoods: null,
	nextPriceLabor: null,
	satCoal: null,
	satGoods: null,
	profit: null,
	earned: null,
	scale: null,
	taxMult: null,
	scratch: null,
	seeded: 0,
	mined: 0,
	settled: 0,
	wages: 0,
	taxes: 0,
	mineRate: 0,
	wageRate: 0,
	taxRate: 0
};

function makeGoldScratch(buyers) {
	return {
		buyers,
		cap: new Float64Array(world.n).fill(Infinity),
		requests: new Float64Array(world.n * GOLD_DEGREE),
		room: new Float64Array(world.n),
		receiving: new Float64Array(world.n),
		delta: new Float64Array(world.n),
		headX: new Float64Array(world.n),
		headY: new Float64Array(world.n),
		flowX: new Float64Array(world.n),
		flowY: new Float64Array(world.n),
		flowRate: new Float64Array(world.n)
	};
}

function mapeGoldPrepare() {
	const n = world.n;
	if (mapeGold.actors && mapeGold.actors.length === n) return;
	mapeGold.actors = new Uint8Array(n);
	mapeGold.purse = new Float64Array(n);
	mapeGold.workerPurse = new Float64Array(n);
	mapeGold.coin = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
	mapeGold.owed = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
	mapeGold.ask = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
	mapeGold.nextAsk = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
	mapeGold.priceCoal = new Float64Array(n);
	mapeGold.priceGoods = new Float64Array(n);
	mapeGold.priceLabor = new Float64Array(n);
	mapeGold.nextPriceCoal = new Float64Array(n);
	mapeGold.nextPriceGoods = new Float64Array(n);
	mapeGold.nextPriceLabor = new Float64Array(n);
	mapeGold.satCoal = new Float64Array(n);
	mapeGold.satGoods = new Float64Array(n);
	mapeGold.profit = new Float64Array(n);
	mapeGold.earned = new Float64Array(n);
	mapeGold.scale = new Float64Array(n);
	mapeGold.taxMult = new Float64Array(n);
	mapeGold.scratch = [
		makeGoldScratch(1 << 1),   // coal coin → mines
		makeGoldScratch(1 << 2),   // goods coin → factories
		makeGoldScratch(1 << 3)    // wage coin → towns
	];
}

function mapeGoldReset() {
	const n = world.n;
	mapeGold.actors.fill(0);
	mapeGold.purse.fill(0);
	mapeGold.workerPurse.fill(0);
	for (let s = 0; s < 3; s++) {
		mapeGold.coin[s].fill(0);
		mapeGold.owed[s].fill(0);
		mapeGold.ask[s].fill(0);
		clearGoldScratch(mapeGold.scratch[s]);
	}
	mapeGold.priceCoal.fill(0);
	mapeGold.priceGoods.fill(0);
	mapeGold.priceLabor.fill(0);
	mapeGold.nextPriceCoal.fill(0);
	mapeGold.nextPriceGoods.fill(0);
	mapeGold.nextPriceLabor.fill(0);
	mapeGold.satCoal.fill(0);
	mapeGold.satGoods.fill(0);
	mapeGold.profit.fill(0);
	mapeGold.earned.fill(0);
	mapeGold.scale.fill(0);
	mapeGold.taxMult.fill(0);
	mapeGold.seeded = mapeGold.mined = mapeGold.settled = mapeGold.wages = mapeGold.taxes = 0;
	mapeGold.mineRate = mapeGold.wageRate = mapeGold.taxRate = 0;
}

function clearGoldScratch(scratch) {
	scratch.cap.fill(Infinity);
	scratch.headX.fill(0);
	scratch.headY.fill(0);
	scratch.flowX.fill(0);
	scratch.flowY.fill(0);
	scratch.flowRate.fill(0);
}

// Split scenario gold by budget horizons, never by a target price.
function mapeGoldSeed(i, pop, perWorker = GOLD_START_GOLD_PER_WORKER) {
	const total = pop * perWorker;
	const workerGold = total * GOLD_WORKER_SEC / (GOLD_WORKER_SEC + GOLD_INPUT_SHARE * GOLD_PURSE_SEC);
	const townGold = total - workerGold;
	mapeGold.workerPurse[i] += workerGold;
	mapeGold.purse[i] += townGold;
	mapeGold.seeded += workerGold + townGold;
}

function mapeGoldFinishSetup(perWorker = GOLD_START_GOLD_PER_WORKER) {
	mapeGoldReset();
	const n = world.n;
	for (let i = 0; i < n; i++) {
		if (mapeIsSettlement(i)) {
			mapeGold.actors[i] = 3;
			mapeGold.scale[i] = 1;
			mapeGold.taxMult[i] = 1;
			mapeGoldSeed(i, mape.pop[i] > 0 ? mape.pop[i] : 1, perWorker);
		}
	}
	mape.money.set(mapeGold.purse);
	for (let i = 0; i < n; i++) mape.money[i] += mapeGold.workerPurse[i];
	mapeMoney.initial = mapeGold.seeded;
	mapeMoney.minted = 0;
	mapeMoney.worn = 0;
	mapeMoney.mintRate = 0;
}

// Per-cell actor map from the game's settlements and industry sites, refreshed each tick.
function mapeGoldSyncActors() {
	const actors = mapeGold.actors;
	actors.fill(0);
	const size = world.size;
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		actors[i] = 3;
	}
	for (let m = 0; m < mape.mineCount; m++) {
		if (!mapeMineActive(m)) continue;
		actors[mape.mineY[m] * size + mape.mineX[m]] = 1;
	}
	for (let f = 0; f < mape.factoryCount; f++) {
		const st = mape.factoryState[f];
		if (st === MAPE_FACTORY_STATE.GONE) continue;
		actors[mape.factoryY[f] * size + mape.factoryX[f]] = 2;
	}
}

function optimalBid(value, stock, target, cool, suppress) {
	if (value <= 0 || target <= 0 || !Number.isFinite(cool)) return 0;
	const need = suppress ? Math.max(0, 1 - stock / target) : 1;
	return GOLD_INPUT_SHARE * value * need / cool;
}

function mapeGoldTownTax(i) {
	const mult = mapeGold.taxMult[i] || 1;
	return (mapeGold.workerPurse[i] / GOLD_WORKER_SEC) * mult / Math.max(1, mape.pop[i]);
}

function mapeGoldTownGoodsBid(i) {
	const tax = mapeGoldTownTax(i);
	const cool = mapeGoldTownCool(i, GOLD_INPUT_SHARE * tax * mape.pop[i] * GOLD_PURSE_SEC);
	return optimalBid((GOLD_GOODS_COMFORT / GOLD_TOWN_GOODS_NEED) * tax, 0, 1, cool, false);
}

function mapeGoldTownCoalBid(i) {
	const tax = mapeGoldTownTax(i);
	const cool = mapeGoldTownCool(i, GOLD_INPUT_SHARE * tax * mape.pop[i] * GOLD_PURSE_SEC);
	return optimalBid((GOLD_COAL_COMFORT / GOLD_TOWN_COAL_NEED) * tax, 0, 1, cool, false);
}

function mapeGoldFactoryCoalBid(i) {
	const out = mapeGold.priceGoods[i];
	const wageCost = mapeGold.priceLabor[i] * GOLD_FACTORY_LABOR * GOLD_FACTORY_YIELD;
	const cool = mapeGoldCreditCool(i, GOLD_INPUT_SHARE * out * 0.34 * GOLD_PURSE_SEC);
	return optimalBid(Math.max(0, out * GOLD_FACTORY_YIELD - wageCost), 0, 1, cool, false);
}

function mapeGoldFactoryLaborBid(i) {
	const out = mapeGold.priceGoods[i];
	const coalCost = mapeGold.priceCoal[i] / GOLD_FACTORY_YIELD;
	const cool = mapeGoldCreditCool(i, GOLD_INPUT_SHARE * out * 0.34 * GOLD_PURSE_SEC);
	return optimalBid(Math.max(0, (out - coalCost) / GOLD_FACTORY_LABOR), 0, 1, cool, false);
}

function mapeGoldMineLaborBid(i) {
	const out = mapeGold.priceCoal[i];
	const cool = mapeGoldCreditCool(i, GOLD_INPUT_SHARE * out * 0.34 * GOLD_PURSE_SEC);
	return optimalBid(out / GOLD_MINE_LABOR, 0, 1, cool, false);
}

function mapeGoldCreditCool(i, budget) {
	return 1 + mapeGoldOwed(i) / (budget + 1e-9);
}

function mapeGoldTownCool(i, budget) {
	const spend = Math.max(0, mapeGold.purse[i] - mapeGoldOwed(i));
	if (spend <= 0) return Infinity;
	return (spend >= budget ? 1 : budget / spend) * mapeGoldCreditCool(i, budget);
}

function mapeGoldOwed(i) {
	return mapeGold.owed[GOLD_PAY_COAL][i] + mapeGold.owed[GOLD_PAY_GOODS][i] + mapeGold.owed[GOLD_PAY_WAGE][i];
}

function mapeGoldUpdatePrices() {
	const n = world.n;
	const actors = mapeGold.actors;
	const decay = GOLD_DECAY;
	for (let i = 0; i < n; i++) {
		const a = actors[i];
		let bCoal = -1, bGoods = -1, bLabor = -1;
		if (a === 3) {
			bCoal = mapeGoldTownCoalBid(i);
			bGoods = mapeGoldTownGoodsBid(i);
		} else if (a === 2) {
			bCoal = mapeGoldFactoryCoalBid(i);
			bLabor = mapeGoldFactoryLaborBid(i);
		} else if (a === 1) {
			bLabor = mapeGoldMineLaborBid(i);
		}
		mapeGold.nextPriceCoal[i] = goldStepBid(mapeGold.priceCoal, i, mapeGold.priceCoal[i], bCoal, decay);
		mapeGold.nextPriceGoods[i] = goldStepBid(mapeGold.priceGoods, i, mapeGold.priceGoods[i], bGoods, decay);
		mapeGold.nextPriceLabor[i] = goldStepBid(mapeGold.priceLabor, i, mapeGold.priceLabor[i], bLabor, decay);
	}
	const tmp = mapeGold.priceCoal; mapeGold.priceCoal = mapeGold.nextPriceCoal; mapeGold.nextPriceCoal = tmp;
	const tg = mapeGold.priceGoods; mapeGold.priceGoods = mapeGold.nextPriceGoods; mapeGold.nextPriceGoods = tg;
	const tl = mapeGold.priceLabor; mapeGold.priceLabor = mapeGold.nextPriceLabor; mapeGold.nextPriceLabor = tl;
}

function goldDiffuse(field, i, here, decay) {
	let laplacian = 0;
	const base = i * GOLD_DEGREE;
	for (let k = 0; k < GOLD_DEGREE; k++) {
		const to = GOLD_NEIGHBORS[base + k];
		if (to >= 0) laplacian += GOLD_DIR[k].weight * (field[to] - here);
	}
	const value = here + (1 / 60) * (GOLD_DIFFUSE / 6 * laplacian - decay * here);
	return value < 0 ? 0 : value;
}

function goldStepBid(field, i, here, bid, decay) {
	const ambient = goldDiffuse(field, i, here, decay);
	if (bid < 0) return ambient;
	const relaxed = here + (1 / 60) * GOLD_NEED_RESPONSE * (bid - here);
	return ambient > here && ambient > relaxed ? ambient : relaxed;
}

// Bills come from the game's own consumption and staffing: towns pay for the coal and goods they
// ate, factories pay for their coal input, and every firm pays its crew. Gold then moves to the
// sellers and workers through the coin streams.
function mapeGoldBill(dt) {
	const n = world.n;
	const size = world.size;
	const price = mapeMoney.price;
	for (let i = 0; i < n; i++) {
		if (mapeGold.actors[i] === 3) {
			const pc = mapeGold.priceCoal[i], pg = mapeGold.priceGoods[i];
			const coal = mape.usedCoal[i] * pc;
			const goods = mape.usedGoods[i] * pg;
			if (coal > 0) mapeGold.owed[GOLD_PAY_COAL][i] += coal;
			if (goods > 0) mapeGold.owed[GOLD_PAY_GOODS][i] += goods;
		}
	}
	for (let f = 0; f < mape.factoryCount; f++) {
		const st = mape.factoryState[f];
		if (st === MAPE_FACTORY_STATE.GONE) continue;
		const i = mape.factoryY[f] * size + mape.factoryX[f];
		const coal = mape.factoryCoal[f] * dt * mapeGold.priceCoal[i];
		if (coal > 0) mapeGold.owed[GOLD_PAY_COAL][i] += coal;
		const present = mapeWorkPresent(i);
		const wage = present * mapeGold.priceLabor[i] * dt;
		if (wage > 0) mapeGold.owed[GOLD_PAY_WAGE][i] += wage;
	}
	for (let m = 0; m < mape.mineCount; m++) {
		if (!mapeMineActive(m)) continue;
		const i = mape.mineY[m] * size + mape.mineX[m];
		const present = mapeWorkPresent(i);
		const wage = present * mapeGold.priceLabor[i] * dt;
		if (wage > 0) mapeGold.owed[GOLD_PAY_WAGE][i] += wage;
	}
}

function mapeGoldSettle() {
	const n = world.n;
	const actors = mapeGold.actors;
	const inbound = [GOLD_PAY_COAL, GOLD_PAY_GOODS, GOLD_PAY_WAGE];
	for (let i = 0; i < n; i++) {
		const a = actors[i];
		if (!a) continue;
		const recv = a === 3 ? GOLD_PAY_WAGE : a === 2 ? GOLD_PAY_GOODS : GOLD_PAY_COAL;
		if (mapeGold.coin[recv][i] > 0) {
			if (a === 3) mapeGold.workerPurse[i] += mapeGold.coin[recv][i];
			else mapeGold.purse[i] += mapeGold.coin[recv][i];
			mapeGold.coin[recv][i] = 0;
		}
		const owed = mapeGoldOwed(i);
		if (owed > 0 && mapeGold.purse[i] > 0) {
			const share = Math.min(1, mapeGold.purse[i] / owed);
			for (let s = 0; s < 3; s++) {
				const pay = mapeGold.owed[s][i] * share;
				mapeGold.purse[i] -= pay;
				mapeGold.owed[s][i] -= pay;
				mapeGold.coin[s][i] += pay;
				mapeGold.settled += pay;
				if (s === GOLD_PAY_WAGE) mapeGold.wages += pay;
			}
			if (mapeGold.purse[i] < 1e-14) mapeGold.purse[i] = 0;
		}
		if (a !== 3) mapeGoldPaySurplus(i, a);
	}
}

function mapeGoldPaySurplus(i, actor) {
	const scale = mapeGold.scale[i] || 1;
	const unitRate = (actor === 2 ? 0.34 : 0.34) * scale;
	const costRate = actor === 2
		? (mapeGold.priceCoal[i] / GOLD_FACTORY_YIELD + mapeGold.priceLabor[i] * GOLD_FACTORY_LABOR) * unitRate
		: mapeGold.priceLabor[i] * unitRate * GOLD_MINE_LABOR;
	const payout = Math.max(0, mapeGold.purse[i] - costRate * GOLD_RESERVE_SEC) * (1 - Math.exp(-(1 / 60) * GOLD_PAYOUT_RATE));
	if (payout <= 0) return;
	mapeGold.purse[i] -= payout;
	mapeGold.coin[GOLD_PAY_WAGE][i] += payout;
	mapeGold.wages += payout;
}

function mapeGoldUpdateAsks() {
	const n = world.n;
	const actors = mapeGold.actors;
	const pop = mape.pop;
	const decay = GOLD_DECAY;
	for (let s = 0; s < 3; s++) {
		const receiver = s === GOLD_PAY_COAL ? 1 : s === GOLD_PAY_GOODS ? 2 : 3;
		const ask = mapeGold.ask[s], next = mapeGold.nextAsk[s];
		for (let i = 0; i < n; i++) {
			const level = actors[i] === receiver ? (receiver === 3 ? GOLD_ASK_LEVEL * (pop[i] / 10) : GOLD_ASK_LEVEL) : -1;
			next[i] = goldStepBid(ask, i, ask[i], level, decay);
		}
		const t = ask; mapeGold.ask[s] = next; mapeGold.nextAsk[s] = t;
	}
}

function mapeGoldTransport(scratch, stock, price) {
	const n = world.n;
	const { requests, room, receiving, delta, buyers, cap } = scratch;
	requests.fill(0);
	receiving.fill(0);
	delta.fill(0);
	scratch.flowX.fill(0);
	scratch.flowY.fill(0);
	scratch.flowRate.fill(0);
	for (let i = 0; i < n; i++) room[i] = Math.max(0, cap[i] - stock[i]);
	for (let i = 0; i < n; i++) {
		if (stock[i] > 1e-12 && !(buyers & (1 << mapeGold.actors[i]))) goldPlanOutflow(scratch, stock, price, i);
	}
	for (let i = 0; i < n; i++) if (receiving[i] > 0) receiving[i] = Math.min(1, room[i] / receiving[i]);
	for (let i = 0; i < n; i++) {
		if (stock[i] > 1e-12 && !(buyers & (1 << mapeGold.actors[i]))) goldAccept(scratch, stock, i);
	}
	for (let i = 0; i < n; i++) stock[i] = Math.max(0, stock[i] + delta[i]);
}

function goldPlanOutflow(scratch, stock, price, i) {
	const { requests, room } = scratch;
	const base = i * GOLD_DEGREE;
	const here = price[i];
	let gx = 0, gy = 0, steepest = 0;
	for (let k = 0; k < GOLD_DEGREE; k++) {
		const to = GOLD_NEIGHBORS[base + k];
		if (to < 0 || price[to] <= here || room[to] <= 0) continue;
		const dir = GOLD_DIR[k];
		const slope = (price[to] - here) * dir.inv;
		requests[base + k] = slope;
		steepest = Math.max(steepest, slope);
		gx += dir.ux * slope;
		gy += dir.uy * slope;
	}
	scratch.headX[i] += GOLD_STEERING * (gx - scratch.headX[i]);
	scratch.headY[i] += GOLD_STEERING * (gy - scratch.headY[i]);
	if (steepest > 0) goldRoute(scratch, stock, i, steepest);
}

function goldRoute(scratch, stock, i, steepest) {
	const { requests, receiving, flowRate } = scratch;
	const base = i * GOLD_DEGREE;
	const length = Math.hypot(scratch.headX[i], scratch.headY[i]) || 1;
	const gx = scratch.headX[i] / length, gy = scratch.headY[i] / length;
	let sum = 0;
	for (let k = 0; k < GOLD_DEGREE; k++) {
		const edge = base + k;
		if (!requests[edge]) continue;
		const dir = GOLD_DIR[k];
		requests[edge] *= 0.25 + 0.75 * Math.max(0, gx * dir.ux + gy * dir.uy);
		sum += requests[edge];
	}
	const outflow = stock[i] * GOLD_FLOW_RATE * (1 / 60) * steepest / (steepest + GOLD_GRADIENT_KNEE);
	for (let k = 0; k < GOLD_DEGREE; k++) {
		const edge = base + k;
		if (!requests[edge]) continue;
		requests[edge] *= outflow / sum;
		receiving[GOLD_NEIGHBORS[edge]] += requests[edge];
	}
}

function goldAccept(scratch, stock, i) {
	const { requests, receiving, delta } = scratch;
	const base = i * GOLD_DEGREE;
	let amountOut = 0, vx = 0, vy = 0;
	for (let k = 0; k < GOLD_DEGREE; k++) {
		const edge = base + k;
		if (!requests[edge]) continue;
		const to = GOLD_NEIGHBORS[edge];
		const amount = requests[edge] * receiving[to];
		delta[to] += amount;
		amountOut += amount;
		vx += GOLD_DIR[k].ux * amount;
		vy += GOLD_DIR[k].uy * amount;
	}
	delta[i] -= amountOut;
	scratch.flowRate[i] = amountOut / (1 / 60);
	scratch.flowX[i] = vx / (1 / 60);
	scratch.flowY[i] = vy / (1 / 60);
}

function mapeGoldStep(dt) {
	if (dt <= 0) return;
	mapeGoldSyncActors();
	mapeGoldUpdatePrices();
	mapeGoldBill(dt);
	mapeGoldUpdateAsks();
	mapeGoldSettle();
	for (let s = 0; s < 3; s++) mapeGoldTransport(mapeGold.scratch[s], mapeGold.coin[s], mapeGold.ask[s]);
	mapeGoldWriteInterface();
}

function mapeGoldFill(cash, full) {
	if (full <= 0 || cash >= full) return 1;
	return cash > 0 ? cash / full : 0;
}

function mapeGoldWriteInterface() {
	const n = world.n;
	const price = mapeMoney.price;
	for (let i = 0; i < n; i++) {
		price[MAPE_RES.COAL * n + i] = mapeGold.priceCoal[i];
		price[MAPE_RES.IRON * n + i] = mapeGold.priceCoal[i];
		price[MAPE_RES.GOODS * n + i] = mapeGold.priceGoods[i];
		price[MAPE_RES.LOGS * n + i] = mapeGold.priceGoods[i];
		price[MAPE_RES.FOOD * n + i] = mapeGold.priceGoods[i];
		price[MAPE_PRICE_LABOUR * n + i] = mapeGold.priceLabor[i];
	}
	for (let i = 0; i < n; i++) {
		const a = mapeGold.actors[i];
		if (a === 3) {
			const full = mape.pop[i] * (GOLD_TOWN_GOODS_NEED * mapeGold.priceGoods[i] + GOLD_TOWN_COAL_NEED * mapeGold.priceCoal[i]) * GOLD_PURSE_SEC;
			mapeMoney.buy[i] = GOLD_BUY_FLOOR + (1 - GOLD_BUY_FLOOR) * mapeGoldFill(mapeGold.purse[i] + mapeGold.workerPurse[i], full);
		} else if (a === 1 || a === 2) {
			const wage = mapeGold.priceLabor[i];
			const need = a === 2 ? 32 : 12;
			const full = need * wage * GOLD_PURSE_SEC;
			mapeMoney.hire[i] = GOLD_HIRE_FLOOR + (GOLD_HIRE_MAX - GOLD_HIRE_FLOOR) * mapeGoldFill(mapeGold.purse[i], full);
		}
		mapeMoney.view[i] = mapeGold.purse[i] + mapeGold.workerPurse[i] + mapeGold.coin[0][i] + mapeGold.coin[1][i] + mapeGold.coin[2][i];
		mapeMoney.pullView[i] = mapeGoldOwed(i);
		mapeMoney.pay[i] = mapeGold.coin[GOLD_PAY_COAL][i] + mapeGold.coin[GOLD_PAY_GOODS][i];
		mapeMoney.pay[n + i] = mapeGold.coin[GOLD_PAY_WAGE][i];
		mape.money[i] = mapeGold.purse[i] + mapeGold.workerPurse[i];
	}
}

function mapeGoldTotal() {
	let sum = 0;
	const n = world.n;
	for (let i = 0; i < n; i++) sum += mapeGold.purse[i] + mapeGold.workerPurse[i] + mapeGold.coin[0][i] + mapeGold.coin[1][i] + mapeGold.coin[2][i];
	return sum;
}

if (typeof module !== 'undefined') {
	module.exports = { mapeGold, mapeGoldPrepare, mapeGoldReset, mapeGoldFinishSetup, mapeGoldStep, mapeGoldTotal };
}
