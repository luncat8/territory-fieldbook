// Owns: universal actor recipes, buy/sell pricing, worker/living wait pools, gold-tax appeal and paid rest.
// Edit for: firm recipes, pool-occupancy hire demand, wait-pool living taxes and worker wallet cycle.
'use strict';

const JOINT_BUDGET_SHARE = 0.78;
const SELL_MARGIN = 0.04;
const SCALE_MIN = 0.35;
const SCALE_MAX = 1.55;
const SCALE_UP = 0.24;
const SCALE_DOWN = 0.36;
const OCCUPANCY_RATE = 0.35;
const WORK_POOL_BASE = 1.8;
const WORK_POOL_TRANSIT = 2.2;
const TOWN_POOL_BASE = 0.35;
const TOWN_POOL_TRANSIT = 0.55;
const WAIT_POOL_FREE = 0.25;
const WAIT_POOL_OVERFLOW = 1.6;
const WAIT_SPOT_TAX = 0.55;
const WAIT_TAX_ADAPT = 0.95;
const POP_FULL_TAX = 0.65;
const REST_TAX_SHARE = 0.35;
const BASE_SHELTER = 0.15;
const TAX_MIN = 0.55;
const TAX_MAX = 2.4;
const TAX_ADAPT = 0.6;

function optimalBid(value, stock, target, cool, suppress, share = INPUT_SHARE) {
	if (value <= 0 || target <= 0 || !Number.isFinite(cool)) return 0;
	const need = suppress ? Math.max(0, 1 - stock / target) : 1;
	return share * value * need / cool;
}

class ActorOptimizer {
	constructor(model) {
		this.model = model;
		this.satBlend = 1 - Math.exp(-ECONOMY_DT * SAT_RATE);
		this.profitBlend = 1 - Math.exp(-ECONOMY_DT * PROFIT_RATE);
		this.occBlend = 1 - Math.exp(-ECONOMY_DT * OCCUPANCY_RATE);
		this.bidOut = new Float64Array(2);
		this.maxOut = new Float64Array(2);
		this.rawOut = new Float64Array(2);
		this.recipes = {
			[ECONOMY_MINE]: { rate: SOURCE_RATE, outItem: ITEM_COAL, outYield: 1, gate: PRICE_GATE, inputs: [{ item: ITEM_LABOR, need: MINE_LABOR }] },
			[ECONOMY_FACTORY]: { rate: FACTORY_RATE, outItem: ITEM_GOODS, outYield: FACTORY_YIELD, gate: 0, inputs: [{ item: ITEM_COAL, need: 1 }, { item: ITEM_LABOR, need: FACTORY_LABOR * FACTORY_YIELD }] },
			[ECONOMY_GOLD]: { rate: SOURCE_RATE, outItem: -1, outYield: GOLD_RATE / SOURCE_RATE, gate: 0, inputs: [{ item: ITEM_LABOR, need: GOLD_LABOR }] }
		};
	}

	sellPrice(i) {
		const { actors, coalFlow, goodsFlow } = this.model;
		const actor = actors[i];
		if (actor === ECONOMY_MINE) return coalFlow.sell[i];
		if (actor === ECONOMY_FACTORY) return goodsFlow.sell[i];
		if (actor === ECONOMY_TOWN) return this.townRestTax(i);
		return 0;
	}

