// Owns: persistent worker objects, personal wallets, fatigue, commuting, queues and unemployed firm founding.
// Docked stocks mirror fresh/tired portions; a state change never deletes a worker or transfers ownership of savings.
'use strict';

const WORKER_CAP = 2048;
const WORKER_UNIT = LABOR_PER_POP;
const WORKER_SPEED = 12;
const WORKER_DUST = 1e-12;
const WORKER_DOCK_SLOPE = 0.1 * GRADIENT_KNEE;
const FACILITY_UNEMPLOY_WORKERS = 4;
const FOUND_FIRM_COOLDOWN_TICKS = 300;
const STATE_FRESH = 0;
const STATE_DEPLETED = 1;

class WorkerParticles extends WorkerLifecycle {
	constructor(model) {
		super();
		this.model = model;
		this.steer = new ParticleSteering(model);
		this.state = new Uint8Array(WORKER_CAP);
		this.x = new Float64Array(WORKER_CAP);
		this.y = new Float64Array(WORKER_CAP);
		this.vx = new Float64Array(WORKER_CAP);
		this.vy = new Float64Array(WORKER_CAP);
		this.amount = new Float64Array(WORKER_CAP);
		this.tired = new Float64Array(WORKER_CAP);
		this.worked = new Float64Array(WORKER_CAP);
		this.gold = new Float64Array(WORKER_CAP);
		this.intent = new Float64Array(WORKER_CAP);
		this.wid = new Int32Array(WORKER_CAP);
		this.dockCell = new Int32Array(WORKER_CAP);
		this.arriveCell = new Int32Array(WORKER_CAP);
		this.dockHead = new Int32Array(ECONOMY_SIZE);
		this.dockPrev = new Int32Array(WORKER_CAP);
		this.dockNext = new Int32Array(WORKER_CAP);
		this.queue = new Float64Array(ECONOMY_SIZE);
		this.unemployed = new Float64Array(ECONOMY_SIZE);
		this.tracker = null;
		this.nextId = 1;
		this.reset();
	}

	reset() {
		this.count = 0;
		this.dockHead.fill(-1);
		this.queue.fill(0);
		this.unemployed.fill(0);
		this.nextId = 1;
		this.emitted = this.arrivals = this.docked = 0;
		this.absorbedGold = 0;
		this.unemploymentTotal = 0;
		this.lastFoundTick = 0;
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
		for (let p = 0; p < this.count; p++) if (this.dockCell[p] < 0) sum += this.portion(p, s);
		return sum;
	}

	inFlightAt(s, i) {
		let sum = 0;
		for (let p = 0; p < this.count; p++) if (this.dockCell[p] < 0 && this.cellOf(p) === i) sum += this.portion(p, s);
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

	dockedGold(s, i) {
		let sum = 0;
		for (let p = this.dockHead[i]; p >= 0; p = this.dockNext[p]) if (this.state[p] === s) sum += this.gold[p];
		return sum;
	}

	dockedAmount(s, i) {
		let sum = 0;
		for (let p = this.dockHead[i]; p >= 0; p = this.dockNext[p]) sum += this.portion(p, s);
		return sum;
	}

	hasDocked(i, s) {
		for (let p = this.dockHead[i]; p >= 0; p = this.dockNext[p]) if (this.state[p] === s) return true;
		return false;
	}

	byWid(id) {
		for (let p = 0; p < this.count; p++) if (this.wid[p] === id) return p;
		return -1;
	}

	nearestWorker(i, radius) {
		const cx = i % ECONOMY_WIDTH, cy = Math.floor(i / ECONOMY_WIDTH);
		let best = -1, bestD = radius * radius;
		for (let p = 0; p < this.count; p++) {
			const dx = this.x[p] - cx, dy = this.y[p] - cy;
			const d = dx * dx + dy * dy;
			if (d <= bestD) {
				bestD = d;
				best = p;
			}
		}
		return best;
	}

	// Top-up a wallet in place: a docked wallet is backed by the pool aggregate, so a docked credit moves both.
	creditWallet(p, amount) {
		this.gold[p] += amount;
		const dock = this.dockCell[p];
		if (dock >= 0) this.flowOf(this.state[p]).gold[dock] += amount;
	}

	step() {
		this.clearFlows(this.model.laborFlow);
		this.clearFlows(this.model.depletedFlow);
		this.syncFromCells();
		this.release();
		this.advanceAll();
		this.admit(STATE_FRESH);
		this.admit(STATE_DEPLETED);
		this.compact();
		this.sweepUnowned();
		this.updateUnemployment();
		this.maybeFoundFirm();
	}

	// Pool gold with neither docked members nor stock to mirror is unowned — the rounding remainder of departed
	// wallets. Orphaning it to the vault keeps later launches from minting it.
	sweepUnowned() {
		const m = this.model;
		const labor = m.labor, depleted = m.depleted;
		const lf = m.laborFlow.gold, df = m.depletedFlow.gold;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (this.dockHead[i] >= 0 || labor[i] > WORKER_DUST || depleted[i] > WORKER_DUST) continue;
			if (lf[i] > 0) { m.money.orphan(i, lf[i]); lf[i] = 0; }
			if (df[i] > 0) { m.money.orphan(i, df[i]); df[i] = 0; }
		}
	}

