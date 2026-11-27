// Owns: the SoA goods particle pool, producer spawn accumulators, buyer room admission, arrival gold split and spoilage.
// Edit for: batch spawn size, haul cost rate, spoilage rates, consignment hold and underwater spot sales.
'use strict';

const MAX_GOODS_PARTICLES = 2048;
const SPAWN_UNIT = 0.08;
const SPAWN_DUST = 0.008;
const SPAWN_FLUSH_TICKS = 150;
const HAUL_COST_RATE = 0.032;
const CONSIGN_WAIT_TICKS = 180;
const SPOIL_COAL = 0;
const SPOIL_GOODS = 0.0035;
const COST_RELAX = 0.06;

class GoodsPool {
	constructor(model) {
		this.model = model;
		this.count = 0;
		this.kind = new Uint8Array(MAX_GOODS_PARTICLES);
		this.x = new Float64Array(MAX_GOODS_PARTICLES);
		this.y = new Float64Array(MAX_GOODS_PARTICLES);
		this.hx = new Float64Array(MAX_GOODS_PARTICLES);
		this.hy = new Float64Array(MAX_GOODS_PARTICLES);
		this.amount = new Float64Array(MAX_GOODS_PARTICLES);
		this.factoryCost = new Float64Array(MAX_GOODS_PARTICLES);
		this.transportCost = new Float64Array(MAX_GOODS_PARTICLES);
		this.owner = new Int32Array(MAX_GOODS_PARTICLES);
		this.facility = new Int32Array(MAX_GOODS_PARTICLES);
		this.waitTicks = new Uint16Array(MAX_GOODS_PARTICLES);
		this.arriving = new Uint8Array(MAX_GOODS_PARTICLES);
		this.spawnAmount = Array.from({ length: 6 }, () => new Float64Array(ECONOMY_SIZE));
		this.spawnCost = Array.from({ length: 6 }, () => new Float64Array(ECONOMY_SIZE));
		this.spawnIdle = Array.from({ length: 6 }, () => new Uint16Array(ECONOMY_SIZE));
		this.stockCost = Array.from({ length: 6 }, () => new Float64Array(ECONOMY_SIZE));
		this.cap = Array.from({ length: 6 }, () => new Float64Array(ECONOMY_SIZE));
		this.sellFloor = Array.from({ length: 6 }, () => new Float64Array(ECONOMY_SIZE));
		this.buyerQueue = Array.from({ length: 6 }, () => new Float64Array(ECONOMY_SIZE));
		this.incoming = new Float64Array(ECONOMY_SIZE);
		this.room = new Float64Array(ECONOMY_SIZE);
		this.accept = new Float64Array(ECONOMY_SIZE);
		this.spoiled = new Float64Array(6);
		this.writtenDown = new Float64Array(6);
		this.spoilShare = [0, 1 - Math.exp(-ECONOMY_DT * SPOIL_GOODS), 0, 0, 1 - Math.exp(-ECONOMY_DT * 0.012), 0];
		this.queueBlend = 1 - Math.exp(-ECONOMY_DT * 3);
		this.maxProfitError = 0;
		this.arrivals = 0;
		this.underwaterLosses = 0;
	}

	reset() {
		this.count = 0;
		for (const k of GOODS_ITEMS) {
			this.spawnAmount[k].fill(0);
			this.spawnCost[k].fill(0);
			this.spawnIdle[k].fill(0);
			this.stockCost[k].fill(0);
			this.cap[k].fill(0);
			this.sellFloor[k].fill(0);
			this.buyerQueue[k].fill(0);
			this.spoiled[k] = this.writtenDown[k] = 0;
		}
		this.maxProfitError = 0;
		this.arrivals = 0;
		this.underwaterLosses = 0;
	}

	produce(kind, cell, made, cost) {
		if (made <= 0) return;
		this.spawnAmount[kind][cell] += made;
		this.spawnCost[kind][cell] += cost;
		this.spawnIdle[kind][cell] = 0;
	}

	flushOwner(cell) {
		for (const k of GOODS_ITEMS) {
			const rem = this.spawnAmount[k][cell];
			if (rem > 1e-12) this.emit(k, cell, rem, this.spawnCost[k][cell]);
			else if (rem > 0) this.spoiled[k] += rem;
			this.spawnAmount[k][cell] = 0;
			this.spawnCost[k][cell] = 0;
			this.spawnIdle[k][cell] = 0;
		}
		if (this.model.coal[cell] > 0) this.spoiled[0] += this.model.coal[cell];
		if (this.model.goods[cell] > 0) this.spoiled[1] += this.model.goods[cell];
		this.spoiled[ITEM_FOOD] += this.model.food[cell];
		this.spoiled[ITEM_WOOD] += this.model.wood[cell];
	}

