// Owns: town services — wait pool, tier-scaled living tax, paid rest, coal/goods/food/wood bids, wealth-class tax and built rooms.
// Edit for: Cheap/Med/Rich strategies, wait-pool crowding tax, rest fee and room capacity. Worker movement/lifecycle: workforce.js.
'use strict';

const TOWN_POOL_BASE = 0.35;
const TOWN_POOL_TRANSIT = 0.55;
const WAIT_POOL_FREE = 0.25;
const WAIT_POOL_OVERFLOW = 1.6;
const WAIT_SPOT_TAX = 0.55;
const WAIT_TAX_ADAPT = 0.95;
const POP_FULL_TAX = 0.65;
const REST_TAX_SHARE = 0.35;
const TAX_MIN = 0.55;
const TAX_MAX = 2.4;
const TAX_ADAPT = 0.6;
const ROOM_BUILD_RATE = 0.14;

const WEALTH_CHEAP = 0;
const WEALTH_MED = 1;
const WEALTH_RICH = 2;
const WEALTH_NAMES = ['Cheap', 'Med', 'Rich'];
const RICH_OCC = 0.85;
const SPACE_COMFORT = 0.25;
const VACANT_OCC = 0.3;
const VACANT_SECONDS = 25;
const NEED_FLOOR = 0.25;

function wealthClassFor(i) {
	let h = (Math.imul(i + 1, 2654435761) >>> 0);
	h = (Math.imul(h ^ (h >>> 15), 2246822519) >>> 0);
	return h % 3;
}

class TownPolicy {
	constructor(model) {
		this.model = model;
		this.satBlend = 1 - Math.exp(-ECONOMY_DT * SAT_RATE);
		this.occBlend = 1 - Math.exp(-ECONOMY_DT * OCCUPANCY_RATE);
	}

	waitOccupancy(i) {
		const pool = this.townWaitPool(i);
		return pool > 0 ? this.model.depleted[i] / pool : 0;
	}

	// Town wait-pool size tracks resident/room base plus realized returning-worker flow to smooth homebound waves.
	townWaitPool(i) {
		const m = this.model;
		const size = Math.max(m.pop[i], m.rooms[i]);
		if (size <= 0) return 0;
		return Math.min(0.85, Math.max(0.08, size * LABOR_PER_POP * TOWN_POOL_BASE + m.workLoad[i] * TOWN_POOL_TRANSIT));
	}

	townDrive(i) {
		const m = this.model;
		if (!m.derived) return 0;
		const ref = Math.max(0.05, Math.max(1, m.pop[i]) * TOWN_GOODS_NEED * Math.max(0.5, m.priceGoods[i]));
		return Math.tanh(m.profit[i] / ref);
	}

	townPopPlan(i) {
		const boost = Math.max(0, this.townDrive(i));
		return Math.min(this.model.settlements.popCap(i), Math.max(this.model.pop[i], this.model.rooms[i]) + POP_HEADROOM * (1 + boost));
	}

	townCoalTarget(i) {
		return Math.min(1, this.townPopPlan(i) * TOWN_COAL_NEED * BUFFER_SECONDS);
	}

	townGoodsTarget(i) {
		return Math.min(1, this.townPopPlan(i) * TOWN_GOODS_NEED * BUFFER_SECONDS);
	}

	townTaxRate(i) {
		return this.model.derived ? this.model.money.taxPerPop(i) : START_TAX_PER_POP;
	}

	townCrowdMult(i) {
		const m = this.model;
		if (!m.derived || m.pop[i] <= 0) return 1;
		const waitExcess = Math.max(0, this.waitOccupancy(i) - WAIT_POOL_FREE);
		const popFull = Math.max(0, m.pop[i] / m.settlements.popCap(i) - 0.8) / 0.2;
		return 1 + WAIT_SPOT_TAX * waitExcess + 0.35 * popFull * popFull;
	}

	townEffectiveMult(i) {
		const m = this.model;
		return m.derived ? (m.taxMult[i] || 1) * this.townCrowdMult(i) * m.settlements.taxFactor(i) : 1;
	}