	// Fresh-worker pool above shift capacity scales with real shift occupancy to smooth commute round-trips.
	firmLaborPool(i, recipe) {
		if (!recipe) return 0;
		const m = this.model;
		const scale = m.scale[i] || 1;
		let laborNeed = 0;
		for (let k = 0; k < recipe.inputs.length; k++) {
			if (recipe.inputs[k].item === ITEM_LABOR) laborNeed = recipe.inputs[k].need;
		}
		if (laborNeed <= 0) return 0;
		const nominal = recipe.rate * scale * laborNeed;
		const occRatio = Math.min(1, m.workLoad[i] / Math.max(1e-9, nominal));
		const outPrice = recipe.outItem < 0 ? 1 : (m.derived ? m.pricesAt(recipe.outItem)[i] : START_PRICE);
		const ref = Math.max(0.02, outPrice * recipe.outYield * recipe.rate * 0.12);
		const drive = m.derived ? Math.tanh(m.profit[i] / ref) : 0;
		const poolSeconds = WORK_POOL_BASE * (1 + 0.35 * drive) + WORK_POOL_TRANSIT * occRatio;
		return Math.min(0.9, Math.max(nominal * 0.8, nominal * poolSeconds));
	}

	// Town wait-pool size tracks resident base plus realized returning-worker flow to smooth homebound waves.
	townWaitPool(i) {
		const m = this.model;
		const pop = m.pop[i];
		if (pop <= 0) return 0;
		return Math.min(0.85, Math.max(0.08, pop * LABOR_PER_POP * TOWN_POOL_BASE + m.workLoad[i] * TOWN_POOL_TRANSIT));
	}

	poolTarget(i) {
		const actor = this.model.actors[i];
		if (actor === ECONOMY_TOWN) return this.townWaitPool(i);
		return actor ? this.firmLaborPool(i, this.recipes[actor]) : 0;
	}

	poolOccupancy(i) {
		const m = this.model;
		const actor = m.actors[i];
		const pool = this.poolTarget(i);
		if (pool <= 0) return 0;
		return (actor === ECONOMY_TOWN ? m.depleted[i] : m.labor[i]) / pool;
	}

	townDrive(i) {
		const m = this.model;
		if (!m.derived) return 0;
		const ref = Math.max(0.05, m.pop[i] * TOWN_GOODS_NEED * Math.max(0.5, m.priceGoods[i]));
		return Math.tanh(m.profit[i] / ref);
	}

	townPopPlan(i) {
		const boost = Math.max(0, this.townDrive(i));
		return Math.min(POP_MAX, this.model.pop[i] + POP_HEADROOM * (1 + boost));
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
		const waitExcess = Math.max(0, this.poolOccupancy(i) - WAIT_POOL_FREE);
		const popFull = Math.max(0, m.pop[i] / POP_MAX - 0.8) / 0.2;
		return 1 + WAIT_SPOT_TAX * waitExcess + 0.35 * popFull * popFull;
	}

	townEffectiveMult(i) {
		const m = this.model;
		return m.derived ? (m.taxMult[i] || 1) * this.townCrowdMult(i) : 1;
	}

	// Posted living tax in gold rises with wait-pool crowding and never drops to zero on empty purses.
	townRestTax(i) {
		const m = this.model;
		if (!m.derived) return START_TAX_PER_POP;
		const crowd = this.townCrowdMult(i);
		const mult = (m.taxMult[i] || 1) * crowd;
		return Math.max(START_TAX_PER_POP * mult, this.townTaxRate(i) * crowd);
	}

	townShare(i) {
		return Math.min(0.76, Math.max(0.42, INPUT_SHARE * (1 + 0.16 * this.townDrive(i))));
	}

	townGoodsBid(i) {
		const m = this.model;
		const tax = this.townTaxRate(i);
		const share = this.townShare(i);
		const cool = m.money.townCool(i, share * tax * m.pop[i] * PURSE_SECONDS);
		return optimalBid((GOODS_COMFORT / TOWN_GOODS_NEED) * tax, m.goods[i], this.townGoodsTarget(i), cool, m.suppression, share);
	}

	townCoalBid(i) {
		const m = this.model;
		const tax = this.townTaxRate(i);
		const share = this.townShare(i);
		const cool = m.money.townCool(i, share * tax * m.pop[i] * PURSE_SECONDS);
		return optimalBid((COAL_COMFORT / TOWN_COAL_NEED) * tax, m.coal[i], this.townCoalTarget(i), cool, m.suppression, share);
	}

