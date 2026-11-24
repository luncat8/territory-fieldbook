// Owns: preallocated SoA worker particles — FRESH commuters and DEPLETED walkers with carried wallets and settle intent,
// release from docked pools, wallet-weighted home steering, room admission and entry wages.
// Edit for: worker batch size (WORKER_UNIT), walk pace and dock release. Pool targets and rest: actors.js, workforce.js.
'use strict';

const WORKER_CAP = 2048;
const WORKER_UNIT = LABOR_PER_POP;
const WORKER_SPEED = 12;
const WORKER_FLUSH_SECONDS = 1;
const WORKER_DUST = 1e-12;
const WORKER_DOCK_SLOPE = 0.1 * GRADIENT_KNEE;
const STATE_FRESH = 0;
const STATE_DEPLETED = 1;

// Docked stocks (labor[i], depleted[i] with their flow gold and intent) are the worker pools and spawn accumulators:
// a firm's fresh pool, a town's wait pool, and still workers resting where they stand. Particles exist only while moving.
class WorkerParticles {
	constructor(model) {
		this.model = model;
		this.steer = new ParticleSteering(model);
		this.state = new Uint8Array(WORKER_CAP);
		this.x = new Float64Array(WORKER_CAP);
		this.y = new Float64Array(WORKER_CAP);
		this.vx = new Float64Array(WORKER_CAP);
		this.vy = new Float64Array(WORKER_CAP);
		this.amount = new Float64Array(WORKER_CAP);
		this.gold = new Float64Array(WORKER_CAP);
		this.intent = new Float64Array(WORKER_CAP);
		this.arriveCell = new Int32Array(WORKER_CAP);
		this.dockIdle = new Float64Array(2 * ECONOMY_SIZE);
		this.dockSeen = new Float64Array(2 * ECONOMY_SIZE);
		this.wantBuy = new Float64Array(ECONOMY_SIZE);
		this.room = new Float64Array(ECONOMY_SIZE);
		this.queue = new Float64Array(ECONOMY_SIZE);
		this.reset();
	}

	reset() {
		this.count = 0;
		this.dockIdle.fill(0);
		this.dockSeen.fill(0);
		this.queue.fill(0);
		this.emitted = this.arrivals = this.docked = 0;
		this.absorbedGold = 0;
	}

	flowOf(s) { return s === STATE_FRESH ? this.model.laborFlow : this.model.depletedFlow; }
	stockOf(s) { return s === STATE_FRESH ? this.model.labor : this.model.depleted; }
	priceOf(s) { return s === STATE_FRESH ? this.model.priceLabor : this.model.priceHome; }
	altOf(s) { return s === STATE_FRESH ? null : this.model.priceRest; }

	mixOf(p) {
		return this.state[p] === STATE_FRESH ? 0 : walletWeight(this.gold[p], this.amount[p], this.model.workforce.refFee);
	}

	cellOf(p) {
		return economyIndex(Math.round(this.x[p]), Math.round(this.y[p]));
	}

	inFlightTotal(s) {
		let sum = 0;
		for (let p = 0; p < this.count; p++) if (this.state[p] === s) sum += this.amount[p];
		return sum;
	}

	inFlightAt(s, i) {
		let sum = 0;
		for (let p = 0; p < this.count; p++) if (this.state[p] === s && this.cellOf(p) === i) sum += this.amount[p];
		return sum;
	}

	// Workers waiting at a full buyer (fresh at a firm, depleted at a town) count toward its pool occupancy,
	// so hire bids and town crowd tax react to the queue instead of drawing more walkers.
	queuedAt(i) {
		return this.queue[i];
	}

	goldTotal() {
		let sum = 0;
		for (let p = 0; p < this.count; p++) sum += this.gold[p];
		return sum;
	}

	step() {
		this.clearFlows(this.model.laborFlow);
		this.clearFlows(this.model.depletedFlow);
		this.releaseDocks(STATE_FRESH);
		this.releaseDocks(STATE_DEPLETED);
		this.advanceAll();
		this.admit(STATE_FRESH);
		this.admit(STATE_DEPLETED);
		this.compact();
	}

	clearFlows(flow) {
		flow.flowX.fill(0);
		flow.flowY.fill(0);
		flow.flowRate.fill(0);
	}

