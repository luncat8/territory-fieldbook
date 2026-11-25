// Owns: preallocated SoA worker particles — FRESH commuters and DEPLETED walkers with personal wallets and settle intent.
// Workers are persistent objects: a docked worker is parked at its cell (not drawn) and keeps its wallet until it
// rests, then leaves by gradient. Docked wallets live on the objects; the cell pool gold is the sum of member
// wallets plus a residual for unmirrored stock, reconciled every tick, so a funded worker keeps his purse across
// docking, shifts, rest and the walk. No gradient means the worker counts as unemployed — the signal to spawn a
// facility. Edit for: worker batch size, walk pace, dock slope.
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
// cell, parked, not drawn). Docked stocks (labor[i], depleted[i] + pool gold and intent) are the cell aggregate the
// B2 rules read and write; syncFromCells reconciles the pools against the personal wallets instead of overwriting
// them, so a worker keeps his money and identity across rest, work and the walk between them.
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
		this.wid = new Int32Array(WORKER_CAP);
		this.moved = new Float64Array(WORKER_CAP);
		this.dockCell = new Int32Array(WORKER_CAP);
		this.arriveCell = new Int32Array(WORKER_CAP);
		this.dockHead = new Int32Array(ECONOMY_SIZE);
		this.dockPrev = new Int32Array(WORKER_CAP);
		this.dockNext = new Int32Array(WORKER_CAP);
		this.queue = new Float64Array(ECONOMY_SIZE);
		this.unemployed = new Float64Array(ECONOMY_SIZE);
		this.residualFresh = new Float64Array(ECONOMY_SIZE);
		this.residualTired = new Float64Array(ECONOMY_SIZE);
		this.pendingFresh = new Float64Array(ECONOMY_SIZE);
		this.pendingTired = new Float64Array(ECONOMY_SIZE);
		this.spawnTakeFresh = new Float64Array(ECONOMY_SIZE);
		this.spawnTakeTired = new Float64Array(ECONOMY_SIZE);
		this.shiftClaims = new Float64Array(ECONOMY_SIZE);
		this.tracker = null;
		this.nextId = 1;
		this.reset();
	}

	reset() {
		this.count = 0;
		this.dockHead.fill(-1);
		this.queue.fill(0);
		this.unemployed.fill(0);
		this.residualFresh.fill(0);
		this.residualTired.fill(0);
		this.pendingFresh.fill(0);
		this.pendingTired.fill(0);
		this.spawnTakeFresh.fill(0);
		this.spawnTakeTired.fill(0);
		this.shiftClaims.fill(0);
		this.nextId = 1;
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

	dockedGold(s, i) {
		let sum = 0;
		for (let p = this.dockHead[i]; p >= 0; p = this.dockNext[p]) if (this.state[p] === s) sum += this.gold[p];
		return sum;
	}

	dockedAmount(s, i) {
		let sum = 0;
		for (let p = this.dockHead[i]; p >= 0; p = this.dockNext[p]) if (this.state[p] === s) sum += this.amount[p];
		return sum;
	}

	// Gold registered by docked fresh workers as shift claims; it sits in the tired pool until they flip tired
	// and reclaim it, so pool moves and spawned workers must never take it.
	claimedShiftGold(i) {
		let sum = 0;
		for (let p = this.dockHead[i]; p >= 0; p = this.dockNext[p]) if (this.state[p] === STATE_FRESH) sum += this.moved[p];
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
		this.releaseState(STATE_FRESH);
		this.releaseState(STATE_DEPLETED);
		this.advanceAll();
		this.admit(STATE_FRESH);
		this.admit(STATE_DEPLETED);
		this.compact();
		this.sweepUnowned();
		this.updateUnemployment();
	}

	// Pool gold with neither docked members nor stock to mirror is unowned — the rounding remainder of departed
	// wallets and abandoned shift claims. Orphaning it to the vault keeps later launches from minting it.
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

	// Re-apply the B2 cell-stock state to the parked objects: B2 flips state (rest, work) and moves pool gold.
	// Pool gold is reconciled, never shared: spends are charged to the workers that paid them and income is
	// credited to the workers that hold the pool now, while unmirrored stock keeps its share in a per-cell
	// residual. Personal wallets therefore survive docking, shifts, rest and the walk between towns.
	syncFromCells() {
		const m = this.model;
		const labor = m.labor, depleted = m.depleted;
		const lfGold = m.laborFlow.gold, dfGold = m.depletedFlow.gold, dfIntent = m.depletedFlow.intent;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (this.dockHead[i] < 0 && labor[i] <= WORKER_DUST && depleted[i] <= WORKER_DUST
				&& Math.abs(this.residualFresh[i]) <= WORKER_DUST && Math.abs(this.residualTired[i]) <= WORKER_DUST) continue;
			this.settlePool(i, STATE_FRESH, labor[i], false);
			this.settlePool(i, STATE_DEPLETED, depleted[i], false);
			let freshTarget = labor[i], depTarget = depleted[i];
			for (let p = this.dockHead[i]; p >= 0; p = this.dockNext[p]) {
				const was = this.state[p];
				if (freshTarget > WORKER_DUST) {
					this.state[p] = STATE_FRESH;
					this.amount[p] = Math.min(this.amount[p], freshTarget);
					freshTarget -= this.amount[p];
				} else {
					this.state[p] = STATE_DEPLETED;
					this.amount[p] = Math.min(this.amount[p], depTarget);
					depTarget -= this.amount[p];
				}
				if (was !== this.state[p]) this.crossDock(p, i, was);
			}
			this.rescueTracked(i);
			this.spawnFromStock(STATE_FRESH, i, freshTarget, null);
			this.spawnFromStock(STATE_DEPLETED, i, depTarget, dfIntent);
			this.settlePool(i, STATE_FRESH, labor[i], true);
			this.settlePool(i, STATE_DEPLETED, depleted[i], true);
			this.residualFresh[i] = lfGold[i] - this.dockedGold(STATE_FRESH, i);
			this.residualTired[i] = dfGold[i] - this.dockedGold(STATE_DEPLETED, i);
		}
	}

	// A watched member whose stock share ran out swaps amounts with an untracked member of the same state:
	// the pool books and the mass ledger stay exact, and population pressure dissolves replaceable surplus
	// instead of a watched worker with a purse.
	rescueTracked(i) {
		if (!this.tracker) return;
		for (let p = this.dockHead[i]; p >= 0; p = this.dockNext[p]) {
			if (!this.isTracked(p) || this.amount[p] > WORKER_DUST) continue;
			for (let q = this.dockHead[i]; q >= 0; q = this.dockNext[q]) {
				if (q === p || this.isTracked(q) || this.state[q] !== this.state[p] || this.amount[q] <= WORKER_DUST) continue;
				this.amount[p] = this.amount[q];
				this.amount[q] = 0;
				break;
			}
		}
	}

	isTracked(p) {
		return !!this.tracker && this.tracker.byId.has(this.wid[p]);
	}


	// One pool's gold reconciliation: delta = pool gold − (member wallets + residual). Spends (delta < 0) hit the
	// members before the state flip — they are the workers that paid — while income (delta > 0) hits the members
	// after the flip, where rest returns savings to the freshly rested. Charges clamp at zero and the residual
	// absorbs every remainder, so member wallets plus residual always equal the pool gold exactly.
	settlePool(i, s, stock, postFlip) {
		const flow = this.flowOf(s);
		const residual = s === STATE_FRESH ? this.residualFresh : this.residualTired;
		const pending = s === STATE_FRESH ? this.pendingFresh : this.pendingTired;
		let sum = 0, sumAmount = 0;
		for (let p = this.dockHead[i]; p >= 0; p = this.dockNext[p]) {
			if (this.state[p] !== s) continue;
			sum += this.gold[p];
			sumAmount += this.amount[p];
		}
		let share;
		if (postFlip) {
			const spawnTake = s === STATE_FRESH ? this.spawnTakeFresh[i] : this.spawnTakeTired[i];
			share = Math.max(0, pending[i] - (s === STATE_DEPLETED ? this.shiftClaims[i] + spawnTake : spawnTake));
			pending[i] = 0;
			if (s === STATE_DEPLETED) this.shiftClaims[i] = 0;
			if (s === STATE_FRESH) this.spawnTakeFresh[i] = 0;
			else this.spawnTakeTired[i] = 0;
		} else {
			const delta = flow.gold[i] - (sum + residual[i]);
			share = Math.min(0, delta);
			pending[i] = Math.max(0, delta);
		}
		if (share === 0) return;
		const denom = Math.max(stock, sumAmount, 1e-9);
		for (let p = this.dockHead[i]; p >= 0; p = this.dockNext[p]) {
			if (this.state[p] !== s || this.amount[p] <= WORKER_DUST) continue;
			const part = share * (this.amount[p] / denom);
			const applied = part < 0 ? Math.max(part, -this.gold[p]) : part;
			if (applied === 0) continue;
			this.gold[p] += applied;
			this.noteWallet(p, applied, s, i);
		}
	}

	// A state flip moves the worker's wallet backing between the fresh and tired pools, and a freshly tired
	// worker reclaims the gold his shift moved ahead of him (it already sits in the tired pool).
	crossDock(p, i, was) {
		const lfGold = this.model.laborFlow.gold, dfGold = this.model.depletedFlow.gold;
		if (was === STATE_FRESH) {
			const g = this.gold[p];
			lfGold[i] -= g;
			dfGold[i] += g;
			this.gold[p] += this.moved[p];
			if (this.moved[p] > 0) this.noteWallet(p, this.moved[p], STATE_DEPLETED, i);
			this.moved[p] = 0;
		} else {
			const g = this.gold[p];
			dfGold[i] -= g;
			lfGold[i] += g;
		}
	}

	// Pending cell stock releases full worker units as docked objects; each spawns with its share of the pool's
	// unclaimed residual gold — the wallet banked for the unmirrored stock it grew out of. The draw is priced from
	// the live pool books (flow gold minus docked wallets), not the stored residual, so freshly flipped reclaims
	// and registered shift claims stay reserved for their owners.
	spawnFromStock(s, i, target, intent) {
		while (target >= WORKER_UNIT) {
			if (this.count >= WORKER_CAP) return;
			let free = Math.max(0, this.flowOf(s).gold[i] - this.dockedGold(s, i));
			if (s === STATE_DEPLETED) free = Math.max(0, free - this.claimedShiftGold(i));
			const take = Math.max(0, free * (WORKER_UNIT / target));
			if (take > 0) {
				if (s === STATE_FRESH) this.spawnTakeFresh[i] += take;
				else this.spawnTakeTired[i] += take;
			}
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
		this.gold[p] = gold;
		this.intent[p] = intent;
		this.wid[p] = this.nextId++;
		this.moved[p] = 0;
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
		this.gold[p] = gold;
		this.intent[p] = 0;
		this.wid[p] = this.nextId++;
		this.moved[p] = 0;
		this.dockCell[p] = -1;
		this.arriveCell[p] = -1;
		this.emitted++;
		return p;
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
		const shift = this.moved[p];
		if (shift > 0) {
			// His shift gold sits in the opposite pool; he takes the claim along as a walker.
			const other = this.flowOf(this.state[p] === STATE_FRESH ? STATE_DEPLETED : STATE_FRESH);
			other.gold[i] = Math.max(0, other.gold[i] - shift);
			this.gold[p] += shift;
			this.noteWallet(p, shift, this.state[p], i);
			this.moved[p] = 0;
		}
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

	// Park a walking worker at a cell as a persistent object: his amount and wallet join the docked aggregate and
	// the object stays alive (dockCell = cell), keeping his money and intent until the gradient sends him on.
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
		if (this.tracker && this.model.actors[i] === ECONOMY_TOWN) this.tracker.visit(this.wid[p], i);
	}

	// Room admission fills each pool in arrival order: a worker docks whole when the pool has room for it, else
	// waits in the queue. Sequential (not normalized) so a burst of arrivals still fills the pool instead of every
	// worker seeing room < 1 and queuing. Fresh arrivals at a firm are paid the entry wage into their own wallet.
	admit(s) {
		const m = this.model, flow = this.flowOf(s), stock = this.stockOf(s);
		for (let p = 0; p < this.count; p++) {
			const b = this.arriveCell[p];
			if (b < 0 || this.dockCell[p] >= 0 || this.state[p] !== s) continue;
			const avail = flow.cap[b] - stock[b];
			if (this.amount[p] <= avail) {
				this.park(p, b);
				if (s === STATE_FRESH) {
					const paid = m.buyArrival(flow, b, this.amount[p] * m.priceLabor[b]);
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
			if (this.dockCell[p] < 0) {
				settled += this.amount[p];
				this.absorbedGold += this.gold[p];
			}
			if (this.tracker && this.gold[p] > 0) this.tracker.bank(this.wid[p], this.gold[p], home);
			this.amount[p] = this.gold[p] = this.intent[p] = this.moved[p] = 0;
		}
		this.compact();
		return settled;
	}

	// A cell about to lose its tired pool pays docked fresh workers their escrowed shift wages on the spot:
	// the claim backing moves from the tired pool to the fresh pool so the wallets stay backed where they are.
	cashClaims(i) {
		const m = this.model;
		let available = m.depletedFlow.gold[i] - this.dockedGold(STATE_DEPLETED, i);
		for (let p = this.dockHead[i]; p >= 0; p = this.dockNext[p]) {
			if (this.state[p] !== STATE_FRESH || this.moved[p] <= 0 || available <= 0) continue;
			const pay = Math.min(this.moved[p], available);
			this.moved[p] -= pay;
			this.gold[p] += pay;
			this.noteWallet(p, pay, STATE_FRESH, i);
			m.laborFlow.gold[i] += pay;
			m.depletedFlow.gold[i] -= pay;
			available -= pay;
		}
	}

	// Founding towns gather parked unemployed workers: docked fresh parkers bring their wallets and stock to
	// the new cell so no wallet loses its pool backing; those that exceed the town's labor room stay parked.
	relocateDocked(from, to) {		const m = this.model;
		let moved = 0;
		let p = this.dockHead[from];
		while (p >= 0) {
			const nx = this.dockNext[p];
			if (this.state[p] === STATE_FRESH && this.amount[p] > WORKER_DUST && m.labor[to] + this.amount[p] <= 1 + 1e-9) {
				const g = this.gold[p], mv = this.moved[p];
				this.unlink(p);
				this.link(p, to);
				this.dockCell[p] = to;
				m.laborFlow.gold[from] = Math.max(0, m.laborFlow.gold[from] - g);
				m.laborFlow.gold[to] += g;
				// Registered shift claims are the worker's own escrowed wages; their tired-pool backing travels
				// with him, or the founding sweep would confiscate gold his flip will reclaim.
				m.depletedFlow.gold[from] = Math.max(0, m.depletedFlow.gold[from] - mv);
				m.depletedFlow.gold[to] += mv;
				m.labor[from] = Math.max(0, m.labor[from] - this.amount[p]);
				m.labor[to] = Math.min(1, m.labor[to] + this.amount[p]);
				if (this.tracker) this.tracker.visit(this.wid[p], to);
				moved += this.amount[p];
			}
			p = nx;
		}
		return moved;
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
		this.gold[p] = this.gold[last];
		this.intent[p] = this.intent[last];
		this.wid[p] = this.wid[last];
		this.moved[p] = this.moved[last];
		this.arriveCell[p] = this.arriveCell[last];
		this.dockCell[p] = lastDock;
		if (lastDock >= 0) this.link(p, lastDock);
	}

	// Worked shifts register their carried gold: each docked fresh member escrows his wallet-weighted share of the
	// shift's wage pool and reclaims it when the sync flips him tired (or abandons it on death). The escrow is
	// capped at the members' combined wallets so the pool books stay exact; the return value is the amount that
	// actually moved and must be transferred from the fresh to the tired pool by the caller.
	moveWorkGold(i, carriedGold) {
		let sumG = 0;
		for (let p = this.dockHead[i]; p >= 0; p = this.dockNext[p]) if (this.state[p] === STATE_FRESH) sumG += this.gold[p];
		if (carriedGold <= 0 || sumG <= 1e-12) return 0;
		const budget = Math.min(carriedGold, sumG);
		let moved = 0;
		for (let p = this.dockHead[i]; p >= 0; p = this.dockNext[p]) {
			if (this.state[p] !== STATE_FRESH) continue;
			const move = Math.min(budget * (this.gold[p] / sumG), this.gold[p]);
			if (move <= 0) continue;
			this.gold[p] -= move;
			this.moved[p] += move;
			this.shiftClaims[i] += move;
			this.noteWallet(p, -move, STATE_FRESH, i);
			moved += move;
		}
		return moved;
	}

	// Rest taxes charge personal wallets: each docked tired worker pays his wallet-weighted share of the pool's
	// living tax; his savings never leave him, so funded commuters keep their purses while resting at towns.
	chargeRestTax(i, restTax) {
		if (restTax <= 0) return;
		let sumG = 0;
		for (let p = this.dockHead[i]; p >= 0; p = this.dockNext[p]) if (this.state[p] === STATE_DEPLETED) sumG += this.gold[p];
		if (sumG <= 1e-12) return;
		for (let p = this.dockHead[i]; p >= 0; p = this.dockNext[p]) {
			if (this.state[p] !== STATE_DEPLETED) continue;
			const pay = Math.min(restTax * (this.gold[p] / sumG), this.gold[p]);
			if (pay <= 0) continue;
			this.gold[p] -= pay;
			this.noteWallet(p, -pay, STATE_DEPLETED, i);
		}
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
		this.wid[p] = this.nextId++;
		this.moved[p] = 0;
		this.dockCell[p] = -1;
		this.arriveCell[p] = -1;
		this.emitted++;
		return p;
	}
}

if (typeof module === 'object') module.exports = { WorkerParticles, WORKER_UNIT, WORKER_SPEED, STATE_FRESH, STATE_DEPLETED };
