// owns: Phase 1 diffusion engine measurements — spread time, isotropy, water barrier, coal-worker-mine loop, scaling
// run: node experiments/mape_spread.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { performance } = require('perf_hooks');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g), match => match[1]);
for (const file of scripts) {
	const code = fs.readFileSync(path.join(root, file), 'utf8');
	vm.runInThisContext(code, { filename: file });
}

const metrics = vm.runInThisContext(`
(function () {
	const dt = SIM_STEP_SEC;
	const size = world.size;
	const n = world.n;

	function blankMap(seed) {
		main.setup(seed || 20261117);
		world.terrain.fill(TERRAIN.MEADOW);
		land.disturbed.fill(0);
		economy.biomass.fill(0);
		sites.state.fill(SITE_STATE.GONE);
		sites.stock.fill(0);
		sites.claim.fill(0);
		sites.initialStock = 0;
		sites.remainingStock = 0;
		mape.pop.fill(0);
		mape.demand.fill(0);
		mape.goods.fill(0);
		mape.workforce.fill(0);
		mape.cellExport.fill(0);
		mape.money.fill(0);
		mape.mineCount = 0;
		mape.mineUnlocked.fill(0);
		mape.factoryCount = 0;
		mape.factoryState.fill(MAPE_FACTORY_STATE.GONE);
		mape.storageCount = 0;
		mape.transportWork = 0;
		mape.minedTotal = 0;
		mape.massIn = 0;
		mape.massOut = 0;
		mape.dissipated = 0;
		mape.popDelta = 0;
		mapeRebuildSettlements();
		mape.initialPop = 0;
		mape.initialGoods = 0;
	}

	function idx(x, y) {
		return y * size + x;
	}

	function measureSpread() {
		blankMap();
		const needCell = idx(22, 32);
		const midCell = idx(32, 32);
		const storeCell = idx(42, 32);
		mape.pop[needCell] = 20;
		mapeRebuildSettlements();
		mape.initialPop = mape.totalPop;
		const goodsDemand = mapeField(MAPE_FIELD.DEMAND, MAPE_RES.GOODS);
		let span20Sec = -1;
		for (let s = 1; s <= 75; s++) {
			mapeStep(dt);
			if (span20Sec < 0 && goodsDemand[storeCell] >= 1e-4) span20Sec = s * dt;
		}
		const midBeforeStore = goodsDemand[midCell];
		mapeAddStorage(42, 32, 255);
		mape.goods[MAPE_RES.GOODS * n + storeCell] = 24;
		mape.initialGoods = mapeGoodsTotal();
		let midZeroSec = -1;
		for (let s = 1; s <= 150; s++) {
			mapeStep(dt);
			if (goodsDemand[midCell] <= 0) {
				midZeroSec = s * dt;
				break;
			}
		}
		return { midBeforeStore, midZeroSec, span20Sec };
	}

	// Compares exact Euclidean distance 10 on axes (10,0) vs Pythagorean diagonals (6,8).
	function measureIsotropy() {
		blankMap();
		mape.pop[idx(32, 32)] = 30;
		mapeRebuildSettlements();
		mape.initialPop = mape.totalPop;
		const goodsDemand = mapeField(MAPE_FIELD.DEMAND, MAPE_RES.GOODS);
		const axial = [idx(42, 32), idx(22, 32), idx(32, 42), idx(32, 22)];
		const diag = [idx(38, 40), idx(40, 38), idx(26, 24), idx(24, 26)];
		const axHit = [-1, -1, -1, -1];
		const dgHit = [-1, -1, -1, -1];
		for (let s = 1; s <= 150; s++) {
			mapeStep(dt);
			const t = s * dt;
			for (let k = 0; k < 4; k++) {
				if (axHit[k] < 0 && goodsDemand[axial[k]] >= 0.02) axHit[k] = t;
				if (dgHit[k] < 0 && goodsDemand[diag[k]] >= 0.02) dgHit[k] = t;
			}
		}
		const axArrive = (axHit[0] + axHit[1] + axHit[2] + axHit[3]) * 0.25;
		const dgArrive = (dgHit[0] + dgHit[1] + dgHit[2] + dgHit[3]) * 0.25;
		let axVal = 0;
		let dgVal = 0;
		for (let k = 0; k < 4; k++) {
			axVal += goodsDemand[axial[k]] * 0.25;
			dgVal += goodsDemand[diag[k]] * 0.25;
		}
		return { axArrive, dgArrive, arriveRatio: dgArrive / axArrive, valRatio: dgVal / axVal };
	}

	function measureWater() {
		blankMap();
		for (let y = 0; y < size; y++) world.terrain[idx(32, y)] = TERRAIN.WATER;
		mape.pop[idx(28, 32)] = 20;
		mapeAddStorage(30, 32, 255);
		mape.goods[MAPE_RES.IRON * n + idx(30, 32)] = 20;
		mapeAddFactory(34, 32, MAPE_FACTORY_STATE.ACTIVE);
		for (let i = 0; i < n; i++) mape.goods[MAPE_RES.CO2 * n + i] = (i % size) < 32 ? 2.0 : 0.1;
		mapeRebuildSettlements();
		mape.initialPop = mape.totalPop;
		mape.initialGoods = mapeGoodsTotal();
		const co2Start = mapeField(MAPE_FIELD.GOODS, MAPE_RES.CO2).reduce((a, b) => a + b, 0);
		for (let s = 0; s < 200; s++) mapeStep(dt);
		let eastGoodsDemand = 0;
		let eastIronStock = 0;
		let eastPop = 0;
		let eastCo2Gain = 0;
		let waterMatLeak = 0;
		let waterCo2 = 0;
		let co2End = 0;
		for (let i = 0; i < n; i++) {
			const x = i % size;
			const co2 = mape.goods[MAPE_RES.CO2 * n + i];
			co2End += co2;
			if (x === 32) {
				for (let r = 0; r < MAPE_RES.CO2; r++) {
					waterMatLeak += Math.abs(mape.demand[r * n + i]) + mape.goods[r * n + i];
				}
				waterMatLeak += Math.abs(mape.workforce[i]) + mape.pop[i];
				waterCo2 += co2;
			} else if (x > 32) {
				eastGoodsDemand += Math.abs(mape.demand[MAPE_RES.GOODS * n + i]);
				eastIronStock += mape.goods[MAPE_RES.IRON * n + i];
				eastPop += mape.pop[i];
				if (co2 > 0.1) eastCo2Gain += co2 - 0.1;
			}
		}
		const eastCo2DemandFromWest = mape.demand[MAPE_RES.CO2 * n + idx(33, 32)];
		const waterLedgerRes = mapeLedgerResidual();
		const co2MassRes = co2End - co2Start;
		// Partial wall verifies material demand and goods bend around coastlines.
		blankMap();
		for (let y = 24; y <= 40; y++) world.terrain[idx(32, y)] = TERRAIN.WATER;
		mapeAddStorage(30, 32, 255);
		mape.goods[MAPE_RES.GOODS * n + idx(30, 32)] = 30;
		mape.pop[idx(35, 32)] = 25;
		mapeRebuildSettlements();
		mape.initialPop = mape.totalPop;
		mape.initialGoods = mapeGoodsTotal();
		for (let s = 0; s < 300; s++) mapeStep(dt);
		return {
			waterMatLeak, eastGoodsDemand, eastIronStock, eastPop, waterCo2,
			eastCo2Gain, eastCo2DemandFromWest, waterLedgerRes, co2MassRes,
			routedBuyerGoods: mape.goods[MAPE_RES.GOODS * n + idx(35, 32)]
		};
	}

	// Verifies coal discovery -> worker demand -> worker diffusion -> mining -> settlement & factory delivery.
	function measureCoalLoop() {
		blankMap();
		const coalSite = sitesPlace(SITE.DEPOSIT, idx(24, 32), RES.FUEL, 40, SITE_STATE.MARKED, 0, 0.25);
		sites.initialStock = 40;
		sites.remainingStock = 40;
		mapeSeedMines();
		const s1 = idx(17, 32);
		const s2 = idx(32, 27);
		const facCell = idx(32, 37);
		mape.pop[s1] = 18;
		mape.pop[s2] = 16;
		mapeRebuildSettlements();
		mape.initialPop = mape.totalPop;
		mape.initialGoods = mapeGoodsTotal();
		for (let s = 0; s < 50; s++) mapeStep(dt);
		const preUnlocked = mape.mineUnlocked[0];
		const preMineWork = mape.workforce[idx(24, 32)];
		const preMinePop = mape.pop[idx(24, 32)];
		const preMined = mape.minedTotal;
		// Factory starts staffed so worker flow into the coal mine is isolated from factory hiring.
		mapeAddFactory(32, 37, MAPE_FACTORY_STATE.ACTIVE);
		mape.pop[facCell] = MAPE_FACTORY_WORKERS;
		mapeRebuildSettlements();
		mape.initialPop = mape.totalPop;
		party.x = 24;
		party.y = 32;
		party.condition = 95;
		party.morale = 80;
		let tUnlock = -1;
		let tWorkAtS1 = -1;
		let tWorkerAtMine = -1;
		let tCoalMined = -1;
		let tCoalAtS1 = -1;
		let tCoalAtS2 = -1;
		let tCoalAtFac = -1;
		let minedBeforeWorkers = 0;
		let peakMineWork = 0;
		const s1CoalStart = mape.goods[MAPE_RES.COAL * n + s1];
		const s2CoalStart = mape.goods[MAPE_RES.COAL * n + s2];
		for (let s = 1; s <= 500; s++) {
			const t = s * dt;
			party.condition = 95;
			party.supplies = 40;
			investigationStep(dt);
			sitesStep(dt);
			territoryStep(dt);
			mapeStep(dt);
			const mineCell = idx(24, 32);
			const mw = mape.workforce[mineCell];
			const mp = mape.pop[mineCell];
			if (mw > peakMineWork) peakMineWork = mw;
			if (mp < MAPE_MINE_MIN_WORKERS && mape.minedTotal > minedBeforeWorkers) minedBeforeWorkers = mape.minedTotal;
			if (tUnlock < 0 && mape.mineUnlocked[0] === 1) tUnlock = t;
			if (tUnlock > 0 && tWorkAtS1 < 0 && mape.workforce[s1] >= 0.05) tWorkAtS1 = t - tUnlock;
			if (tUnlock > 0 && tWorkerAtMine < 0 && mp >= 0.5) tWorkerAtMine = t - tUnlock;
			if (tUnlock > 0 && tCoalMined < 0 && mape.minedTotal >= 0.5) tCoalMined = t - tUnlock;
			if (tUnlock > 0 && tCoalAtS1 < 0 && mape.goods[MAPE_RES.COAL * n + s1] >= s1CoalStart + 0.5) tCoalAtS1 = t - tUnlock;
			if (tUnlock > 0 && tCoalAtS2 < 0 && mape.goods[MAPE_RES.COAL * n + s2] >= s2CoalStart + 0.5) tCoalAtS2 = t - tUnlock;
			if (tUnlock > 0 && tCoalAtFac < 0 && mape.goods[MAPE_RES.COAL * n + facCell] >= 0.5) tCoalAtFac = t - tUnlock;
		}
		return {
			preUnlocked, preMineWork, preMinePop, preMined, minedBeforeWorkers,
			tUnlock, tWorkAtS1, tWorkerAtMine, tCoalMined, tCoalAtS1, tCoalAtS2, tCoalAtFac,
			peakMineWork,
			chainMinePop: mape.pop[idx(24, 32)],
			chainFacPop: mape.pop[facCell],
			chainMined: mape.minedTotal,
			chainStockLeft: sites.stock[coalSite],
			s1CoalStart, s2CoalStart,
			chainS1Coal: mape.goods[MAPE_RES.COAL * n + s1],
			chainS2Coal: mape.goods[MAPE_RES.COAL * n + s2],
			chainFacCoal: mape.goods[MAPE_RES.COAL * n + facCell],
			chainTransportWork: mape.transportWork,
			chainLedgerRes: mapeLedgerResidual(),
			chainPopRes: mapePopResidual()
		};
	}

	const spread = measureSpread();
	const iso = measureIsotropy();
	const water = measureWater();
	const coal = measureCoalLoop();

	main.setup(20261117);
	let realCoalMine = -1;
	for (let m = 0; m < mape.mineCount; m++) {
		if (mape.mineRes[m] === MAPE_RES.COAL) { realCoalMine = m; break; }
	}
	const rmx = mape.mineX[realCoalMine];
	const rmy = mape.mineY[realCoalMine];
	const rmSlot = mape.mineSite[realCoalMine];
	let nearCoalBefore = 0;
	const nearList = [];
	for (let k = 0; k < mape.settleCount; k++) {
		const c = mape.settleCells[k];
		const d = Math.hypot((c % size) - rmx, ((c / size) | 0) - rmy);
		if (d <= 12) {
			nearList.push(c);
			nearCoalBefore += mape.goods[MAPE_RES.COAL * n + c];
		}
	}
	sites.state[rmSlot] = SITE_STATE.VISIBLE;
	party.x = rmx;
	party.y = rmy;
	investigation.progress[idx(rmx, rmy)] = 1;
	sitesClaim(rmSlot, FACTION_PLAYER);
	territoryStep(dt);
	for (let s = 0; s < 300; s++) {
		party.condition = 90;
		party.supplies = 40;
		main.step(dt);
	}
	let nearCoalAfter = 0;
	for (let k = 0; k < nearList.length; k++) nearCoalAfter += mape.goods[MAPE_RES.COAL * n + nearList[k]];
	const realMinePop = mape.pop[idx(rmx, rmy)];
	const realMineStock = mape.goods[MAPE_RES.COAL * n + idx(rmx, rmy)];
	const realMined = mape.minedTotal;
	const realLedgerRes = mapeLedgerResidual();
	const realPopRes = mapePopResidual();
	let badValues = 0;
	for (let i = 0; i < mape.goods.length; i++) {
		if (!Number.isFinite(mape.goods[i]) || mape.goods[i] < -1e-6 || !Number.isFinite(mape.demand[i])) badValues++;
	}
	for (let i = 0; i < n; i++) {
		if (!Number.isFinite(mape.pop[i]) || mape.pop[i] < -1e-6 || !Number.isFinite(mape.workforce[i]) || mape.workforce[i] < -1e-6) badValues++;
	}

	// 5. Timing: live 64x64 R=4 mapeStep(0.2) + kernel scaling across R in {1,4,8} and size in {64,128,256}.
	for (let w = 0; w < 50; w++) mapeStep(dt);
	const liveTicks = 400;
	const t0 = performance.now();
	for (let t = 0; t < liveTicks; t++) mapeStep(dt);
	const liveMs = (performance.now() - t0) / liveTicks;

	const scaling = [];
	for (const sz of [64, 128, 256]) {
		const cells = sz * sz;
		const terr = new Uint8Array(cells);
		const pop = new Float32Array(cells);
		const work = new Float32Array(cells);
		const workNext = new Float32Array(cells);
		for (let i = 0; i < cells; i++) {
			terr[i] = (i * 2654435761 >>> 28) < 3 ? TERRAIN.WATER : TERRAIN.MEADOW;
			if (terr[i] !== TERRAIN.WATER && (i % 47) === 0) pop[i] = 14;
		}
		for (const rCount of [1, 4, 8]) {
			const dem = new Float32Array(rCount * cells);
			const demNext = new Float32Array(rCount * cells);
			const gds = new Float32Array(rCount * cells);
			const gdsNext = new Float32Array(rCount * cells);
			for (let r = 0; r < rCount; r++) {
				const off = r * cells;
				for (let i = 0; i < cells; i++) {
					if (terr[i] === TERRAIN.WATER) continue;
					dem[off + i] = ((i + r * 13) % 29 === 0) ? 3.5 : ((i + r * 7) % 97 === 0 ? -4.0 : 0.2);
					if ((i + r * 11) % 31 === 0) gds[off + i] = 6.0;
				}
			}
			for (let w = 0; w < 10; w++) mapeKernelStep(sz, rCount, terr, dem, demNext, gds, gdsNext, pop, work, workNext, dt);
			const runs = sz === 256 ? 40 : sz === 128 ? 100 : 300;
			const s0 = performance.now();
			for (let k = 0; k < runs; k++) mapeKernelStep(sz, rCount, terr, dem, demNext, gds, gdsNext, pop, work, workNext, dt);
			scaling.push({ size: sz, r: rCount, ms: (performance.now() - s0) / runs });
		}
	}

	return Object.assign({}, spread, iso, water, coal, {
		realMinePop, realMined, realMineStock, nearCoalBefore, nearCoalAfter, realLedgerRes, realPopRes, badValues,
		liveMs, scaling
	});
})()
`);

