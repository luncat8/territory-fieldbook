// Owns: universal firm recipes, buy/sell pricing, fresh-worker pools, firm scale and the actor tick dispatch.
// Edit for: firm recipes, pool-occupancy hire demand and firm wage handoff. Town services: towns.js.
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

function optimalBid(value, stock, target, cool, suppress, share = INPUT_SHARE) {
	if (value <= 0 || target <= 0 || !Number.isFinite(cool)) return 0;
	const need = suppress ? Math.max(0, 1 - stock / target) : 1;
	return share * value * need / cool;
}

class ActorOptimizer {
	constructor(model) {
		this.model = model;
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
		if (actor === ECONOMY_TOWN) return this.model.towns.townRestTax(i);
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

	poolTarget(i) {
		const actor = this.model.actors[i];
		if (actor === ECONOMY_TOWN) return this.model.towns.townWaitPool(i);
		return actor ? this.firmLaborPool(i, this.recipes[actor]) : 0;
	}

	poolOccupancy(i) {
		const m = this.model;
		const actor = m.actors[i];
		const pool = this.poolTarget(i);
		if (pool <= 0) return 0;
		return (actor === ECONOMY_TOWN ? m.depleted[i] : m.labor[i]) / pool;
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
			if (actor === ECONOMY_TOWN) this.model.towns.stepTown(i);
			else this.stepFirm(i, this.recipes[actor]);
		}
	}

	adaptActors() {
		const m = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const actor = m.actors[i];
			if (!actor) continue;
			m.profit[i] += this.profitBlend * (m.earned[i] - m.profit[i]);
			if (actor === ECONOMY_TOWN) this.model.towns.adaptTownTax(i);
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
				if (item === ITEM_COAL) {
					m.burnedCoal += used;
					m.land.dispose(i, used, USE_COAL);
				}
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
}

if (typeof module === 'object') module.exports = { ActorOptimizer };
