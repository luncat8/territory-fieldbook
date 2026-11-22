// owns: survey seeding — settlement placement, the starter town near spawn, initial atmosphere
// edit for: seed density, starter search ring, seeded stock and CO2

function mapePlaceSettlement(idx, p = randomRange(MAPE_POP_SEED_MIN, MAPE_POP_SEED_MAX), stock = true) {
	const n = world.n;
	mape.pop[idx] = p;
	mape.money[idx] = p * MAPE_MONEY_PER_POP;
	if (!stock) {
		const pCoal = MAPE_RES.COAL * n + idx;
		const pGoods = MAPE_RES.GOODS * n + idx;
		mape.marketSignal[pCoal] = mape.demand[pCoal];
		mape.marketSignal[pGoods] = mape.demand[pGoods];
		return;
	}
	mape.goods[MAPE_RES.GOODS * n + idx] = p * (0.18 + 0.1 * (idx % 4));
	mape.goods[MAPE_RES.COAL * n + idx] = p * 0.15;
}

function mapeFindStarterSettlement() {
	const sx = world.startX;
	const sy = world.startY;
	for (let r = 2; r <= 6; r++) {
		for (let dy = -r; dy <= r; dy++) {
			for (let dx = -r; dx <= r; dx++) {
				if (Math.max(dx < 0 ? -dx : dx, dy < 0 ? -dy : dy) !== r) continue;
				const x = sx + dx;
				const y = sy + dy;
				if (!worldWalkableAt(x, y) || sitesAt(x, y) >= 0) continue;
				return y * world.size + x;
			}
		}
	}
	return -1;
}

function mapeSeedSettlements() {
	const target = Math.round(world.n * MAPE_SETTLE_TARGET);
	let placed = 0;
	const starter = mapeFindStarterSettlement();
	if (starter >= 0) {
		mapePlaceSettlement(starter);
		placed = 1;
	}
	// Settle the ground that can carry a town: swamp interior and bare desert cannot farm.
	const maxTries = target * 40;
	for (let t = 0; t < maxTries && placed < target; t++) {
		const x = randomInt(world.size);
		const y = randomInt(world.size);
		if (!worldWalkableAt(x, y)) continue;
		const idx = y * world.size + x;
		if (mape.pop[idx] > 0 || sitesAt(x, y) >= 0) continue;
		if (x === world.startX && y === world.startY) continue;
		if (world.settleValue[idx] < MAPE_SETTLE_VALUE_MIN) continue;
		mapePlaceSettlement(idx);
		placed++;
	}
}

function mapeSeedAtmosphere() {
	const n = world.n;
	const off = MAPE_RES.CO2 * n;
	const goods = mape.goods;
	for (let i = 0; i < n; i++) goods[off + i] = MAPE_CO2_INIT;
}

if (typeof module !== 'undefined') {
	module.exports = { mapePlaceSettlement, mapeSeedSettlements, mapeSeedAtmosphere };
}
