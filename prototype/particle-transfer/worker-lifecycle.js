// Owns: per-worker fatigue, recovery, wage distribution and unemployed firm construction.
// Methods operate on the persistent SoA owned by WorkerParticles, never on disposable stock fragments.
'use strict';

class WorkerLifecycle {
	portion(p, s) {
		return s === STATE_FRESH ? Math.max(0, this.amount[p] - this.tired[p]) : this.tired[p];
	}

	beginWork() { this.worked.fill(0); }

	// Recipes consume fresh capacity, not people. FIFO makes a completed shift leave before new hires.
	workAt(i, used) {
		let p = this.dockHead[i];
		if (p < 0) return;
		while (this.dockNext[p] >= 0) p = this.dockNext[p];
		for (; p >= 0 && used > WORKER_DUST; p = this.dockPrev[p]) {
			const take = Math.min(used, this.portion(p, STATE_FRESH));
			this.tired[p] += take;
			this.worked[p] += take;
			used -= take;
			if (this.tired[p] >= this.amount[p] - WORKER_DUST && this.state[p] === STATE_FRESH) {
				this.state[p] = STATE_DEPLETED;
				this.crossDock(p, i, STATE_FRESH);
			}
		}
	}

	// Income is new money from the employer; savings never enter an anonymous wage-sharing pool.
	payIncome(i, income) {
		let weight = 0;
		for (let p = this.dockHead[i]; p >= 0; p = this.dockNext[p]) weight += this.worked[p];
		const byWork = weight > WORKER_DUST;
		if (!byWork) weight = this.dockedAmount(STATE_FRESH, i);
		if (weight <= WORKER_DUST) return 0;
		for (let p = this.dockHead[i]; p >= 0; p = this.dockNext[p]) {
			const part = income * (byWork ? this.worked[p] : this.portion(p, STATE_FRESH)) / weight;
			this.creditWallet(p, part);
			this.noteWallet(p, part, STATE_FRESH, i);
		}
		return income;
	}

	// Rest is charged only to the worker receiving it. The rate budget is the room service, not the wait pool.
	restAt(i, budget, fee, stillOnly = false) {
		let rested = 0, tax = 0, tail = this.dockHead[i];
		if (tail >= 0) while (this.dockNext[tail] >= 0) tail = this.dockNext[tail];
		for (let p = tail; p >= 0 && budget > WORKER_DUST; p = this.dockPrev[p]) {
			if (stillOnly && this.state[p] === STATE_FRESH && this.isFirm(i)) continue;
			if (stillOnly && this.model.actors[i] === ECONOMY_TOWN && this.gold[p] > WORKER_DUST) continue;
			let take = Math.min(budget, this.tired[p]);
			if (stillOnly) take = Math.min(take, this.amount[p] * this.model.workforce.restShare * this.model.depletedFlow.still[i] * this.model.land.rest[i]);
			if (fee > 0) take = Math.min(take, this.gold[p] / fee);
			if (take <= WORKER_DUST) continue;
			const pay = Math.min(this.gold[p], take * fee);
			this.gold[p] = Math.max(0, this.gold[p] - pay);
			this.flowOf(this.state[p]).gold[i] = Math.max(0, this.flowOf(this.state[p]).gold[i] - pay);
			this.noteWallet(p, -pay, STATE_DEPLETED, i);
			this.tired[p] -= take;
			budget -= take;
			rested += take;
			tax += pay;
			if (this.tired[p] <= WORKER_DUST && this.state[p] === STATE_DEPLETED) {
				this.state[p] = STATE_FRESH;
				this.crossDock(p, i, STATE_DEPLETED);
			}
		}
		// Sub-unit stock has not formed a worker yet, but still participates in the conservative recipes.
		const m = this.model;
		const bare = Math.max(0, m.depleted[i] - this.dockedAmount(STATE_DEPLETED, i) - rested);
		const extra = Math.min(budget, bare);
		rested += extra;
		m.depleted[i] = Math.max(0, m.depleted[i] - rested);
		m.labor[i] += rested;
		m.restedDepleted += rested;
		m.suppliedLabor += rested;
		if (tax > 0) m.money.payRestTax(i, tax);
		return rested;
	}

	// Construction competes by output value minus recipe inputs, and requires idle local workers.
	maybeFoundFirm() {
		const m = this.model;
		if (m.ticks - this.lastFoundTick < FOUND_FIRM_COOLDOWN_TICKS || !this.facilityDemand()) return;
		this.lastFoundTick = m.ticks;
		let best = -1, bestKind = 0, bestScore = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (m.actors[i]) continue;
			const x = i % ECONOMY_WIDTH, y = Math.floor(i / ECONOMY_WIDTH);
			let idle = 0, coal = m.coal[i];
			for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
				if (x + dx < 0 || x + dx >= ECONOMY_WIDTH || y + dy < 0 || y + dy >= ECONOMY_HEIGHT) continue;
				const n = economyIndex(x + dx, y + dy);
				idle += this.unemployed[n];
				if (m.actors[n] === ECONOMY_MINE) coal += m.labor[n] + m.particles.spawnAt(ITEM_COAL, n);
			}
			if (idle + WORKER_DUST < FACILITY_UNEMPLOY_WORKERS * WORKER_UNIT) continue;
			const mineValue = m.priceCoal[i] - m.priceLabor[i] * MINE_LABOR;
			const factoryValue = coal > WORKER_DUST ? m.priceGoods[i] * FACTORY_YIELD - m.priceCoal[i] - m.priceLabor[i] * FACTORY_LABOR * FACTORY_YIELD : 0;
			const value = Math.max(mineValue, factoryValue);
			if (value <= bestScore) continue;
			best = i;
			bestScore = value;
			bestKind = factoryValue > mineValue ? ECONOMY_FACTORY : ECONOMY_MINE;
		}
		if (best >= 0) m.setActor(best, bestKind);
	}

}

if (typeof module === 'object') module.exports = { WorkerLifecycle };