	townRestTax(i) {
		const m = this.model;
		if (!m.derived) return START_TAX_PER_POP;
		const crowd = this.townCrowdMult(i);
		const mult = (m.taxMult[i] || 1) * crowd;
		return Math.max(START_TAX_PER_POP * mult, this.townTaxRate(i) * crowd) * m.settlements.taxFactor(i);
	}

	townShare(i) {
		return Math.min(0.76, Math.max(0.42, INPUT_SHARE * (1 + 0.16 * this.townDrive(i))));
	}

	townGoodsBid(i) {
		const m = this.model;
		const tax = this.townTaxRate(i);
		const share = this.townShare(i);
		const cool = m.money.townCool(i, share * tax * Math.max(1, m.pop[i]) * PURSE_SECONDS);
		return m.settlements.bidFactor(i) * optimalBid((GOODS_COMFORT / TOWN_GOODS_NEED) * tax, m.goods[i], this.townGoodsTarget(i), cool, m.suppression, share);
	}

	townCoalBid(i) {
		const m = this.model;
		const tax = this.townTaxRate(i);
		const share = this.townShare(i);
		const cool = m.money.townCool(i, share * tax * Math.max(1, m.pop[i]) * PURSE_SECONDS);
		return m.settlements.bidFactor(i) * optimalBid((COAL_COMFORT / TOWN_COAL_NEED) * tax, m.coal[i], this.townCoalTarget(i), cool, m.suppression, share);
	}

	// Food and wood bids share the same vault-cooled gold discipline as coal/goods; young hamlets keep a sub-gate pull for self-forage.
	townFoodBid(i) {
		const m = this.model, need = m.harvest.needFood(i);
		if (need <= 0) return 0;
		if (!m.derived) return START_PRICE * (m.suppression ? need : 1);
		const tax = this.townTaxRate(i), share = this.townShare(i) * 0.5;
		const cool = m.money.townCool(i, share * tax * Math.max(1, m.pop[i]) * PURSE_SECONDS);
		const bid = Number.isFinite(cool) ? m.settlements.bidFactor(i) * share * (FOOD_BID_VALUE / FOOD_NEED) * tax * (m.suppression ? need : 1) / cool : 0;
		return m.settlements.isYoungTown(i) ? Math.max(YOUNG_PULL * need, bid) : bid;
	}

	townWoodBid(i) {
		const m = this.model, need = m.harvest.needWood(i);
		if (need <= 0) return 0;
		if (!m.derived) return START_PRICE * (m.suppression ? need : 1);
		const tax = this.townTaxRate(i), share = this.townShare(i) * 0.35;
		const cool = m.money.townCool(i, share * tax * Math.max(1, m.pop[i]) * PURSE_SECONDS);
		const bid = Number.isFinite(cool) ? m.settlements.bidFactor(i) * share * (WOOD_BID_VALUE / WOOD_USE) * tax * (m.suppression ? need : 1) / cool : 0;
		return m.settlements.isYoungTown(i) ? Math.max(YOUNG_PULL * need, bid) : bid;
	}

	// Returning tired workers pay rest tax from their carried wallet to recover into fresh residents; none are clipped away.
	restWorkers(i, comfort) {
		const m = this.model;
		const dep = m.depleted[i];
		if (dep <= 1e-12 || hasBetterNeighbor(m.depletedFlow, m.priceHome, i)) return 0;
		const carried = m.depletedFlow.gold[i];
		const size = Math.max(m.pop[i], m.rooms[i]);
		const roomCap = m.settlements.popCap(i) * WORKER_PER_POP;
		const freeRoom = Math.max(0, roomCap - (m.fresh[i] + m.labor[i]));
		const restRate = (size * LABOR_PER_POP * (0.25 + 0.95 * comfort) + 0.12) * m.settlements.restFactor(i);
		const wantRest = Math.min(dep, freeRoom, restRate * ECONOMY_DT);
		const feePerUnit = (this.townRestTax(i) / LABOR_PER_POP) * REST_TAX_SHARE * comfort;
		const fullFee = wantRest * feePerUnit;
		const afford = fullFee > 1e-12 ? Math.min(1, carried / fullFee) : 1;
		const restedWork = wantRest * afford;
		if (restedWork <= 1e-12) return 0;

		const share = Math.min(1, restedWork / dep);
		const arrivedGold = carried * share;
		const restTax = Math.min(arrivedGold, restedWork * feePerUnit);
		m.depleted[i] = Math.max(0, dep - restedWork);
		m.depletedFlow.gold[i] = Math.max(0, carried - arrivedGold);
		if (m.depleted[i] <= 1e-12 && m.depletedFlow.gold[i] > 0) {
			m.money.workerPurse[i] += m.depletedFlow.gold[i];
			m.depletedFlow.gold[i] = 0;
		}
		m.money.payRestTax(i, restTax, arrivedGold - restTax);
		m.restedDepleted += restedWork;
		const toLabor = Math.min(1 - m.labor[i], restedWork);
		m.labor[i] += toLabor;
		m.suppliedLabor += toLabor;
		m.fresh[i] += restedWork - toLabor;
		return restedWork;
	}

