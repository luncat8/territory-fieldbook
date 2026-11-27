// Owns: the free-workforce idle grid, resource deposit mask, construction sites and firm founding without minted gold.
// Edit for: idle founder threshold, deposit distribution, mine/factory siting margin and founder build work.
'use strict';

const FIRM_SCAN_TICKS = 150;
const FIRM_COOLDOWN_TICKS = 360;
const FIRM_RADIUS = 2;
const FIRM_SEARCH_RADIUS = 6;
const FIRM_FOUNDERS = 3;
const FIRM_BUILD_WORK = 1.0;
const FOUNDER_BUILD_RATE = 0.45;

class FirmFounding {
	constructor(model) {
		this.model = model;
		this.deposit = new Uint8Array(ECONOMY_SIZE);
		this.idle = new Float64Array(ECONOMY_SIZE);
		this.building = new Uint8Array(ECONOMY_SIZE);
		this.buildProgress = new Float64Array(ECONOMY_SIZE);
		this.seedDeposits();
	}

	seedDeposits() {
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const x = i % ECONOMY_WIDTH, y = Math.floor(i / ECONOMY_WIDTH);
			const seam = 0.55 + 0.35 * Math.sin(x * 0.37 + 0.6) * Math.cos(y * 0.41 + 1.1) + 0.15 * Math.cos((x - y) * 0.31);
			this.deposit[i] = seam >= 0.42 ? 1 : 0;
		}
	}

	reset() {
		this.idle.fill(0);
		this.building.fill(0);
		this.buildProgress.fill(0);
		this.ticks = this.founded = this.completed = 0;
		this.lastFound = -FIRM_COOLDOWN_TICKS;
		this.hadIdle = false;
	}

	clearSite(i) {
		this.building[i] = 0;
		this.buildProgress[i] = 0;
	}

	isBuilding(i) {
		return this.building[i] !== 0;
	}

	hasProject(workerId) {
		const { owners } = this.model;
		for (let id = 1; id < owners.facilities.length; id++) {
			const f = owners.facilities[id];
			if (f.cell >= 0 && this.building[f.cell] && owners.accounts[f.owner].workerId === workerId) return true;
		}
		return false;
	}

	founderId(cell) {
		const { workers } = this.model;
		let best = -1, rank = Infinity;
		for (let w = 0; w < workers.count; w++) {
			if (workers.state[w] !== WORKER_STILL || workers.tired[w] > 1e-6) continue;
			const d = Math.max(Math.abs(torusDelta(workers.x[w] - cell % ECONOMY_WIDTH - 0.5, ECONOMY_WIDTH)), Math.abs(torusDelta(workers.y[w] - Math.floor(cell / ECONOMY_WIDTH) - 0.5, ECONOMY_HEIGHT)));
			if (d > FIRM_SEARCH_RADIUS) continue;
			const draw = Math.imul(workers.id[w] ^ Math.imul(cell + 1, 2246822519) ^ Math.imul(this.ticks + 1, 3266489917), 2654435761) >>> 0;
			if (draw >= rank) continue;
			rank = draw;
			best = workers.id[w];
		}
		return best;
	}

	step() {
		const m = this.model, { workers } = m;
		this.ticks++;
		this.stepConstruction();
		if (this.hadIdle) this.idle.fill(0);
		this.hadIdle = false;
		let bestAnchor = -1, bestCount = FIRM_FOUNDERS - 1e-6;
		for (let w = 0; w < workers.count; w++) {
			if (workers.state[w] !== WORKER_STILL || workers.tired[w] > 1e-6) continue;
			const c = workers.cell[w];
			const cx = c % ECONOMY_WIDTH, cy = Math.floor(c / ECONOMY_WIDTH);
			this.hadIdle = true;
			for (let y = cy - FIRM_RADIUS, yEnd = cy + FIRM_RADIUS; y <= yEnd; y++) {
				const wy = MAP_WRAP ? wrapY(y) : y;
				if (wy < 0 || wy >= ECONOMY_HEIGHT) continue;
				for (let x = cx - FIRM_RADIUS, xEnd = cx + FIRM_RADIUS; x <= xEnd; x++) {
					const wx = MAP_WRAP ? wrapX(x) : x;
					if (wx < 0 || wx >= ECONOMY_WIDTH) continue;
					const n = economyIndex(wx, wy);
					this.idle[n] += workers.amount[w];
					if (this.idle[n] > bestCount) {
						bestCount = this.idle[n];
						bestAnchor = n;
					}
				}
			}
		}
		if (this.ticks % FIRM_SCAN_TICKS !== 0) return;
		if (bestAnchor < 0 || this.ticks - this.lastFound < FIRM_COOLDOWN_TICKS) return;
		this.scanAndFound(bestAnchor);
	}

	// Idle founders within reach contribute sweat equity to finish construction with zero minted gold.
	stepConstruction() {
		const m = this.model, { workers } = m;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (!this.building[i] || m.actors[i] === ECONOMY_FARM) continue;
			const sx = i % ECONOMY_WIDTH, sy = Math.floor(i / ECONOMY_WIDTH);
			for (let w = 0; w < workers.count; w++) {
				if (workers.state[w] !== WORKER_STILL || workers.tired[w] >= workers.amount[w] - 1e-6) continue;
				const wc = workers.cell[w];
				const wx = wc % ECONOMY_WIDTH, wy = Math.floor(wc / ECONOMY_WIDTH);
				if (Math.abs(torusDelta(wx - sx, ECONOMY_WIDTH)) > FIRM_SEARCH_RADIUS
					|| Math.abs(torusDelta(wy - sy, ECONOMY_HEIGHT)) > FIRM_SEARCH_RADIUS) continue;
				const work = Math.min(workers.amount[w] - workers.tired[w], FOUNDER_BUILD_RATE * ECONOMY_DT);
				workers.tired[w] += work;
				m.workedLabor += work;
				this.buildProgress[i] += work;
				if (workers.tired[w] >= workers.amount[w] - 1e-7) {
					workers.tired[w] = workers.amount[w];
					workers.setState(w, WORKER_WALK_HOME);
				}
				if (this.buildProgress[i] >= FIRM_BUILD_WORK) break;
			}
			if (this.buildProgress[i] >= FIRM_BUILD_WORK) {
				this.building[i] = 0;
				this.completed++;
			}
		}
	}

	scanAndFound(anchor) {
		const m = this.model, { actors, land, forage } = m;
		const ax = anchor % ECONOMY_WIDTH, ay = Math.floor(anchor / ECONOMY_WIDTH);
		let bestCell = -1, bestKind = 0, bestValue = 0;
		for (let y = ay - FIRM_SEARCH_RADIUS, yEnd = ay + FIRM_SEARCH_RADIUS; y <= yEnd; y++) {
			const wy = MAP_WRAP ? wrapY(y) : y;
			if (wy < 0 || wy >= ECONOMY_HEIGHT) continue;
			for (let x = ax - FIRM_SEARCH_RADIUS, xEnd = ax + FIRM_SEARCH_RADIUS; x <= xEnd; x++) {
				const wx = MAP_WRAP ? wrapX(x) : x;
				if (wx < 0 || wx >= ECONOMY_WIDTH) continue;
				const i = economyIndex(wx, wy);
				if (actors[i] || land.terrain[i] === TERRAIN_WATER || forage.plotOwner[i] || m.farms.plotOwner[i]) continue;
				if (land.claim[i] > 0.72 || this.founderId(i) < 0) continue;
				if (m.priceFood[i] > 0 && m.farms.canSite(i)) {
					const value = m.priceFood[i] * FARM_YIELD / FARM_SEASON_SECONDS;
					if (value > bestValue) { bestValue = value; bestCell = i; bestKind = ECONOMY_FARM; }
				}
				if (this.deposit[i] && m.priceCoal[i] > 0) {
					const mineVal = m.priceCoal[i] * SOURCE_RATE - m.priceLabor[i] * SOURCE_RATE * MINE_LABOR * 0.5;
					if (mineVal > bestValue) { bestValue = mineVal; bestCell = i; bestKind = ECONOMY_MINE; }
				}
				if (m.priceCoal[i] > 0 && m.priceGoods[i] > 0) {
					const facVal = (m.priceGoods[i] * FACTORY_YIELD - m.priceCoal[i] * 1.05) * FACTORY_RATE;
					if (facVal > bestValue) { bestValue = facVal; bestCell = i; bestKind = ECONOMY_FACTORY; }
				}
			}
		}
		if (bestCell < 0) return;
		const founder = this.founderId(bestCell);
		if (founder < 0) return;
		actors[bestCell] = bestKind;
		m.owners.found(bestCell, founder);
		m.scale[bestCell] = 0.7;
		m.workLoad[bestCell] = m.profit[bestCell] = 0;
		this.building[bestCell] = 1;
		this.buildProgress[bestCell] = 0;
		if (bestKind === ECONOMY_FARM) m.farms.init(bestCell);
		this.lastFound = this.ticks;
		this.founded++;
		land.refresh();
	}
}

if (typeof module === 'object') module.exports = { FirmFounding, FIRM_FOUNDERS, FIRM_SCAN_TICKS };
