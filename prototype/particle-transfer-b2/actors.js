// Owns: firm recipes (mine, factory, gold mine, sawmill), joint-budget input bidding, shift conversion and scale adaptation.
// Edit for: recipe yields/labor needs, pool-occupancy wage cooling, cost-basis sell floors and firm scale rates.
'use strict';

const JOINT_BUDGET_SHARE = 0.78;
const SELL_MARGIN = 0.04;
const SCALE_MIN = 0.35;
const SCALE_MAX = 1.55;
const SCALE_UP = 0.24;
const SCALE_DOWN = 0.36;
const OCCUPANCY_RATE = 0.35;

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
		this.laborCost = new Float64Array(ECONOMY_SIZE);
		this.bidOut = new Float64Array(2);
		this.maxOut = new Float64Array(2);
		this.rawOut = new Float64Array(2);
		this.recipes = {
			[ECONOMY_MINE]: { rate: SOURCE_RATE, outItem: ITEM_COAL, outYield: 1, gate: PRICE_GATE, inputs: [{ item: ITEM_LABOR, need: MINE_LABOR }] },
			[ECONOMY_FACTORY]: { rate: FACTORY_RATE, outItem: ITEM_GOODS, outYield: FACTORY_YIELD, gate: 0, inputs: [{ item: ITEM_COAL, need: 1 }, { item: ITEM_LABOR, need: FACTORY_LABOR * FACTORY_YIELD }] },
			[ECONOMY_GOLD]: { rate: SOURCE_RATE, outItem: -1, outYield: GOLD_RATE / SOURCE_RATE, gate: 0, inputs: [{ item: ITEM_LABOR, need: GOLD_LABOR }] },
			// patch:true marks the sawmill's forest dependence — bids and scale adapt clamp against remaining forest room.
			[ECONOMY_SAWMILL]: { rate: SAWMILL_RATE, outItem: ITEM_WOOD, outYield: 1, gate: SAWMILL_GATE, patch: true, inputs: [{ item: ITEM_LABOR, need: SAWMILL_LABOR }] }
		};
	}

	sellPrice(i) {
		const m = this.model, actor = m.actors[i];
		if (actor === ECONOMY_MINE) return m.goodsPool.sellFloor[ITEM_COAL][i];
		if (actor === ECONOMY_FACTORY) return m.goodsPool.sellFloor[ITEM_GOODS][i];
		if (actor === ECONOMY_TOWN) return m.towns.restTax(i);
		if (actor === ECONOMY_FARM) return m.goodsPool.sellFloor[ITEM_FOOD][i];
		if (actor === ECONOMY_SAWMILL) return m.goodsPool.sellFloor[ITEM_WOOD][i];
		return 0;
	}

	shiftSlots(i) {
		const actor = this.model.actors[i];
		if (actor === ECONOMY_FARM) return this.model.farms.crewTarget(i);
		if (!this.recipes[actor]) return 0;
		return Math.max(1, Math.round(2 * (this.model.scale[i] || 1)));
	}

	poolSlots(i) {
		const actor = this.model.actors[i];
		if (actor === ECONOMY_FARM) return this.model.farms.crewTarget(i);
		if (!this.recipes[actor]) return 0;
		return Math.max(1, Math.ceil(1.5 + 1.5 * (this.model.scale[i] || 1)));
	}

	// Target worker presence balances standby shifts with active load; multi-input firms hold 1 standby worker until material arrives.
	firmLaborPool(i, recipe) {
		if (!recipe) return 0;
		const m = this.model;
		const scale = m.scale[i] || 1;
		const cap = this.shiftSlots(i) + this.poolSlots(i);
		let matReady = 1;
		for (let k = 0; k < recipe.inputs.length; k++) {
			const inp = recipe.inputs[k];
			if (inp.item !== ITEM_LABOR) matReady = Math.min(matReady, 0.3 + 0.7 * Math.min(1, m.stocks[inp.item][i] / 0.08));
		}
		const nominal = recipe.rate * scale * recipe.inputs[recipe.inputs.length - 1].need;
		const occRatio = Math.min(1, m.workLoad[i] / Math.max(1e-9, nominal));
		const outPrice = recipe.outItem < 0 ? 1 : (m.derived ? m.pricesAt(recipe.outItem)[i] : START_PRICE);
		const ref = Math.max(1e-12, outPrice * recipe.outYield * recipe.rate * 0.12);
		const drive = m.derived ? Math.tanh(m.profit[i] / ref) : 0;
		return Math.min(cap, Math.max(1, (2.0 * scale + 1.4 * occRatio + 0.4 * Math.max(0, drive)) * matReady));
	}

	poolTarget(i) {
		const m = this.model, actor = m.actors[i];
		if (actor === ECONOMY_TOWN) return m.towns.waitCap(i);
		if (actor === ECONOMY_FARM) return m.farms.crewTarget(i);
		return this.recipes[actor] ? this.firmLaborPool(i, this.recipes[actor]) : 0;
	}

	poolOccupancy(i) {
		const m = this.model, actor = m.actors[i];
		if (actor === ECONOMY_TOWN) {
			const cap = m.towns.waitCap(i);
			return cap > 0 ? m.waitCount[i] / cap : 0;
		}
		const pool = actor === ECONOMY_FARM ? m.farms.crewTarget(i) : this.firmLaborPool(i, this.recipes[actor]);
		return pool > 0 ? (m.shiftCount[i] + m.poolCount[i]) / pool : 0;
	}

	isHiringFirm(i) {
		const m = this.model, actor = m.actors[i], recipe = this.recipes[actor];
		if (actor === ECONOMY_FARM) return m.farms.wageBid(i) > 0 && m.shiftCount[i] + m.poolCount[i] < m.farms.crewTarget(i) + 1;
		if (!recipe || m.founding.isBuilding(i)) return false;
		const fallback = recipe.outItem === ITEM_COAL ? START_PRICE * 0.5 : START_PRICE;
		const outPrice = recipe.outItem < 0 ? 1 : (m.derived ? m.pricesAt(recipe.outItem)[i] : fallback);
		if (!m.derived && recipe.gate > 0 && outPrice <= recipe.gate) return false;
		if (recipe.outItem < 0) return true;
		const outTarget = Math.max(0.25, recipe.rate * (m.scale[i] || 1) * BUFFER_SECONDS);
		if (m.suppression && m.goodsPool.spawnAmount[recipe.outItem][i] >= outTarget) return false;
		return outPrice > 0;
	}

	firmBids(i, recipe) {
		const m = this.model;
		const { inputs, rate, outItem, outYield, gate } = recipe;
		const scale = m.scale[i] || 1;
		const fallback = outItem === ITEM_COAL ? START_PRICE * 0.5 : START_PRICE;
		const outPrice = outItem < 0 ? 1 : (m.derived ? m.pricesAt(outItem)[i] : fallback);
		this.bidOut.fill(0);
		this.maxOut.fill(0);
		if (!m.derived && gate > 0 && outPrice <= gate) return;
		const outValue = outPrice * outYield;
		if (outValue <= 0) return;
		const outTarget = Math.max(0.25, rate * scale * BUFFER_SECONDS);
		const outBuffered = outItem < 0 ? 0 : m.goodsPool.spawnAmount[outItem][i];
		let sellRoom = outItem < 0 || !m.suppression ? 1 : Math.max(0, 1 - outBuffered / outTarget);
		// Patch firms (sawmill) cannot bid past the surrounding forest: no standing timber, no hiring.
		if (recipe.patch) sellRoom = Math.min(sellRoom, m.farms.forestRoom(i));
		const ref = Math.max(1e-12, outValue * rate * 0.12);
		const drive = m.derived ? Math.tanh(m.profit[i] / ref) : 0;
		const cool = m.money.creditCool(i, INPUT_SHARE * outValue * rate * scale * PURSE_SECONDS);
		if (!Number.isFinite(cool)) return;

		let rawSum = 0;
		for (let k = 0; k < inputs.length; k++) {
			const { item, need } = inputs[k];
			let otherCost = 0;
			if (m.derived || outItem < 0) {
				for (let j = 0; j < inputs.length; j++) {
					if (j !== k) otherCost += m.pricesAt(inputs[j].item)[i] * inputs[j].need;
				}
			}
			// Fields are competing buyer bids, not binding supplier asks: never let a rival wage veto all joint bidding.
			const remain = Math.max(0, outValue - Math.min(otherCost, outValue * (1 - 1 / inputs.length)));
			const isLabor = item === ITEM_LABOR;
			const share = Math.min(0.82, Math.max(0.32, INPUT_SHARE * (1 + (isLabor ? 0.28 : 0.12) * drive)));
			const target = isLabor ? this.firmLaborPool(i, recipe) : Math.max(0.18, rate * scale * need * BUFFER_SECONDS);
			const present = isLabor ? m.shiftCount[i] + m.poolCount[i] : m.stocks[item][i] + m.goodsPool.buyerQueue[item][i];
			const roomNeed = m.suppression ? Math.max(0, 1 - present / Math.max(1e-9, target)) : 1;
			this.rawOut[k] = share * remain * sellRoom * roomNeed;
			this.maxOut[k] = m.derived ? (remain * 0.96) / need : Infinity;
			rawSum += this.rawOut[k];
		}
		const budgetCap = Math.min(0.85, Math.max(0.42, (inputs.length > 1 ? JOINT_BUDGET_SHARE : 0.82) * (1 + 0.14 * drive))) * outValue * sellRoom;
		const fit = m.derived && rawSum > budgetCap && rawSum > 0 ? budgetCap / rawSum : 1;
		for (let k = 0; k < inputs.length; k++) {
			const quantity = inputs[k].item === ITEM_LABOR ? this.firmLaborPool(i, recipe) : Math.max(0.18, rate * scale * inputs[k].need * BUFFER_SECONDS);
			const cashCap = outItem < 0 && inputs[k].item === ITEM_LABOR ? Infinity : m.money.cash(i) / (inputs.length * quantity);
			this.bidOut[k] = Math.min(cashCap, (this.rawOut[k] * fit) / (inputs[k].need * cool));
			if (this.bidOut[k] > this.maxOut[k]) this.bidOut[k] = this.maxOut[k];
		}
	}

	entryWage(i) {
		const actor = this.model.actors[i];
		if (actor === ECONOMY_FARM) return this.model.farms.wageBid(i);
		const recipe = this.recipes[actor];
		if (!recipe) return 0;
		this.firmBids(i, recipe);
		return this.bidOut[recipe.inputs.length - 1];
	}

	factoryCoalBid(i) { this.firmBids(i, this.recipes[ECONOMY_FACTORY]); return this.bidOut[0]; }
	factoryLaborBid(i) { this.firmBids(i, this.recipes[ECONOMY_FACTORY]); return this.bidOut[1]; }
	mineLaborBid(i) { this.firmBids(i, this.recipes[ECONOMY_MINE]); return this.bidOut[0]; }
	goldLaborBid(i) { this.firmBids(i, this.recipes[ECONOMY_GOLD]); return this.bidOut[0]; }
	sawmillLaborBid(i) { this.firmBids(i, this.recipes[ECONOMY_SAWMILL]); return this.bidOut[0]; }

	stepFirms() {
		const m = this.model;
		m.goodsPool.cap[ITEM_COAL].fill(0);
		m.goodsPool.cap[ITEM_GOODS].fill(0);
		// cap[ITEM_WOOD] is deliberately not zeroed here: farms/towns rewrite it every tick before goodsPool.step reads it.
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = m.actors[i];
			// Sawmill output must deplete standing forest first, so it bypasses the generic stock-converting stepFirm.
			if (a === ECONOMY_SAWMILL && !m.founding.isBuilding(i)) {
				m.farms.stepSawmill(i, this.recipes[a]);
				continue;
			}
			if (!this.recipes[a] || m.founding.isBuilding(i)) continue;
			this.stepFirm(i, this.recipes[a]);
		}
	}

	// Converts owned inputs using real shift labor from SHIFT workers, carrying exact input + wage cost into spawnCost.
	stepFirm(i, recipe) {
		const m = this.model;
		const { inputs, rate, outItem, outYield, gate } = recipe;
		const scale = m.scale[i] || 1;
		const outCap = Math.max(0.35, rate * scale * BUFFER_SECONDS * 1.5);
		let batches = rate * scale * ECONOMY_DT;
		if (outItem >= 0) batches = Math.min(batches, Math.max(0, outCap - m.goodsPool.spawnAmount[outItem][i]) / outYield);
		for (let k = 0; k < inputs.length; k++) {
			const { item, need } = inputs[k];
			const avail = item === ITEM_LABOR ? m.shiftAvail[i] : m.stocks[item][i];
			batches = Math.min(batches, avail / need);
		}
		let usedLabor = 0;
		if (batches > 1e-12) {
			let inputCost = 0;
			for (let k = 0; k < inputs.length; k++) {
				const { item, need } = inputs[k];
				const used = batches * need;
				if (item === ITEM_LABOR) {
					usedLabor = used;
					const onSiteFresh = Math.max(used, m.labor[i]);
					const share = onSiteFresh > 0 ? Math.min(1, used / onSiteFresh) : 1;
					const wageSlice = this.laborCost[i] * share;
					this.laborCost[i] = Math.max(0, this.laborCost[i] - wageSlice);
					inputCost += wageSlice;
					m.workers.applyShiftWork(i, used);
				} else {
					const stock = m.stocks[item][i];
					const costBuf = m.goodsPool.stockCost[item];
					const share = stock > 0 ? Math.min(1, used / stock) : 0;
					const usedCost = costBuf[i] * share;
					m.stocks[item][i] = Math.max(0, stock - used);
					costBuf[i] = m.stocks[item][i] > 1e-12 ? Math.max(0, costBuf[i] - usedCost) : 0;
					inputCost += usedCost;
					if (item === ITEM_COAL) m.burnedCoal += used;
				}
			}
			const made = batches * outYield;
			if (outItem < 0) {
				m.money.dig(i, made);
				m.earned[i] += (made - inputCost) / ECONOMY_DT;
			} else {
				m.goodsPool.produce(outItem, i, made, inputCost);
				if (outItem === ITEM_COAL) m.producedCoal += made;
				else m.producedGoods += made;
			}
		}
		m.workLoad[i] += this.occBlend * (usedLabor / ECONOMY_DT - m.workLoad[i]);
		this.firmBids(i, recipe);
		for (let k = 0; k < inputs.length; k++) {
			const { item, need } = inputs[k];
			if (item === ITEM_LABOR) continue;
			const stock = m.stocks[item][i];
			const target = Math.max(0.18, rate * scale * need * BUFFER_SECONDS);
			const canBuy = this.bidOut[k] > 0 && m.pricesAt(item)[i] <= this.maxOut[k];
			m.goodsPool.cap[item][i] = canBuy ? Math.max(stock, target) : stock;
		}
		if (outItem >= 0) {
			const sAmt = m.goodsPool.spawnAmount[outItem][i];
			const unitCost = sAmt > 1e-9 ? m.goodsPool.spawnCost[outItem][i] / sAmt : 0;
			m.goodsPool.sellFloor[outItem][i] = m.derived ? unitCost * (1 + SELL_MARGIN) : gate;
		}
	}

	adaptFirms() {
		const m = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = m.actors[i], recipe = this.recipes[a];
			if (!recipe || m.founding.isBuilding(i)) continue;
			m.profit[i] += this.profitBlend * (m.earned[i] - m.profit[i]);
			if (!m.derived) continue;
			const { rate, outItem, outYield } = recipe;
			const outPrice = outItem < 0 ? 1 : m.pricesAt(outItem)[i];
			const outValue = outPrice * outYield;
			const ref = Math.max(1e-12, outValue * rate * 0.12);
			const drive = Math.tanh(m.profit[i] / ref);
		const outStock = outItem < 0 ? 0 : m.goodsPool.spawnAmount[outItem][i];
		const outTarget = Math.max(0.25, rate * m.scale[i] * BUFFER_SECONDS);
		let sellRoom = outItem < 0 ? 1 : Math.max(0, 1 - outStock / outTarget);
		// Patch firms (sawmill) also refuse to rescale up without forest room.
		if (recipe.patch) sellRoom = Math.min(sellRoom, m.farms.forestRoom(i));
			const solvent = m.money.wageDebt(i) <= m.money.cash(i) + Math.max(0.25, outValue * rate * 2.5);
			if (drive > 0.02 && solvent && sellRoom > 0.2) {
				m.scale[i] = Math.min(SCALE_MAX, m.scale[i] + ECONOMY_DT * SCALE_UP * drive * sellRoom);
			} else if (drive < -0.02 || !solvent || (outStock > 0.25 && sellRoom < 0.15)) {
				m.scale[i] = Math.max(SCALE_MIN, m.scale[i] - ECONOMY_DT * SCALE_DOWN * Math.max(0.15, -drive));
			}
		}
	}
}

if (typeof module === 'object') module.exports = { ActorOptimizer, SELL_MARGIN, JOINT_BUDGET_SHARE };
