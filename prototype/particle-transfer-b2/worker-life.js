// Owns: worker-owned needs history, splitting, starvation and dense-pool removal.
// Edit for: personal split requirements/cooldown, starvation grace and inheritance accounting.
'use strict';

const WORKER_SPLIT_SECONDS = 45;
const WORKER_SPLIT_GOLD = 16;
const WORKER_SPLIT_FOOD = 0.9;
const WORKER_SPLIT_NEEDS = 0.75;
const WORKER_STARVE_SECONDS = 120;

class WorkerLife {
	constructor(model) {
		this.model = model;
		this.needs = new Float64Array(MAX_WORKERS);
		this.splitAge = new Float64Array(MAX_WORKERS);
		this.hunger = new Float64Array(MAX_WORKERS);
		this.columns = [this.needs, this.splitAge, this.hunger];
		this.blend = 1 - Math.exp(-ECONOMY_DT / 12);
	}

	reset() {
		for (const col of this.columns) col.fill(0);
		this.deaths = this.removedTired = this.lostFood = 0;
	}

	init(w) {
		for (const col of this.columns) col[w] = 0;
	}

	step() {
		const m = this.model, pool = m.workers;
		// Reverse traversal keeps newborns and swapped survivors from receiving a second lifecycle tick.
		for (let w = pool.count - 1; w >= 0; w--) {
			const c = pool.cell[w];
			const comfort = m.actors[c] === ECONOMY_TOWN ? m.workforce.comfortAt(c) : this.needs[w];
			this.needs[w] += (comfort - this.needs[w]) * this.blend;
			this.hunger[w] = pool.food[w] <= 1e-6 ? this.hunger[w] + ECONOMY_DT : 0;
			if (this.hunger[w] >= WORKER_STARVE_SECONDS) {
				this.remove(w);
				continue;
			}
			const eligible = this.needs[w] >= WORKER_SPLIT_NEEDS && pool.food[w] >= WORKER_SPLIT_FOOD
				&& pool.gold[w] >= WORKER_SPLIT_GOLD && pool.tired[w] <= 0.3 * pool.amount[w];
			this.splitAge[w] += ECONOMY_DT;
			if (eligible && this.splitAge[w] >= WORKER_SPLIT_SECONDS) this.split(w);
		}
	}

	split(w) {
		const pool = this.model.workers;
		const child = pool.spawn(pool.x[w], pool.y[w], WORKER_STILL, 0, pool.gold[w] / 2, pool.food[w] / 2, false);
		if (child < 0) return false;
		pool.gold[w] /= 2;
		pool.food[w] /= 2;
		pool.tired[child] = pool.tired[w] / 2;
		pool.tired[w] /= 2;
		pool.paidRest[w] = Math.min(pool.paidRest[w], pool.tired[w]);
		this.needs[child] = this.needs[w];
		this.splitAge[w] = 0;
		return true;
	}

	remove(w) {
		const m = this.model, pool = m.workers;
		m.money.vault += pool.gold[w];
		this.deaths += pool.amount[w];
		this.removedTired += pool.tired[w];
		this.lostFood += pool.food[w];
		const last = --pool.count;
		for (const col of pool.columns) col[w] = col[last];
		for (const col of this.columns) col[w] = col[last];
	}
}

if (typeof module === 'object') module.exports = { WorkerLife, WORKER_SPLIT_SECONDS, WORKER_STARVE_SECONDS };
