// owns: settlement intake, satisfaction, subsistence, population growth, migration and household waste
// edit for: population dynamics and metabolism

function mapePopulationBeginStep() {
	mape.usedGoods.fill(0);
	mape.usedCoal.fill(0);
	mape.usedFood.fill(0);
}

function mapeRecordUse(r, idx, amount) {
	if (amount <= 0) return;
	if (r === MAPE_RES.GOODS) mape.usedGoods[idx] += amount;
	if (r === MAPE_RES.COAL) mape.usedCoal[idx] += amount;
	if (r === MAPE_RES.FOOD) mape.usedFood[idx] += amount;
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
		if (p <= 0 || mapeIsIndustry(i)) continue;
		mapeUseLocalStock(MAPE_RES.GOODS, i, p * MAPE_NEED_GOODS * dt);
		mapeUseLocalStock(MAPE_RES.COAL, i, p * MAPE_NEED_COAL * dt);
		mapeUseLocalStock(MAPE_RES.LOGS, i, p * MAPE_NEED_LOGS * dt);
		mapeUseLocalStock(MAPE_RES.FOOD, i, p * MAPE_NEED_FOOD * dt);
	}
}

function mapePopulationRate(r) {
	if (mape.engine === MAPE_ENGINE.DIFFUSION) {
		return r === MAPE_RES.GOODS ? MAPE_NEED_GOODS : r === MAPE_RES.FOOD ? MAPE_NEED_FOOD : MAPE_NEED_COAL;
	}
	return r === MAPE_RES.GOODS ? MAPE_MARKET_GOODS_USE : r === MAPE_RES.FOOD ? MAPE_MARKET_FOOD_USE : MAPE_MARKET_COAL_USE;
}

// Farm, forage and firewood cover part of a town's need; the rest is the market's job.
// Imports are the profit a player brings, not the difference between life and death.
// The square root keeps worthless ground habitable: swamp edge and desert still feed someone.
function mapeSubsistence(i) {
	const idle = 1 - land.disturbed[i];
	const share = MAPE_SUBSIST_MAX * Math.sqrt(world.settleValue[i]) * idle;
	return share > 1 ? 1 : share;
}

// Waste cuts carrying capacity to zero; Fluid field also empties industry cells, while
// Residents keeps the crew that walked to the site.
function mapePopCapacity(i) {
	if (mape.workforceMode === MAPE_WORKFORCE_MODE.FLUID && mapeIsIndustry(i)) return 0;
	return MAPE_POP_CAP * landProductivity(i);
}

function mapePopulationAttract(i) {
	const p = mape.pop[i];
	const work = mape.workforce[i];
	const need = work / (p + work + 1);
	return Math.min(1, mapePopulationImports(i) + need);
}

// Farm, goods and firewood imports share the lift above own-ground subsistence; the weights
// are the balance subject. With no farms satFood is 0 and the seeded map keeps its deficit.
function mapePopulationImports(i) {
	return 0.45 * mape.satFood[i] + 0.40 * mape.satGoods[i] + 0.15 * mape.satCoal[i];
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
	const amount = Math.min(Math.abs(flux), next[src], mapePopCapacity(dst) - next[dst]);
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
		if (before <= 0) continue;
		const cap = mapePopCapacity(i);
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
	const satFood = mape.satFood;
	const goodsRate = mapePopulationRate(MAPE_RES.GOODS);
	const coalRate = mapePopulationRate(MAPE_RES.COAL);
	const foodRate = mapePopulationRate(MAPE_RES.FOOD);
	const blend = 1 - Math.exp(-dt / MAPE_SAT_SCALE);
	for (let i = 0; i < world.n; i++) {
		const p = pop[i];
		if (p <= 0) {
			satGoods[i] = satCoal[i] = satFood[i] = 0;
			continue;
		}
		const goods = mape.usedGoods[i];
		const coal = mape.usedCoal[i];
		const food = mape.usedFood[i];
		const g = Math.min(1, goods / (p * goodsRate * dt));
		const c = Math.min(1, coal / (p * coalRate * dt));
		const f = Math.min(1, food / (p * foodRate * dt));
		satGoods[i] += (g - satGoods[i]) * blend;
		satCoal[i] += (c - satCoal[i]) * blend;
		satFood[i] += (f - satFood[i]) * blend;
		if (goods > 0) landDisturbAround(i, goods * MAPE_SETTLE_DISTURB);
		if (coal <= 0) continue;
		const slot = MAPE_RES.CO2 * world.n + i;
		const before = mape.goods[slot];
		mape.goods[slot] += coal;
		mape.massIn += mape.goods[slot] - before;
	}
	if (mapePopulationClamp()) mapeRebuildSettlements();
	// Scenes that pin residents keep them; every live engine lets food decide.
	if (!mape.fixedResidents) mapePopulationGrowth(dt);
	// totalPop is the published figure; growth must not leave it a step behind.
	mapeRebuildSettlements();
	if (mape.fixedResidents || mape.engine !== MAPE_ENGINE.DIFFUSION) return;
	if (mape.workforceMode === MAPE_WORKFORCE_MODE.RESIDENTS) mapePopulationMigration(dt);
	mapeRebuildSettlements();
}

// Sustenance 0…1: what the land gives plus what imports add on top of it. Between the famine
// line and the neutral point a town neither grows nor shrinks — the seeded map has a deficit
// but keeps its people. Only waste (which lowers land value) can push a town below famine.
// Growth also fades as a town nears its room, so supplied towns settle at a steady size
// instead of piling everyone onto the same few cells.
function mapePopulationGrowth(dt) {
	const pop = mape.pop;
	const terrain = world.terrain;
	const neutral = MAPE_SUBSIST_NEUTRAL;
	const famine = MAPE_SUBSIST_FAMINE;
	for (let i = 0; i < world.n; i++) {
		const before = pop[i];
		if (before <= 0 || terrain[i] === TERRAIN.WATER) continue;
		const settlement = mapeIsSettlement(i);
		const own = mapeSubsistence(i);
		const imports = mapePopulationImports(i);
		const feed = own + (1 - own) * imports;
		const cap = settlement && mape.workforceMode === MAPE_WORKFORCE_MODE.FLUID
			? Math.max(before, mapeFluidCapacity(i))
			: Math.max(before, mapePopCapacity(i));
		let rate = 0;
		if (feed > neutral) {
			const room = cap > 0 ? Math.max(0, cap - before) / cap : 0;
			rate = MAPE_GROWTH * (feed - neutral) / (1 - neutral) * room;
		} else if (feed < famine) {
			rate = -MAPE_DEATH * (famine - feed) / famine;
		}
		const change = before * rate * dt;
		if (change === 0) continue;
		pop[i] = Math.max(0, Math.min(cap, before + change));
		mape.popDelta += pop[i] - before;
	}
}

if (typeof module !== 'undefined') {
	module.exports = { mapeUseDiffusionStock, mapePopulationStep, mapeRecordUse };
}