let failures = 0;
function check(name, ok, detail) {
	if (!ok) failures++;
	console.log('check_' + name + '=' + (ok ? 'pass' : 'fail') + (detail ? ' ' + detail : ''));
}

console.log('spread_mid_before=' + metrics.midBeforeStore.toFixed(4) +
	' mid_zero_sec=' + metrics.midZeroSec.toFixed(2) +
	' span20_sec=' + metrics.span20Sec.toFixed(2));
console.log('isotropy_axial_sec=' + metrics.axArrive.toFixed(2) +
	' diag_sec=' + metrics.dgArrive.toFixed(2) +
	' arrive_ratio=' + metrics.arriveRatio.toFixed(4) +
	' value_ratio=' + metrics.valRatio.toFixed(4));
console.log('water_mat_leak=' + metrics.waterMatLeak.toFixed(6) +
	' east_goods_d=' + metrics.eastGoodsDemand.toFixed(6) +
	' east_iron=' + metrics.eastIronStock.toFixed(6) +
	' east_pop=' + metrics.eastPop.toFixed(6) +
	' east_co2_gain=' + metrics.eastCo2Gain.toFixed(3) +
	' co2_res=' + metrics.co2MassRes.toFixed(6) +
	' routed_goods=' + metrics.routedBuyerGoods.toFixed(3));