	// Living appeal is shelter comfort per gold of living tax; wait-pool & housing crowding act through goldTax
	// rather than zeroing full towns or giving shrinking towns fake popRoom attraction.
	townHomeBid(i) {
		const m = this.model;
		if (m.pop[i] <= 0) return 0;
		const comfort = COAL_COMFORT * m.satCoal[i] + GOODS_COMFORT * m.satGoods[i];
		const shelter = BASE_SHELTER + (1 - BASE_SHELTER) * comfort;
		const goldTax = this.townRestTax(i);
		return START_PRICE * shelter * (START_TAX_PER_POP / Math.max(1e-6, goldTax));
	}

	// Universal firm bid optimizer: splits output value across inputs within a profitable budget
	// and emits workforce hire demand inversely with fresh-worker pool occupancy down to zero on overflow.
	firmBids(i, recipe) {
		const m = this.model;
		const { inputs, rate, outItem, outYield, gate } = recipe;
		const scale = m.scale[i] || 1;
		const fallback = outItem === ITEM_COAL ? START_PRICE * 0.5 : START_PRICE;
		const outPrice = outItem < 0 ? 1 : (m.derived ? m.pricesAt(outItem)[i] : fallback);
		this.bidOut.fill(0);
		this.maxOut.fill(0);
		if (gate > 0 && outPrice <= gate) return;
		const outValue = outPrice * outYield;
		if (outValue <= 0) return;
		const outTarget = Math.min(0.92, rate * scale * BUFFER_SECONDS);
		const sellRoom = outItem < 0 || !m.suppression ? 1 : Math.max(0, 1 - m.stocks[outItem][i] / outTarget);
		const ref = Math.max(0.02, outValue * rate * 0.12);
		const drive = m.derived ? Math.tanh(m.profit[i] / ref) : 0;
		const cool = m.money.creditCool(i, INPUT_SHARE * outValue * rate * scale * PURSE_SECONDS);
		if (!Number.isFinite(cool)) return;

		let rawSum = 0;
		for (let k = 0; k < inputs.length; k++) {
			let otherCost = 0;
			if (m.derived || outItem < 0) {
				for (let j = 0; j < inputs.length; j++) {
					if (j !== k) otherCost += m.pricesAt(inputs[j].item)[i] * inputs[j].need;
				}
			}
			const remain = Math.max(0, outValue - otherCost);
			const isLabor = inputs[k].item === ITEM_LABOR;
			const share = Math.min(0.82, Math.max(0.32, INPUT_SHARE * (1 + (isLabor ? 0.28 : 0.12) * drive)));
			const target = isLabor ? this.firmLaborPool(i, recipe) : Math.min(0.92, rate * scale * inputs[k].need * BUFFER_SECONDS);
			const need = m.suppression ? Math.max(0, 1 - m.stocks[inputs[k].item][i] / Math.max(1e-9, target)) : 1;
			this.rawOut[k] = share * remain * sellRoom * need;
			this.maxOut[k] = m.derived ? (remain * 0.96) / inputs[k].need : Infinity;
			rawSum += this.rawOut[k];
		}
		const budgetCap = Math.min(0.85, Math.max(0.42, (inputs.length > 1 ? JOINT_BUDGET_SHARE : 0.82) * (1 + 0.14 * drive))) * outValue * sellRoom;
		const fit = m.derived && rawSum > budgetCap && rawSum > 0 ? budgetCap / rawSum : 1;
		for (let k = 0; k < inputs.length; k++) {
			this.bidOut[k] = (this.rawOut[k] * fit) / (inputs[k].need * cool);
			if (this.bidOut[k] > this.maxOut[k]) this.bidOut[k] = this.maxOut[k];
		}
	}

