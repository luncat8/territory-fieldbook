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
	}

	reset() {
		this.list.length = 0;
		this.byId.clear();
		this.nameAt = 0;
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
		const entry = { id: workers.wid[p], name: name || this.autoName(), funded: opening, earned: 0, spent: 0, banked: 0, events: [], history: [], stops: {}, open: null, lastEvent: -TRACK_EVENT_TICKS, status: 'active', settledAt: -1 };
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

	// The ledger counts every delta mechanically; event text pairs opposite pool moves so a shift or a rest
	// reads as one line instead of a transfer there and back.
	walletDelta(id, amount, fresh, i) {
		const entry = this.byId.get(id);
		if (!entry) return;
		if (amount >= 0) entry.earned += amount;
		else entry.spent -= amount;
		const open = entry.open;
		if (open && open.fresh !== fresh && open.cell === i) {
			const net = open.amount + amount;
			entry.open = null;
			if (Math.abs(net) < 1e-9) {
				this.say(entry, `${open.fresh ? 'worked shift at' : 'rested at'} ${this.place(i)}`);
			} else if (net < 0) {
				this.taxAt(entry, i, -net);
				this.say(entry, `rest tax ${(-net).toFixed(2)} g at ${this.place(i)}`);
			} else {
				this.say(entry, `+${net.toFixed(2)} g at ${this.place(i)}`);
			}
			return;
		}
		if (open) this.flushOpen(entry);
		entry.open = { amount, fresh, cell: i };
	}

	// A pending half-pair reads as a plain move when its counterpart never arrives.
	flushOpen(entry) {
		const open = entry.open;
		if (!open) return;
		entry.open = null;
		if (open.amount < 0) {
			this.taxAt(entry, open.cell, -open.amount);
			this.say(entry, `−${(-open.amount).toFixed(2)} g ${open.fresh ? 'shift' : 'rest tax'} at ${this.place(open.cell)}`);
		} else {
			this.say(entry, `+${open.amount.toFixed(2)} g ${open.fresh ? 'wages' : 'carried'} at ${this.place(open.cell)}`);
		}
	}

	sampleAll() {
		if (this.model.ticks % TRACK_SAMPLE_STRIDE) return;
		const workers = this.model.workers;
		for (let k = 0; k < this.list.length; k++) {
			const entry = this.list[k];
			if (entry.status !== 'active') continue;
			this.flushOpen(entry);
			const p = workers.byWid(entry.id);
			entry.history.push(p >= 0 ? workers.gold[p] : 0);
			if (entry.history.length > TRACK_HISTORY) entry.history.shift();
		}
	}

	hire(id, pay, i) {
		const entry = this.byId.get(id);
		if (!entry) return;
		entry.earned += pay;
		this.note(entry, `hired at ${this.place(i)} · +${pay.toFixed(2)} g`);
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
