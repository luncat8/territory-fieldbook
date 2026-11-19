// owns: settlement intake, satisfaction, population growth, migration and household waste
// edit for: population dynamics and metabolism

function mapePopulationBeginStep() {
	mape.usedGoods.fill(0);
	mape.usedCoal.fill(0);
}

function mapeRecordUse(r, idx, amount) {
	if (amount <= 0) return;
	if (r === MAPE_RES.GOODS) mape.usedGoods[idx] += amount;
	if (r === MAPE_RES.COAL) mape.usedCoal[idx] += amount;
}

function mapeUseLocalStock(r, idx, amount) {
	const p = r * world.n + idx;
	const before = mape.goods[p];
	const amountUsed = Math.min(before, amount);
	mape.goods[p] = before - amountUsed;
	const used = before - mape.goods[p];
	mape.massOut += used;
	mapeRecordUse(r, idx, used);
}

function mapeUseDiffusionStock(dt) {
	const pop = mape.pop;
	for (let i = 0; i < world.n; i++) {
		const p = pop[i];
		if (p <= 0 || (mape.cellExport[i] & MAPE_CELL_INDUSTRY) !== 0) continue;
		mapeUseLocalStock(MAPE_RES.GOODS, i, p * MAPE_NEED_GOODS * dt);
		mapeUseLocalStock(MAPE_RES.COAL, i, p * MAPE_NEED_COAL * dt);
	}
}

function mapePopulationRate(r) {
	if (mape.engine === MAPE_ENGINE.DIFFUSION) return r === MAPE_RES.GOODS ? MAPE_NEED_GOODS : MAPE_NEED_COAL;
	return r === MAPE_RES.GOODS ? MAPE_MARKET_GOODS_USE : MAPE_MARKET_COAL_USE;
}

function mapePopulationAttract(i) {
	const p = mape.pop[i];
	const work = mape.workforce[i];
	const need = work / (p + work + 1);
	return Math.min(1, 0.75 * mape.satGoods[i] + 0.25 * mape.satCoal[i] + need);
}

function mapePopulationTransfer(a, b, dt, next) {
	const pa = mape.pop[a];
	const pb = mape.pop[b];
	const attractA = mapePopulationAttract(a);
	const attractB = mapePopulationAttract(b);
	const flux = (MAPE_MIGRATE * (pa - pb) * 0.5 + MAPE_MIGRATE_BIAS * (pa + pb) * (attractB - attractA)) * dt;
	if (Math.abs(flux) <= 1e-9) return;
	const src = flux > 0 ? a : b;
	const dst = flux > 0 ? b : a;
	const cap = MAPE_POP_CAP * landProductivity(dst);
	const amount = Math.min(Math.abs(flux), next[src], cap - next[dst]);
	if (amount <= 0) return;
	const before = next[src] + next[dst];
	next[src] -= amount;
	next[dst] += amount;
	mape.popDelta += next[src] + next[dst] - before;
}

function mapePopulationMigration(dt) {
	const size = world.size;
	const terrain = world.terrain;
	const pop = mape.pop;
	const next = mape.popNext;
	next.set(pop);
	for (let y = 0; y < size; y++) {
		const row = y * size;
		for (let x = 0; x < size; x++) {
			const i = row + x;
			if (terrain[i] === TERRAIN.WATER || pop[i] <= 0) continue;
			if (x + 1 < size && terrain[i + 1] !== TERRAIN.WATER) mapePopulationTransfer(i, i + 1, dt, next);
			if (y + 1 < size && terrain[i + size] !== TERRAIN.WATER) mapePopulationTransfer(i, i + size, dt, next);
		}
	}
	pop.set(next);
}

function mapePopulationClamp() {
	const pop = mape.pop;
	let changed = false;
	for (let i = 0; i < world.n; i++) {
		const before = pop[i];
		const cap = MAPE_POP_CAP * landProductivity(i);
		if (before <= cap) continue;
		pop[i] = cap;
		mape.popDelta += pop[i] - before;
		changed = true;
	}
	return changed;
}

function mapePopulationStep(dt) {
	const pop = mape.pop;
	const satGoods = mape.satGoods;
	const satCoal = mape.satCoal;
	const goodsRate = mapePopulationRate(MAPE_RES.GOODS);
	const coalRate = mapePopulationRate(MAPE_RES.COAL);
	const blend = 1 - Math.exp(-dt / MAPE_SAT_SCALE);
	for (let i = 0; i < world.n; i++) {
		const p = pop[i];
		if (p <= 0) {
			satGoods[i] = satCoal[i] = 0;
			continue;
		}
		const g = Math.min(1, mape.usedGoods[i] / (p * goodsRate * dt));
		const c = Math.min(1, mape.usedCoal[i] / (p * coalRate * dt));
		satGoods[i] += (g - satGoods[i]) * blend;
		satCoal[i] += (c - satCoal[i]) * blend;
		const goods = mape.usedGoods[i];
		const coal = mape.usedCoal[i];
		if (goods > 0) landDisturb(i, goods * MAPE_SETTLE_DISTURB);
		if (coal <= 0) continue;
		const slot = MAPE_RES.CO2 * world.n + i;
		const before = mape.goods[slot];
		mape.goods[slot] += coal;
		mape.massIn += mape.goods[slot] - before;
	}
	if (mapePopulationClamp()) mapeRebuildSettlements();
	if (mape.fixedResidents || mape.engine !== MAPE_ENGINE.DIFFUSION) return;
	mapePopulationGrowth(dt);
	if (mape.workforceMode === MAPE_WORKFORCE_MODE.RESIDENTS) mapePopulationMigration(dt);
	mapeRebuildSettlements();
}

function mapePopulationGrowth(dt) {
	const pop = mape.pop;
	const terrain = world.terrain;
	const disturbed = land.disturbed;
	for (let i = 0; i < world.n; i++) {
		const before = pop[i];
		if (before <= 0 || terrain[i] === TERRAIN.WATER) continue;
		const sat = 0.75 * mape.satGoods[i] + 0.25 * mape.satCoal[i];
		const change = before * (MAPE_GROWTH * sat - MAPE_DEATH * (1 - sat)) * dt;
		let cap = MAPE_POP_CAP * (1 - disturbed[i]);
		if (mape.workforceMode === MAPE_WORKFORCE_MODE.FLUID && mapeIsSettlement(i)) cap = Math.max(before, mapeFluidCapacity(i));
		pop[i] = Math.max(0, Math.min(cap, before + change));
		mape.popDelta += pop[i] - before;
	}
}

if (typeof module !== 'undefined') {
	module.exports = { mapeUseDiffusionStock, mapePopulationStep, mapeRecordUse };
}