	// Towns provide services and manage built rooms; they never create or despawn workers.
	stepTown(i) {
		const m = this.model;
		const pop = m.pop[i];
		const wantCoal = pop * TOWN_COAL_NEED * ECONOMY_DT;
		const wantGoods = pop * TOWN_GOODS_NEED * ECONOMY_DT;
		const usedCoal = Math.min(m.coal[i] * SERVICE_SHARE, wantCoal);
		const usedGoods = Math.min(m.goods[i] * SERVICE_SHARE, wantGoods);
		const coalCost = m.coal[i] > 0 ? m.coalFlow.cost[i] * Math.min(1, usedCoal / m.coal[i]) : 0;
		const goodsCost = m.goods[i] > 0 ? m.goodsFlow.cost[i] * Math.min(1, usedGoods / m.goods[i]) : 0;
		m.coal[i] = Math.max(0, m.coal[i] - usedCoal);
		m.goods[i] = Math.max(0, m.goods[i] - usedGoods);
		m.coalFlow.cost[i] = m.coal[i] > 1e-12 ? Math.max(0, m.coalFlow.cost[i] - coalCost) : 0;
		m.goodsFlow.cost[i] = m.goods[i] > 1e-12 ? Math.max(0, m.goodsFlow.cost[i] - goodsCost) : 0;
		m.burnedCoal += usedCoal;
		m.consumedGoods += usedGoods;
		m.land.dispose(i, usedCoal, USE_COAL);
		m.land.dispose(i, usedGoods, USE_GOODS);

		m.satCoal[i] += this.satBlend * ((wantCoal > 0 ? usedCoal / wantCoal : 0) - m.satCoal[i]);
		m.satGoods[i] += this.satBlend * ((wantGoods > 0 ? usedGoods / wantGoods : 0) - m.satGoods[i]);
		const comfort = COAL_COMFORT * m.satCoal[i] + GOODS_COMFORT * m.satGoods[i];

		const taxesBefore = m.money.taxes;
		const restedWork = this.restWorkers(i, comfort);
		m.workLoad[i] += this.occBlend * (restedWork / ECONOMY_DT - m.workLoad[i]);

		m.money.collectTax(i, comfort);
		const taxIncome = (m.money.taxes - taxesBefore) / ECONOMY_DT;
		m.earned[i] += taxIncome - (coalCost + goodsCost) / ECONOMY_DT;

		const target = this.roomTarget(i);
		const broke = m.money.workerPurse[i] + m.workerGoldAt(i) < 1e-6 && m.pop[i] > 0;
		const pace = target > m.rooms[i] ? ROOM_BUILD_RATE : (broke ? POP_RATE * 2.4 : POP_RATE);
		let deltaRooms = ECONOMY_DT * pace * (target - m.rooms[i]);
		if (deltaRooms > 0) deltaRooms = m.harvest.takeWood(i, deltaRooms * WOOD_PER_POP) / WOOD_PER_POP;
		const cap = m.settlements.popCap(i);
		m.rooms[i] = Math.min(cap, Math.max(0, m.rooms[i] + deltaRooms));
		const occ = cap > 1e-9 ? m.pop[i] / cap : 0;
		if (occ < VACANT_OCC && restedWork <= 1e-12) m.vacantTicks[i] += ECONOMY_DT;
		else m.vacantTicks[i] = Math.max(0, m.vacantTicks[i] - ECONOMY_DT * 2);
		if (deltaRooms < 0) this.evictSurplus(i, -deltaRooms);

		const tax = this.townTaxRate(i);
		const ceiling = m.settlements.bidFactor(i) * 0.96;
		const maxCoal = m.derived ? (COAL_COMFORT / TOWN_COAL_NEED) * tax * ceiling : Infinity;
		const maxGoods = m.derived ? (GOODS_COMFORT / TOWN_GOODS_NEED) * tax * ceiling : Infinity;
		const waitPool = this.townWaitPool(i);
		const capWorkers = Math.max(0, cap * WORKER_PER_POP - m.fresh[i] - m.labor[i]);
		m.coalFlow.cap[i] = this.townCoalBid(i) > 0 && m.priceCoal[i] <= maxCoal ? Math.max(m.coal[i], this.townCoalTarget(i)) : m.coal[i];
		m.goodsFlow.cap[i] = this.townGoodsBid(i) > 0 && m.priceGoods[i] <= maxGoods ? Math.max(m.goods[i], this.townGoodsTarget(i)) : m.goods[i];
		m.depletedFlow.cap[i] = Math.max(m.rooms[i], m.pop[i]) > 0
			? Math.max(m.depleted[i], Math.min(0.95, waitPool * WAIT_POOL_OVERFLOW, capWorkers))
			: 0;
	}

