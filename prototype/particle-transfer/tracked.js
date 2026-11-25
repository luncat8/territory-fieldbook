// Owns: watched-worker panel — worker picker, spawn and fund controls, the property ledger, purse chart and event feed.
// Edit for: property rows, ledger lines, chart styling and spawn defaults.
'use strict';

class TrackedPanel {
	constructor(model, cellOf) {
		this.model = model;
		this.cellOf = cellOf || (() => -1);
		this.choice = -1;
		this.w = 0;
		this.h = 0;
		this.panel = $('tracked-panel');
		this.select = $('tracked-select');
		this.props = $('tracked-props');
		this.events = $('tracked-events');
		this.count = $('tracked-count');
		this.canvas = $('tracked-purse');
		this.ctx = this.canvas.getContext('2d');
		this.goldInput = $('tracked-gold');
		this.fundInput = $('tracked-fund-amount');
		this.select.addEventListener('change', () => { this.choice = Number(this.select.value); this.refresh(); });
		$('tracked-spawn').addEventListener('click', () => this.spawn());
		$('tracked-fund').addEventListener('click', () => this.fund());
		this.refresh();
	}

	tick() {
		this.model.tracker.sampleAll();
	}

	entry() {
		const list = this.model.tracker.list;
		if (!list.length) return null;
		if (this.choice >= 0 && this.choice < list.length) return list[this.choice];
		return list[list.length - 1];
	}

	spawn() {
		const model = this.model;
		let i = this.cellOf();
		if (i < 0 || !model.actors[i]) {
			i = model.actors.indexOf(ECONOMY_TOWN);
			if (i < 0) i = model.actors.indexOf(ECONOMY_MINE);
		}
		if (i < 0) return;
		const gold = Math.max(0, Number(this.goldInput.value) || 0);
		const entry = model.spawnTrackedWorker(i, null, gold);
		if (!entry) return;
		this.choice = model.tracker.list.indexOf(entry);
		this.refresh();
	}

	fund() {
		const entry = this.entry();
		if (!entry || entry.status !== 'active') return;
		const amount = Math.max(0, Number(this.fundInput.value) || 0);
		if (amount <= 0) return;
		this.model.fundTracked(entry.id, amount);
		this.refresh();
	}

	fit() {
		const ratio = Math.min(3, window.devicePixelRatio || 1);
		this.w = this.canvas.clientWidth;
		this.h = this.canvas.clientHeight;
		this.canvas.width = Math.round(this.w * ratio);
		this.canvas.height = Math.round(this.h * ratio);
		this.ctx.setTransform(ratio,0,0,ratio,0,0);
	}

	wallet(entry) {
		const p = this.model.workers.byWid(entry.id);
		return p >= 0 ? this.model.workers.gold[p] : 0;
	}

	escrow(entry) {
		const p = this.model.workers.byWid(entry.id);
		return p >= 0 ? this.model.workers.moved[p] : 0;
	}

	where(entry) {
		const workers = this.model.workers;
		const p = workers.byWid(entry.id);
		if (p < 0) return entry.status === 'settled' ? `settled at ${this.model.tracker.place(entry.settledAt)}` : 'gone';
		const i = workers.dockCell[p];
		const place = i >= 0 ? `docked at ${this.model.tracker.place(i)}` : `walking near ${this.model.tracker.place(workers.cellOf(p))}`;
		return `${workers.state[p] === STATE_FRESH ? 'fresh' : 'tired'} · ${place}`;
	}

	refresh() {
		const tracker = this.model.tracker;
		const list = tracker.list;
		this.panel.hidden = !list.length;
		this.count.textContent = list.length ? `${list.length}/${TRACK_CAP}` : '';
		let options = '';
		for (let k = 0; k < list.length; k++) options += `<option value="${k}">${list[k].name}</option>`;
		this.select.innerHTML = options;
		if (this.choice >= list.length) this.choice = -1;
		const entry = this.entry();
		if (!entry) {
			this.props.innerHTML = '';
			this.events.innerHTML = '';
			return;
		}
		this.select.value = String(this.choice >= 0 ? this.choice : list.length - 1);
		const wallet = this.wallet(entry);
		const escrow = this.escrow(entry);
		const balance = entry.funded + entry.earned - entry.spent - wallet;
		const exact = Math.abs(balance) < 1e-6;
		this.props.innerHTML =
			`<div><span>Purse</span><strong>${wallet.toFixed(3)} g</strong></div>` +
			`<div><span>Shift escrow</span><strong>${escrow.toFixed(3)} g</strong></div>` +
			`<div><span>Where</span><strong>${this.where(entry)}</strong></div>` +
			`<div><span>Granted</span><strong>${entry.funded.toFixed(2)} g</strong></div>` +
			`<div><span>Earned</span><strong>${entry.earned.toFixed(3)} g</strong></div>` +
			`<div><span>Spent</span><strong>${entry.spent.toFixed(3)} g</strong></div>` +
			`<div><span>Rest stops</span><strong>${Object.keys(entry.stops).length}</strong></div>` +
			`<div class="${exact ? 'ok' : 'off'}"><span>Ledger check</span><strong>${exact ? 'exact' : balance.toExponential(1) + ' g'}</strong></div>`;
		this.events.innerHTML = entry.events.map(text => `<li>${text}</li>`).join('');
		this.draw();
	}

	draw() {
		const { ctx:g, w, h } = this;
		g.clearRect(0,0,w,h);
		const entry = this.entry();
		if (!entry) return;
		const history = entry.history;
		const n = history.length;
		if (n < 2 || w <= 0) return;
		let peak = 1e-9;
		for (let k = 0; k < n; k++) peak = Math.max(peak, history[k]);
		const dx = (w - 6) / (TRACK_HISTORY - 1);
		g.beginPath();
		for (let k = 0; k < n; k++) {
			const x = 3 + k * dx, y = h - 3 - (history[k] / peak) * (h - 6);
			if (k) g.lineTo(x,y); else g.moveTo(x,y);
		}
		g.strokeStyle = '#b8a4f3';
		g.lineWidth = 1.4;
		g.stroke();
		g.lineTo(3 + (n - 1) * dx, h - 3);
		g.lineTo(3, h - 3);
		g.closePath();
		g.fillStyle = 'rgba(184,164,243,0.14)';
		g.fill();
	}

	reset() {
		this.choice = -1;
		this.refresh();
	}
}

if (typeof module === 'object') module.exports = { TrackedPanel };