	// Firms keep their fresh pool; a town keeps its wait pool unless a neighbor offers higher home appeal
	// (dominated-town release), so workers are never trapped in a worse town.
	holdsDock(s, i) {
		const m = this.model, a = m.actors[i];
		if (s === STATE_FRESH) return (m.laborFlow.buyers & (1 << a)) !== 0;
		return a === ECONOMY_TOWN && m.depletedFlow.cap[i] > 0 && !hasBetterNeighbor(m.depletedFlow, m.priceHome, i);
	}

	// Workers leave a dock once the slope clears WORKER_DOCK_SLOPE (still > 0.9 below it): one batch per tick,
	// or a smaller remainder after WORKER_FLUSH_SECONDS without new arrivals. A full GRADIENT_KNEE gate stranded
	// commuters in a town whose wage field reaches it with a slope under the knee.
	releaseDocks(s) {
		const m = this.model, flow = this.flowOf(s), stock = this.stockOf(s), steer = this.steer;
		const price = this.priceOf(s), alt = this.altOf(s), off = s * ECONOMY_SIZE;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const idx = off + i, amt = stock[i];
			flow.still[i] = 1;
			if (amt <= 1e-12) {
				this.dockIdle[idx] = this.dockSeen[idx] = 0;
				continue;
			}
			this.dockIdle[idx] = amt > this.dockSeen[idx] + 1e-15 ? 0 : this.dockIdle[idx] + ECONOMY_DT;
			this.dockSeen[idx] = amt;
			if (this.holdsDock(s, i)) continue;
			const moving = steer.sampleGradient(price, alt, alt ? flow.mix[i] : 0, i, -Infinity);
			flow.still[i] = GRADIENT_KNEE / (steer.grad[2] + GRADIENT_KNEE);
			if (!moving || steer.grad[2] < WORKER_DOCK_SLOPE) continue;
			if (amt < WORKER_UNIT && this.dockIdle[idx] < WORKER_FLUSH_SECONDS) continue;
			if (this.count >= WORKER_CAP) return;
			this.emitFrom(s, i, amt);
			this.dockSeen[idx] = stock[i];
		}
	}

	emitFrom(s, i, amt) {
		const flow = this.flowOf(s), stock = this.stockOf(s);
		const all = amt - WORKER_UNIT <= 1e-12;
		const take = all ? amt : WORKER_UNIT;
		const share = take / amt;
		const gold = all ? flow.gold[i] : flow.gold[i] * share;
		const p = this.count++;
		this.state[p] = s;
		this.x[p] = i % ECONOMY_WIDTH;
		this.y[p] = Math.floor(i / ECONOMY_WIDTH);
		this.vx[p] = WORKER_SPEED * this.steer.grad[3];
		this.vy[p] = WORKER_SPEED * this.steer.grad[4];
		this.amount[p] = take;
		this.gold[p] = gold;
		this.intent[p] = flow.intent ? flow.intent[i] : 0;
		this.arriveCell[p] = -1;
		stock[i] = all ? 0 : amt - take;
		flow.gold[i] = all ? 0 : flow.gold[i] - gold;
		flow.cost[i] = all ? 0 : flow.cost[i] * (1 - share);
		if (all && flow.intent) flow.intent[i] = 0;
		this.emitted++;
	}

	advanceAll() {
		const m = this.model, steer = this.steer;
		this.queue.fill(0);
		for (let p = 0; p < this.count; p++) {
			this.arriveCell[p] = -1;
			const s = this.state[p], flow = this.flowOf(s), stock = this.stockOf(s);
			const price = this.priceOf(s), alt = this.altOf(s), mix = this.mixOf(p);
			const ci = this.cellOf(p);
			const buyer = (flow.buyers & (1 << m.actors[ci])) !== 0;
			const moving = steer.sampleGradient(price, alt, mix, ci, -Infinity) && steer.grad[2] >= WORKER_DOCK_SLOPE;
			if (buyer && flow.cap[ci] - stock[ci] > 1e-12 && (s === STATE_FRESH || !moving)) {
				this.arriveCell[p] = ci;
				this.vx[p] = this.vy[p] = 0;
				continue;
			}
			const still = GRADIENT_KNEE / (steer.grad[2] + GRADIENT_KNEE);
			if (s === STATE_DEPLETED) this.intent[p] = m.settlements.nextIntent(this.intent[p], still, ci);
			if (!moving || this.amount[p] <= WORKER_DUST) {
				this.vx[p] = this.vy[p] = 0;
				if (buyer) this.queue[ci] += this.amount[p];
				else this.dock(p, ci);
				continue;
			}
			steer.advance(this, p, WORKER_SPEED);
			flow.flowX[ci] += this.vx[p] * this.amount[p];
			flow.flowY[ci] += this.vy[p] * this.amount[p];
			flow.flowRate[ci] += this.amount[p];
		}
	}

	// A still worker joins the docked stock where it stands, so shelter rest, intent pledges and founding see it.
	// A cell already holding a full worker cell keeps the particle hovering instead of overfilling it.
	dock(p, i) {
		const s = this.state[p], flow = this.flowOf(s), stock = this.stockOf(s);
		const amt = this.amount[p], before = stock[i];
		if (before + amt > 1) return;
		stock[i] = before + amt;
		flow.gold[i] += this.gold[p];
		if (flow.intent) flow.intent[i] = (flow.intent[i] * before + this.intent[p] * amt) / stock[i];
		this.amount[p] = this.gold[p] = 0;
		this.docked++;
	}

	// Normalized room admission keeps pools under their cap; fresh arrivals at a firm are paid the entry wage.
	admit(s) {
		const m = this.model, flow = this.flowOf(s), stock = this.stockOf(s);
		this.wantBuy.fill(0);
		let any = false;
		for (let p = 0; p < this.count; p++) {
			const b = this.arriveCell[p];
			if (b < 0 || this.state[p] !== s) continue;
			this.wantBuy[b] += this.amount[p];
			any = true;
		}
		if (!any) return;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (this.wantBuy[i] > 0) this.room[i] = Math.min(1, Math.max(0, flow.cap[i] - stock[i]) / this.wantBuy[i]);
		}
		for (let p = 0; p < this.count; p++) {
			const b = this.arriveCell[p];
			if (b < 0 || this.state[p] !== s) continue;
			if (this.room[b] <= 0) {
				this.queue[b] += this.amount[p];
				continue;
			}
			const amt = this.amount[p], all = this.room[b] >= 1 - 1e-12;
			const accepted = all ? amt : amt * this.room[b];
			const gold = all ? this.gold[p] : this.gold[p] * this.room[b];
			const before = stock[b];
			stock[b] = before + accepted;
			flow.gold[b] += gold;
			if (flow.intent) flow.intent[b] = (flow.intent[b] * before + this.intent[p] * accepted) / stock[b];
			this.amount[p] = all ? 0 : amt - accepted;
			this.gold[p] = all ? 0 : this.gold[p] - gold;
			this.queue[b] += this.amount[p];
			if (s === STATE_FRESH) m.buyArrival(flow, b, accepted * m.priceLabor[b]);
			this.arrivals++;
		}
	}

	// Founding converts depleted walkers within the radius too; their wallets become the young town's savings.
	absorbNear(cx, cy, radius) {
		let settled = 0;
		this.absorbedGold = 0;
		for (let p = 0; p < this.count; p++) {
			if (this.state[p] !== STATE_DEPLETED || Math.abs(this.x[p] - cx) > radius || Math.abs(this.y[p] - cy) > radius) continue;
			settled += this.amount[p];
			this.absorbedGold += this.gold[p];
			this.amount[p] = this.gold[p] = 0;
		}
		this.compact();
		return settled;
	}

	compact() {
		let p = 0;
		while (p < this.count) {
			if (this.amount[p] > 0) p++;
			else this.removeAt(p);
		}
	}

	removeAt(p) {
		const last = --this.count;
		if (this.gold[p] > 0) this.model.money.orphan(this.cellOf(p), this.gold[p]);
		if (p === last) return;
		this.state[p] = this.state[last];
		this.x[p] = this.x[last];
		this.y[p] = this.y[last];
		this.vx[p] = this.vx[last];
		this.vy[p] = this.vy[last];
		this.amount[p] = this.amount[last];
		this.gold[p] = this.gold[last];
		this.intent[p] = this.intent[last];
		this.arriveCell[p] = this.arriveCell[last];
	}
}

if (typeof module === 'object') module.exports = { WorkerParticles, WORKER_UNIT, WORKER_SPEED, STATE_FRESH, STATE_DEPLETED };
