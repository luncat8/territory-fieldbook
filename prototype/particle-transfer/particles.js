// Owns: preallocated SoA goods particles, spawn accumulators, haul-cost accrual, spoilage and buyer arrival split.
// Edit for: batch sizing (SPAWN_UNIT), haul cost, underwater consignment/spot-sell and room admission. Steering: steering.js.
'use strict';

const GOODS_KINDS = 2;
const PARTICLE_CAP = 4096;
const SPAWN_UNIT = 0.08;
const IDLE_FLUSH_SECONDS = 2.5;
const PARTICLE_SPEED = 6;
const HAUL_COST_RATE = 0.024;
const HAUL_PER_CELL = HAUL_COST_RATE / PARTICLE_SPEED;
const DUST_FLOOR = 1e-12;

class GoodsParticles {
	constructor(model) {
		this.model = model;
		this.kind = new Uint8Array(PARTICLE_CAP);
		this.owner = new Int32Array(PARTICLE_CAP);
		this.x = new Float64Array(PARTICLE_CAP);
		this.y = new Float64Array(PARTICLE_CAP);
		this.vx = new Float64Array(PARTICLE_CAP);
		this.vy = new Float64Array(PARTICLE_CAP);
		this.amount = new Float64Array(PARTICLE_CAP);
		this.factoryCost = new Float64Array(PARTICLE_CAP);
		this.transportCost = new Float64Array(PARTICLE_CAP);
		this.arriveCell = new Int32Array(PARTICLE_CAP);
		this.count = 0;

		this.spoilRate = new Float64Array(GOODS_KINDS);
		this.spoiled = new Float64Array(GOODS_KINDS);
		this.buyers = new Uint8Array(GOODS_KINDS);
		this.buyers[ITEM_COAL] = (1 << ECONOMY_FACTORY) | (1 << ECONOMY_TOWN);
		this.buyers[ITEM_GOODS] = 1 << ECONOMY_TOWN;

		this.spawnAmount = new Float64Array(GOODS_KINDS * ECONOMY_SIZE);
		this.spawnCost = new Float64Array(GOODS_KINDS * ECONOMY_SIZE);
		this.spawnIdle = new Float64Array(GOODS_KINDS * ECONOMY_SIZE);
		this.cap = new Float64Array(GOODS_KINDS * ECONOMY_SIZE);
		this.sell = new Float64Array(GOODS_KINDS * ECONOMY_SIZE);
		this.room = new Float64Array(ECONOMY_SIZE);
		this.wantBuy = new Float64Array(ECONOMY_SIZE);
		this.flowX = new Float64Array(GOODS_KINDS * ECONOMY_SIZE);
		this.flowY = new Float64Array(GOODS_KINDS * ECONOMY_SIZE);
		this.steer = new ParticleSteering(model);
		this.reset();
	}

	reset() {
		this.count = 0;
		this.spoiled.fill(0);
		this.spawnAmount.fill(0);
		this.spawnCost.fill(0);
		this.spawnIdle.fill(0);
		this.cap.fill(1);
		this.sell.fill(0);
		this.flowX.fill(0);
		this.flowY.fill(0);
		this.deliveries = 0;
		this.realizedProfit = 0;
		this.lastBuyerPay = this.lastTransportPaid = this.lastFactoryRevenue = 0;
		this.lastFactoryCost = this.lastTransportCost = this.lastProfit = 0;
	}

	prepareStep() {
		this.cap.fill(1);
		this.sell.fill(0);
		this.flowX.fill(0);
		this.flowY.fill(0);
	}

	clearSell(i) {
		this.sell[i] = 0;
		this.sell[ECONOMY_SIZE + i] = 0;
	}

	setCap(k, i, value) {
		this.cap[k * ECONOMY_SIZE + i] = value;
	}

	setSell(k, i, value) {
		this.sell[k * ECONOMY_SIZE + i] = value;
	}

	sellAt(k, i) {
		return this.sell[k * ECONOMY_SIZE + i];
	}

	spawnAt(k, i) {
		return this.spawnAmount[k * ECONOMY_SIZE + i];
	}

	spawnCostAt(k, i) {
		return this.spawnCost[k * ECONOMY_SIZE + i];
	}