	emit(kind, cell, amt, cost, source = cell) {
		if (this.count >= MAX_GOODS_PARTICLES || amt <= 1e-12) {
			this.spoiled[kind] += amt;
			return false;
		}
		const idx = this.count++;
		this.kind[idx] = kind;
		this.x[idx] = (cell % ECONOMY_WIDTH) + 0.5;
		this.y[idx] = Math.floor(cell / ECONOMY_WIDTH) + 0.5;
		this.hx[idx] = 0;
		this.hy[idx] = 0;
		this.amount[idx] = amt;
		this.factoryCost[idx] = cost;
		this.transportCost[idx] = 0;
		this.owner[idx] = this.model.owners.ownerAt(source);
		this.facility[idx] = this.model.owners.cell[source];
		this.waitTicks[idx] = 0;
		this.arriving[idx] = 0;
		return true;
	}

	removeAt(idx) {
		const last = --this.count;
		if (idx === last) return;
		this.kind[idx] = this.kind[last];
		this.x[idx] = this.x[last];
		this.y[idx] = this.y[last];
		this.hx[idx] = this.hx[last];
		this.hy[idx] = this.hy[last];
		this.amount[idx] = this.amount[last];
		this.factoryCost[idx] = this.factoryCost[last];
		this.transportCost[idx] = this.transportCost[last];
		this.owner[idx] = this.owner[last];
		this.facility[idx] = this.facility[last];
		this.waitTicks[idx] = this.waitTicks[last];
		this.arriving[idx] = this.arriving[last];
	}

	unitPrice(idx) {
		const amt = this.amount[idx];
		return amt > 1e-12 ? (this.factoryCost[idx] + this.transportCost[idx]) / amt : 0;
	}

	isBuyer(kind, cell) {
		const a = this.model.actors[cell];
		if (!a) return false;
		// Wood is checked before the isBuilding guard: a farm mid-construction must still receive wood.
		if (kind === ITEM_WOOD) return a === ECONOMY_TOWN || a === ECONOMY_FARM || a === ECONOMY_GOLD;
		if (this.model.founding.isBuilding(cell)) return false;
		return kind === ITEM_COAL ? a === ECONOMY_FACTORY || a === ECONOMY_TOWN : a === ECONOMY_TOWN;
	}

	inTransitTotal(kind) {
		let sum = 0;
		for (let i = 0; i < this.count; i++) {
			if (this.kind[i] === kind) sum += this.amount[i];
		}
		return sum;
	}