console.log('coal_pre_unlock=' + metrics.preUnlocked +
	' pre_work=' + metrics.preMineWork.toFixed(4) +
	' pre_pop=' + metrics.preMinePop.toFixed(4) +
	' pre_mined=' + metrics.preMined.toFixed(4) +
	' mined_without_workers=' + metrics.minedBeforeWorkers.toFixed(6));
console.log('coal_timing_unlock_s=' + metrics.tUnlock.toFixed(1) +
	' work_at_s1_s=' + metrics.tWorkAtS1.toFixed(1) +
	' worker_at_mine_s=' + metrics.tWorkerAtMine.toFixed(1) +
	' coal_mined_s=' + metrics.tCoalMined.toFixed(1) +
	' coal_at_s1_s=' + metrics.tCoalAtS1.toFixed(1) +
	' coal_at_s2_s=' + metrics.tCoalAtS2.toFixed(1) +
	' coal_at_fac_s=' + metrics.tCoalAtFac.toFixed(1));
console.log('coal_totals_peak_work=' + metrics.peakMineWork.toFixed(2) +
	' mine_pop=' + metrics.chainMinePop.toFixed(2) +
	' fac_pop=' + metrics.chainFacPop.toFixed(2) +
	' mined=' + metrics.chainMined.toFixed(2) +
	' stock_left=' + metrics.chainStockLeft.toFixed(2) +
	' s1_coal=' + metrics.s1CoalStart.toFixed(2) + '->' + metrics.chainS1Coal.toFixed(2) +
	' s2_coal=' + metrics.s2CoalStart.toFixed(2) + '->' + metrics.chainS2Coal.toFixed(2) +
	' fac_coal=' + metrics.chainFacCoal.toFixed(2) +
	' transport_work=' + metrics.chainTransportWork.toFixed(2));
