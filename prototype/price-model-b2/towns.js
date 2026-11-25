// Owns: town services — wait pool, tier-scaled living tax, paid rest, coal/goods uptake, wealth-class tax and resident targets.
// Edit for: Cheap/Med/Rich strategies, wait-pool crowding tax and the rest fee. Home appeal: workforce.js; firm pricing: actors.js.
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

// Town wealth classes (draft: "town wealth class" — 3 random strategies assigned per town).
const WEALTH_CHEAP = 0;
const WEALTH_MED = 1;
const WEALTH_RICH = 2;
const WEALTH_NAMES = ['Cheap', 'Med', 'Rich'];
const RICH_OCC = 0.85;        // rich towns hold a few free resident slots, so the wait queue stays ~0
const SPACE_COMFORT = 0.25;   // free housing lifts a town's rest comfort
const VACANT_OCC = 0.3;       // occupancy below this counts as vacant
const VACANT_SECONDS = 25;    // vacant this long → slow size decay
const NEED_FLOOR = 0.25;      // comfort floor a rich town keeps before cutting size

// Deterministic, reproducible wealth-class assignment (cheap / med / rich) per cell index.
// Same variety as a random draw but identical across resets and tests (no RNG state to drift).
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

	// Town wait-pool size tracks resident base plus realized returning-worker flow to smooth homebound waves.
	townWaitPool(i) {
		const m = this.model;
		const pop = m.pop[i];
		if (pop <= 0) return 0;
		return Math.min(0.85, Math.max(0.08, pop * LABOR_PER_POP * TOWN_POOL_BASE + m.workLoad[i] * TOWN_POOL_TRANSIT));
	}

	townDrive(i) {
		const m = this.model;
		if (!m.derived) return 0;
		const ref = Math.max(0.05, m.pop[i] * TOWN_GOODS_NEED * Math.max(0.5, m.priceGoods[i]));
		return Math.tanh(m.profit[i] / ref);
	}

	townPopPlan(i) {
		const boost = Math.max(0, this.townDrive(i));
		return Math.min(this.model.settlements.popCap(i), this.model.pop[i] + POP_HEADROOM * (1 + boost));
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

	// Posted living tax in gold rises with wait-pool crowding, falls with low tier and never drops to zero on empty purses.
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
		const cool = m.money.townCool(i, share * tax * m.pop[i] * PURSE_SECONDS);
		return m.settlements.bidFactor(i) * optimalBid((GOODS_COMFORT / TOWN_GOODS_NEED) * tax, m.goods[i], this.townGoodsTarget(i), cool, m.suppression, share);
	}

	townCoalBid(i) {
		const m = this.model;
		const tax = this.townTaxRate(i);
		const share = this.townShare(i);
		const cool = m.money.townCool(i, share * tax * m.pop[i] * PURSE_SECONDS);
		return m.settlements.bidFactor(i) * optimalBid((COAL_COMFORT / TOWN_COAL_NEED) * tax, m.coal[i], this.townCoalTarget(i), cool, m.suppression, share);
	}

	// Returning depleted workers in the town wait pool pay the gold rest tax from their carried wallet
	// to rest into fresh labor. A town rests only workers for whom it is the local best home; penniless workers get no
	// paid rest and only rest slowly while still (workforce.js).
	restWorkers(i, comfort, workCap) {
		const m = this.model;
		const dep = m.depleted[i];
		if (dep <= 1e-12 || hasBetterNeighbor(m.depletedFlow, m.priceHome, i)) return 0;
		const carried = m.depletedFlow.gold[i];
		const restRate = (m.pop[i] * LABOR_PER_POP * (0.25 + 0.95 * comfort) + 0.12) * m.settlements.restFactor(i);
		const wantRest = Math.min(dep, restRate * ECONOMY_DT);
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
		const restedLabor = Math.min(Math.max(0, workCap - m.labor[i]), restedWork);
		m.labor[i] += restedLabor;
		m.suppliedLabor += restedLabor;
		return restedWork;
	}

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
		const workCap = Math.min(1, pop * LABOR_PER_POP * BUFFER_SECONDS);

		const taxesBefore = m.money.taxes;
		const restedWork = this.restWorkers(i, comfort, workCap);
		m.workLoad[i] += this.occBlend * (restedWork / ECONOMY_DT - m.workLoad[i]);
		const supplied = Math.min(Math.max(0, workCap - m.labor[i]), Math.max(0, pop * LABOR_PER_POP * ECONOMY_DT - restedWork));
		if (supplied > 0) {
			m.labor[i] += supplied;
			m.suppliedLabor += supplied;
		}

		m.money.collectTax(i, comfort);
		const taxIncome = (m.money.taxes - taxesBefore) / ECONOMY_DT;
		m.earned[i] += taxIncome - (coalCost + goodsCost) / ECONOMY_DT;

		const target = this.townResidentTarget(i);
		let deltaPop = ECONOMY_DT * POP_RATE * (target - pop);
		if (deltaPop > 0) deltaPop = m.harvest.takeWood(i, deltaPop * WOOD_PER_POP) / WOOD_PER_POP;
		m.pop[i] = Math.min(m.settlements.popCap(i), Math.max(0, pop + deltaPop));
		// Track vacancy so cheap/med towns only shed size when long-empty or broke (upkeep is deferred, see draft).
		const cap = m.settlements.popCap(i);
		const occ = cap > 1e-9 ? m.pop[i] / cap : 0;
		if (occ < VACANT_OCC && restedWork <= 1e-12) m.vacantTicks[i] += ECONOMY_DT;
		else m.vacantTicks[i] = Math.max(0, m.vacantTicks[i] - ECONOMY_DT * 2);
		if (deltaPop < 0 && pop > 1e-9) {
			const shed = Math.min(1 - m.depleted[i], -deltaPop * LABOR_PER_POP);
			if (shed > 0) {
				const leaveShare = Math.min(1, (shed / LABOR_PER_POP) / pop);
				const migrantGold = m.money.workerPurse[i] * leaveShare;
				m.money.workerPurse[i] = Math.max(0, m.money.workerPurse[i] - migrantGold);
				m.depleted[i] += shed;
				m.depletedFlow.gold[i] += migrantGold;
				m.emittedDepleted += shed;
			}
		}

		const tax = this.townTaxRate(i);
		const ceiling = m.settlements.bidFactor(i) * 0.96;
		const maxCoal = m.derived ? (COAL_COMFORT / TOWN_COAL_NEED) * tax * ceiling : Infinity;
		const maxGoods = m.derived ? (GOODS_COMFORT / TOWN_GOODS_NEED) * tax * ceiling : Infinity;
		const waitPool = this.townWaitPool(i);
		m.coalFlow.cap[i] = this.townCoalBid(i) > 0 && m.priceCoal[i] <= maxCoal ? Math.max(m.coal[i], this.townCoalTarget(i)) : m.coal[i];
		m.goodsFlow.cap[i] = this.townGoodsBid(i) > 0 && m.priceGoods[i] <= maxGoods ? Math.max(m.goods[i], this.townGoodsTarget(i)) : m.goods[i];
		m.depletedFlow.cap[i] = m.pop[i] > 0 ? Math.min(0.95, Math.max(m.depleted[i], waitPool * WAIT_POOL_OVERFLOW)) : 0;
	}

	// Target resident population for a town. Comfort/affordability still gate how many residents a town can
	// actually serve, so a starved town shrinks; cheap/med keep their built size (they do not shed residents just
	// because they are poor — tax is the lever that keeps them full), while rich holds a cozy occupancy with a few
	// free slots (queue ≈ 0). Cheap/med only shed slowly when long-vacant or broke; rich also cuts size first
	// when the wait pool overflows yet it cannot meet resident needs.
	townResidentTarget(i) {
		const m = this.model;
		const pop = m.pop[i];
		const comfort = COAL_COMFORT * m.satCoal[i] + GOODS_COMFORT * m.satGoods[i];
		const mult = m.derived ? (m.taxMult[i] || 1) : 1;
		const workerGold = m.money.workerPurse[i] + m.workerGoldAt(i);
		const afford = workerGold / (workerGold + pop * 0.25 * mult);
		const taxDrag = mult > 1 ? 1 / (1 + 0.5 * (mult - 1)) : 1 + 0.18 * (1 - mult);
		const popCap = m.settlements.popCap(i);
		let target = Math.min(popCap, POP_BASE + (popCap - POP_BASE) * comfort * afford * taxDrag);
		const cls = m.wealthClass[i];
		if (cls === WEALTH_RICH) {
			target *= RICH_OCC;
			if (this.waitOccupancy(i) > 1 && comfort < NEED_FLOOR) target = Math.min(target, pop * 0.6);
		} else {
			// Cheap/med keep their built size: do not shrink with comfort, only hold or grow.
			target = Math.max(target, pop);
		}
		if (m.vacantTicks[i] > VACANT_SECONDS || workerGold < 1e-6 || m.harvest.hungry(i)) target = Math.min(target, pop * 0.985);
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
		const occ = cap > 1e-9 ? pop / cap : 0;
		const housingFree = Math.max(0, 1 - occ);
		const cCoal = m.coal[i] > 1e-6 ? m.unitCostAt(ITEM_COAL, i) : m.priceCoal[i];
		const cGoods = m.goods[i] > 1e-6 ? m.unitCostAt(ITEM_GOODS, i) : m.priceGoods[i];
		const rationCost = TOWN_COAL_NEED * m.satCoal[i] * cCoal + TOWN_GOODS_NEED * m.satGoods[i] * cGoods;
		const workerGold = m.money.workerPurse[i] + m.workerGoldAt(i);
		const baseTax = (workerGold / WORKER_SECONDS) / pop;
		const minProfitTax = baseTax > 1e-9 && comfort > 0.05 ? (rationCost * 1.12) / (baseTax * Math.max(0.25, comfort)) : TAX_MIN;
		const waitExcess = Math.max(0, poolOcc - WAIT_POOL_FREE);
		const popFull = Math.max(0, occ - 0.8) / 0.2;
		const crowdPush = WAIT_TAX_ADAPT * waitExcess + POP_FULL_TAX * popFull * popFull;

		// Town wealth class decides how taxes react to a full wait pool vs vacant slots (draft "town wealth class").
		let target;
		if (cls === WEALTH_CHEAP) {
			// Cheap (poor-worker) towns: drop tax to fill vacant slots, even if they cannot yet buy every resource;
			// when the pool queues, hold a modest tax and let size grow to absorb workers.
			if (housingFree > 0.01) {
				target = Math.max(TAX_MIN, minProfitTax * 0.6, 1 - 0.5 * housingFree) + crowdPush * 0.3;
			} else if (queue > 0) {
				target = Math.max(TAX_MIN, minProfitTax, 1 + 0.1 * queue) + crowdPush * 0.5;
			} else {
				target = Math.max(TAX_MIN, minProfitTax, 1) + crowdPush * 0.5;
			}
		} else if (cls === WEALTH_RICH) {
			// Rich towns: rise tax (no growth) when the pool queues and fit needs; if still short, size is cut in
			// townResidentTarget. With free slots and few workers they ease tax to refill toward a cozy occupancy.
			if (queue > 0) {
				target = Math.max(TAX_MIN, minProfitTax, 1 + 0.4 * queue + 0.15 * comfort) + crowdPush;
			} else if (occ < RICH_OCC) {
				const fillNeed = RICH_OCC - occ;
				target = Math.max(TAX_MIN, minProfitTax * 0.7, 1 - 1.2 * fillNeed) + crowdPush * 0.3;
			} else {
				target = Math.max(TAX_MIN, minProfitTax, 1 + 0.1) + crowdPush * 0.5;
			}
		} else {
			// Med (balanced): buy most resources to fit needs, then grow — the prior single behaviour.
			if (drive > 0.02 && comfort > 0.55) {
				target = Math.max(TAX_MIN, minProfitTax, 1 - 0.42 * drive * comfort) + crowdPush;
			} else {
				const shortage = Math.max(0, 0.6 - comfort) / 0.6;
				const loss = Math.max(0, -drive);
				target = Math.max(minProfitTax, 1 + 1.15 * Math.max(shortage, loss) + crowdPush);
			}
		}
		m.taxMult[i] += ECONOMY_DT * TAX_ADAPT * (Math.min(TAX_MAX, Math.max(TAX_MIN, target)) - m.taxMult[i]);
	}
}

if (typeof module === 'object') module.exports = { TownPolicy };
