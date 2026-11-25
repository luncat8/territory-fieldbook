// Owns: edge conductance, uphill gradient sampling (full-res price/home and coarse forage) and bounded particle steps.
// Edit for: goods/worker speeds, heading blend, dock slope and water-avoiding movement.
'use strict';

const GOODS_SPEED = 6;
const WORKER_SPEED = 11;

class Steering {
	constructor(model) {
		this.model = model;
		this.conductance = new Float64Array(ECONOMY_SIZE * DEGREE);
		this.grad = { gx: 0, gy: 0, bestSlope: 0, bestPull: 0, bestDir: -1 };
		this.out = { x: 0, y: 0, hx: 0, hy: 0, ds: 0, effort: 0, cell: 0 };
		this.rebuildConductance();
	}

	// Harmonic mean of endpoint speeds gives zero conductance across any water edge.
	rebuildConductance() {
		const spd = this.model.land.speed;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = spd[i], base = i * DEGREE;
			for (let k = 0; k < DEGREE; k++) {
				const to = NEIGHBORS[base + k];
				const b = to >= 0 ? spd[to] : 0;
				this.conductance[base + k] = a > 0 && b > 0 ? (2 * a * b) / (a + b) : 0;
			}
		}
	}

	sampleField(field, alt, mix, i, floor) {
		const g = this.grad, cond = this.conductance, base = i * DEGREE;
		const here = alt ? field[i] + mix * (alt[i] - field[i]) : field[i];
		const cut = Math.max(here, floor);
		let gx = 0, gy = 0, bestSlope = 0, bestPull = 0, bestDir = -1;
		for (let k = 0; k < DEGREE; k++) {
			const c = cond[base + k];
			if (c <= 0) continue;
			const to = NEIGHBORS[base + k];
			const there = alt ? field[to] + mix * (alt[to] - field[to]) : field[to];
			if (there <= cut) continue;
			const dir = DIRECTIONS[k];
			const pull = (there - here) * dir.inv;
			const slope = c * pull;
			gx += dir.ux * slope;
			gy += dir.uy * slope;
			if (pull > bestPull) bestPull = pull;
			if (slope > bestSlope) {
				bestSlope = slope;
				bestDir = k;
			}
		}
		g.gx = gx;
		g.gy = gy;
		g.bestSlope = bestSlope;
		g.bestPull = bestPull;
		g.bestDir = bestDir;
		return bestSlope;
	}

	sampleForage(forage, i) {
		const g = this.grad, cond = this.conductance, base = i * DEGREE;
		const here = forage.scoreAtCell(i);
		let gx = 0, gy = 0, bestSlope = 0, bestPull = 0, bestDir = -1;
		for (let k = 0; k < DEGREE; k++) {
			const c = cond[base + k];
			if (c <= 0) continue;
			const to = NEIGHBORS[base + k];
			const there = forage.scoreAtCell(to);
			if (there <= here + 1e-6) continue;
			const dir = DIRECTIONS[k];
			const pull = (there - here) * dir.inv;
			const slope = c * pull;
			gx += dir.ux * slope;
			gy += dir.uy * slope;
			if (pull > bestPull) bestPull = pull;
			if (slope > bestSlope) {
				bestSlope = slope;
				bestDir = k;
			}
		}
		g.gx = gx;
		g.gy = gy;
		g.bestSlope = bestSlope;
		g.bestPull = bestPull;
		g.bestDir = bestDir;
		return bestSlope;
	}

	hasBetterNeighbor(field, alt, mix, i) {
		const cond = this.conductance, base = i * DEGREE;
		const here = alt ? field[i] + mix * (alt[i] - field[i]) : field[i];
		for (let k = 0; k < DEGREE; k++) {
			if (cond[base + k] <= 0) continue;
			const to = NEIGHBORS[base + k];
			const there = alt ? field[to] + mix * (alt[to] - field[to]) : field[to];
			if (there > here + 1e-9) return true;
		}
		return false;
	}

	// Launches along the steepest uphill edge from a dock so symmetric buyers cannot cancel heading to zero.
	advance(x, y, hx, hy, maxSpeed) {
		const { gx, gy, bestSlope, bestDir } = this.grad, out = this.out;
		const cx = Math.min(ECONOMY_WIDTH - 1, Math.max(0, Math.floor(x)));
		const cy = Math.min(ECONOMY_HEIGHT - 1, Math.max(0, Math.floor(y)));
		const cell = economyIndex(cx, cy);
		if (bestSlope <= 0 || bestDir < 0) {
			out.x = x; out.y = y; out.hx = 0; out.hy = 0; out.ds = 0; out.effort = 0; out.cell = cell;
			return false;
		}
		const dir = DIRECTIONS[bestDir];
		const gLen = Math.hypot(gx, gy);
		const tx = gLen > 1e-9 ? gx / gLen : dir.ux;
		const ty = gLen > 1e-9 ? gy / gLen : dir.uy;
		if ((hx === 0 && hy === 0) || hx * tx + hy * ty <= 0) {
			hx = dir.ux;
			hy = dir.uy;
		} else {
			hx += STEERING_BLEND * (tx - hx);
			hy += STEERING_BLEND * (ty - hy);
		}
		const hLen = Math.hypot(hx, hy) || 1;
		const ux = hx / hLen, uy = hy / hLen;
		const cEdge = this.conductance[cell * DEGREE + bestDir] || this.model.land.speed[cell] || 0.5;
		const ds = Math.min(0.45, maxSpeed * cEdge * (bestSlope / (bestSlope + GRADIENT_KNEE)) * ECONOMY_DT);
		let nx = Math.min(ECONOMY_WIDTH - 0.05, Math.max(0.05, x + ux * ds));
		let ny = Math.min(ECONOMY_HEIGHT - 0.05, Math.max(0.05, y + uy * ds));
		let nextCell = economyIndex(Math.floor(nx), Math.floor(ny));
		if (this.model.land.terrain[nextCell] === TERRAIN_WATER) {
			const safe = NEIGHBORS[cell * DEGREE + bestDir];
			const sx = (safe % ECONOMY_WIDTH) + 0.5 - x, sy = Math.floor(safe / ECONOMY_WIDTH) + 0.5 - y;
			const sLen = Math.hypot(sx, sy) || 1;
			nx = Math.min(ECONOMY_WIDTH - 0.05, Math.max(0.05, x + (sx / sLen) * ds));
			ny = Math.min(ECONOMY_HEIGHT - 0.05, Math.max(0.05, y + (sy / sLen) * ds));
			nextCell = economyIndex(Math.floor(nx), Math.floor(ny));
			if (this.model.land.terrain[nextCell] === TERRAIN_WATER) { nx = x; ny = y; nextCell = cell; }
		}
		out.x = nx; out.y = ny; out.hx = ux; out.hy = uy;
		out.ds = Math.hypot(nx - x, ny - y);
		out.effort = out.ds / Math.max(0.15, cEdge);
		out.cell = nextCell;
		return out.ds > 0;
	}
}

if (typeof module === 'object') module.exports = { Steering };
