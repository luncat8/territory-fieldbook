// Owns: town rest services, bazaar food sales, construction-wood bidding and wealth-class tax/room adaptation.
// Edit for: service prices, input bids and Cheap/Med/Rich strategies; never worker lifecycle.
'use strict';

const WALLET_PRICE_REFERENCE = 8;
const BASE_REST_FEE = 1.05;
const BASE_RATION_FEE = 0.45;
const ROOM_REST_BASE = 0.22;
const ROOM_REST_COMFORT = 0.38;
const WAIT_POOL_FREE = 0.25;
const WAIT_SPOT_TAX = 0.65;
const WAIT_TAX_ADAPT = 0.95;
const POP_FULL_TAX = 0.65;
const TAX_MIN = 0.48;
const TAX_MAX = 2.6;
const TAX_ADAPT = 0.6;
const WEALTH_CHEAP = 0;
const WEALTH_MED = 1;
const WEALTH_RICH = 2;
const WEALTH_NAMES = ['Cheap', 'Med', 'Rich'];
const RICH_OCC = 0.8;
const VACANT_OCC = 0.3;
const VACANT_SECONDS = 25;
const NEED_FLOOR = 0.25;
const WOOD_BID_VALUE = 0.14;
const WOOD_USE = 0.002;
const YOUNG_PULL = 0.05;

class TownRules {
	constructor(model) {
		this.model = model;
		this.satBlend = 1 - Math.exp(-ECONOMY_DT * SAT_RATE);
		this.profitBlend = 1 - Math.exp(-ECONOMY_DT * PROFIT_RATE);
		this.wealthBlend = 1 - Math.exp(-ECONOMY_DT * 0.4);
		this.revenueTick = new Float64Array(ECONOMY_SIZE);
	}

