// Owns: preallocated SoA worker particles — FRESH commuters and DEPLETED walkers with carried wallets and settle intent.
// Workers are persistent objects: a docked worker is parked at its cell (not drawn) and keeps its wallet until it
// rests, then leaves by gradient. A town never holds or releases; it only rests and taxes. No gradient means the
// worker counts as unemployed — the signal to spawn a facility. Edit for: worker batch size, walk pace, dock slope.
'use strict';

const WORKER_CAP = 2048;
const WORKER_UNIT = LABOR_PER_POP;
const WORKER_SPEED = 12;
const WORKER_DUST = 1e-12;
const WORKER_DOCK_SLOPE = 0.1 * GRADIENT_KNEE;
const FACILITY_UNEMPLOY_WORKERS = 4;
const STATE_FRESH = 0;
const STATE_DEPLETED = 1;

// Worker objects are the persistent reality. A worker is either walking (dockCell < 0, drawn) or docked (dockCell =
// cell, parked, not drawn). Docked stocks (labor[i], depleted[i] + flow gold and intent) are the cell aggregate the
// B2 rules read and write; syncFromCells re-applies their state and wallets to the parked objects each tick, so a
// worker keeps its money and identity across rest, work and the walk between them.
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
		this.dockCell = new Int32Array(WORKER_CAP);
		this.arriveCell = new Int32Array(WORKER_CAP);
		this.dockHead = new Int32Array(ECONOMY_SIZE);
		this.dockPrev = new Int32Array(WORKER_CAP);
		this.dockNext = new Int32Array(WORKER_CAP);
		this.queue = new Float64Array(ECONOMY_SIZE);
		this.unemployed = new Float64Array(ECONOMY_SIZE);
		this.reset();
	}

	reset() {
		this.count = 0;
		this.dockHead.fill(-1);
		this.queue.fill(0);
		this.unemployed.fill(0);
		this.emitted = this.arrivals = this.docked = 0;
		this.absorbedGold = 0;
		this.unemploymentTotal = 0;
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

	isFirm(i) {
		const a = this.model.actors[i];
		return a === ECONOMY_MINE || a === ECONOMY_FACTORY || a === ECONOMY_GOLD;
	}

	inFlightTotal(s) {
		let sum = 0;
		for (let p = 0; p < this.count; p++) if (this.dockCell[p] < 0 && this.state[p] === s) sum += this.amount[p];
		return sum;
	}

	inFlightAt(s, i) {
		let sum = 0;
		for (let p = 0; p < this.count; p++) if (this.dockCell[p] < 0 && this.state[p] === s && this.cellOf(p) === i) sum += this.amount[p];
		return sum;
	}

	// Walkers waiting at a full buyer (fresh at a firm, depleted at a town) count toward its pool occupancy,
	// so hire bids and town crowd tax react to the queue instead of drawing more walkers.
	queuedAt(i) {
		return this.queue[i];
	}

	// Only walking workers carry money outside the docked aggregates; docked wallets live in the cell flow gold.
	goldTotal() {
		let sum = 0;
		for (let p = 0; p < this.count; p++) if (this.dockCell[p] < 0) sum += this.gold[p];
		return sum;
	}

	unemployment() { return this.unemploymentTotal; }
	unemployedAt(i) { return this.unemployed[i]; }
	facilityDemand() { return this.unemploymentTotal >= FACILITY_UNEMPLOY_WORKERS * WORKER_UNIT; }

	link(p, i) {
		this.dockPrev[p] = -1;
		this.dockNext[p] = this.dockHead[i];
		if (this.dockHead[i] >= 0) this.dockPrev[this.dockHead[i]] = p;
		this.dockHead[i] = p;
	}

	unlink(p) {
		const i = this.dockCell[p];
		if (i < 0) return;
		const pr = this.dockPrev[p], nx = this.dockNext[p];
		if (pr >= 0) this.dockNext[pr] = nx;
		else this.dockHead[i] = nx;
		if (nx >= 0) this.dockPrev[nx] = pr;
		this.dockCell[p] = -1;
	}

	step() {
		this.clearFlows(this.model.laborFlow);
		this.clearFlows(this.model.depletedFlow);
		this.syncFromCells();
		this.releaseState(STATE_FRESH);
		this.releaseState(STATE_DEPLETED);
		this.advanceAll();
		this.admit(STATE_FRESH);
		this.admit(STATE_DEPLETED);
		this.compact();
		this.updateUnemployment();
	}

	clearFlows(flow) {
		flow.flowX.fill(0);
		flow.flowY.fill(0);
		flow.flowRate.fill(0);
	}

	// Re-apply the B2 cell-stock state and wallets to the parked objects: B2 flips state (rest, work) and moves
	// gold (wages, rest tax, shelter) on the docked aggregates, and creates stock with no backing object (town
	// population supply, resident shed). Mirrored objects follow that net change; stock below one worker unit stays
	// in the cell as pending supply and is mirrored once a full worker accumulates, so supply releases in batches.
	syncFromCells() {
		const m = this.model;
		const labor = m.labor, depleted = m.depleted;
		const lfGold = m.laborFlow.gold, dfGold = m.depletedFlow.gold, dfIntent = m.depletedFlow.intent;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			let p = this.dockHead[i];
			if (p < 0 && labor[i] <= WORKER_DUST && depleted[i] <= WORKER_DUST) continue;
			let freshTarget = labor[i], depTarget = depleted[i];
			let freshTotal = 0, depTotal = 0;
			while (p >= 0) {
				const nx = this.dockNext[p];
				if (freshTarget > WORKER_DUST) {
					this.state[p] = STATE_FRESH;
					const take = Math.min(this.amount[p], freshTarget);
					this.amount[p] = take;
					freshTarget -= take;
					freshTotal += take;
				} else {
					this.state[p] = STATE_DEPLETED;
					const take = Math.min(this.amount[p], depTarget);
					this.amount[p] = take;
					depTarget -= take;
					depTotal += take;
				}
				p = nx;
			}
			while (freshTarget >= WORKER_UNIT) {
				if (this.count >= WORKER_CAP) break;
				this.spawnDocked(STATE_FRESH, i, WORKER_UNIT, 0, 0);
				freshTarget -= WORKER_UNIT;
				freshTotal += WORKER_UNIT;
			}
			while (depTarget >= WORKER_UNIT) {
				if (this.count >= WORKER_CAP) break;
				this.spawnDocked(STATE_DEPLETED, i, WORKER_UNIT, 0, dfIntent[i]);
				depTarget -= WORKER_UNIT;
				depTotal += WORKER_UNIT;
			}
			p = this.dockHead[i];
			while (p >= 0) {
				const nx = this.dockNext[p];
				if (this.state[p] === STATE_FRESH) this.gold[p] = labor[i] > WORKER_DUST ? lfGold[i] * (this.amount[p] / labor[i]) : 0;
				else {
					this.gold[p] = depleted[i] > WORKER_DUST ? dfGold[i] * (this.amount[p] / depleted[i]) : 0;
					this.intent[p] = dfIntent[i];
				}
				p = nx;
			}
		}
	}

	spawnDocked(s, i, amount, gold, intent) {
		const p = this.count++;
		this.state[p] = s;
		this.x[p] = i % ECONOMY_WIDTH;
		this.y[p] = Math.floor(i / ECONOMY_WIDTH);
		this.vx[p] = this.vy[p] = 0;
		this.amount[p] = amount;
		this.gold[p] = gold;
		this.intent[p] = intent;
		this.arriveCell[p] = -1;
		this.dockCell[p] = i;
		this.link(p, i);
	}

	// A docked worker leaves purely by gradient. Fresh workers employed at a firm stay (the firm consumes them);
	// every other docked worker walks once its uphill slope clears the dock slope. No town holds or releases.
	releaseState(s) {
		const price = this.priceOf(s), alt = this.altOf(s);
		for (let p = 0; p < this.count; p++) {
			if (this.dockCell[p] < 0 || this.state[p] !== s) continue;
			const i = this.dockCell[p];
			if (s === STATE_FRESH && this.isFirm(i)) continue;
			const mix = s === STATE_FRESH ? 0 : this.mixOf(p);
			if (!this.steer.sampleGradient(price, alt, mix, i, -Infinity)) continue;
			if (this.steer.grad[2] < WORKER_DOCK_SLOPE) continue;
			this.launch(p, i);
		}
	}

	launch(p, i) {
		const flow = this.flowOf(this.state[p]), stock = this.stockOf(this.state[p]);
		this.unlink(p);
		stock[i] = Math.max(0, stock[i] - this.amount[p]);
		flow.gold[i] = Math.max(0, flow.gold[i] - this.gold[p]);
		this.dockCell[p] = -1;
		this.vx[p] = WORKER_SPEED * this.steer.grad[3];
		this.vy[p] = WORKER_SPEED * this.steer.grad[4];
		this.emitted++;
	}

	advanceAll() {
		const m = this.model, steer = this.steer;
		this.queue.fill(0);
		for (let p = 0; p < this.count; p++) {
			if (this.dockCell[p] >= 0) continue;
			this.arriveCell[p] = -1;
			const s = this.state[p], flow = this.flowOf(s), stock = this.stockOf(s);
			const price = this.priceOf(s), alt = this.altOf(s), mix = this.mixOf(p);
			const ci = this.cellOf(p);
			const buyer = (flow.buyers & (1 << m.actors[ci])) !== 0;
			const moving = steer.sampleGradient(price, alt, mix, ci, -Infinity) && steer.grad[2] >= WORKER_DOCK_SLOPE;
			if (buyer && flow.cap[ci] - stock[ci] > WORKER_DUST && (s === STATE_FRESH || !moving)) {
				this.arriveCell[p] = ci;
				this.vx[p] = this.vy[p] = 0;
				continue;
			}
			const still = GRADIENT_KNEE / (steer.grad[2] + GRADIENT_KNEE);
			if (s === STATE_DEPLETED) this.intent[p] = m.settlements.nextIntent(this.intent[p], still, ci);
			if (!moving || this.amount[p] <= WORKER_DUST) {
				this.vx[p] = this.vy[p] = 0;
				if (buyer) this.queue[ci] += this.amount[p];
				else this.parkHere(p, ci);
				continue;
			}
			steer.advance(this, p, WORKER_SPEED);
			flow.flowX[ci] += this.vx[p] * this.amount[p];
			flow.flowY[ci] += this.vy[p] * this.amount[p];
			flow.flowRate[ci] += this.amount[p];
		}
	}

	// Park a walking worker at a cell as a persistent object: its amount and wallet join the docked aggregate and
	// the object stays alive (dockCell = cell), keeping its money and intent until the gradient sends it on its way.
	parkHere(p, i) {
		const flow = this.flowOf(this.state[p]), stock = this.stockOf(this.state[p]);
		if (stock[i] + this.amount[p] > flow.cap[i] + WORKER_DUST) return false;
		this.park(p, i);
		return true;
	}

	park(p, i) {
		const s = this.state[p], flow = this.flowOf(s), stock = this.stockOf(s);
		const before = stock[i];
		stock[i] += this.amount[p];
		flow.gold[i] += this.gold[p];
		if (flow.intent) flow.intent[i] = (flow.intent[i] * before + this.intent[p] * this.amount[p]) / stock[i];
		this.dockCell[p] = i;
		this.x[p] = i % ECONOMY_WIDTH;
		this.y[p] = Math.floor(i / ECONOMY_WIDTH);
		this.vx[p] = this.vy[p] = 0;
		this.link(p, i);
		this.docked++;
	}

	// Room admission fills each pool in arrival order: a worker docks whole when the pool has room for it, else
	// waits in the queue. Sequential (not normalized) so a burst of arrivals still fills the pool instead of every
	// worker seeing room < 1 and queuing. Fresh arrivals at a firm are paid the entry wage.
	admit(s) {
		const m = this.model, flow = this.flowOf(s), stock = this.stockOf(s);
		for (let p = 0; p < this.count; p++) {
			const b = this.arriveCell[p];
			if (b < 0 || this.dockCell[p] >= 0 || this.state[p] !== s) continue;
			const avail = flow.cap[b] - stock[b];
			if (this.amount[p] <= avail) {
				this.park(p, b);
				if (s === STATE_FRESH) m.buyArrival(flow, b, this.amount[p] * m.priceLabor[b]);
				this.arrivals++;
			} else {
				this.queue[b] += this.amount[p];
			}
			this.arriveCell[p] = -1;
		}
	}

	// Founding converts depleted workers within the radius into residents; walking workers bring their wallets,
	// docked workers' wallets already sit in the cell stock that foundTown banks. Both cease to be workers.
	absorbNear(cx, cy, radius) {
		let settled = 0;
		this.absorbedGold = 0;
		for (let p = 0; p < this.count; p++) {
			if (this.state[p] !== STATE_DEPLETED) continue;
			if (Math.abs(this.x[p] - cx) > radius || Math.abs(this.y[p] - cy) > radius) continue;
			if (this.dockCell[p] < 0) {
				settled += this.amount[p];
				this.absorbedGold += this.gold[p];
			}
			this.amount[p] = this.gold[p] = this.intent[p] = 0;
		}
		this.compact();
		return settled;
	}

	// A docked fresh worker with no firm to climb to is unemployed: no workforce gradient, so it stays parked.
	updateUnemployment() {
		let total = 0;
		this.unemployed.fill(0);
		for (let p = 0; p < this.count; p++) {
			if (this.dockCell[p] < 0 || this.state[p] !== STATE_FRESH) continue;
			const i = this.dockCell[p];
			if (this.isFirm(i)) continue;
			this.unemployed[i] += this.amount[p];
			total += this.amount[p];
		}
		this.unemploymentTotal = total;
	}

	compact() {
		let p = 0;
		while (p < this.count) {
			if (this.amount[p] > WORKER_DUST) {
				p++;
				continue;
			}
			if (this.gold[p] > 0) this.model.money.orphan(this.cellOf(p), this.gold[p]);
			if (this.dockCell[p] >= 0) this.unlink(p);
			this.removeAt(p);
		}
	}

	removeAt(p) {
		const last = --this.count;
		if (p === last) return;
		// Capture the dock cell first: unlink clears dockCell[last], so the move would otherwise drop the
		// relocated worker's dock and strand it as an uncounted walker.
		const lastDock = this.dockCell[last];
		if (lastDock >= 0) this.unlink(last);
		this.state[p] = this.state[last];
		this.x[p] = this.x[last];
		this.y[p] = this.y[last];
		this.vx[p] = this.vx[last];
		this.vy[p] = this.vy[last];
		this.amount[p] = this.amount[last];
		this.gold[p] = this.gold[last];
		this.intent[p] = this.intent[last];
		this.arriveCell[p] = this.arriveCell[last];
		this.dockCell[p] = lastDock;
		if (lastDock >= 0) this.link(p, lastDock);
	}

	// Emit a walking worker from a docked stock (tests and external spawning); takes the full requested amount.
	emitFrom(s, i, amt) {
		if (amt <= WORKER_DUST || this.count >= WORKER_CAP) return -1;
		const flow = this.flowOf(s), stock = this.stockOf(s);
		const take = Math.min(amt, stock[i]);
		if (take <= WORKER_DUST) return -1;
		const gold = stock[i] > WORKER_DUST ? flow.gold[i] * (take / stock[i]) : 0;
		stock[i] -= take;
		flow.gold[i] = Math.max(0, flow.gold[i] - gold);
		if (stock[i] <= WORKER_DUST) flow.gold[i] = 0;
		const p = this.count++;
		this.state[p] = s;
		this.x[p] = i % ECONOMY_WIDTH;
		this.y[p] = Math.floor(i / ECONOMY_WIDTH);
		this.vx[p] = this.vy[p] = 0;
		this.amount[p] = take;
		this.gold[p] = gold;
		this.intent[p] = flow.intent ? flow.intent[i] : 0;
		this.dockCell[p] = -1;
		this.arriveCell[p] = -1;
		this.emitted++;
		return p;
	}
}

if (typeof module === 'object') module.exports = { WorkerParticles, WORKER_UNIT, WORKER_SPEED, STATE_FRESH, STATE_DEPLETED };