	// When built rooms contract below housed residents, excess residents step onto depleted with their share of savings.
	evictSurplus(i) {
		const m = this.model;
		const housed = m.fresh[i] + m.labor[i];
		const excess = housed + m.away[i] - m.rooms[i] * WORKER_PER_POP;
		const shed = Math.min(1 - m.depleted[i], housed, Math.max(0, excess));
		if (shed <= 1e-12) return;
		const fromFresh = Math.min(m.fresh[i], shed);
		m.fresh[i] -= fromFresh;
		let rem = shed - fromFresh;
		let carriedGold = 0;
		if (rem > 1e-12 && m.labor[i] > 0) {
			const fromLabor = Math.min(m.labor[i], rem);
			const ratio = fromLabor / m.labor[i];
			carriedGold = m.laborFlow.gold[i] * ratio;
			m.labor[i] -= fromLabor;
			m.laborFlow.cost[i] = Math.max(0, m.laborFlow.cost[i] * (1 - ratio));
			m.laborFlow.gold[i] = Math.max(0, m.laborFlow.gold[i] - carriedGold);
			m.workedLabor += fromLabor;
			rem -= fromLabor;
		}
		const moved = shed - rem;
		if (moved <= 1e-12) return;
		const purseShare = m.money.workerPurse[i] * Math.min(1, moved / Math.max(moved, housed + m.depleted[i] + m.away[i]));
		m.money.workerPurse[i] = Math.max(0, m.money.workerPurse[i] - purseShare);
		m.depleted[i] += moved;
		m.depletedFlow.gold[i] += purseShare + carriedGold;
		m.emittedDepleted += moved;
		m.workforce.derivePop();
	}

	roomTarget(i) {
		const m = this.model;
		const rooms = m.rooms[i];
		const comfort = COAL_COMFORT * m.satCoal[i] + GOODS_COMFORT * m.satGoods[i];
		const mult = m.derived ? (m.taxMult[i] || 1) : 1;
		const size = Math.max(1, m.pop[i], rooms);
		const workerGold = m.money.workerPurse[i] + m.workerGoldAt(i);
		const afford = workerGold / (workerGold + size * 0.25 * mult);
		const taxDrag = mult > 1 ? 1 / (1 + 0.5 * (mult - 1)) : 1 + 0.18 * (1 - mult);
		const popCap = m.settlements.popCap(i);
		let target = Math.min(popCap, POP_BASE + (popCap - POP_BASE) * comfort * afford * taxDrag);
		const cls = m.wealthClass[i];
		if (cls === WEALTH_RICH) {
			target *= RICH_OCC;
			if (this.waitOccupancy(i) > 1 && comfort < NEED_FLOOR) target = Math.min(target, rooms * 0.6);
			else target = Math.max(target, Math.min(rooms, popCap * RICH_OCC));
		} else {
			target = Math.max(target, rooms);
		}
		if (workerGold < 1e-6 && m.pop[i] > 0) return 0;
		if (m.vacantTicks[i] > VACANT_SECONDS || m.harvest.hungry(i)) target = Math.min(target, rooms * 0.985);
		return Math.min(popCap, Math.max(POP_BASE, Math.max(0, target)));
	}

