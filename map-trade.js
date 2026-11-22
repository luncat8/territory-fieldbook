// owns: player trade at settlement markets — prices, selling, items, supplies and hiring
// edit for: price law, market funds use, supply cost, recruitment

// One price law for the whole map: the party trades at the local scarcity ratio the
// settlement's own households and industry pay (map-money.js).
function mapePrice(res, idx) {
	const mr = mapeResOf(res);
	return RES_BASE_VALUE[res] * mapeMoneyPriceRatio(mr >= 0 ? mr : MAPE_RES.GOODS, idx);
}

function mapeSell(res, idx) {
	if (!mapeIsSettlement(idx)) return 0;
	const have = economy.inventory[res];
	if (have < 0.01) return 0;
	const price = mapePrice(res, idx);
	const units = Math.min(have, mape.money[idx] / price);
	if (units < 0.05) return 0;
	const revenue = units * price;
	economy.inventory[res] = have - units;
	mapeMoneyPlayer(idx, -revenue);
	const mr = mapeResOf(res);
	if (mr >= 0) {
		const slot = mr * world.n + idx;
		const before = mape.goods[slot];
		mape.goods[slot] = before + units;
		mape.massIn += mape.goods[slot] - before;
	}
	return revenue;
}

function mapeAcceptItem(idx) {
	if (!mapeIsSettlement(idx) || mape.money[idx] < ITEM_VALUE) return 0;
	mapeMoneyPlayer(idx, -ITEM_VALUE);
	return ITEM_VALUE;
}

function mapeCanBuySupplies(idx, units) {
	if (!mapeIsSettlement(idx)) return false;
	return mape.goods[MAPE_RES.GOODS * world.n + idx] >= units * MAPE_SUPPLY_GOODS;
}

function mapeBuySupplies(idx, units) {
	if (!mapeCanBuySupplies(idx, units)) return -1;
	const slot = MAPE_RES.GOODS * world.n + idx;
	const before = mape.goods[slot];
	mape.goods[slot] = before - units * MAPE_SUPPLY_GOODS;
	mape.massOut += before - mape.goods[slot];
	const cost = units * SUPPLY_PRICE;
	mapeMoneyPlayer(idx, cost);
	return cost;
}

function mapeCanHire(idx) {
	return mapeIsSettlement(idx) && mape.pop[idx] >= MAPE_HIRE_MIN_POP;
}

function mapeRecruit(idx, fee) {
	if (!mapeCanHire(idx)) return false;
	const before = mape.pop[idx];
	mape.pop[idx] = before - 1;
	mape.popDelta -= before - mape.pop[idx];
	mapeMoneyPlayer(idx, fee);
	mapeRebuildSettlements();
	return true;
}

if (typeof module !== 'undefined') {
	module.exports = { mapePrice, mapeSell, mapeAcceptItem, mapeCanBuySupplies, mapeBuySupplies, mapeCanHire, mapeRecruit };
}
