// Owns: named worker tracking — per-worker purse ledger, rest-stop tallies, event feed and wallet history for the audit panel.
// Edit for: name pool, ledger buckets, event throttle, history length and settled bookkeeping.
'use strict';

const TRACK_CAP = 12;
const TRACK_EVENTS = 8;
const TRACK_HISTORY = 180;
const TRACK_EVENT_TICKS = 30;
const TRACK_SAMPLE_STRIDE = 15;
const TRACK_SPAWN_GOLD = 50;
// Local place formatting keeps the tracker loadable without the UI files that own ACTOR_TAGS and cellName.
const PLACE_TAGS = ['', 'M', 'F', 'T', 'G'];
const placeName = i => `${String(i % ECONOMY_WIDTH).padStart(2, '0')}, ${String(Math.floor(i / ECONOMY_WIDTH)).padStart(2, '0')}`;
const WORKER_NAMES = ['Aldo', 'Bram', 'Cato', 'Dirk', 'Egon', 'Femke', 'Gerrit', 'Hanna', 'Ivo', 'Klaas', 'Lotte', 'Maas', 'Nora', 'Okke', 'Pim', 'Roel', 'Sanne', 'Teun', 'Ulke', 'Yfke'];

class WorkerTracker {
	constructor(model) {
		this.model = model;
		this.list = [];
		this.byId = new Map();
		this.nameAt = 0;
		this.autoWatch = true;
	}

	reset() {
		this.list.length = 0;
		this.byId.clear();
		this.nameAt = 0;
		this.autoWatch = true;
	}

	// The first worker born after a reset is watched automatically, so every run carries one full life story.
	watchFirst() {
		const workers = this.model.workers;
		if (!this.autoWatch || !workers.count) return null;
		this.autoWatch = false;
		const entry = this.track(0, null, workers.gold[0]);
		if (entry) this.note(entry, `watched from start · born at ${this.place(workers.cellOf(0))}`);
		return entry;
	}

	autoName() {
		const cycle = Math.floor(this.nameAt / WORKER_NAMES.length) + 1;
		return WORKER_NAMES[this.nameAt++ % WORKER_NAMES.length] + (cycle > 1 ? ` ${cycle}` : '');
	}

	place(i) {
		return `${PLACE_TAGS[this.model.actors[i]] || '·'} ${placeName(i)}`;
	}

	// Opening balance enters `funded` so the ledger balance starts exact for adopted walkers too.
	track(p, name, opening) {
		const workers = this.model.workers;
		if (this.list.length >= TRACK_CAP || this.byId.has(workers.wid[p])) return null;
		const entry = { id: workers.wid[p], name: name || this.autoName(), funded: opening, earned: 0, spent: 0, banked: 0, events: [], history: [], stops: {}, unreportedIncome: 0, unreportedTax: 0, lastEvent: -TRACK_EVENT_TICKS, status: 'active', settledAt: -1 };
		this.list.push(entry);
		this.byId.set(entry.id, entry);
		this.note(entry, opening > 0 ? `tracked with ${opening.toFixed(2)} g` : 'tracked, purse empty');
		return entry;
	}

	forget(id) {
		const entry = this.byId.get(id);
		if (!entry) return;
		this.byId.delete(id);
		const k = this.list.indexOf(entry);
		if (k >= 0) this.list.splice(k, 1);
	}

	note(entry, text) {
		entry.events.unshift(text);
		if (entry.events.length > TRACK_EVENTS) entry.events.pop();
	}

	// Throttled line: the ledger stays exact per tick, the feed only surfaces a line every half second.
	say(entry, text) {
		if (this.model.ticks - entry.lastEvent < TRACK_EVENT_TICKS) return;
		entry.lastEvent = this.model.ticks;
		this.note(entry, text);
	}

	walletDelta(id, amount, fresh, i) {
		const entry = this.byId.get(id);
		if (!entry || amount === 0) return;
		if (amount > 0) {
			entry.earned += amount;
			entry.unreportedIncome += amount;
		} else {
			entry.spent -= amount;
			entry.unreportedTax -= amount;
			this.taxAt(entry, i, -amount);
		}
		if (this.model.ticks - entry.lastEvent < TRACK_EVENT_TICKS) return;
		if (amount > 0 && entry.unreportedIncome >= 0.005) {
			this.say(entry, `+${entry.unreportedIncome.toFixed(2)} g wages at ${this.place(i)}`);
			entry.unreportedIncome = 0;
		}
		if (amount < 0 && entry.unreportedTax >= 0.005) {
			this.say(entry, `−${entry.unreportedTax.toFixed(2)} g rest tax at ${this.place(i)}`);
			entry.unreportedTax = 0;
		}
	}

	sampleAll() {
		if (this.model.ticks % TRACK_SAMPLE_STRIDE) return;
		const workers = this.model.workers;
		for (let k = 0; k < this.list.length; k++) {
			const entry = this.list[k];
			if (entry.status !== 'active') continue;
			const p = workers.byWid(entry.id);
			entry.history.push(p >= 0 ? workers.gold[p] : 0);
			if (entry.history.length > TRACK_HISTORY) entry.history.shift();
		}
	}

	hire(id, pay, i) {
		const entry = this.byId.get(id);
		if (!entry) return;
		entry.earned += pay;
		if (pay >= 0.005) this.note(entry, `hired at ${this.place(i)} · +${pay.toFixed(2)} g`);
	}

	fund(id, amount) {
		const entry = this.byId.get(id);
		if (!entry) return;
		entry.funded += amount;
		this.note(entry, `granted +${amount.toFixed(2)} g`);
	}

	bank(id, amount, i) {
		const entry = this.byId.get(id);
		if (!entry || entry.status !== 'active') return;
		entry.spent += amount;
		entry.banked += amount;
		entry.status = 'settled';
		entry.settledAt = i;
		this.note(entry, `settled at ${this.place(i)} · banked ${amount.toFixed(2)} g`);
	}

	leftBehind(id, amount, i) {
		const entry = this.byId.get(id);
		if (!entry) return;
		entry.spent += amount;
		this.say(entry, `left ${amount.toFixed(2)} g at ${this.place(i)}`);
	}

	visit(id, i) {
		const entry = this.byId.get(id);
		if (!entry) return;
		const stop = entry.stops[i] || (entry.stops[i] = { visits: 0, tax: 0 });
		stop.visits++;
	}

	taxAt(entry, i, tax) {
		const stop = entry.stops[i] || (entry.stops[i] = { visits: 0, tax: 0 });
		stop.tax += tax;
	}
}

if (typeof module === 'object') module.exports = { WorkerTracker, TRACK_CAP, TRACK_SPAWN_GOLD, WORKER_NAMES };