	factoryCoalBid(i) { this.firmBids(i, this.recipes[ECONOMY_FACTORY]); return this.bidOut[0]; }
	factoryLaborBid(i) { this.firmBids(i, this.recipes[ECONOMY_FACTORY]); return this.bidOut[1]; }
	mineLaborBid(i) { this.firmBids(i, this.recipes[ECONOMY_MINE]); return this.bidOut[0]; }
	goldLaborBid(i) { this.firmBids(i, this.recipes[ECONOMY_GOLD]); return this.bidOut[0]; }

	stepActors() {
		const { actors } = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const actor = actors[i];
			if (!actor) continue;
			if (actor === ECONOMY_TOWN) this.stepTown(i);
			else this.stepFirm(i, this.recipes[actor]);
		}
	}

	adaptActors() {
		const m = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const actor = m.actors[i];
			if (!actor) continue;
			m.profit[i] += this.profitBlend * (m.earned[i] - m.profit[i]);
			if (actor === ECONOMY_TOWN) this.adaptTownTax(i);
			else this.adaptFirmScale(i, this.recipes[actor]);
		}
	}

	// Firms draw shift labor from their on-site fresh-worker pool, carry book cost into finished stock,
	// and move completed-shift workers' pocket gold onto depletedFlow.gold.
	stepFirm(i, recipe) {
		const m = this.model;
		const { inputs, rate, outItem, outYield, gate } = recipe;
		const scale = m.scale[i] || 1;
		let batches = rate * scale * ECONOMY_DT;
		if (outItem >= 0) batches = Math.min(batches, (1 - m.stocks[outItem][i]) / outYield);
		for (let k = 0; k < inputs.length; k++) {
			const { item, need } = inputs[k];
			batches = Math.min(batches, m.stocks[item][i] / need);
			if (item === ITEM_LABOR) batches = Math.min(batches, (1 - m.depleted[i]) / need);
		}

		let usedLabor = 0;
		if (batches > 0) {
			let inputCost = 0;
			for (let k = 0; k < inputs.length; k++) {
				const { item, need } = inputs[k];
				const used = batches * need;
				const stock = m.stocks[item][i];
				const flow = m.flows[item];
				const ratio = stock > 0 ? Math.min(1, used / stock) : 0;
				const usedCost = flow.cost[i] * ratio;
				m.stocks[item][i] = Math.max(0, stock - used);
				flow.cost[i] = m.stocks[item][i] > 1e-12 ? Math.max(0, flow.cost[i] - usedCost) : 0;
				inputCost += usedCost;
				if (item === ITEM_COAL) m.burnedCoal += used;
				else if (item === ITEM_LABOR) {
					usedLabor = used;
					const carriedGold = flow.gold[i] * ratio;
					flow.gold[i] = Math.max(0, flow.gold[i] - carriedGold);
					m.depletedFlow.gold[i] += carriedGold;
					if (m.stocks[item][i] <= 1e-12 && flow.gold[i] > 0) {
						m.depletedFlow.gold[i] += flow.gold[i];
						flow.gold[i] = 0;
					}
					m.workedLabor += used;
					m.depleted[i] += used;
					m.emittedDepleted += used;
				}
			}
			const made = batches * outYield;
			if (outItem < 0) {
				m.money.dig(i, made);
				m.earned[i] += (made - inputCost) / ECONOMY_DT;
			} else {
				m.stocks[outItem][i] += made;
				m.flows[outItem].cost[i] += inputCost;
				if (outItem === ITEM_COAL) m.producedCoal += made;
				else m.producedGoods += made;
			}
		}
		m.workLoad[i] += this.occBlend * (usedLabor / ECONOMY_DT - m.workLoad[i]);

		this.firmBids(i, recipe);
		for (let k = 0; k < inputs.length; k++) {
			const { item, need } = inputs[k];
			const stock = m.stocks[item][i];
			const target = item === ITEM_LABOR ? this.firmLaborPool(i, recipe) : Math.min(0.92, rate * scale * need * BUFFER_SECONDS);
			const canBuy = this.bidOut[k] > 0 && m.pricesAt(item)[i] <= this.maxOut[k];
			m.flows[item].cap[i] = canBuy ? Math.max(stock, target) : stock;
		}
		if (outItem >= 0) {
			const unitCost = m.unitCostAt(outItem, i);
			m.flows[outItem].sell[i] = m.derived ? Math.max(gate, unitCost * (1 + SELL_MARGIN)) : gate;
		}
	}

	adaptFirmScale(i, recipe) {
		const m = this.model;
		if (!m.derived) return;
		const { rate, outItem, outYield } = recipe;
		const outPrice = outItem < 0 ? 1 : m.pricesAt(outItem)[i];
		const outValue = outPrice * outYield;
		const ref = Math.max(0.02, outValue * rate * 0.12);
		const drive = Math.tanh(m.profit[i] / ref);
		const outStock = outItem < 0 ? 0 : m.stocks[outItem][i];
		const outTarget = Math.min(0.92, rate * m.scale[i] * BUFFER_SECONDS);
		const sellRoom = outItem < 0 ? 1 : Math.max(0, 1 - outStock / outTarget);
		const solvent = m.money.owedAt(i) <= m.money.purse[i] + Math.max(0.25, outValue * rate * 2.5);
		if (drive > 0.02 && solvent && sellRoom > 0.2) {
			m.scale[i] = Math.min(SCALE_MAX, m.scale[i] + ECONOMY_DT * SCALE_UP * drive * sellRoom);
		} else if (drive < -0.02 || !solvent || (outStock > 0.25 && sellRoom < 0.15)) {
			m.scale[i] = Math.max(SCALE_MIN, m.scale[i] - ECONOMY_DT * SCALE_DOWN * Math.max(0.15, -drive));
		}
	}

	// Returning depleted workers in the town wait pool pay the gold rest tax from their carried wallet
	// to rest into fresh labor; high-tax or wait-crowded towns price out penniless workers.
	restWorkers(i, comfort, workCap) {
		const m = this.model;
		const dep = m.depleted[i];
		if (dep <= 1e-12) return 0;
		const carried = m.depletedFlow.gold[i];
		const mult = this.townEffectiveMult(i);
		if (comfort <= 0.05) {
			if (carried <= 1e-9 || hasHigherNeighbor(m.priceHome, i)) return 0;
			const shelterRest = Math.min(dep, Math.max(0.12, m.pop[i] * LABOR_PER_POP * 0.4) * ECONOMY_DT);
			const banked = carried * Math.min(1, shelterRest / dep);
			m.depleted[i] = Math.max(0, dep - shelterRest);
			m.depletedFlow.gold[i] = Math.max(0, carried - banked);
			if (m.depleted[i] <= 1e-12 && m.depletedFlow.gold[i] > 0) {
				m.money.workerPurse[i] += m.depletedFlow.gold[i];
				m.depletedFlow.gold[i] = 0;
			}
			m.money.workerPurse[i] += banked;
			m.restedDepleted += shelterRest;
			const toLabor = Math.min(Math.max(0, workCap - m.labor[i]), shelterRest);
			m.labor[i] += toLabor;
			m.suppliedLabor += toLabor;
			return shelterRest;
		}

		const restRate = m.pop[i] * LABOR_PER_POP * (0.25 + 0.95 * comfort) + 0.12 * comfort;
		const wantRest = Math.min(dep, restRate * ECONOMY_DT);
		const feePerUnit = (this.townRestTax(i) / LABOR_PER_POP) * REST_TAX_SHARE * comfort;
		const fullFee = wantRest * feePerUnit;
		const afford = fullFee > 1e-12 ? Math.min(1, carried / fullFee) : 1;
		const grace = mult <= 1.15 ? 0.25 : 0;
		const restedWork = wantRest * (grace + (1 - grace) * afford);
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

		const mult = m.derived ? (m.taxMult[i] || 1) : 1;
		const workerGold = m.money.workerPurse[i] + m.workerGoldAt(i);
		const afford = workerGold / (workerGold + pop * 0.25 * mult);
		const taxDrag = mult > 1 ? 1 / (1 + 0.5 * (mult - 1)) : 1 + 0.18 * (1 - mult);
		const goalPop = Math.min(POP_MAX, POP_BASE + (POP_MAX - POP_BASE) * comfort * afford * taxDrag);
		const migrantBoost = restedWork > 0 && pop < goalPop ? Math.min(goalPop - pop, (restedWork / LABOR_PER_POP) * 0.2 * comfort) : 0;
		const deltaPop = ECONOMY_DT * POP_RATE * (goalPop - pop) + migrantBoost;
		m.pop[i] = Math.min(POP_MAX, Math.max(0, pop + deltaPop));
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
		const maxCoal = m.derived ? (COAL_COMFORT / TOWN_COAL_NEED) * tax * 0.96 : Infinity;
		const maxGoods = m.derived ? (GOODS_COMFORT / TOWN_GOODS_NEED) * tax * 0.96 : Infinity;
		const waitPool = this.townWaitPool(i);
		m.coalFlow.cap[i] = this.townCoalBid(i) > 0 && m.priceCoal[i] <= maxCoal ? Math.max(m.coal[i], this.townCoalTarget(i)) : m.coal[i];
		m.goodsFlow.cap[i] = this.townGoodsBid(i) > 0 && m.priceGoods[i] <= maxGoods ? Math.max(m.goods[i], this.townGoodsTarget(i)) : m.goods[i];
		m.depletedFlow.cap[i] = this.townHomeBid(i) > 0 ? Math.min(0.95, Math.max(m.depleted[i], waitPool * WAIT_POOL_OVERFLOW)) : 0;
	}

	adaptTownTax(i) {
		const m = this.model;
		if (!m.derived) {
			m.taxMult[i] = 1;
			return;
		}
		const pop = Math.max(1, m.pop[i]);
		const comfort = COAL_COMFORT * m.satCoal[i] + GOODS_COMFORT * m.satGoods[i];
		const drive = this.townDrive(i);
		const cCoal = m.coal[i] > 1e-6 ? m.unitCostAt(ITEM_COAL, i) : m.priceCoal[i];
		const cGoods = m.goods[i] > 1e-6 ? m.unitCostAt(ITEM_GOODS, i) : m.priceGoods[i];
		const rationCost = TOWN_COAL_NEED * m.satCoal[i] * cCoal + TOWN_GOODS_NEED * m.satGoods[i] * cGoods;
		const workerGold = m.money.workerPurse[i] + m.workerGoldAt(i);
		const baseTax = (workerGold / WORKER_SECONDS) / pop;
		const minProfitTax = baseTax > 1e-9 && comfort > 0.05 ? (rationCost * 1.12) / (baseTax * Math.max(0.25, comfort)) : TAX_MIN;
		const waitExcess = Math.max(0, this.poolOccupancy(i) - WAIT_POOL_FREE);
		const popFull = Math.max(0, m.pop[i] / POP_MAX - 0.8) / 0.2;
		const crowdPush = WAIT_TAX_ADAPT * waitExcess + POP_FULL_TAX * popFull * popFull;

		let target = 1;
		if (drive > 0.02 && comfort > 0.55) {
			target = Math.max(TAX_MIN, minProfitTax, 1 - 0.42 * drive * comfort) + crowdPush;
		} else {
			const shortage = Math.max(0, 0.6 - comfort) / 0.6;
			const loss = Math.max(0, -drive);
			target = Math.max(minProfitTax, 1 + 1.15 * Math.max(shortage, loss) + crowdPush);
		}
		m.taxMult[i] += ECONOMY_DT * TAX_ADAPT * (Math.min(TAX_MAX, Math.max(TAX_MIN, target)) - m.taxMult[i]);
	}
}

if (typeof module === 'object') module.exports = { ActorOptimizer };
