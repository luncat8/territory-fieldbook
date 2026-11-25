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
const STARVE_SECONDS = 60;
// A shift longer than this hunger level is interrupted by a food trip: the worker heads home to eat
// before the starvation budget runs out (draft: food is bought at the town bazaar, not delivered to work).
const FOOD_TRIP_HUNGER = STARVE_SECONDS * 0.5;
const FED_COMFORT = 0.15;
const BIRTH_COMFORT = 0.7;
// Starter purse per person a parent needs before splitting; matches the seeded per-capita purse
// (START_TAX_PER_POP * WORKER_SECONDS), which lives in gold.js and loads after this file.
const BIRTH_PURSE = 2.6;
const BIRTH_COOLDOWN_TICKS = 1800;

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
		this.hunger = new Float64Array(WORKER_CAP);
		this.birthTick = new Int32Array(WORKER_CAP);
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
		this.hunger.fill(0);
		this.nextId = 1;
		this.emitted = this.arrivals = this.docked = 0;
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

	// Walkers waiting at a full firm count toward its pool occupancy, so hire bids react to the queue
	// instead of drawing more walkers. Towns keep no pool, so their occupancy stays zero.
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
		this.live();
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
		this.hunger[p] = 0;
		this.birthTick[p] = this.model.ticks;
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
		this.hunger[p] = 0;
		this.birthTick[p] = this.model.ticks;
		this.wid[p] = this.nextId++;
		this.dockCell[p] = -1;
		this.arriveCell[p] = -1;
		this.emitted++;
		return p;
	}

	// A docked worker leaves purely by gradient. A tired worker who has rested partway (fresh units recovered)
	// goes to a job without waiting for full recovery, so his fresh units free the town labor cap that paid rest
	// needs. Firm workers stay to work until exhausted — or until hunger says the shift must break for a food
	// trip home, whichever comes first. No town holds or releases.
	release() {
		const m = this.model, steer = this.steer;
		for (let p = 0; p < this.count; p++) {
			if (this.dockCell[p] < 0) continue;
			const i = this.dockCell[p];
			const fresh = this.portion(p, STATE_FRESH), tired = this.portion(p, STATE_DEPLETED);
			const homeMix = walletWeight(this.gold[p], this.amount[p], m.workforce.refFee);
			if (this.isFirm(i)) {
				// A mostly-tired worker ends its shift and frees the room for the rest; a hungry worker breaks
				// for the bazaar even mid-shift. Its leftover fresh portion is too small to matter. No
				// pool-cap condition — towns and firms manage no wait pool.
				const stuck = tired >= fresh || this.hunger[p] > FOOD_TRIP_HUNGER;
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
		this.queue.fill(0);
		for (let p = 0; p < this.count; p++) {
			if (this.dockCell[p] >= 0) continue;
			this.arriveCell[p] = -1;
			const s = this.state[p], flow = this.flowOf(s), stock = this.stockOf(s);
			const price = this.priceOf(s), alt = this.altOf(s), mix = this.mixOf(p);
			const ci = this.cellOf(p);
			const buyer = (flow.buyers & (1 << m.actors[ci])) !== 0;
			const moving = steer.sampleGradient(price, alt, mix, ci, -Infinity) && steer.grad[2] >= WORKER_DOCK_SLOPE;
			// A worker only waits at a buyer while that buyer is locally the best option: waiting registers
			// the queue that cools the posted bid, and once another buyer outbids the field the walker
			// leaves instead of being held forever on a room sliver no shift-end will open.
			if (buyer && !moving && this.fits(p, ci)) {
				this.arriveCell[p] = ci;
				this.vx[p] = this.vy[p] = 0;
				continue;
			}
		const still = GRADIENT_KNEE / (steer.grad[2] + GRADIENT_KNEE);
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
	}

	fits(p, i) {
		// Whole-worker admission against the plain physical cell bounds: the fresh portion needs labor
		// room at the host, the tired portion needs depleted room in the cell. No pool machinery shrinks
		// these caps any more — they stay at the uniform cell bound, so queuing means a genuinely full cell.
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

	// Workers own their life cycle. A town only feeds whoever is docked there; nobody spawns or despawns
	// from the town side. Fed, comfortable workers with savings split in two, and a worker unfed for
	// STARVE_SECONDS starves wherever he is.
	live() {
		const m = this.model;
		for (let p = 0; p < this.count; p++) {
			const i = this.dockCell[p] >= 0 ? this.dockCell[p] : this.cellOf(p);
			if (m.actors[i] === ECONOMY_TOWN && m.workforce.comfortAt(i) > FED_COMFORT) this.hunger[p] = 0;
			else this.hunger[p] += ECONOMY_DT;
		}
		for (let p = this.count - 1; p >= 0; p--) {
			if (this.hunger[p] < STARVE_SECONDS) continue;
			this.starve(p);
		}
		this.split();
	}

	// A starved worker leaves the world: his purse orphans where he fell (towns inherit, open ground goes
	// to the haul vault) and his portions book as starved on both mass sides, so no identity needs a case.
	starve(p) {
		const m = this.model;
		const cell = this.cellOf(p);
		m.starvedLabor += this.portion(p, STATE_FRESH);
		m.starvedTired += this.tired[p];
		m.starved++;
		if (this.tracker) this.tracker.starved(this.wid[p], this.gold[p], cell);
		const dock = this.dockCell[p];
		if (dock >= 0) {
			// His portions leave the host stock with him: a docked worker's mass lives in the cell pools,
			// so removing the object without releasing them would leave phantom mass behind.
			m.labor[dock] = Math.max(0, m.labor[dock] - this.portion(p, STATE_FRESH));
			m.depleted[dock] = Math.max(0, m.depleted[dock] - this.tired[p]);
			this.flowOf(this.state[p]).gold[dock] = Math.max(0, this.flowOf(this.state[p]).gold[dock] - this.gold[p]);
		}
		if (this.gold[p] > 0) m.money.orphan(cell, this.gold[p]);
		if (dock >= 0) this.unlink(p);
		this.removeAt(p);
	}

	// A fed worker whose needs are met and who holds a starter purse splits in two. The child is a new
	// person: his portions join the home cell stock and book as granted supply, like the tracked-worker
	// tool; he starts broke and earns his own purse, so savings are never split and no ledger needs a
	// case. Births pace on the cooldown and the home cell's room, with no town action at all.
	split() {
		const m = this.model;
		for (let p = 0; p < this.count; p++) {
			if (this.count >= WORKER_CAP) return;
			if (this.hunger[p] > WORKER_DUST || this.dockCell[p] < 0) continue;
			if (m.ticks - this.birthTick[p] < BIRTH_COOLDOWN_TICKS) continue;
			const home = this.dockCell[p];
			if (m.actors[home] !== ECONOMY_TOWN || m.workforce.comfortAt(home) < BIRTH_COMFORT) continue;
			if (this.gold[p] < BIRTH_PURSE * (this.amount[p] / WORKER_UNIT)) continue;
			const fresh = this.portion(p, STATE_FRESH);
			if (m.labor[home] + fresh > m.laborFlow.cap[home] + WORKER_DUST) continue;
			if (m.depleted[home] + this.tired[p] > 1 + WORKER_DUST) continue;
			this.spawnSplit(p, home, fresh);
		}
	}

	spawnSplit(p, home, fresh) {
		const m = this.model;
		const child = this.count++;
		this.state[child] = this.state[p];
		this.x[child] = this.x[p];
		this.y[child] = this.y[p];
		this.vx[child] = this.vy[child] = 0;
		this.amount[child] = this.amount[p];
		this.tired[child] = this.tired[p];
		this.worked[child] = 0;
		this.gold[child] = 0;
		this.intent[child] = 0;
		this.hunger[child] = 0;
		this.birthTick[child] = m.ticks;
		this.wid[child] = this.nextId++;
		this.arriveCell[child] = -1;
		this.dockCell[child] = home;
		this.link(child, home);
		this.birthTick[p] = m.ticks;
		m.labor[home] += fresh;
		m.depleted[home] += this.tired[child];
		m.suppliedLabor += fresh;
		m.emittedDepleted += this.tired[child];
		m.births++;
		if (this.tracker) this.tracker.born(this.wid[p], this.wid[child], home);
	}

	// Founding docks walking depleted settlers at the new town as its first resting residents; their
	// savings bank into the household purse. Settlers the cell cannot hold keep walking with their
	// wallets, and forget the pledge once a home field reaches them.
	absorbNear(cx, cy, radius) {
		const m = this.model;
		const home = economyIndex(Math.round(cx), Math.round(cy));
		for (let p = 0; p < this.count; p++) {
			if (this.state[p] !== STATE_DEPLETED || this.dockCell[p] >= 0) continue;
			if (Math.abs(this.x[p] - cx) > radius || Math.abs(this.y[p] - cy) > radius) continue;
			if (!this.fits(p, home)) continue;
			const gold = this.gold[p];
			this.park(p, home);
			this.gold[p] = 0;
			m.depletedFlow.gold[home] = Math.max(0, m.depletedFlow.gold[home] - gold);
			m.money.workerPurse[home] += gold;
			if (this.tracker && gold > 0) this.tracker.bank(this.wid[p], gold, home);
		}
	}

	// Founding towns gather parked workers: docked workers bring their wallets, stock and shift-claim
	// backing to the new cell so no wallet loses its pool backing; those that exceed the town's room
	// stay parked.
	relocateDocked(from, to) {
		const m = this.model;
		let moved = 0;
		let p = this.dockHead[from];
		while (p >= 0) {
			const nx = this.dockNext[p];
			const fresh = this.portion(p, STATE_FRESH), tired = this.tired[p];
			const room = m.labor[to] + fresh <= 1 + 1e-9 && m.depleted[to] + tired <= 1 + 1e-9;
			if (this.amount[p] > WORKER_DUST && room) {
				const g = this.gold[p];
				this.unlink(p);
				this.link(p, to);
				this.dockCell[p] = to;
				const flow = this.flowOf(this.state[p]);
				flow.gold[from] = Math.max(0, flow.gold[from] - g);
				flow.gold[to] += g;
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
		this.hunger[p] = this.hunger[last];
		this.birthTick[p] = this.birthTick[last];
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
		this.hunger[p] = 0;
		this.birthTick[p] = this.model.ticks;
		this.wid[p] = this.nextId++;
		this.dockCell[p] = -1;
		this.arriveCell[p] = -1;
		this.emitted++;
		return p;
	}
}

if (typeof module === 'object') module.exports = { WorkerParticles, WORKER_UNIT, WORKER_SPEED, STATE_FRESH, STATE_DEPLETED };
