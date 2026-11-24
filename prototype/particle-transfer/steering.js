// Owns: shared particle steering — terrain edge conductance, uphill score sampling and the bounded heading move.
// Edit for: terrain speed table, gradient-knee direction shares and how goods and worker particles pick a direction.
'use strict';

const TERRAIN_SPEED = [1, 0.85, 0.55];

// A score is price[to] blended toward alt[to] by the carrier's own mix (worker wallet weight); goods pass alt = null.
function blendedScore(price, alt, mix, to) {
	return alt ? price[to] + mix * (alt[to] - price[to]) : price[to];
}

class ParticleSteering {
	constructor(model) {
		this.model = model;
		this.grad = new Float64Array(3);
		this.toCell = -1;
	}

	edgeConductance(from, to) {
		const terrain = this.model.land.terrain;
		const a = TERRAIN_SPEED[terrain[from]], b = TERRAIN_SPEED[terrain[to]];
		return a > 0 && b > 0 ? 2 * a * b / (a + b) : 0;
	}

	hasHigherNeighbor(price, alt, mix, i) {
		const here = blendedScore(price, alt, mix, i);
		const base = i * DEGREE;
		for (let k = 0; k < DEGREE; k++) {
			const to = NEIGHBORS[base + k];
			if (to >= 0 && blendedScore(price, alt, mix, to) > here + 1e-9) return true;
		}
		return false;
	}

	hasNeighborClearing(price, i, ask) {
		const here = price[i];
		const base = i * DEGREE;
		for (let k = 0; k < DEGREE; k++) {
			const to = NEIGHBORS[base + k];
			if (to >= 0 && price[to] > here + 1e-9 && price[to] >= ask) return true;
		}
		return false;
	}

	// Direction shares use unweighted gradient sum g*c / (gSum + knee) so uniformly slow ground moves slower.
	// grad[2] holds the steepest slope, so callers gate stillness on it against GRADIENT_KNEE.
	sampleGradient(price, alt, mix, i, minThere) {
		const here = blendedScore(price, alt, mix, i);
		const base = i * DEGREE;
		let gSum = 0, steepest = 0;
		for (let k = 0; k < DEGREE; k++) {
			const to = NEIGHBORS[base + k];
			if (to < 0) continue;
			const there = blendedScore(price, alt, mix, to);
			if (there < minThere || there <= here + 1e-9) continue;
			const g = (there - here) * DIRECTIONS[k].inv;
			gSum += g;
			if (g > steepest) steepest = g;
		}
		this.grad[0] = this.grad[1] = this.grad[2] = 0;
		if (steepest <= 1e-9) return false;
		const denom = gSum + GRADIENT_KNEE;
		let gx = 0, gy = 0;
		for (let k = 0; k < DEGREE; k++) {
			const to = NEIGHBORS[base + k];
			if (to < 0) continue;
			const there = blendedScore(price, alt, mix, to);
			if (there < minThere || there <= here + 1e-9) continue;
			const dir = DIRECTIONS[k];
			const share = (there - here) * dir.inv * this.edgeConductance(i, to) / denom;
			gx += dir.ux * share;
			gy += dir.uy * share;
		}
		this.grad[0] = gx;
		this.grad[1] = gy;
		this.grad[2] = steepest;
		return true;
	}

	// Blends the pool's heading toward the last sampled gradient and moves one bounded step; returns the distance.
	advance(pool, p, speed) {
		const px = pool.x[p], py = pool.y[p];
		pool.vx[p] += STEERING_BLEND * (speed * this.grad[0] - pool.vx[p]);
		pool.vy[p] += STEERING_BLEND * (speed * this.grad[1] - pool.vy[p]);
		const nx = Math.min(ECONOMY_WIDTH - 1, Math.max(0, px + pool.vx[p] * ECONOMY_DT));
		const ny = Math.min(ECONOMY_HEIGHT - 1, Math.max(0, py + pool.vy[p] * ECONOMY_DT));
		pool.x[p] = nx;
		pool.y[p] = ny;
		this.toCell = economyIndex(Math.round(nx), Math.round(ny));
		return Math.hypot(nx - px, ny - py);
	}
}

if (typeof module === 'object') module.exports = { ParticleSteering, TERRAIN_SPEED, blendedScore };
