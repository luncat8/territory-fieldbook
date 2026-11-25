// Owns: the SoA worker particle pool, life-cycle transitions (including FORAGE), entry wages, room fees and watched-worker events.
// Edit for: shift work rate, personal food burn/thresholds, FIFO queue promotion and watched-worker event logging.
'use strict';

const MAX_WORKERS = 512;
const WORKER_UNIT = 1;
const WORKER_WALK_JOB = 0;
const WORKER_FIRM_POOL = 1;
const WORKER_SHIFT = 2;
const WORKER_WALK_HOME = 3;
const WORKER_TOWN_WAIT = 4;
const WORKER_ROOM = 5;
const WORKER_STILL = 6;
const WORKER_FORAGE = 7;
const WORKER_STATE_NAMES = ['Walk job', 'Firm pool', 'Shift', 'Walk home', 'Town wait', 'Room', 'Still', 'Forage'];
const WORK_RATE = 0.22;
const FOOD_BAG = 1;
const FOOD_HUNGRY = 0.06;
const FOOD_FULL = 0.92;
const FOOD_BURN_IDLE = 0.011;
const FOOD_BURN_WALK = 0.018;
const FOOD_BURN_WORK = 0.028;
const FOOD_BURN_FORAGE = 0.003;
const WATCH_LOG_CAP = 8;
const EVT_WAGE = 1;
const EVT_WAIT = 2;
const EVT_TAX = 3;
const EVT_RATION = 4;
const EVT_LEAVE = 5;
const EVT_FORAGE = 6;
const EVT_FED = 7;
const EVT_NAMES = ['', 'Wage', 'Wait', 'Tax', 'Ration', 'Leave', 'Forage', 'Fed'];

class WorkerPool {
	constructor(model) {
		this.model = model;
		this.count = 0;
		this.nextId = 0;
		this.id = new Int32Array(MAX_WORKERS);
		this.state = new Uint8Array(MAX_WORKERS);
		this.cell = new Int32Array(MAX_WORKERS);
		this.x = new Float64Array(MAX_WORKERS);
		this.y = new Float64Array(MAX_WORKERS);
		this.hx = new Float64Array(MAX_WORKERS);
		this.hy = new Float64Array(MAX_WORKERS);
		this.amount = new Float64Array(MAX_WORKERS);
		this.tired = new Float64Array(MAX_WORKERS);
		this.paidRest = new Float64Array(MAX_WORKERS);
		this.gold = new Float64Array(MAX_WORKERS);
		this.food = new Float64Array(MAX_WORKERS);
		this.intent = new Float64Array(MAX_WORKERS);
		this.since = new Int32Array(MAX_WORKERS);
		this.columns = [this.id, this.state, this.cell, this.x, this.y, this.hx, this.hy, this.amount, this.tired, this.paidRest, this.gold, this.food, this.intent, this.since];
		this.watchedId = -1;
		this.logHead = 0;
		this.logCount = 0;
		this.logTick = new Int32Array(WATCH_LOG_CAP);
		this.logKind = new Uint8Array(WATCH_LOG_CAP);
		this.logVal = new Float64Array(WATCH_LOG_CAP);
		this.logCell = new Int32Array(WATCH_LOG_CAP);
	}

	reset() {
		this.count = this.nextId = this.seededWorkers = this.seededTired = this.births = this.forageEntries = 0;
		this.watchedId = -1;
		this.logHead = this.logCount = 0;
	}

