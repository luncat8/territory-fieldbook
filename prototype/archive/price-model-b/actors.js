// Owns: universal actor recipes, buy/sell pricing, cost-basis conversion, scale/tax adaptation and workforce cycle.
// Edit for: firm recipes, profit-driven workforce demand, city living-tax policy and depleted workforce migration.
'use strict';

const JOINT_BUDGET_SHARE = 0.78;
const SELL_MARGIN = 0.04;
const SCALE_MIN = 0.35;
const SCALE_MAX = 1.55;
const SCALE_UP = 0.24;
const SCALE_DOWN = 0.36;
const REST_RATE = 0.55;
const TAX_MIN = 0.55;
const TAX_MAX = 2.2;
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
		if (actor === ECONOMY_TOWN) return this.townTaxRate(i);
		return 0;
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

	// Profitable, well-supplied towns lower living taxes and project strong appeal to depleted workers.
	townHomeBid(i) {
		const m = this.model;
		const pop = m.pop[i];
		const popRoom = Math.max(0, 1 - pop / POP_MAX);
		const comfort = COAL_COMFORT * m.satCoal[i] + GOODS_COMFORT * m.satGoods[i];
		if (comfort < 0.2 || m.profit[i] < -0.03) return 0;
		const afford = m.money.workerPurse[i] / (m.money.workerPurse[i] + pop * 0.25);
		const mult = m.derived ? (m.taxMult[i] || 1) : 1;
		return comfort * (0.35 + 0.65 * afford) * popRoom / (mult * mult);
	}

	// Universal firm bid optimizer: splits output value across inputs within a profitable budget,
	// raising workforce demand when profitable and cutting worker pay when losing money.
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
			const target = Math.min(0.92, rate * scale * inputs[k].need * BUFFER_SECONDS);
			const floor = isLabor && drive > 0 ? 0.35 * drive : 0;
			const need = m.suppression ? Math.max(floor, 1 - m.stocks[inputs[k].item][i] / target) : 1;
			this.rawOut[k] = share * remain * sellRoom * need;
			this.maxOut[k] = m.derived ? (remain * 0.96) / inputs[k].need : Infinity;
			rawSum += this.rawOut[k];
		}
		const budgetCap = Math.min(0.85, Math.max(0.42, (inputs.length > 1 ? JOINT_BUDGET_SHARE : 0.82) * (1 + 0.14 * drive))) * outValue * sellRoom;
		const fit = m.derived && rawSum > budgetCap && rawSum > 0 ? budgetCap / rawSum : 1;
		for (let k = 0; k < inputs.length; k++) {
			this.bidOut[k] = (this.rawOut[k] * fit) / (inputs[k].need * cool);
			// maxOut is the per-unit walk-away price (margin / need): never bid above it.
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

	// Firms never pause conversion of already-stocked inputs; input book cost carries into output
	// stock and sets the minimum sell price so stocked product is never sold at a loss.
	stepFirm(i, recipe) {
		const m = this.model;
		const { inputs, rate, outItem, outYield, gate } = recipe;
		const scale = m.scale[i] || 1;
		let batches = rate * scale * ECONOMY_DT;
		if (outItem >= 0) batches = Math.min(batches, (1 - m.stocks[outItem][i]) / outYield);
		for (let k = 0; k < inputs.length; k++) batches = Math.min(batches, m.stocks[inputs[k].item][i] / inputs[k].need);

		if (batches > 0) {
			let inputCost = 0;
			for (let k = 0; k < inputs.length; k++) {
				const { item, need } = inputs[k];
				const used = batches * need;
				const stock = m.stocks[item][i];
				const costFlow = m.flows[item].cost;
				const usedCost = stock > 0 ? costFlow[i] * Math.min(1, used / stock) : 0;
				m.stocks[item][i] = Math.max(0, stock - used);
				costFlow[i] = m.stocks[item][i] > 1e-12 ? Math.max(0, costFlow[i] - usedCost) : 0;
				inputCost += usedCost;
				if (item === ITEM_COAL) m.burnedCoal += used;
				else if (item === ITEM_LABOR) {
					m.workedLabor += used;
					const tired = Math.min(1 - m.depleted[i], used);
					m.depleted[i] += tired;
					m.emittedDepleted += tired;
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

		this.firmBids(i, recipe);
		for (let k = 0; k < inputs.length; k++) {
			const { item, need } = inputs[k];
			const stock = m.stocks[item][i];
			const target = Math.min(0.92, rate * scale * need * BUFFER_SECONDS);
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

	stepTown(i) {
		const m = this.model;
		const pop = m.pop[i];
		const comfortBefore = COAL_COMFORT * m.satCoal[i] + GOODS_COMFORT * m.satGoods[i];
		const workCap = Math.min(1, pop * LABOR_PER_POP * BUFFER_SECONDS);

		let restedLabor = 0, restedWork = 0;
		if (m.depleted[i] > 0 && comfortBefore > 0.2 && m.profit[i] >= -0.03) {
			restedWork = Math.min(m.depleted[i], (0.2 + comfortBefore * REST_RATE) * ECONOMY_DT);
			restedLabor = Math.min(Math.max(0, workCap - m.labor[i]), restedWork);
			m.depleted[i] -= restedWork;
			m.restedDepleted += restedWork;
			m.labor[i] += restedLabor;
			m.suppliedLabor += restedLabor;
		}
		const supplied = Math.min(Math.max(0, workCap - m.labor[i]), Math.max(0, pop * LABOR_PER_POP * ECONOMY_DT - restedLabor));
		m.labor[i] += supplied;
		m.suppliedLabor += supplied;

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
		const taxIncome = m.money.collectTax(i, comfort);
		m.earned[i] += taxIncome - (coalCost + goodsCost) / ECONOMY_DT;

		const mult = m.derived ? (m.taxMult[i] || 1) : 1;
		const afford = m.money.workerPurse[i] / (m.money.workerPurse[i] + pop * 0.25 * mult);
		const taxDrag = mult > 1 ? 1 / mult : 1 + 0.18 * (1 - mult);
		const goalPop = Math.min(POP_MAX, POP_BASE + (POP_MAX - POP_BASE) * comfort * afford * taxDrag);
		const migrantBoost = restedWork > 0 && pop < goalPop ? Math.min(goalPop - pop, (restedWork / LABOR_PER_POP) * 0.2 * comfort) : 0;
		const deltaPop = ECONOMY_DT * POP_RATE * (goalPop - pop) + migrantBoost;
		m.pop[i] = Math.min(POP_MAX, Math.max(0, pop + deltaPop));
		if (deltaPop < 0) {
			const shed = Math.min(1 - m.depleted[i], -deltaPop * LABOR_PER_POP);
			m.depleted[i] += shed;
			m.emittedDepleted += shed;
		}

		const tax = this.townTaxRate(i);
		const maxCoal = m.derived ? (COAL_COMFORT / TOWN_COAL_NEED) * tax * 0.96 : Infinity;
		const maxGoods = m.derived ? (GOODS_COMFORT / TOWN_GOODS_NEED) * tax * 0.96 : Infinity;
		m.coalFlow.cap[i] = this.townCoalBid(i) > 0 && m.priceCoal[i] <= maxCoal ? Math.max(m.coal[i], this.townCoalTarget(i)) : m.coal[i];
		m.goodsFlow.cap[i] = this.townGoodsBid(i) > 0 && m.priceGoods[i] <= maxGoods ? Math.max(m.goods[i], this.townGoodsTarget(i)) : m.goods[i];
		m.depletedFlow.cap[i] = this.townHomeBid(i) > 0 ? Math.min(1, 0.25 + 0.75 * Math.max(0, 1 - m.pop[i] / POP_MAX)) : 0;
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
		const baseTax = (m.money.workerPurse[i] / WORKER_SECONDS) / pop;
		const minProfitTax = baseTax > 1e-9 && comfort > 0.05 ? (rationCost * 1.12) / (baseTax * Math.max(0.25, comfort)) : TAX_MIN;

		let target = 1;
		if (drive > 0.02 && comfort > 0.55) {
			target = Math.max(TAX_MIN, minProfitTax, 1 - 0.42 * drive * comfort);
		} else {
			const shortage = Math.max(0, 0.6 - comfort) / 0.6;
			const loss = Math.max(0, -drive);
			target = Math.min(TAX_MAX, Math.max(minProfitTax, 1 + 1.15 * Math.max(shortage, loss)));
		}
		m.taxMult[i] += ECONOMY_DT * TAX_ADAPT * (Math.min(TAX_MAX, Math.max(TAX_MIN, target)) - m.taxMult[i]);
	}
}

if (typeof module === 'object') module.exports = { ActorOptimizer };