	clearFlows(flow) {
		flow.flowX.fill(0);
		flow.flowY.fill(0);
		flow.flowRate.fill(0);
	}

	// Only births/resident output create new objects. Work and rest update existing objects explicitly.
	syncFromCells() {
		const m = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			this.spawnFromStock(STATE_FRESH, i, Math.max(0, m.labor[i] - this.dockedAmount(STATE_FRESH, i)), null);
			this.spawnFromStock(STATE_DEPLETED, i, Math.max(0, m.depleted[i] - this.dockedAmount(STATE_DEPLETED, i)), m.depletedFlow.intent);
		}
	}

	// Backing follows the wallet; this is not income or expenditure.
	crossDock(p, i, was) {
		const lfGold = this.model.laborFlow.gold, dfGold = this.model.depletedFlow.gold;
		if (was === STATE_FRESH) {
			const g = this.gold[p];
			lfGold[i] = Math.max(0, lfGold[i] - g);
			dfGold[i] += g;
		} else {
			const g = this.gold[p];
			dfGold[i] = Math.max(0, dfGold[i] - g);
			lfGold[i] += g;
		}
	}

	// Only unowned gold accompanies newly formed workers; existing wallets are never redistributed.
	spawnFromStock(s, i, target, intent) {
		while (target >= WORKER_UNIT) {
			if (this.count >= WORKER_CAP) return;
			const free = Math.max(0, this.flowOf(s).gold[i] - this.dockedGold(s, i));
			const take = Math.max(0, free * (WORKER_UNIT / target));
			this.spawnDocked(s, i, WORKER_UNIT, take, intent ? intent[i] : 0);
			target -= WORKER_UNIT;
		}
	}

	noteWallet(p, applied, s, i) {
		if (this.tracker && applied !== 0) this.tracker.walletDelta(this.wid[p], applied, s === STATE_FRESH, i);
	}

	spawnDocked(s, i, amount, gold, intent) {
		const p = this.count++;
		this.state[p] = s;
		this.x[p] = i % ECONOMY_WIDTH;
		this.y[p] = Math.floor(i / ECONOMY_WIDTH);
		this.vx[p] = this.vy[p] = 0;
		this.amount[p] = amount;
		this.tired[p] = s === STATE_DEPLETED ? amount : 0;
		this.worked[p] = 0;
		this.gold[p] = gold;
		this.intent[p] = intent;
		this.wid[p] = this.nextId++;
		this.arriveCell[p] = -1;
		this.dockCell[p] = i;
		this.link(p, i);
	}

	// Mint a walker from nothing (worker tool): no cell stock is touched; the caller mints the purse into seeded.
	spawnWalker(s, i, amount, gold) {
		if (this.count >= WORKER_CAP) return -1;
		const p = this.count++;
		this.state[p] = s;
		this.x[p] = i % ECONOMY_WIDTH;
		this.y[p] = Math.floor(i / ECONOMY_WIDTH);
		this.vx[p] = this.vy[p] = 0;
		this.amount[p] = amount;
		this.tired[p] = s === STATE_DEPLETED ? amount : 0;
		this.worked[p] = 0;
		this.gold[p] = gold;
		this.intent[p] = 0;
		this.wid[p] = this.nextId++;
		this.dockCell[p] = -1;
		this.arriveCell[p] = -1;
		this.emitted++;
		return p;
	}

	// A docked worker leaves purely by gradient. A tired worker who has rested partway (fresh units recovered)
	// goes to a job without waiting for full recovery, so his fresh units free the town labor cap that paid rest
	// needs; a fresh worker never turns home. Firm workers stay to work until exhausted or the full depleted pool
