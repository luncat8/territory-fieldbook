// Owns: the free-workforce idle grid, resource deposit mask, construction sites, worker-owner selection and firm founding without minted gold.
// Edit for: idle founder threshold, deposit distribution, mine/factory/sawmill siting margin, founder build work and reference owners.
'use strict';

const FIRM_SCAN_TICKS = 150;
const FIRM_COOLDOWN_TICKS = 360;
const FIRM_RADIUS = 2;
const FIRM_SEARCH_RADIUS = 6;
const FIRM_FOUNDERS = 3;
const FIRM_BUILD_WORK = 1.0;
const FOUNDER_BUILD_RATE = 0.45;
const SAWMILL_SPACING = 12;
const FARM_SPACING = 22;

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
		this.seed = 977;
		this.lastFound = -FIRM_COOLDOWN_TICKS;
		this.hadIdle = false;
	}

	random(n) {
		this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0;
		return Math.floor(this.seed / 4294967296 * n);
	}

	isFreeNear(w, sx, sy) {
		const { workers } = this.model;
		if (workers.state[w] !== WORKER_STILL || workers.tired[w] > 1e-6) return false;
		const wc = workers.cell[w];
		return Math.abs(torusDelta(wc % ECONOMY_WIDTH - sx, ECONOMY_WIDTH)) <= FIRM_SEARCH_RADIUS
			&& Math.abs(torusDelta(Math.floor(wc / ECONOMY_WIDTH) - sy, ECONOMY_HEIGHT)) <= FIRM_SEARCH_RADIUS;
	}

	// A random free (still, rested) worker within reach of the site; else the nearest worker of any state; else -1.
	pickFounder(cell) {
		const { workers } = this.model;
		const sx = cell % ECONOMY_WIDTH, sy = Math.floor(cell / ECONOMY_WIDTH);
		let free = 0, nearest = -1, nearestD = Infinity;
		for (let w = 0; w < workers.count; w++) {
			if (this.isFreeNear(w, sx, sy)) free++;
			const wc = workers.cell[w];
			const d = Math.abs(torusDelta(wc % ECONOMY_WIDTH - sx, ECONOMY_WIDTH)) + Math.abs(torusDelta(Math.floor(wc / ECONOMY_WIDTH) - sy, ECONOMY_HEIGHT));
			if (d < nearestD) { nearestD = d; nearest = w; }
		}
		if (!free) return nearest;
		let pick = this.random(free);
		for (let w = 0; w < workers.count; w++) {
			if (!this.isFreeNear(w, sx, sy)) continue;
			if (pick-- === 0) return w;
		}
		return nearest;
	}

	// Worker-owner founding (plan M.1a): no paid initiation and an empty purse; a founder who already owns
	// a firm adds this facility to his shared cash and debt.
	assignOwner(cell) {
		const { workers, owners } = this.model;
		const w = this.pickFounder(cell);
		const id = w >= 0 ? workers.id[w] : -1;
		const o = owners.ownerOfWorker(id) || owners.create(id);
		owners.attach(cell, o);
		return o;
	}

	// Reference scene: one named owner per firm kind, so same-kind sites share a portfolio purse from the start.
	assignReferenceOwners() {
		const { actors, workers, owners } = this.model;
		const kindOwner = new Int32Array(8);
		let next = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = actors[i];
			if (!a || a === ECONOMY_TOWN || a === ECONOMY_GARDEN) continue;
			if (!kindOwner[a]) kindOwner[a] = owners.create(next < workers.count ? workers.id[next++] : -1);
			owners.attach(i, kindOwner[a]);
		}
	}

	clearSite(i) {
		this.building[i] = 0;
		this.buildProgress[i] = 0;
	}

	isBuilding(i) {
		return this.building[i] !== 0;
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

	hasNear(cell, kind, radius) {
		const { actors } = this.model;
		const cx = cell % ECONOMY_WIDTH, cy = Math.floor(cell / ECONOMY_WIDTH);
		for (let dy = -radius; dy <= radius; dy++) {
			for (let dx = -radius; dx <= radius; dx++) {
				const c = wrapCell(cx + dx, cy + dy);
				if (c >= 0 && actors[c] === kind) return true;
			}
		}
		return false;
	}

	scanAndFound(anchor) {
		const m = this.model, { actors, land, forage } = m;
		const ax = anchor % ECONOMY_WIDTH, ay = Math.floor(anchor / ECONOMY_WIDTH);
		const wageRef = Math.max(m.priceLabor[anchor], m.workers.meanGold() * WORK_RATE * 0.1);
		let bestCell = -1, bestKind = 0, bestValue = wageRef * WORK_RATE * 0.2;
		for (let y = ay - FIRM_SEARCH_RADIUS, yEnd = ay + FIRM_SEARCH_RADIUS; y <= yEnd; y++) {
			const wy = MAP_WRAP ? wrapY(y) : y;
			if (wy < 0 || wy >= ECONOMY_HEIGHT) continue;
			for (let x = ax - FIRM_SEARCH_RADIUS, xEnd = ax + FIRM_SEARCH_RADIUS; x <= xEnd; x++) {
				const wx = MAP_WRAP ? wrapX(x) : x;
				if (wx < 0 || wx >= ECONOMY_WIDTH) continue;
				const i = economyIndex(wx, wy);
				if (actors[i] || land.terrain[i] === TERRAIN_WATER || forage.plotOwner[i] || m.farms.plotOwner[i]) continue;
				if (land.claim[i] > 0.72) continue;
				const farmYield = FARM_YIELD * Math.min(1, Math.max(0.4, m.farms.quality(i) * 1.6));
				const farmGate = Math.max(m.priceLabor[i] * WORK_RATE * FARM_SEASON_SECONDS / farmYield, wageRef * 0.15);
				if (m.priceFood[i] > farmGate && m.farms.canSite(i) && !this.hasNear(i, ECONOMY_FARM, FARM_SPACING)) {
					const value = m.priceFood[i] * farmYield / FARM_SEASON_SECONDS - m.priceLabor[i] * WORK_RATE;
					if (value > bestValue) { bestValue = value; bestCell = i; bestKind = ECONOMY_FARM; }
				}
				if (this.deposit[i] && m.priceCoal[i] > m.optimizer.itemGate(ITEM_COAL, i) * 2) {
					const mineVal = (m.priceCoal[i] - m.priceLabor[i] * MINE_LABOR * 0.5) * SOURCE_RATE;
					if (mineVal > bestValue) { bestValue = mineVal; bestCell = i; bestKind = ECONOMY_MINE; }
				}
				if (m.priceCoal[i] > 0 && m.priceGoods[i] > m.priceCoal[i] * 1.15) {
					const facVal = (m.priceGoods[i] * FACTORY_YIELD - m.priceCoal[i] * 1.05 - m.priceLabor[i] * FACTORY_LABOR * FACTORY_YIELD * 0.5) * FACTORY_RATE;
					if (facVal > bestValue) { bestValue = facVal; bestCell = i; bestKind = ECONOMY_FACTORY; }
				}
				if (m.priceWood[i] > m.optimizer.itemGate(ITEM_WOOD, i) * 1.5 && m.farms.forestShare(i) > 0.3 && !this.hasNear(i, ECONOMY_SAWMILL, SAWMILL_SPACING)) {
					const sawVal = (m.priceWood[i] - m.priceLabor[i] * SAWMILL_LABOR) * SAWMILL_RATE;
					if (sawVal > bestValue) { bestValue = sawVal; bestCell = i; bestKind = ECONOMY_SAWMILL; }
				}
			}
		}
		if (bestCell < 0) return;
		actors[bestCell] = bestKind;
		m.scale[bestCell] = 0.7;
		m.workLoad[bestCell] = m.profit[bestCell] = 0;
		this.building[bestCell] = 1;
		this.buildProgress[bestCell] = 0;
		this.assignOwner(bestCell);
		if (bestKind === ECONOMY_FARM) m.farms.init(bestCell);
		this.lastFound = this.ticks;
		this.founded++;
		land.refresh();
	}
}

if (typeof module === 'object') module.exports = { FirmFounding, FIRM_FOUNDERS, FIRM_SCAN_TICKS };