	reset() {
		this.revenueTick.fill(0);
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (this.model.actors[i] === ECONOMY_TOWN) this.initTown(i);
		}
	}

	initTown(i) {
		this.model.food[i] = 0;
		this.revenueTick[i] = 0;
		this.model.localWealth[i] = this.model.workers.count ? this.walletMean() : WALLET_PRICE_REFERENCE;
		this.model.currencies.stampTown(i);
	}

	clearTown(i) {
		this.model.food[i] = 0;
		this.revenueTick[i] = 0;
		this.model.localWealth[i] = 0;
		this.model.currencies.unstampTown(i);
	}

	recordRevenue(i, amount) {
		this.revenueTick[i] += amount;
	}

	observeWallet(i, perWorkerGold) {
		const cur = this.model.localWealth[i];
		this.model.localWealth[i] = cur + 0.18 * (perWorkerGold - cur);
	}

	waitCap(i) {
		const rooms = this.model.rooms[i];
		if (rooms <= 0) return 0;
		return Math.max(2, Math.ceil(rooms * 0.4));
	}

	demandPop(i) {
		const m = this.model;
		return Math.max(m.pop[i], m.rooms[i] * 0.6);
	}

	drive(i) {
		const m = this.model;
		if (!m.derived) return 0;
		const ref = Math.max(1e-12, this.demandPop(i) * TOWN_GOODS_NEED * m.priceGoods[i]);
		return Math.tanh(m.profit[i] / ref);
	}

	popPlan(i) {
		const boost = Math.max(0, this.drive(i));
		return Math.min(this.model.settlements.popCap(i), this.demandPop(i) + POP_HEADROOM * (1 + boost));
	}

	coalTarget(i) {
		return Math.max(0.15, this.popPlan(i) * TOWN_COAL_NEED * BUFFER_SECONDS);
	}

	goodsTarget(i) {
		return Math.max(0.25, this.popPlan(i) * TOWN_GOODS_NEED * BUFFER_SECONDS);
	}

	walletMean() {
		const { workers } = this.model;
		return workers.count ? workers.totalGold() / workers.totalAmount() : 0;
	}

	wealthRatio(i) {
		return this.model.derived ? this.model.localWealth[i] / WALLET_PRICE_REFERENCE : 1;
	}

	taxRate(i) {
		const m = this.model;
		if (!m.derived) return m.money.startTaxPerPop;
		return m.money.startTaxPerPop * this.wealthRatio(i) * (m.taxMult[i] || 1);
	}

	crowdMult(i) {
		const m = this.model;
		if (!m.derived || m.rooms[i] <= 0) return 1;
		const waitOcc = m.optimizer.poolOccupancy(i);
		const waitExcess = Math.max(0, waitOcc - WAIT_POOL_FREE);
		const roomFull = Math.max(0, m.roomCount[i] / Math.max(1, m.rooms[i]) - 0.8) / 0.2;
		return 1 + WAIT_SPOT_TAX * waitExcess + 0.35 * roomFull * roomFull;
	}

	effectiveMult(i) {
		const m = this.model;
		return m.derived ? (m.taxMult[i] || 1) * this.crowdMult(i) * m.settlements.taxFactor(i) : 1;
	}

	restTax(i) {
		const m = this.model;
		if (!m.derived) return BASE_REST_FEE;
		return BASE_REST_FEE * this.wealthRatio(i) * this.effectiveMult(i);
	}

	roomRestRate(i) {
		const comfort = this.model.workforce.restComfort(i);
		return (ROOM_REST_BASE + ROOM_REST_COMFORT * comfort) * this.model.settlements.restFactor(i);
	}

	share(i) {
		return Math.min(0.76, Math.max(0.42, INPUT_SHARE * (1 + 0.16 * this.drive(i))));
	}

	foodTarget(i) { return Math.max(2, this.demandPop(i) * 0.5); }

	foodFee(i) {
		return BASE_RATION_FEE * this.wealthRatio(i);
	}

	foodBid(i) {
		const m = this.model;
		const target = this.foodTarget(i);
		const present = m.food[i] + m.goodsPool.buyerQueue[ITEM_FOOD][i];
		const cool = m.money.townCool(i, target * this.foodFee(i));
		return optimalBid(this.foodFee(i) * 2, present, target, cool, m.suppression);
	}

	goodsBid(i) {
		const m = this.model;
		const tax = this.taxRate(i), sh = this.share(i);
		const cool = m.money.townCool(i, sh * tax * this.demandPop(i) * PURSE_SECONDS);
		const present = m.goods[i] + m.goodsPool.buyerQueue[ITEM_GOODS][i];
		return m.settlements.bidFactor(i) * optimalBid((GOODS_COMFORT / TOWN_GOODS_NEED) * tax, present, this.goodsTarget(i), cool, m.suppression, sh);
	}

	coalBid(i) {
		const m = this.model;
		const tax = this.taxRate(i), sh = this.share(i);
		const cool = m.money.townCool(i, sh * tax * this.demandPop(i) * PURSE_SECONDS);
		const present = m.coal[i] + m.goodsPool.buyerQueue[ITEM_COAL][i];
		return m.settlements.bidFactor(i) * optimalBid((COAL_COMFORT / TOWN_COAL_NEED) * tax, present, this.coalTarget(i), cool, m.suppression, sh);
	}

	// Construction wood: only towns below the wood tier cap bid; the share trim keeps wood from crowding out coal/goods bids.
	woodBid(i) {
		const m = this.model;
		const need = m.settlements.needWood(i);
		if (need <= 0) return 0;
		if (!m.derived) return START_PRICE * (m.suppression ? need : 1);
		const tax = this.taxRate(i), sh = this.share(i) * 0.35;
		const cool = m.money.townCool(i, sh * tax * Math.max(1, m.pop[i]) * PURSE_SECONDS);
		const bid = Number.isFinite(cool)
			? m.settlements.bidFactor(i) * optimalBid((WOOD_BID_VALUE / WOOD_USE) * tax, m.wood[i] + m.goodsPool.buyerQueue[ITEM_WOOD][i], m.settlements.woodTarget(i), cool, m.suppression, sh)
			: 0;
		return m.settlements.isYoungTown(i) ? Math.max(YOUNG_PULL * this.wealthRatio(i) * need, bid) : bid;
	}

	// Funded workers refill their food bag from the town's food stock; broke workers or unsupplied towns cannot, triggering FORAGE.
	// Rations tender worker notes first at consenting towns — spendable notes buy food like gold at parity.
	buyRation(i, w) {
		const m = this.model, { workers } = m;
		const avail = this.model.food[i];
		const want = FOOD_BAG - workers.food[w];
		let notes = 0;
		if (m.banks.notesSpendable() && m.currencies.townAccepts(m.banks.noteIssuer(), i)) {
			notes = m.currencies.workerBalance(m.banks.noteIssuer(), w);
		}
		if (avail <= 1e-4 || want <= 1e-4 || workers.gold[w] + notes <= 1e-5) return 0;
		const unitFee = this.foodFee(i);
		const maxBuy = unitFee > 1e-9 ? (workers.gold[w] + notes) / unitFee : want;
		const bought = Math.min(want, avail, maxBuy);
		if (bought <= 1e-5) return 0;
		const bill = bought * unitFee;
		const notePart = notes > 0 ? m.currencies.workerToAccount(m.banks.noteIssuer(), w, i, bill) : 0;
		const cost = Math.min(workers.gold[w], bill - notePart);
		const stockCost = m.goodsPool.stockCost[ITEM_FOOD];
		stockCost[i] *= 1 - bought / avail;
		m.consumedFood += bought;
		workers.gold[w] -= cost;
		if (cost > 0) m.tracker.expense(w, cost, i);
		this.model.food[i] -= bought;
		workers.food[w] = Math.min(FOOD_BAG, workers.food[w] + bought);
		if (notePart > 0) m.money.rationNotes += notePart;
		if (cost > 0) {
			m.money.payTown(i, cost);
			workers.logEvent(w, EVT_RATION, cost);
		}
		return bought;
	}

	stepTowns() {
		const m = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (m.actors[i] === ECONOMY_TOWN) this.stepTown(i);
		}
	}

	// Comfort inputs are consumed as services; food is bought and sold as food, never manufactured from goods.
	stepTown(i) {
		const m = this.model;
		const usePop = Math.max(m.pop[i], m.rooms[i] * 0.35);
		const wantCoal = usePop * TOWN_COAL_NEED * ECONOMY_DT;
		const wantGoods = usePop * TOWN_GOODS_NEED * ECONOMY_DT;
		const usedCoal = Math.min(m.coal[i] * SERVICE_SHARE, wantCoal);
		const usedGoods = Math.min(m.goods[i] * SERVICE_SHARE, wantGoods);
		const coalCostBuf = m.goodsPool.stockCost[ITEM_COAL];
		const goodsCostBuf = m.goodsPool.stockCost[ITEM_GOODS];
		const coalCost = m.coal[i] > 0 ? coalCostBuf[i] * Math.min(1, usedCoal / m.coal[i]) : 0;
		const goodsCost = m.goods[i] > 0 ? goodsCostBuf[i] * Math.min(1, usedGoods / m.goods[i]) : 0;
		m.coal[i] = Math.max(0, m.coal[i] - usedCoal);
		m.goods[i] = Math.max(0, m.goods[i] - usedGoods);
		coalCostBuf[i] = m.coal[i] > 1e-12 ? Math.max(0, coalCostBuf[i] - coalCost) : 0;
		goodsCostBuf[i] = m.goods[i] > 1e-12 ? Math.max(0, goodsCostBuf[i] - goodsCost) : 0;
		m.burnedCoal += usedCoal;
		m.consumedGoods += usedGoods;

		m.satCoal[i] += this.satBlend * ((wantCoal > 0 ? usedCoal / wantCoal : 0) - m.satCoal[i]);
		m.satGoods[i] += this.satBlend * ((wantGoods > 0 ? usedGoods / wantGoods : 0) - m.satGoods[i]);
		m.goodsPool.cap[ITEM_FOOD][i] = Math.max(m.food[i], this.foodTarget(i));

		const occ = m.rooms[i] > 1e-9 ? m.pop[i] / m.rooms[i] : 0;
		if (occ < VACANT_OCC && this.revenueTick[i] <= 1e-9) m.vacantTicks[i] += ECONOMY_DT;
		else m.vacantTicks[i] = Math.max(0, m.vacantTicks[i] - ECONOMY_DT * 2);

		m.earned[i] += (this.revenueTick[i] - (coalCost + goodsCost)) / ECONOMY_DT;
		this.revenueTick[i] = 0;

		const tax = this.taxRate(i);
		const ceiling = m.settlements.bidFactor(i) * 0.96;
		const maxCoal = m.derived ? (COAL_COMFORT / TOWN_COAL_NEED) * tax * ceiling : Infinity;
		const maxGoods = m.derived ? (GOODS_COMFORT / TOWN_GOODS_NEED) * tax * ceiling : Infinity;
		m.goodsPool.cap[ITEM_COAL][i] = this.coalBid(i) > 0 && m.priceCoal[i] <= maxCoal ? Math.max(m.coal[i], this.coalTarget(i)) : m.coal[i];
		m.goodsPool.cap[ITEM_GOODS][i] = this.goodsBid(i) > 0 && m.priceGoods[i] <= maxGoods ? Math.max(m.goods[i], this.goodsTarget(i)) : m.goods[i];
		const maxWood = m.derived ? (WOOD_BID_VALUE / WOOD_USE) * tax * ceiling : Infinity;
		m.goodsPool.cap[ITEM_WOOD][i] = this.woodBid(i) > 0 && m.priceWood[i] <= maxWood ? Math.max(m.wood[i], m.settlements.woodTarget(i)) : m.wood[i];
	}

	roomTarget(i) {
		const m = this.model;
		const rooms = m.rooms[i], popCap = m.settlements.popCap(i);
		const comfort = COAL_COMFORT * m.satCoal[i] + GOODS_COMFORT * m.satGoods[i];
		const mult = m.derived ? (m.taxMult[i] || 1) : 1;
		const taxDrag = mult > 1 ? 1 / (1 + 0.5 * (mult - 1)) : 1 + 0.18 * (1 - mult);
		let target = Math.min(popCap, POP_BASE + (popCap - POP_BASE) * comfort * taxDrag);
		const cls = m.wealthClass[i], waitOcc = m.optimizer.poolOccupancy(i);
		if (cls === WEALTH_RICH) {
			target *= RICH_OCC;
			if (waitOcc > 1 && comfort < NEED_FLOOR) target = Math.min(target, rooms * 0.65);
		} else {
			if (cls === WEALTH_CHEAP && waitOcc > 0.6) target = Math.max(target, Math.min(popCap, rooms + 2));
			target = Math.max(target, rooms);
		}
		if (m.vacantTicks[i] > VACANT_SECONDS || m.money.cash(i) < 1e-4) target = Math.min(target, rooms * 0.985);
		return Math.min(popCap, Math.max(POP_BASE, target));
	}

	adaptTowns() {
		const m = this.model;
		const wallets = this.walletMean();
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (m.actors[i] !== ECONOMY_TOWN) continue;
			m.localWealth[i] += this.wealthBlend * (wallets - m.localWealth[i]);
			m.profit[i] += this.profitBlend * (m.earned[i] - m.profit[i]);
			const goalRooms = this.roomTarget(i);
			m.rooms[i] = Math.min(POP_MAX, Math.max(POP_BASE, m.rooms[i] + ECONOMY_DT * POP_RATE * (goalRooms - m.rooms[i])));
			this.adaptTax(i);
		}
	}

	adaptTax(i) {
		const m = this.model;
		if (!m.derived) { m.taxMult[i] = 1; return; }
		const rooms = Math.max(1, m.rooms[i]);
		const comfort = COAL_COMFORT * m.satCoal[i] + GOODS_COMFORT * m.satGoods[i];
		const drive = this.drive(i), cls = m.wealthClass[i];
		const poolOcc = m.optimizer.poolOccupancy(i);
		const queue = Math.max(0, poolOcc - 1);
		const occ = m.pop[i] / rooms;
		const housingFree = Math.max(0, 1 - occ);
		const cCoal = m.coal[i] > 1e-6 ? m.unitCostAt(ITEM_COAL, i) : m.priceCoal[i];
		const cGoods = m.goods[i] > 1e-6 ? m.unitCostAt(ITEM_GOODS, i) : m.priceGoods[i];
		const rationCost = TOWN_COAL_NEED * m.satCoal[i] * cCoal + TOWN_GOODS_NEED * m.satGoods[i] * cGoods;
		const baseTax = m.money.startTaxPerPop * this.wealthRatio(i);
		const minProfitTax = baseTax > 1e-9 && comfort > 0.05 ? (rationCost * 1.1) / (baseTax * Math.max(0.25, comfort)) : TAX_MIN;
		const waitExcess = Math.max(0, poolOcc - WAIT_POOL_FREE);
		const roomFull = Math.max(0, occ - 0.8) / 0.2;
		const crowdPush = WAIT_TAX_ADAPT * waitExcess + POP_FULL_TAX * roomFull * roomFull;

		let target;
		if (cls === WEALTH_CHEAP) {
			if (housingFree > 0.05) target = Math.max(TAX_MIN, minProfitTax * 0.6, 1 - 0.55 * housingFree) + crowdPush * 0.3;
			else if (queue > 0) target = Math.max(TAX_MIN, minProfitTax, 1 + 0.1 * queue) + crowdPush * 0.5;
			else target = Math.max(TAX_MIN, minProfitTax, 1) + crowdPush * 0.5;
		} else if (cls === WEALTH_RICH) {
			if (queue > 0) target = Math.max(TAX_MIN, minProfitTax, 1 + 0.45 * queue + 0.15 * comfort) + crowdPush;
			else if (occ < RICH_OCC) target = Math.max(TAX_MIN, minProfitTax * 0.7, 1 - 1.2 * (RICH_OCC - occ)) + crowdPush * 0.3;
			else target = Math.max(TAX_MIN, minProfitTax, 1.12) + crowdPush * 0.5;
		} else {
			if (drive > 0.02 && comfort > 0.55) target = Math.max(TAX_MIN, minProfitTax, 1 - 0.42 * drive * comfort) + crowdPush;
			else target = Math.max(minProfitTax, 1 + 1.1 * Math.max(Math.max(0, 0.6 - comfort) / 0.6, Math.max(0, -drive)) + crowdPush);
		}
		m.taxMult[i] += ECONOMY_DT * TAX_ADAPT * (Math.min(TAX_MAX, Math.max(TAX_MIN, target)) - m.taxMult[i]);
	}
}

if (typeof module === 'object') module.exports = { TownRules, BASE_REST_FEE, WEALTH_CHEAP, WEALTH_MED, WEALTH_RICH, WEALTH_NAMES };