	spawnTotal(k) {
		const off = k * ECONOMY_SIZE;
		let sum = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) sum += this.spawnAmount[off + i];
		return sum;
	}

	inFlightTotal(k) {
		let sum = 0;
		for (let p = 0; p < this.count; p++) {
			if (this.kind[p] === k) sum += this.amount[p];
		}
		return sum;
	}

	inFlightAt(k, i) {
		let sum = 0;
		for (let p = 0; p < this.count; p++) {
			if (this.kind[p] !== k) continue;
			if (economyIndex(Math.round(this.x[p]), Math.round(this.y[p])) === i) sum += this.amount[p];
		}
		return sum;
	}

	priceOf(p) {
		return (this.factoryCost[p] + this.transportCost[p]) / this.amount[p];
	}

	accumulate(k, i, made, cost) {
		if (made <= 0) return 0;
		const idx = k * ECONOMY_SIZE + i;
		const before = this.spawnAmount[idx];
		const after = before + made;
		this.spawnAmount[idx] = after;
		this.spawnCost[idx] += cost;
		this.spawnIdle[idx] = 0;
		return after - before;
	}

	emit(k, i, amount, factoryCost, owner = i, vx = 0, vy = 0) {
		if (amount <= 0 || this.count >= PARTICLE_CAP) return -1;
		const p = this.count++;
		this.kind[p] = k;
		this.owner[p] = owner;
		this.x[p] = i % ECONOMY_WIDTH;
		this.y[p] = Math.floor(i / ECONOMY_WIDTH);
		this.vx[p] = vx;
		this.vy[p] = vy;
		this.amount[p] = amount;
		this.factoryCost[p] = factoryCost;
		this.transportCost[p] = 0;
		this.arriveCell[p] = -1;
		return p;
	}

	removeAt(p) {
		const last = --this.count;
		if (p === last) return;
		this.kind[p] = this.kind[last];
		this.owner[p] = this.owner[last];
		this.x[p] = this.x[last];
		this.y[p] = this.y[last];
		this.vx[p] = this.vx[last];
		this.vy[p] = this.vy[last];
		this.amount[p] = this.amount[last];
		this.factoryCost[p] = this.factoryCost[last];
		this.transportCost[p] = this.transportCost[last];
		this.arriveCell[p] = this.arriveCell[last];
	}

	step() {
		this.spawnKind(ITEM_COAL, this.model.priceCoal);
		this.spawnKind(ITEM_GOODS, this.model.priceGoods);
		this.advanceAll();
		this.admitKind(ITEM_COAL);
		this.admitKind(ITEM_GOODS);
		this.compact();
	}

	// Accumulators hold fractional output until SPAWN_UNIT (or idle flush) and launch only above cost-basis selfPrice.
	spawnKind(k, price) {
		const off = k * ECONOMY_SIZE;
		const gate = k === ITEM_COAL ? PRICE_GATE : 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const idx = off + i;
			const amt = this.spawnAmount[idx];
			if (amt <= DUST_FLOOR) continue;
			this.spawnIdle[idx] += ECONOMY_DT;
			const unitCost = this.spawnCost[idx] / amt;
			const floor = this.model.derived ? Math.max(gate, unitCost * (1 + SELL_MARGIN)) : gate;
			this.sell[idx] = floor;
			const readyBatch = amt >= SPAWN_UNIT;
			const readyFlush = this.spawnIdle[idx] >= IDLE_FLUSH_SECONDS;
			if (!readyBatch && !readyFlush) continue;
			const minThere = Math.max(price[i], floor);
			if (!this.steer.sampleGradient(price, null, 0, i, minThere + 1e-12)) continue;
			if (this.count >= PARTICLE_CAP) return;

			let emit, emitCost;
			if (!readyBatch || amt - SPAWN_UNIT <= DUST_FLOOR) {
				emit = amt;
				emitCost = this.spawnCost[idx];
				this.spawnAmount[idx] = 0;
				this.spawnCost[idx] = 0;
			} else {
				const after = amt - SPAWN_UNIT;
				emit = amt - after;
				emitCost = this.spawnCost[idx] * (emit / amt);
				this.spawnAmount[idx] = after;
				this.spawnCost[idx] = Math.max(0, this.spawnCost[idx] - emitCost);
			}
			this.emit(k, i, emit, emitCost, i, PARTICLE_SPEED * this.steer.grad[0], PARTICLE_SPEED * this.steer.grad[1]);
		}
	}

	advanceAll() {
		const m = this.model, steer = this.steer;
		for (let p = 0; p < this.count; p++) {
			this.arriveCell[p] = -1;
			const k = this.kind[p];
			if (this.spoilParticle(p, k)) continue;
			const cx = Math.round(this.x[p]), cy = Math.round(this.y[p]);
			const ci = economyIndex(cx, cy);
			const price = m.pricesAt(k);
			const ask = this.priceOf(p);
			if (!steer.hasHigherNeighbor(price, null, 0, ci)) {
				this.stepAtPeak(p, k, ci, cx, cy, price[ci], ask);
				continue;
			}
			const minThere = steer.hasNeighborClearing(price, ci, ask) ? ask : -Infinity;
			if (!steer.sampleGradient(price, null, 0, ci, minThere)) {
				this.vx[p] = this.vy[p] = 0;
				continue;
			}
			const ds = steer.advance(this, p, PARTICLE_SPEED);
			if (ds <= 0) continue;
			const c = steer.edgeConductance(ci, steer.toCell);
			if (c > 0) this.transportCost[p] += HAUL_PER_CELL * (ds / c) * this.amount[p];
			const fIdx = k * ECONOMY_SIZE + ci;
			this.flowX[fIdx] += this.vx[p] * this.amount[p];
			this.flowY[fIdx] += this.vy[p] * this.amount[p];
		}
	}

	spoilParticle(p, k) {
		const rate = this.spoilRate[k];
		if (rate <= 0) return false;
		const before = this.amount[p];
		const after = before * Math.exp(-rate * ECONOMY_DT);
		if (after <= DUST_FLOOR) {
			this.spoiled[k] += before;
			this.amount[p] = 0;
			const owner = this.owner[p];
			const loss = -this.factoryCost[p];
			if (this.model.isProducer(owner)) this.model.earned[owner] += loss / ECONOMY_DT;
			this.lastProfit = loss;
			this.realizedProfit += loss;
			return true;
		}
		this.amount[p] = after;
		this.spoiled[k] += before - after;
		return false;
	}

	// Buyer holds apply only at local price maxima: non-perishables wait in consignment at the dock if underwater; perishables spot-sell.
	stepAtPeak(p, k, ci, cx, cy, here, ask) {
		const m = this.model;
		const stock = m.stocks[k];
		const isBuyer = (this.buyers[k] & (1 << m.actors[ci])) !== 0;
		if (!isBuyer) {
			this.vx[p] = this.vy[p] = 0;
			return;
		}
		const px = this.x[p], py = this.y[p];
		const dist = Math.hypot(cx - px, cy - py);
		const c = TERRAIN_SPEED[m.land.terrain[ci]];
		const maxStep = PARTICLE_SPEED * c * ECONOMY_DT;
		if (dist > maxStep) {
			const ux = (cx - px) / dist, uy = (cy - py) / dist;
			this.vx[p] = ux * PARTICLE_SPEED * c;
			this.vy[p] = uy * PARTICLE_SPEED * c;
			this.x[p] = px + ux * maxStep;
			this.y[p] = py + uy * maxStep;
			if (c > 0) this.transportCost[p] += HAUL_PER_CELL * (maxStep / c) * this.amount[p];
			return;
		}
		if (dist > 0) {
			this.x[p] = cx;
			this.y[p] = cy;
			if (c > 0) this.transportCost[p] += HAUL_PER_CELL * (dist / c) * this.amount[p];
		}
		this.vx[p] = this.vy[p] = 0;
		const hasRoom = this.cap[k * ECONOMY_SIZE + ci] - stock[ci] > DUST_FLOOR;
		if (hasRoom && (here >= this.priceOf(p) || this.spoilRate[k] > 0)) this.arriveCell[p] = ci;
	}

	// Normalized room admission prevents buyer overflow; arrival split credits Transport Company first, then owner.
	admitKind(k) {
		const m = this.model;
		const stock = m.stocks[k];
		const costBuf = m.itemCosts[k];
		const price = m.pricesAt(k);
		const capOff = k * ECONOMY_SIZE;
		this.wantBuy.fill(0);
		let any = false;
		for (let p = 0; p < this.count; p++) {
			const b = this.arriveCell[p];
			if (this.kind[p] === k && b >= 0 && this.amount[p] > 0) {
				this.wantBuy[b] += this.amount[p];
				any = true;
			}
		}
		if (!any) return;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const want = this.wantBuy[i];
			if (want > 0) this.room[i] = Math.min(1, Math.max(0, this.cap[capOff + i] - stock[i]) / want);
		}
		for (let p = 0; p < this.count; p++) {
			const b = this.arriveCell[p];
			if (this.kind[p] !== k || b < 0 || this.amount[p] <= 0) continue;
			const share = this.room[b];
			if (share <= 0) continue;
			const beforeAmt = this.amount[p];
			let accepted, accFactory, accTransport;
			if (share >= 1 - 1e-12) {
				accepted = beforeAmt;
				accFactory = this.factoryCost[p];
				accTransport = this.transportCost[p];
				this.amount[p] = this.factoryCost[p] = this.transportCost[p] = 0;
			} else {
				const afterAmt = beforeAmt - beforeAmt * share;
				accepted = beforeAmt - afterAmt;
				const ratio = accepted / beforeAmt;
				accFactory = this.factoryCost[p] * ratio;
				accTransport = this.transportCost[p] * ratio;
				this.amount[p] = afterAmt;
				this.factoryCost[p] = Math.max(0, this.factoryCost[p] - accFactory);
				this.transportCost[p] = Math.max(0, this.transportCost[p] - accTransport);
			}
			stock[b] += accepted;
			const buyerPay = accepted * price[b];
			costBuf[b] += buyerPay;
			const transportPaid = Math.min(buyerPay, accTransport);
			const factoryRevenue = buyerPay - transportPaid;
			const profit = factoryRevenue - accFactory;
			const owner = this.owner[p];
			m.money.payArrival(b, owner, transportPaid, factoryRevenue);
			if (m.isProducer(owner)) m.earned[owner] += profit / ECONOMY_DT;
			this.lastBuyerPay = buyerPay;
			this.lastTransportPaid = transportPaid;
			this.lastFactoryRevenue = factoryRevenue;
			this.lastFactoryCost = accFactory;
			this.lastTransportCost = accTransport;
			this.lastProfit = profit;
			this.deliveries++;
			this.realizedProfit += profit;
		}
	}

	compact() {
		let p = 0;
		while (p < this.count) {
			if (this.amount[p] <= 0) this.removeAt(p);
			else p++;
		}
	}
}

if (typeof module === 'object') module.exports = { GoodsParticles, SPAWN_UNIT, PARTICLE_SPEED, HAUL_COST_RATE };