// blocks their shift. No town holds or releases.
	release() {
		const m = this.model, steer = this.steer;
		for (let p = 0; p < this.count; p++) {
			if (this.dockCell[p] < 0) continue;
			const i = this.dockCell[p];
			const fresh = this.portion(p, STATE_FRESH), tired = this.portion(p, STATE_DEPLETED);
			const homeMix = walletWeight(this.gold[p], this.amount[p], m.workforce.refFee);
			if (this.isFirm(i)) {
				// A full depleted pool caps the recipe, so the worker's leftover fresh can never be worked and
				// the shift could never complete; the mostly-tired ones end it and free the room for the rest.
				const stuck = m.depleted[i] + WORKER_DUST >= m.depletedFlow.cap[i] && tired >= fresh;
				if (this.state[p] === STATE_FRESH && !stuck) continue;
				if (!steer.sampleGradient(m.priceHome, m.priceRest, homeMix, i, -Infinity)) continue;
				if (steer.grad[2] < WORKER_DOCK_SLOPE) continue;
				this.travel(p, i, STATE_DEPLETED);
				continue;
			}
			const laborOk = steer.sampleGradient(m.priceLabor, null, 0, i, -Infinity);
			const laborSteep = laborOk ? steer.grad[2] : 0, laborHx = steer.grad[3], laborHy = steer.grad[4];
			const homeOk = steer.sampleGradient(m.priceHome, m.priceRest, homeMix, i, -Infinity);
			const homeSteep = homeOk ? steer.grad[2] : 0, homeHx = steer.grad[3], homeHy = steer.grad[4];
			const laborClear = laborOk && laborSteep >= WORKER_DOCK_SLOPE;
			const homeClear = homeOk && homeSteep >= WORKER_DOCK_SLOPE;
			let want = -1;
			if (this.state[p] === STATE_FRESH) {
				if (laborClear) want = STATE_FRESH;
			} else if (fresh > WORKER_DUST && laborClear && (!homeClear || fresh >= tired)) want = STATE_FRESH;
			else if (homeClear) want = STATE_DEPLETED;
			if (want < 0) continue;
			steer.grad[2] = want === STATE_FRESH ? laborSteep : homeSteep;
			steer.grad[3] = want === STATE_FRESH ? laborHx : homeHx;
			steer.grad[4] = want === STATE_FRESH ? laborHy : homeHy;
			this.travel(p, i, want);
		}
	}

	travel(p, i, want) {
		if (this.state[p] !== want) {
			this.crossDock(p, i, this.state[p]);
			this.state[p] = want;
		}
		this.launch(p, i);
	}

	launch(p, i) {
		const flow = this.flowOf(this.state[p]);
		this.unlink(p);
		this.model.labor[i] = Math.max(0, this.model.labor[i] - this.portion(p, STATE_FRESH));
		this.model.depleted[i] = Math.max(0, this.model.depleted[i] - this.tired[p]);
		flow.gold[i] = Math.max(0, flow.gold[i] - this.gold[p]);
		this.dockCell[p] = -1;
		this.vx[p] = WORKER_SPEED * this.steer.grad[3];
		this.vy[p] = WORKER_SPEED * this.steer.grad[4];
		this.emitted++;
	}

	advanceAll() {
		const m = this.model, steer = this.steer;
		let recovered = 0;
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
				if (!this.fits(p, ci)) recovered += this.restWalking(p, ci, 1);
				if (this.state[p] !== s) continue;
				this.arriveCell[p] = ci;
				this.vx[p] = this.vy[p] = 0;
				continue;
			}
			const still = GRADIENT_KNEE / (steer.grad[2] + GRADIENT_KNEE);
			if (!buyer) recovered += this.restWalking(p, ci, still);
			if (this.state[p] !== s) continue;
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
		m.restedDepleted += recovered;
		m.suppliedLabor += recovered;
	}

	fits(p, i) {
		const m = this.model;
		return m.labor[i] + this.portion(p, STATE_FRESH) <= m.laborFlow.cap[i] + WORKER_DUST
			&& m.depleted[i] + this.tired[p] <= m.depletedFlow.cap[i] + WORKER_DUST;
	}

	parkHere(p, i) {
		if (!this.fits(p, i)) return false;
		this.park(p, i);
		return true;
	}

	park(p, i) {
		const s = this.state[p], flow = this.flowOf(s);
		const before = this.model.depleted[i];
		this.model.labor[i] += this.portion(p, STATE_FRESH);
		this.model.depleted[i] += this.tired[p];
		flow.gold[i] += this.gold[p];
		if (flow.intent) flow.intent[i] = (flow.intent[i] * before + this.intent[p] * this.tired[p]) / this.model.depleted[i];
		this.dockCell[p] = i;
		this.x[p] = i % ECONOMY_WIDTH;
		this.y[p] = Math.floor(i / ECONOMY_WIDTH);
		this.vx[p] = this.vy[p] = 0;
		this.link(p, i);
		this.docked++;
		if (this.tracker && this.model.actors[i] === ECONOMY_TOWN) this.tracker.visit(this.wid[p], i);
	}

	// Room admission fills each pool in arrival order: a worker docks whole when the pool has room for it, else
	// waits in the queue. Sequential (not normalized) so a burst of arrivals still fills the pool instead of every
	// worker seeing room < 1 and queuing. Fresh arrivals at a firm are paid the entry wage into their own wallet.
	admit(s) {
		const m = this.model, flow = this.flowOf(s);
		for (let p = 0; p < this.count; p++) {
			const b = this.arriveCell[p];
			if (b < 0 || this.dockCell[p] >= 0 || this.state[p] !== s) continue;
			if (this.fits(p, b)) {
				this.park(p, b);
				if (s === STATE_FRESH) {
					const paid = m.buyArrival(flow, b, this.amount[p] * m.priceLabor[b], this.wid[p]);
					if (paid > 0) {
						this.gold[p] += paid;
						if (this.tracker) this.tracker.hire(this.wid[p], paid, b);
					}
				}
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
		const home = economyIndex(Math.round(cx), Math.round(cy));
		for (let p = 0; p < this.count; p++) {
			if (this.state[p] !== STATE_DEPLETED) continue;
			if (Math.abs(this.x[p] - cx) > radius || Math.abs(this.y[p] - cy) > radius) continue;
			if (this.dockCell[p] >= 0 && this.model.actors[this.dockCell[p]]) continue;
			if (this.dockCell[p] < 0) {
				settled += this.tired[p];
				this.model.workedLabor += this.portion(p, STATE_FRESH);
				this.absorbedGold += this.gold[p];
			}
			if (this.tracker && this.gold[p] > 0) this.tracker.bank(this.wid[p], this.gold[p], home);
			this.amount[p] = this.gold[p] = this.intent[p] = 0;
		}
		this.compact();
		return settled;
	}

	// Founding towns gather parked unemployed workers: docked fresh parkers bring their wallets and stock to
	// the new cell so no wallet loses its pool backing; those that exceed the town's labor room stay parked.
	relocateDocked(from, to) {
		const m = this.model;
		let moved = 0;
		let p = this.dockHead[from];
		while (p >= 0) {
			const nx = this.dockNext[p];
			if (this.state[p] === STATE_FRESH && this.amount[p] > WORKER_DUST && m.labor[to] + this.amount[p] <= 1 + 1e-9) {
				const g = this.gold[p];
				this.unlink(p);
				this.link(p, to);
				this.dockCell[p] = to;
				m.laborFlow.gold[from] = Math.max(0, m.laborFlow.gold[from] - g);
				m.laborFlow.gold[to] += g;
				const fresh = this.portion(p, STATE_FRESH), tired = this.tired[p];
				m.labor[from] -= fresh;
				m.labor[to] += fresh;
				m.depleted[from] = Math.max(0, m.depleted[from] - tired);
				m.depleted[to] += tired;
				if (this.tracker) this.tracker.visit(this.wid[p], to);
				moved += this.amount[p];
			}
			p = nx;
		}
		return moved;
	}

	// A fresh worker with no significant job gradient is free workforce, whether walking or parked.
	updateUnemployment() {
		let total = 0;
		this.unemployed.fill(0);
		for (let p = 0; p < this.count; p++) {
			if (this.state[p] !== STATE_FRESH) continue;
			const i = this.cellOf(p);
			if (this.isFirm(i)) continue;
			if (this.steer.sampleGradient(this.model.priceLabor, null, 0, i, -Infinity) && this.steer.grad[2] >= WORKER_DOCK_SLOPE) continue;
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
			if (this.gold[p] > 0) {
				const dock = this.dockCell[p];
				if (dock >= 0) {
					// A docked wallet is backed by the pool aggregate; release the backing before orphaning the gold.
					const flow = this.flowOf(this.state[p]);
					flow.gold[dock] = Math.max(0, flow.gold[dock] - this.gold[p]);
				}
				// A worker dissolving into a town settles there: his purse banks into the municipal worker purse,
				// and the watched-worker story ends as a settlement rather than a loss.
				const cell = this.cellOf(p);
				if (this.tracker && this.model.actors[cell] === ECONOMY_TOWN) this.tracker.bank(this.wid[p], this.gold[p], cell);
				else if (this.tracker) this.tracker.leftBehind(this.wid[p], this.gold[p], cell);
				this.model.money.orphan(cell, this.gold[p]);
			}
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
		this.tired[p] = this.tired[last];
		this.worked[p] = this.worked[last];
		this.gold[p] = this.gold[last];
		this.intent[p] = this.intent[last];
		this.wid[p] = this.wid[last];
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
		this.tired[p] = s === STATE_DEPLETED ? take : 0;
		this.worked[p] = 0;
		this.gold[p] = gold;
		this.intent[p] = flow.intent ? flow.intent[i] : 0;
		this.wid[p] = this.nextId++;
		this.dockCell[p] = -1;
		this.arriveCell[p] = -1;
		this.emitted++;
		return p;
	}
}

if (typeof module === 'object') module.exports = { WorkerParticles, WORKER_UNIT, WORKER_SPEED, STATE_FRESH, STATE_DEPLETED };