console.log('real_map_mine_pop=' + metrics.realMinePop.toFixed(2) +
	' mined=' + metrics.realMined.toFixed(2) +
	' near_settle_coal=' + metrics.nearCoalBefore.toFixed(2) + '->' + metrics.nearCoalAfter.toFixed(2) +
	' ledger_res=' + metrics.realLedgerRes.toFixed(6) +
	' pop_res=' + metrics.realPopRes.toFixed(6) +
	' bad_values=' + metrics.badValues);
console.log('tick_live_64_r4_ms=' + metrics.liveMs.toFixed(4));
for (const row of metrics.scaling) {
	console.log('bench_s' + row.size + '_r' + row.r + '_ms=' + row.ms.toFixed(4));
}

const s256r8 = metrics.scaling.find(row => row.size === 256 && row.r === 8);
const cadence256r8 = Math.max(1, Math.ceil(s256r8.ms / 8));
console.log('scaling_s256_r8_cadence_ticks=' + cadence256r8);
check('arrival_20cell', metrics.midBeforeStore > 0 && metrics.midZeroSec > 0 && metrics.midZeroSec <= 15 && metrics.span20Sec > 0 && metrics.span20Sec <= 15);
check('isotropy', Math.abs(metrics.arriveRatio - 1) <= 0.15 && Math.abs(metrics.valRatio - 1) <= 0.15);
check('water_blocks_materials', metrics.waterMatLeak === 0 && metrics.eastGoodsDemand === 0 && metrics.eastIronStock === 0 && metrics.eastPop === 0);
check('co2_crosses_water', metrics.waterCo2 > 10 && metrics.eastCo2Gain > 5 && Math.abs(metrics.eastCo2DemandFromWest) > 0.05);
check('water_routing', metrics.routedBuyerGoods > 0.5);
check('locked_mine_idle', metrics.preUnlocked === 0 && metrics.preMineWork === 0 && metrics.preMinePop === 0 && metrics.preMined === 0 && metrics.minedBeforeWorkers === 0);
check('coal_workers_demand', metrics.tUnlock > 0 && metrics.peakMineWork > 1 && metrics.tWorkAtS1 > 0 && metrics.tWorkAtS1 < 15);
check('workers_diffuse_to_mine', metrics.tWorkerAtMine > 0 && metrics.chainMinePop >= 3 && metrics.chainFacPop >= 2);
check('mine_produces_coal', metrics.tCoalMined >= metrics.tWorkerAtMine * 0.5 && metrics.chainMined > 5 && metrics.chainStockLeft < 35);
check('coal_diffuses_to_settlement_and_factory',
	metrics.tCoalAtS1 > 0 && metrics.tCoalAtS2 > 0 && metrics.tCoalAtFac > 0 &&
	metrics.chainS1Coal > metrics.s1CoalStart + 0.5 && metrics.chainS2Coal > metrics.s2CoalStart + 0.5 &&
	metrics.chainFacCoal > 2 && metrics.chainTransportWork > 1);
check('real_map_coal_loop', metrics.realMinePop >= 3 && metrics.realMined > 10 && metrics.realMined - metrics.realMineStock > 3);
check('conservation',
	Math.abs(metrics.waterLedgerRes) < 1e-4 && Math.abs(metrics.co2MassRes) < 1e-3 &&
	Math.abs(metrics.chainLedgerRes) < 1e-4 && Math.abs(metrics.chainPopRes) < 1e-4 &&
	Math.abs(metrics.realLedgerRes) < 1e-4 && Math.abs(metrics.realPopRes) < 1e-4 &&
	metrics.badValues === 0);
check('tick_budget', metrics.liveMs < 2.0, 'live_ms=' + metrics.liveMs.toFixed(3));

if (failures > 0) {
	console.log('mape_spread_failures=' + failures);
	process.exit(1);
}
console.log('mape_spread_failures=0');
