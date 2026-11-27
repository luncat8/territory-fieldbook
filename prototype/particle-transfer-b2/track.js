// Owns: named worker tracking — per-worker purse ledger, rest-stop tallies, event feed and wallet history for the audit panel.
// Edit for: name pool, ledger buckets, event throttle, history length and settled bookkeeping.
'use strict';

const TRACK_CAP = 12;
const TRACK_EVENTS = 8;
const TRACK_HISTORY = 180;
const TRACK_EVENT_TICKS = 30;
const TRACK_SAMPLE_STRIDE = 15;
const PLACE_TAGS = ['', 'M', 'F', 'T', 'G', 'A', 'H', 'S'];
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
		if (entry) this.note(entry, `watched from start · born at ${this.place(workers.cell[0])}`);
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
	track(w, name, opening) {
		const workers = this.model.workers;
		const id = workers.id[w];
		if (this.list.length >= TRACK_CAP || this.byId.has(id)) return null;
		const entry = { id, name: name || this.autoName(), funded: opening, earned: 0, spent: 0, splitShared: 0, events: [], history: [], stops: {}, unreportedIncome: 0, unreportedTax: 0, lastEvent: -TRACK_EVENT_TICKS, status: 'active', starvedAt: -1 };
		this.list.push(entry);
		this.byId.set(id, entry);
		this.note(entry, opening > 0 ? `tracked with ${opening.toFixed(2)} g` : 'tracked, purse empty');
		return entry;
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

	// Every wallet mutation routes here so `funded + earned − spent − splitShared === wallet` stays exact.
	walletDelta(w, amount, place) {
		const entry = this.byId.get(this.model.workers.id[w]);
		if (!entry || amount === 0 || entry.status !== 'active') return;
		const minReport = Math.max(1e-30, this.model.money.unitScale() * 0.005);
		const digits = minReport < 1e-3 ? 4 : 2;
		if (amount > 0) {
			entry.earned += amount;
			entry.unreportedIncome += amount;
			if (this.model.ticks - entry.lastEvent >= TRACK_EVENT_TICKS && entry.unreportedIncome >= minReport) {
				this.say(entry, `+${entry.unreportedIncome.toFixed(digits)} g wages at ${this.place(place)}`);
				entry.unreportedIncome = 0;
			}
		} else {
			entry.spent -= amount;
			entry.unreportedTax -= amount;
			if (this.model.ticks - entry.lastEvent >= TRACK_EVENT_TICKS && entry.unreportedTax >= minReport) {
				this.say(entry, `−${entry.unreportedTax.toFixed(digits)} g at ${this.place(place)}`);
				entry.unreportedTax = 0;
			}
		}
	}

	income(w, amount, place) {
		this.walletDelta(w, amount, place);
	}

	expense(w, amount, place) {
		this.walletDelta(w, -amount, place);
	}

	fund(entry, amount) {
		entry.funded += amount;
		this.note(entry, `granted +${amount.toFixed(2)} g`);
	}

	// A watched parent split in two; the child of a watched worker carries the story on.
	// WorkerLife halves both wallets before this hook, so the child's opening gold is exactly what left the parent.
	onSplit(w, child) {
		const workers = this.model.workers;
		const parent = this.byId.get(workers.id[w]);
		if (!parent) return;
		parent.splitShared += workers.gold[child];
		if (parent.status === 'active') this.note(parent, `split in two at ${this.place(workers.cell[child])}`);
		if (parent.status !== 'active' || this.list.length >= TRACK_CAP || this.byId.has(workers.id[child])) return;
		const entry = this.track(child, null, workers.gold[child]);
		if (entry) this.note(entry, `born of ${parent.name} (#${parent.id}) at ${this.place(workers.cell[child])}`);
	}

	// The watched story ends: the worker starved and his purse orphaned where he fell.
	onRemove(w) {
		const workers = this.model.workers;
		const entry = this.byId.get(workers.id[w]);
		if (!entry || entry.status !== 'active') return;
		entry.spent += workers.gold[w];
		entry.status = 'starved';
		entry.starvedAt = this.model.ticks;
		this.note(entry, workers.gold[w] > 0 ? `starved at ${this.place(workers.cell[w])} · left ${workers.gold[w].toFixed(2)} g` : `starved at ${this.place(workers.cell[w])}`);
	}

	sampleAll() {
		if (this.model.ticks % TRACK_SAMPLE_STRIDE) return;
		const workers = this.model.workers;
		for (let k = 0; k < this.list.length; k++) {
			const entry = this.list[k];
			if (entry.status !== 'active') continue;
			const p = workers.indexOfId(entry.id);
			entry.history.push(p >= 0 ? workers.gold[p] : 0);
			if (entry.history.length > TRACK_HISTORY) entry.history.shift();
		}
	}

	visit(id, i, tax = 0) {
		const entry = this.byId.get(id);
		if (!entry) return;
		const stop = entry.stops[i] || (entry.stops[i] = { visits: 0, tax: 0 });
		stop.visits++;
		stop.tax += tax;
	}
}

if (typeof module === 'object') module.exports = { WorkerTracker, TRACK_CAP, TRACK_SAMPLE_STRIDE, TRACK_HISTORY, WORKER_NAMES };
