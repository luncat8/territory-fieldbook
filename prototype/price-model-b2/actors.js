// Owns: universal actor recipes, buy/sell pricing, worker/living wait pools, tier-scaled town taxes and paid rest.
// Edit for: firm recipes, pool-occupancy hire demand, wait-pool living taxes and worker wallet cycle. Home appeal: workforce.js.
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
const NEED_FLOOR = 0.25;      // comfort floor a rich town keeps before cutting size

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

	// Towns hold no managed wait pool: only firms size one. Towns rest and tax; tired workers arrive,
	// rest while the town can serve them and leave by the home gradient.
	poolTarget(i) {
		const actor = this.model.actors[i];
		return actor && actor !== ECONOMY_TOWN ? this.firmLaborPool(i, this.recipes[actor]) : 0;
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

	// Storage is sized for the town's rooms (housing cap), not for whoever is home: the people cycle
	// between home and work, so present-pop sizing would collapse buffers below one batch while the
	// workforce is out. Consumption still follows who is present.
	townPopPlan(i) {
		return this.model.settlements.popCap(i);
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

	// Housing crowding only: full housing raises the living tax. Towns hold no wait pool, so a pile
	// of resting or passing workers never taxes the residents.
	townCrowdMult(i) {
		const m = this.model;
		if (!m.derived || m.pop[i] <= 0) return 1;
		const popFull = Math.max(0, m.pop[i] / m.settlements.popCap(i) - 0.8) / 0.2;
		return 1 + 0.35 * popFull * popFull;
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

		m.satCoal[i] += this.satBlend * ((wantCoal > 0 ? usedCoal / wantCoal : 0) - m.satCoal[i]);
		m.satGoods[i] += this.satBlend * ((wantGoods > 0 ? usedGoods / wantGoods : 0) - m.satGoods[i]);
		const comfort = COAL_COMFORT * m.satCoal[i] + GOODS_COMFORT * m.satGoods[i];
		const workCap = Math.min(1, pop * LABOR_PER_POP * BUFFER_SECONDS, 1 - m.depleted[i]);

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

		// Population is the residents' own affair, never a town headcount target: fed and solvent
		// people split (each birth books the child's fresh capacity as granted supply), and a town in
		// famine thins after hunger persists (the lost people's mass books as starved on both sides).
		// The town's only lever is pricing the room — tax — never spawning, shedding or steering anyone.
		const cap = m.settlements.popCap(i);
		// Enough money means the household purse still backs a starter purse per person: a town that
		// taxes its residents below that line has people who cannot afford to split.
		const perCapita = m.money.workerPurse[i] / Math.max(1e-9, pop);
		const fed = comfort >= BIRTH_COMFORT && perCapita >= START_TAX_PER_POP * WORKER_SECONDS;
		// A split needs somewhere to stand: births clip to the home cell's labor room, or the flow
		// engine would silently clamp the overflow and break the mass ledger.
		const room = Math.max(0, 1 - m.labor[i]);
		const birth = fed ? Math.min(cap - pop, ECONOMY_DT * POP_RATE * pop, room / LABOR_PER_POP) : 0;
		if (birth > 0) {
			m.pop[i] = pop + birth;
			const born = birth * LABOR_PER_POP;
			m.labor[i] += born;
			m.suppliedLabor += born;
			m.births += birth;
		}
		m.famineSeconds[i] = comfort <= FAMINE_COMFORT ? m.famineSeconds[i] + ECONOMY_DT : 0;
		if (m.famineSeconds[i] >= FAMINE_SECONDS && pop > 0) {
			const loss = Math.min(pop, ECONOMY_DT * POP_RATE * pop * 2);
			const mass = loss * LABOR_PER_POP;
			const fromLabor = Math.min(m.labor[i], mass);
			const fromDepleted = Math.min(m.depleted[i], mass - fromLabor);
			// The dead take their pool backing with them and the town inherits it: removing mass without
			// its gold would leave unbacked pool gold behind.
			const laborGold = m.labor[i] > 1e-12 ? m.laborFlow.gold[i] * (fromLabor / m.labor[i]) : 0;
			const depletedGold = m.depleted[i] > 1e-12 ? m.depletedFlow.gold[i] * (fromDepleted / m.depleted[i]) : 0;
			m.labor[i] -= fromLabor;
			m.depleted[i] -= fromDepleted;
			m.laborFlow.gold[i] = Math.max(0, m.laborFlow.gold[i] - laborGold);
			m.depletedFlow.gold[i] = Math.max(0, m.depletedFlow.gold[i] - depletedGold);
			m.money.workerPurse[i] += laborGold + depletedGold;
			m.starvedLabor += fromLabor;
			m.starvedTired += fromDepleted;
			m.starved += loss;
			m.pop[i] = pop - loss;
		}

		const tax = this.townTaxRate(i);
		const ceiling = m.settlements.bidFactor(i) * 0.96;
		const maxCoal = m.derived ? (COAL_COMFORT / TOWN_COAL_NEED) * tax * ceiling : Infinity;
		const maxGoods = m.derived ? (GOODS_COMFORT / TOWN_GOODS_NEED) * tax * ceiling : Infinity;
		m.coalFlow.cap[i] = this.townCoalBid(i) > 0 && m.priceCoal[i] <= maxCoal ? Math.max(m.coal[i], this.townCoalTarget(i)) : m.coal[i];
		m.goodsFlow.cap[i] = this.townGoodsBid(i) > 0 && m.priceGoods[i] <= maxGoods ? Math.max(m.goods[i], this.townGoodsTarget(i)) : m.goods[i];
		// Towns manage no wait pool: room is the plain cell bound while the town can actually serve
		// (comfort from real supplies). An unsupplied town rests nobody and holds nobody — tired
		// workers pass through toward towns that can feed them instead of starving in place.
		m.depletedFlow.cap[i] = comfort > 0.05 ? 1 : 0;
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
		const occ = cap > 1e-9 ? pop / cap : 0;
		const housingFree = Math.max(0, 1 - occ);
		const cCoal = m.coal[i] > 1e-6 ? m.unitCostAt(ITEM_COAL, i) : m.priceCoal[i];
		const cGoods = m.goods[i] > 1e-6 ? m.unitCostAt(ITEM_GOODS, i) : m.priceGoods[i];
		const rationCost = TOWN_COAL_NEED * m.satCoal[i] * cCoal + TOWN_GOODS_NEED * m.satGoods[i] * cGoods;
		const workerGold = m.money.workerPurse[i] + m.workerGoldAt(i);
		const baseTax = (workerGold / WORKER_SECONDS) / pop;
		const minProfitTax = baseTax > 1e-9 && comfort > 0.05 ? (rationCost * 1.12) / (baseTax * Math.max(0.25, comfort)) : TAX_MIN;
		const popFull = Math.max(0, occ - 0.8) / 0.2;
		const crowdPush = POP_FULL_TAX * popFull * popFull;

		// Town wealth class decides how taxes react to full vs vacant housing (draft "town wealth class").
		let target;
		if (cls === WEALTH_CHEAP) {
			// Cheap (poor-worker) towns: drop tax to fill vacant slots, even if they cannot yet buy every resource.
			if (housingFree > 0.01) {
				target = Math.max(TAX_MIN, minProfitTax * 0.6, 1 - 0.5 * housingFree) + crowdPush * 0.3;
			} else {
				target = Math.max(TAX_MIN, minProfitTax, 1) + crowdPush * 0.5;
			}
		} else if (cls === WEALTH_RICH) {
			// Rich towns: hold a cozy occupancy — raise tax when housing overfills, ease it to refill free slots.
			if (occ > RICH_OCC) {
				target = Math.max(TAX_MIN, minProfitTax, 1 + 0.4 * (occ - RICH_OCC) / 0.2 + 0.15 * comfort) + crowdPush;
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

if (typeof module === 'object') module.exports = { ActorOptimizer };