	spawnBufferTotal(kind) {
		const buf = this.spawnAmount[kind];
		let sum = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) sum += buf[i];
		return sum;
	}

	// Emits a batch once accumulated stock reaches SPAWN_UNIT (or flushes idle partial batches) when uphill price clears sellFloor.
	stepSpawn() {
		const { steering } = this.model;
		for (const k of GOODS_ITEMS) {
			const price = this.model.pricesAt(k);
			let demand = false;
			for (let i = 0; i < ECONOMY_SIZE; i++) if (price[i] > 0) { demand = true; break; }
			if (!demand) continue;
			const sAmt = this.spawnAmount[k], sCost = this.spawnCost[k], sIdle = this.spawnIdle[k];
			for (let i = 0; i < ECONOMY_SIZE; i++) {
				const avail = sAmt[i];
				if (avail <= 1e-12) continue;
				if (sIdle[i] < 60000) sIdle[i]++;
				const unitCost = sCost[i] / avail;
				const gate = k === ITEM_WOOD ? SAWMILL_GATE : k === ITEM_COAL ? PRICE_GATE : 0;
				const floor = this.model.derived ? unitCost * (1 + SELL_MARGIN) : gate;
				this.sellFloor[k][i] = floor;
				const batch = avail >= SPAWN_UNIT ? SPAWN_UNIT : avail >= SPAWN_DUST && sIdle[i] >= SPAWN_FLUSH_TICKS ? avail : 0;
				if (batch <= 0 || this.count >= MAX_GOODS_PARTICLES) continue;
				if (steering.sampleField(price, null, 0, i, floor) <= 0) {
					// No road pays this batch's floor: relax the book toward the best price the road can see, so
					// inventory that outran its buyers cannot wedge the site's buffers forever.
					// Accounting only — no gold moves, conservation is untouched.
					let best = price[i];
					const base = i * DEGREE;
					for (let k = 0; k < DEGREE; k++) {
						const to = NEIGHBORS[base + k];
						if (to >= 0 && price[to] > best) best = price[to];
					}
					const over = unitCost - Math.min(unitCost, best);
					if (over > 0) {
						const loss = over * (1 - Math.exp(-COST_RELAX * ECONOMY_DT)) * avail;
						sCost[i] -= loss;
						this.writtenDown[k] += loss;
					}
					continue;
				}
				const share = Math.min(1, batch / avail);
				const batchCost = sCost[i] * share;
				sAmt[i] = Math.max(0, avail - batch);
				sCost[i] = sAmt[i] > 1e-12 ? Math.max(0, sCost[i] - batchCost) : 0;
				if (sAmt[i] <= 1e-12) {
					this.spoiled[k] += sAmt[i];
					sAmt[i] = 0;
					sCost[i] = 0;
				}
				this.emit(k, i, batch, batchCost);
			}
		}
	}

	step() {
		this.stepSpawn();
		this.stepMove();
		this.admitKind(ITEM_COAL);
		this.admitKind(ITEM_GOODS);
		this.admitKind(ITEM_FOOD);
		this.admitKind(ITEM_WOOD);
	}

	// Moves particles uphill, accrues haul cost on effort, handles underwater re-steering/consignment and flags buyer arrivals.
	stepMove() {
		const { steering } = this.model;
		let p = 0;
		while (p < this.count) {
			const k = this.kind[p];
			const share = this.spoilShare[k];
			if (share > 0) {
				const lost = this.amount[p] * share;
				this.amount[p] -= lost;
				this.spoiled[k] += lost;
			}
			if (this.amount[p] <= 1e-11) {
				this.spoiled[k] += Math.max(0, this.amount[p]);
				this.removeAt(p);
				continue;
			}
			this.arriving[p] = 0;
			const cell = economyIndex(Math.floor(this.x[p]), Math.floor(this.y[p]));
			const priceField = this.model.pricesAt(k);
			const ask = this.model.derived ? this.unitPrice(p) : 0;
			if (this.isBuyer(k, cell)) {
				const bid = priceField[cell];
				const hasRoom = this.cap[k][cell] - this.model.stocks[k][cell] > 1e-9 && this.model.money.cash(cell) > 1e-9;
				if (hasRoom && bid + 1e-6 >= ask) {
					this.arriving[p] = 1;
					this.waitTicks[p] = 0;
					p++;
					continue;
				}
				if (steering.sampleField(priceField, null, 0, cell, ask) > 0) {
					this.moveParticle(p);
					p++;
					continue;
				}
				// At a local maximum while underwater: relax the in-flight book toward the best price the road can see so hauled cost that outran its buyers unwedges instead of parking forever (mirrors stepSpawn's COST_RELAX; accounting only, no gold moves).
				if (this.waitTicks[p] < 60000) this.waitTicks[p]++;
				let best = priceField[cell];
				const nBase = cell * DEGREE;
				for (let d = 0; d < DEGREE; d++) {
					const to = NEIGHBORS[nBase + d];
					if (to >= 0 && priceField[to] > best) best = priceField[to];
				}
				const unitCost = this.unitPrice(p);
				const over = unitCost - Math.min(unitCost, best);
				if (over > 0) {
					const loss = over * (1 - Math.exp(-COST_RELAX * ECONOMY_DT)) * this.amount[p];
					let rem = loss;
					const tr = this.transportCost[p];
					const trTake = Math.min(tr, rem);
					this.transportCost[p] = Math.max(0, tr - trTake);
					rem -= trTake;
					const fc = this.factoryCost[p];
					const fcTake = Math.min(fc, rem);
					this.factoryCost[p] = Math.max(0, fc - fcTake);
					this.writtenDown[k] += trTake + fcTake;
				}
				// Coal never consigns; perishable goods spot-sell below cost before rotting.
				if (k !== ITEM_COAL && hasRoom && bid > 0 && this.waitTicks[p] >= CONSIGN_WAIT_TICKS) {
					this.arriving[p] = 1;
				}
				this.hx[p] = 0;
				this.hy[p] = 0;
				p++;
				continue;
			}
			steering.sampleField(priceField, null, 0, cell, 0);
			if (steering.grad.bestSlope > 0) this.moveParticle(p);
			else {
				this.hx[p] = 0;
				this.hy[p] = 0;
			}
			p++;
		}
	}

	moveParticle(p) {
		const { steering } = this.model;
		if (!steering.advance(this.x[p], this.y[p], this.hx[p], this.hy[p], GOODS_SPEED)) return;
		this.x[p] = steering.out.x;
		this.y[p] = steering.out.y;
		this.hx[p] = steering.out.hx;
		this.hy[p] = steering.out.hy;
		if (this.model.decay) this.transportCost[p] += HAUL_COST_RATE * this.model.pricesAt(this.kind[p])[steering.out.cell] * this.amount[p] * steering.out.effort;
		this.waitTicks[p] = 0;
	}

	// Normalized buyer room + cash admission splits buyerPay across the Transport Company account and owner purse with exact conservation.
	admitKind(kind) {
		const { stocks, money } = this.model;
		const stock = stocks[kind], priceField = this.model.pricesAt(kind);
		const cap = this.cap[kind], queue = this.buyerQueue[kind], costBuf = this.stockCost[kind];
		const inc = this.incoming, room = this.room, acc = this.accept;
		inc.fill(0);
		acc.fill(0);
		for (let i = 0; i < ECONOMY_SIZE; i++) room[i] = Math.max(0, cap[i] - stock[i]);
		for (let p = 0; p < this.count; p++) {
			if (this.arriving[p] && this.kind[p] === kind) {
				inc[economyIndex(Math.floor(this.x[p]), Math.floor(this.y[p]))] += this.amount[p];
			}
		}
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const req = inc[i];
			if (req <= 0) {
				queue[i] *= 1 - this.queueBlend;
				continue;
			}
			const unitBid = priceField[i];
			const roomShare = Math.min(1, room[i] / req);
			const cashShare = unitBid > 1e-12 ? Math.min(1, money.cash(i) / (req * unitBid)) : 1;
			acc[i] = Math.max(0, Math.min(roomShare, cashShare));
			const rejected = req * (1 - acc[i]);
			queue[i] += this.queueBlend * (rejected - queue[i]);
		}
		let p = 0;
		while (p < this.count) {
			if (!this.arriving[p] || this.kind[p] !== kind) { p++; continue; }
			const cell = economyIndex(Math.floor(this.x[p]), Math.floor(this.y[p]));
			const bid = priceField[cell];
			const share = Math.min(acc[cell], bid > 0 ? money.cash(cell) / (this.amount[p] * bid) : 0);
			if (share <= 1e-12) { p++; continue; }
			const all = share >= 1 - 1e-11;
			const accepted = all ? this.amount[p] : this.amount[p] * share;
			const facSlice = all ? this.factoryCost[p] : this.factoryCost[p] * share;
			const trSlice = all ? this.transportCost[p] : this.transportCost[p] * share;
			const itemUnitPrice = (facSlice + trSlice) / accepted;
			const buyerUnitPrice = priceField[cell];
			const buyerPay = money.spend(cell, accepted * buyerUnitPrice);
			const effectiveUnitBid = buyerPay / accepted;
			const transportPaid = Math.min(buyerPay, trSlice);
			const factoryRevenue = buyerPay - transportPaid;
			money.payTransport(transportPaid);
			money.payOwner(this.owner[p], factoryRevenue);
			if (buyerPay > 0 && !this.model.owners.accountAt(cell)?.municipal) money.inputs += buyerPay;
			const realizedProfit = factoryRevenue - facSlice - (trSlice - transportPaid);
			const identityProfit = accepted * (effectiveUnitBid - itemUnitPrice);
			const err = Math.abs(realizedProfit - identityProfit);
			if (err > this.maxProfitError) this.maxProfitError = err;
			if (realizedProfit < -1e-9) this.underwaterLosses++;
			this.arrivals++;
			const source = this.model.owners.facilities[this.facility[p]];
			if (source && source.cell >= 0 && source.owner === this.owner[p]) this.model.earned[source.cell] += realizedProfit / ECONOMY_DT;
			stock[cell] += accepted;
			costBuf[cell] += buyerPay;
			if (all || this.amount[p] - accepted <= 1e-11) {
				if (!all && this.amount[p] - accepted > 0) this.spoiled[kind] += this.amount[p] - accepted;
				this.removeAt(p);
				continue;
			}
			this.amount[p] -= accepted;
			this.factoryCost[p] = Math.max(0, this.factoryCost[p] - facSlice);
			this.transportCost[p] = Math.max(0, this.transportCost[p] - trSlice);
			p++;
		}
	}
}

if (typeof module === 'object') module.exports = { GoodsPool, SPAWN_UNIT };