	adaptTownTax(i) {
		const m = this.model;
		if (!m.derived) {
			m.taxMult[i] = 1;
			return;
		}
		const pop = Math.max(1, m.pop[i]);
		const cap = m.settlements.popCap(i);
		const comfort = COAL_COMFORT * m.satCoal[i] + GOODS_COMFORT * m.satGoods[i];
		const drive = this.townDrive(i);
		const cls = m.wealthClass[i];
		const poolOcc = this.waitOccupancy(i);
		const queue = Math.max(0, poolOcc - 1);
		const occ = cap > 1e-9 ? m.pop[i] / cap : 0;
		const housingFree = Math.max(0, 1 - occ);
		const cCoal = m.coal[i] > 1e-6 ? m.unitCostAt(ITEM_COAL, i) : m.priceCoal[i];
		const cGoods = m.goods[i] > 1e-6 ? m.unitCostAt(ITEM_GOODS, i) : m.priceGoods[i];
		const cFood = m.unitCostAt(ITEM_FOOD, i);
		const cWood = m.unitCostAt(ITEM_WOOD, i);
		const rationCost = TOWN_COAL_NEED * m.satCoal[i] * cCoal + TOWN_GOODS_NEED * m.satGoods[i] * cGoods
			+ FOOD_NEED * m.harvest.satFood[i] * cFood + WOOD_USE * m.harvest.satWood[i] * cWood;
		const workerGold = m.money.workerPurse[i] + m.workerGoldAt(i);
		const baseTax = (workerGold / WORKER_SECONDS) / pop;
		const minProfitTax = baseTax > 1e-9 && comfort > 0.05 ? (rationCost * 1.12) / (baseTax * Math.max(0.25, comfort)) : TAX_MIN;
		const waitExcess = Math.max(0, poolOcc - WAIT_POOL_FREE);
		const popFull = Math.max(0, occ - 0.8) / 0.2;
		const crowdPush = WAIT_TAX_ADAPT * waitExcess + POP_FULL_TAX * popFull * popFull;

		let target;
		if (cls === WEALTH_CHEAP) {
			if (housingFree > 0.01) target = Math.max(TAX_MIN, minProfitTax * 0.6, 1 - 0.5 * housingFree) + crowdPush * 0.3;
			else if (queue > 0) target = Math.max(TAX_MIN, minProfitTax, 1 + 0.1 * queue) + crowdPush * 0.5;
			else target = Math.max(TAX_MIN, minProfitTax, 1) + crowdPush * 0.5;
		} else if (cls === WEALTH_RICH) {
			if (queue > 0) target = Math.max(TAX_MIN, minProfitTax, 1 + 0.4 * queue + 0.15 * comfort) + crowdPush;
			else if (occ < RICH_OCC) target = Math.max(TAX_MIN, minProfitTax * 0.7, 1 - 1.2 * (RICH_OCC - occ)) + crowdPush * 0.3;
			else target = Math.max(TAX_MIN, minProfitTax, 1.1) + crowdPush * 0.5;
		} else if (drive > 0.02 && comfort > 0.55) {
			target = Math.max(TAX_MIN, minProfitTax, 1 - 0.42 * drive * comfort) + crowdPush;
		} else {
			const shortage = Math.max(0, 0.6 - comfort) / 0.6;
			const loss = Math.max(0, -drive);
			target = Math.max(minProfitTax, 1 + 1.15 * Math.max(shortage, loss) + crowdPush);
		}
		m.taxMult[i] += ECONOMY_DT * TAX_ADAPT * (Math.min(TAX_MAX, Math.max(TAX_MIN, target)) - m.taxMult[i]);
	}
}

if (typeof module === 'object') module.exports = { TownPolicy };