	seedReference() {
		const { actors, money } = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (actors[i] !== ECONOMY_TOWN) continue;
			this.model.localWealth[i] = SEED_WORKER_GOLD;
			const cx = (i % ECONOMY_WIDTH) + 0.5, cy = Math.floor(i / ECONOMY_WIDTH) + 0.5;
			for (let n = 0; n < SEED_WORKERS_PER_TOWN; n++) {
				const inRoom = n < 7, tired = inRoom ? 0.15 + 0.75 * (n / 7) : 0;
				const food = 0.65 + 0.35 * (((n + 1) * 0.6180339887) % 1);
				const w = this.spawn(cx, cy, inRoom ? WORKER_ROOM : WORKER_STILL, tired, SEED_WORKER_GOLD, food, true);
				if (w >= 0 && inRoom) this.paidRest[w] = tired;
				if (w >= 0) money.seedWorker(SEED_WORKER_GOLD);
			}
		}
		if (this.count > 0) this.watch(this.id[0]);
	}

	spawn(x, y, state, tired, gold, food, isSeed) {
		if (this.count >= MAX_WORKERS) return -1;
		const w = this.count++;
		const c = economyIndex(Math.min(ECONOMY_WIDTH - 1, Math.max(0, Math.floor(x))), Math.min(ECONOMY_HEIGHT - 1, Math.max(0, Math.floor(y))));
		this.id[w] = ++this.nextId;
		this.state[w] = state;
		this.cell[w] = c;
		this.x[w] = x; this.y[w] = y;
		this.hx[w] = this.hy[w] = 0;
		this.amount[w] = WORKER_UNIT;
		this.tired[w] = tired;
		this.paidRest[w] = this.intent[w] = 0;
		this.gold[w] = gold;
		this.food[w] = food;
		this.since[w] = this.model.ticks || 0;
		this.model.workerLife.init(w);
		if (isSeed) { this.seededWorkers += WORKER_UNIT; this.seededTired += tired; }
		else this.births += WORKER_UNIT;
		return w;
	}

	watch(workerId) {
		this.watchedId = workerId;
		this.logHead = this.logCount = 0;
	}

	indexOfId(workerId) {
		for (let w = 0; w < this.count; w++) if (this.id[w] === workerId) return w;
		return -1;
	}

	pickNear(gx, gy, maxDist = 1.4) {
		let best = -1, bestD = maxDist;
		for (let w = 0; w < this.count; w++) {
			const d = Math.hypot(this.x[w] - gx, this.y[w] - gy);
			if (d < bestD) { bestD = d; best = this.id[w]; }
		}
		return best;
	}

	logEvent(w, kind, val) {
		if (this.id[w] !== this.watchedId) return;
		const slot = this.logHead;
		this.logTick[slot] = this.model.ticks;
		this.logKind[slot] = kind;
		this.logVal[slot] = val;
		this.logCell[slot] = this.cell[w];
		this.logHead = (slot + 1) % WATCH_LOG_CAP;
		if (this.logCount < WATCH_LOG_CAP) this.logCount++;
	}

	setState(w, next) {
		if (this.state[w] === next) return;
		this.state[w] = next;
		this.since[w] = this.model.ticks;
		if (!this.isWalking(next)) {
			this.hx[w] = 0;
			this.hy[w] = 0;
			this.x[w] = (this.cell[w] % ECONOMY_WIDTH) + 0.5;
			this.y[w] = Math.floor(this.cell[w] / ECONOMY_WIDTH) + 0.5;
		}
	}

	isWalking(st) {
		return st === WORKER_WALK_JOB || st === WORKER_WALK_HOME || st === WORKER_FORAGE;
	}

	totalAmount() { let s = 0; for (let w = 0; w < this.count; w++) s += this.amount[w]; return s; }
	totalTired() { let s = 0; for (let w = 0; w < this.count; w++) s += this.tired[w]; return s; }
	totalGold() { let s = 0; for (let w = 0; w < this.count; w++) s += this.gold[w]; return s; }

	hasOnSite(cell) {
		for (let w = 0; w < this.count; w++) if (this.cell[w] === cell && (this.state[w] === WORKER_SHIFT || this.state[w] === WORKER_FIRM_POOL)) return true;
		return false;
	}

	payOnSite(cell, totalPay) {
		let weight = 0;
		for (let w = 0; w < this.count; w++) {
			if (this.cell[w] === cell && (this.state[w] === WORKER_SHIFT || this.state[w] === WORKER_FIRM_POOL)) weight += this.amount[w];
		}
		if (weight <= 0) return;
		for (let w = 0; w < this.count; w++) {
			if (this.cell[w] === cell && (this.state[w] === WORKER_SHIFT || this.state[w] === WORKER_FIRM_POOL)) {
				this.gold[w] += totalPay * (this.amount[w] / weight);
			}
		}
	}

	evictCell(cell) {
		for (let w = 0; w < this.count; w++) {
			if (this.cell[w] !== cell) continue;
			const st = this.state[w];
			if (st === WORKER_FIRM_POOL || st === WORKER_SHIFT || st === WORKER_TOWN_WAIT || st === WORKER_ROOM) {
				this.paidRest[w] = 0;
				this.setState(w, WORKER_STILL);
			}
		}
	}

	accumulateView() {
		const m = this.model;
		for (let w = 0; w < this.count; w++) {
			const c = this.cell[w], st = this.state[w];
			const amt = this.amount[w], tr = this.tired[w], fr = Math.max(0, amt - tr);
			m.workerGold[c] += this.gold[w];
			if (st === WORKER_FIRM_POOL) {
				m.poolCount[c] += amt;
				m.labor[c] += fr;
			} else if (st === WORKER_SHIFT) {
				m.shiftCount[c] += amt;
				m.labor[c] += fr;
				m.shiftAvail[c] += Math.min(fr, WORK_RATE * amt * ECONOMY_DT);
			} else if (st === WORKER_TOWN_WAIT) {
				m.waitCount[c] += amt;
				m.pop[c] += amt;
				m.depleted[c] += tr;
			} else if (st === WORKER_ROOM) {
				m.roomCount[c] += amt;
				m.pop[c] += amt;
			} else if (st === WORKER_STILL) {
				if (tr > 1e-6) { m.stillDep[c] += tr; m.depleted[c] += tr; }
				else { m.stillFresh[c] += amt; m.labor[c] += amt; }
			} else if (st === WORKER_WALK_JOB) {
				m.labor[c] += fr;
			} else if (st === WORKER_WALK_HOME) {
				m.depleted[c] += tr;
			} else if (st === WORKER_FORAGE) {
				m.forageCount[c] += amt;
			}
		}
	}

	// Distributes exact recipe labor across SHIFT workers at cell and sends finished workers home.
	applyShiftWork(cell, usedLabor) {
		if (usedLabor <= 1e-12) return;
		const avail = this.model.shiftAvail[cell];
		if (avail <= 1e-12) return;
		const ratio = Math.min(1, usedLabor / avail);
		let actual = 0;
		for (let w = 0; w < this.count; w++) {
			if (this.cell[w] !== cell || this.state[w] !== WORKER_SHIFT) continue;
			const cap = Math.min(this.amount[w] - this.tired[w], WORK_RATE * this.amount[w] * ECONOMY_DT);
			const work = cap * ratio;
			this.tired[w] = Math.min(this.amount[w], this.tired[w] + work);
			actual += work;
			if (this.tired[w] >= this.amount[w] - 1e-7) {
				this.tired[w] = this.amount[w];
				this.setState(w, WORKER_WALK_HOME);
			}
		}
		this.model.workedLabor += actual;
	}

	tryAdmitFirm(w, c) {
		const m = this.model, opt = m.optimizer;
		if (!opt.isHiringFirm(c)) return false;
		const fr = this.amount[w] - this.tired[w];
		if (fr <= 1e-6) return false;
		const shiftSlots = opt.shiftSlots(c);
		const totalCap = shiftSlots + opt.poolSlots(c);
		if (m.shiftCount[c] + m.poolCount[c] + this.amount[w] > totalCap + 1e-6) return false;
		const bill = m.priceLabor[c] * fr;
		if (bill > 0 && m.money.purse[c] <= 1e-9 && m.money.owedWage[c] > START_PRICE * 1.5) return false;
		m.money.payEntryWage(c, w, bill);
		opt.laborCost[c] += bill;
		if (bill > 0) this.logEvent(w, EVT_WAGE, bill);
		if (m.shiftCount[c] + this.amount[w] <= shiftSlots + 1e-6) {
			m.shiftCount[c] += this.amount[w];
			this.setState(w, WORKER_SHIFT);
		} else {
			m.poolCount[c] += this.amount[w];
			this.setState(w, WORKER_FIRM_POOL);
		}
		return true;
	}

	checkInRoom(w, c) {
		const m = this.model, towns = m.towns;
		const tr = this.tired[w];
		const feeRate = towns.restTax(c);
		const fullFee = feeRate * tr;
		if (fullFee > 1e-9 && this.gold[w] <= 1e-6) return false;
		m.towns.observeWallet(c, this.gold[w] / this.amount[w]);
		let paid = 0;
		if (fullFee <= 1e-9) {
			this.paidRest[w] = tr;
		} else if (this.gold[w] >= fullFee) {
			paid = fullFee;
			this.gold[w] -= fullFee;
			this.paidRest[w] = tr;
		} else {
			paid = this.gold[w];
			this.paidRest[w] = tr * (paid / fullFee);
			this.gold[w] = 0;
		}
		if (paid > 0) {
			m.money.payTown(c, paid);
			this.logEvent(w, EVT_TAX, paid);
		}
		m.roomCount[c] += this.amount[w];
		this.setState(w, WORKER_ROOM);
		towns.buyRation(c, w);
		return true;
	}

	tryAdmitTown(w, c) {
		const m = this.model, towns = m.towns;
		if (m.actors[c] !== ECONOMY_TOWN || m.rooms[c] <= 0) return false;
		const feeRate = towns.restTax(c);
		if (feeRate > 1e-9 && this.gold[w] <= 1e-6) return false;
		if (m.roomCount[c] + this.amount[w] <= m.rooms[c] + 1e-6) return this.checkInRoom(w, c);
		if (m.waitCount[c] + this.amount[w] <= towns.waitCap(c) + 1e-6) {
			m.waitCount[c] += this.amount[w];
			this.setState(w, WORKER_TOWN_WAIT);
			this.logEvent(w, EVT_WAIT, m.waitCount[c]);
			return true;
		}
		return false;
	}

	step() {
		const m = this.model, { steering, forage, workforce, towns, land } = m;
		const shelterShare = workforce.restShare;
		let tickRested = 0;
		for (let w = 0; w < this.count; w++) {
			let st = this.state[w], c = this.cell[w];
			const burn = st === WORKER_SHIFT ? FOOD_BURN_WORK : (st === WORKER_WALK_JOB || st === WORKER_WALK_HOME) ? FOOD_BURN_WALK : st === WORKER_FORAGE ? FOOD_BURN_FORAGE : FOOD_BURN_IDLE;
			this.food[w] = Math.max(0, this.food[w] - burn * ECONOMY_DT);
			if (st !== WORKER_FORAGE && m.actors[c] === ECONOMY_TOWN && this.food[w] < 0.75 * FOOD_BAG) towns.buyRation(c, w);
			if (st !== WORKER_FORAGE && this.food[w] <= FOOD_HUNGRY) {
				this.paidRest[w] = 0;
				this.setState(w, WORKER_FORAGE);
				this.forageEntries++;
				this.logEvent(w, EVT_FORAGE, this.gold[w]);
				st = WORKER_FORAGE;
			}
			if (st === WORKER_FORAGE) {
				tickRested += this.stepForager(w, shelterShare);
				continue;
			}
			if (st === WORKER_WALK_JOB) {
				this.stepWalkJob(w);
			} else if (st === WORKER_WALK_HOME) {
				this.stepWalkHome(w);
			} else if (st === WORKER_ROOM) {
				tickRested += this.stepRoom(w);
			} else if (st === WORKER_TOWN_WAIT) {
				const wMix = walletWeight(this.gold[w], this.amount[w], BASE_REST_FEE);
				if ((towns.restTax(c) > 1e-9 && this.gold[w] <= 1e-6) || steering.hasBetterNeighbor(m.priceHome, m.priceRest, wMix, c)) {
					this.setState(w, WORKER_WALK_HOME);
				}
			} else if (st === WORKER_STILL) {
				if (this.tired[w] > 1e-9) {
					const rest = Math.min(this.tired[w], this.amount[w] * shelterShare * land.rest[c]);
					this.tired[w] = Math.max(0, this.tired[w] - rest);
					tickRested += rest;
					if (this.tired[w] <= 1e-8) this.tired[w] = 0;
					this.relaunchTired(w);
				} else {
					this.relaunchFresh(w);
				}
			}
		}
		m.restedDepleted += tickRested;
		this.promoteQueues();
	}

	// Dedicated FORAGE mode ignores job/home/founding tasks until personal food reaches FOOD_FULL.
	stepForager(w, shelterShare) {
		const m = this.model, { steering, forage, land } = m;
		const c = this.cell[w];
		let rested = 0;
		const picked = forage.pickAt(c, FOOD_BAG - this.food[w]);
		this.food[w] = Math.min(FOOD_BAG, this.food[w] + picked);
		if (this.tired[w] > 1e-9) {
			rested = Math.min(this.tired[w], this.amount[w] * shelterShare * land.rest[c] * 0.55);
			this.tired[w] = Math.max(0, this.tired[w] - rested);
			if (this.tired[w] <= 1e-8) this.tired[w] = 0;
		}
		if (this.food[w] >= FOOD_FULL) {
			this.logEvent(w, EVT_FED, this.food[w]);
			if (this.tired[w] <= 1e-6) {
				this.setState(w, WORKER_STILL);
				this.relaunchFresh(w);
			} else {
				this.setState(w, WORKER_STILL);
				this.relaunchTired(w);
			}
			return rested;
		}
		steering.sampleForage(forage, c);
		if (steering.grad.bestSlope > 0 && steering.advance(this.x[w], this.y[w], this.hx[w], this.hy[w], WORKER_SPEED)) {
			this.x[w] = steering.out.x;
			this.y[w] = steering.out.y;
			this.hx[w] = steering.out.hx;
			this.hy[w] = steering.out.hy;
			this.cell[w] = steering.out.cell;
		} else {
			this.hx[w] = 0;
			this.hy[w] = 0;
		}
		return rested;
	}

	stepWalkJob(w) {
		const m = this.model, { steering } = m, c = this.cell[w];
		if (this.tryAdmitFirm(w, c)) return;
		steering.sampleField(m.priceLabor, null, 0, c, 0);
		if (steering.grad.bestPull < DOCK_SLOPE) {
			this.setState(w, WORKER_STILL);
			return;
		}
		if (!steering.advance(this.x[w], this.y[w], this.hx[w], this.hy[w], WORKER_SPEED)) return;
		this.x[w] = steering.out.x;
		this.y[w] = steering.out.y;
		this.hx[w] = steering.out.hx;
		this.hy[w] = steering.out.hy;
		this.cell[w] = steering.out.cell;
		this.tryAdmitFirm(w, this.cell[w]);
	}

	stepWalkHome(w) {
		const m = this.model, { steering } = m, c = this.cell[w];
		const wMix = walletWeight(this.gold[w], this.amount[w], BASE_REST_FEE);
		if (m.actors[c] === ECONOMY_TOWN && !steering.hasBetterNeighbor(m.priceHome, m.priceRest, wMix, c) && this.tryAdmitTown(w, c)) return;
		steering.sampleField(m.priceHome, m.priceRest, wMix, c, 0);
		if (steering.grad.bestPull < DOCK_SLOPE) {
			this.setState(w, WORKER_STILL);
			return;
		}
		if (!steering.advance(this.x[w], this.y[w], this.hx[w], this.hy[w], WORKER_SPEED)) return;
		this.x[w] = steering.out.x;
		this.y[w] = steering.out.y;
		this.hx[w] = steering.out.hx;
		this.hy[w] = steering.out.hy;
		this.cell[w] = steering.out.cell;
		const nc = this.cell[w];
		if (m.actors[nc] === ECONOMY_TOWN && !steering.hasBetterNeighbor(m.priceHome, m.priceRest, wMix, nc)) this.tryAdmitTown(w, nc);
	}

	stepRoom(w) {
		const m = this.model, c = this.cell[w];
		if (m.actors[c] !== ECONOMY_TOWN) {
			this.paidRest[w] = 0;
			this.setState(w, WORKER_STILL);
			return 0;
		}
		const rate = m.towns.roomRestRate(c);
		const recover = Math.min(this.tired[w], this.paidRest[w], rate * this.amount[w] * ECONOMY_DT);
		this.tired[w] = Math.max(0, this.tired[w] - recover);
		this.paidRest[w] = Math.max(0, this.paidRest[w] - recover);
		if (this.tired[w] <= 1e-8) {
			this.tired[w] = 0;
			this.paidRest[w] = 0;
			this.logEvent(w, EVT_LEAVE, this.gold[w]);
			this.setState(w, WORKER_STILL);
			this.relaunchFresh(w);
		} else if (this.paidRest[w] <= 1e-8) {
			this.paidRest[w] = 0;
			this.setState(w, WORKER_STILL);
		}
		return recover;
	}

	relaunchFresh(w) {
		const m = this.model, c = this.cell[w];
		if (this.tryAdmitFirm(w, c)) return;
		m.steering.sampleField(m.priceLabor, null, 0, c, 0);
		if (m.steering.grad.bestPull >= DOCK_SLOPE) this.setState(w, WORKER_WALK_JOB);
	}

	relaunchTired(w) {
		const m = this.model, c = this.cell[w];
		const wMix = walletWeight(this.gold[w], this.amount[w], BASE_REST_FEE);
		if (m.actors[c] === ECONOMY_TOWN && !m.steering.hasBetterNeighbor(m.priceHome, m.priceRest, wMix, c) && this.tryAdmitTown(w, c)) return;
		m.steering.sampleField(m.priceHome, m.priceRest, wMix, c, 0);
		if (m.steering.grad.bestPull >= DOCK_SLOPE) this.setState(w, WORKER_WALK_HOME);
	}

	// FIFO promotion by earliest `since` moves queued pool workers into shifts and town waiters into vacated rooms.
	promoteQueues() {
		const m = this.model;
		for (let pass = 0; pass < 2; pass++) {
			let bestShiftW = -1, bestRoomW = -1;
			for (let w = 0; w < this.count; w++) {
				const c = this.cell[w], st = this.state[w];
				if (st === WORKER_FIRM_POOL && m.shiftCount[c] + this.amount[w] <= m.optimizer.shiftSlots(c) + 1e-6) {
					if (bestShiftW < 0 || this.since[w] < this.since[bestShiftW]) bestShiftW = w;
				} else if (st === WORKER_TOWN_WAIT && m.roomCount[c] + this.amount[w] <= m.rooms[c] + 1e-6) {
					if (bestRoomW < 0 || this.since[w] < this.since[bestRoomW]) bestRoomW = w;
				}
			}
			if (bestShiftW >= 0) {
				const c = this.cell[bestShiftW];
				m.poolCount[c] -= this.amount[bestShiftW];
				m.shiftCount[c] += this.amount[bestShiftW];
				this.setState(bestShiftW, WORKER_SHIFT);
			}
			if (bestRoomW >= 0) {
				const c = this.cell[bestRoomW];
				m.waitCount[c] -= this.amount[bestRoomW];
				if (!this.checkInRoom(bestRoomW, c)) this.setState(bestRoomW, WORKER_STILL);
			}
			if (bestShiftW < 0 && bestRoomW < 0) break;
		}
	}
}

if (typeof module === 'object') module.exports = { WorkerPool, WORKER_UNIT, WORKER_WALK_JOB, WORKER_FIRM_POOL, WORKER_SHIFT, WORKER_WALK_HOME, WORKER_TOWN_WAIT, WORKER_ROOM, WORKER_STILL, WORKER_FORAGE, WORKER_STATE_NAMES, FOOD_BAG, FOOD_HUNGRY, FOOD_FULL, EVT_NAMES };
