// Owns: Watched Workers audit panel — worker picker, purse sparkline, personal ledger props, the event feed and its ⧉ copy.
// Edit for: panel layout, sparkline sampling and the spawn/fund debug controls.
'use strict';

class TrackedPanel {
	constructor(model, diagnostics) {
		this.model = model;
		this.diagnostics = diagnostics;
		this.root = $('watched-worker');
		this.choice = -1;
		this.selectedId = -1;
		this.followedId = -1;
		this.lastOptions = null;
		this.build();
	}

	build() {
		this.root.innerHTML =
			'<div class="tracked-top"><div class="tracked-head" data-track-head></div>' + labCopyHtml('Copy the watched worker ledger and events for chat') + '</div>' +
			'<select data-track-select aria-label="Watched worker"></select>' +
			'<canvas data-track-purse width="240" height="34"></canvas>' +
			'<div class="tracked-props" data-track-props></div>' +
			'<ul class="tracked-events" data-track-events></ul>' +
			'<div class="tracked-controls"><input data-track-gold type="number" min="1" step="1" value="5" aria-label="Debug gold"><button type="button" data-track-fund>Fund</button><button type="button" data-track-spawn>Spawn</button></div>' +
			'<div class="tracked-count" data-track-count></div>';
		this.head = this.root.querySelector('[data-track-head]');
		this.select = this.root.querySelector('[data-track-select]');
		this.purseCanvas = this.root.querySelector('[data-track-purse]');
		this.props = this.root.querySelector('[data-track-props]');
		this.events = this.root.querySelector('[data-track-events]');
		this.goldInput = this.root.querySelector('[data-track-gold]');
		this.count = this.root.querySelector('[data-track-count]');
		this.select.addEventListener('change', () => {
			const list = this.model.tracker.list;
			const idx = Number(this.select.value);
			if (Number.isInteger(idx) && list[idx]) this.choose(idx);
		});
		labBindCopy(this.root.querySelector('[data-copy]'), () => this.copyText());
		this.root.querySelector('[data-track-fund]').addEventListener('click', () => this.fund());
		this.root.querySelector('[data-track-spawn]').addEventListener('click', () => this.spawn());
	}

	// Per-sim-tick: adopt the first born worker and sample wallet history on a stride.
	tick() {
		const tracker = this.model.tracker;
		tracker.watchFirst();
		tracker.sampleAll();
	}

	reset() {
		this.choice = -1;
		this.selectedId = -1;
		this.followedId = -1;
		this.lastOptions = null;
	}

	choose(idx) {
		const list = this.model.tracker.list;
		const entry = list[idx];
		if (!entry) return;
		this.choice = idx;
		this.selectedId = entry.id;
		this.followedId = entry.id;
		this.model.workers.watch(entry.id);
		this.renderEntry(entry);
	}

	refresh() {
		const tracker = this.model.tracker;
		const list = tracker.list;
		if (!list.length) {
			this.lastOptions = null;
			this.select.innerHTML = '';
			this.head.textContent = 'Watched worker: nobody tracked yet';
			this.props.innerHTML = '';
			this.events.innerHTML = '';
			this.count.textContent = '';
			return;
		}
		// A map pick moves workers.watchedId; follow it so the ring and the panel stay one story.
		const wid = this.model.workers.watchedId;
		if (wid !== this.followedId) {
			const idx = list.findIndex(entry => entry.id === wid);
			if (idx >= 0) { this.choice = idx; this.followedId = wid; this.selectedId = wid; }
		}
		if (this.choice < 0 || this.choice >= list.length) {
			const idx = list.findIndex(entry => entry.id === this.selectedId);
			this.choice = idx >= 0 ? idx : 0;
		}
		const options = list.map((entry, i) => `<option value="${i}"${i === this.choice ? ' selected' : ''}>${entry.name} · #${entry.id} · ${entry.status}</option>`).join('');
		if (options !== this.lastOptions) {
			this.select.innerHTML = options;
			this.lastOptions = options;
		}
		this.renderEntry(list[this.choice]);
	}

	renderEntry(entry) {
		const m = this.model, workers = m.workers, diag = this.diagnostics;
		const p = workers.indexOfId(entry.id);
		const wallet = p >= 0 ? workers.gold[p] : 0;
		const balance = entry.funded + entry.earned - entry.spent - entry.splitShared - wallet;
		const exact = Math.abs(balance) < 1e-6;
		this.head.textContent = `Watched worker #${entry.id} · ${entry.name}`;
		const row = (label, value, off) => `<div><span>${label}</span><strong${off ? ' class="off"' : ''}>${value}</strong></div>`;
		this.props.innerHTML =
			row('Where', p >= 0 ? m.tracker.place(workers.cell[p]) : entry.status) +
			row('Why', p >= 0 ? diag.workerReason(p) : entry.status === 'active' ? 'no longer on the map' : 'starved') +
			row('Wallet', `${wallet.toFixed(3)} g`) +
			row('Food', p >= 0 ? `${Math.round(workers.food[p] * 100)}%` : '—') +
			row('Tired', p >= 0 ? `${Math.round(workers.tired[p] * 100)}%` : '—') +
			row('Unpaid wages', `${m.money.unpaidWages(entry.id).toFixed(3)} g`) +
			row('Granted', `${entry.funded.toFixed(3)} g`) +
			row('Earned', `${entry.earned.toFixed(3)} g`) +
			row('Spent', `${entry.spent.toFixed(3)} g`) +
			row('Shared with child', `${entry.splitShared.toFixed(3)} g`) +
			row('Ledger', exact ? '✓ exact' : balance.toExponential(2), !exact);
		// The typed wage/tax/ration log rides along for whichever worker the map ring follows.
		const typed = [];
		if (entry.id === workers.watchedId && workers.logCount) {
			for (let n = 0; n < workers.logCount; n++) {
				const idx = (workers.logHead - workers.logCount + n + WATCH_LOG_CAP) % WATCH_LOG_CAP;
				const kind = workers.logKind[idx], val = workers.logVal[idx];
				typed.push(kind === EVT_WAGE ? `+${val.toFixed(2)}g wage` : kind === EVT_TAX ? `−${val.toFixed(2)}g tax` : kind === EVT_RATION ? `−${val.toFixed(2)}g ration` : kind === EVT_FORAGE ? `forage (${val.toFixed(1)}g)` : kind === EVT_FED ? `fed ${(val * 100).toFixed(0)}%` : EVT_NAMES[kind]);
			}
		}
		const feed = [...entry.events, ...typed];
		this.events.innerHTML = feed.length
			? feed.map(text => `<li>${text}</li>`).join('')
			: '<li class="calm">no events yet</li>';
		this.drawSpark(entry.history);
		this.count.textContent = `tracked ${this.model.tracker.list.length}/${TRACK_CAP}`;
	}

	copyText() {
		const entry = this.model.tracker.list[this.choice];
		return entry ? this.diagnostics.workerText(entry) : 'Watched worker: nobody tracked yet';
	}

	drawSpark(history) {
		const canvas = this.purseCanvas;
		const w = canvas.width || 240, h = canvas.height || 34;
		const ctx = canvas.getContext && canvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, w, h);
		if (history.length < 2) return;
		let max = 0;
		for (const value of history) if (value > max) max = value;
		max = Math.max(max, 1e-6);
		ctx.strokeStyle = '#f7d468';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		const n = history.length;
		for (let k = 0; k < n; k++) {
			const x = 2 + (k / (n - 1)) * (w - 4);
			const y = h - 3 - (history[k] / max) * (h - 6);
			if (k === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.stroke();
	}

	// Debug credit: seeds money so the personal ledger and the world mint stay one ledger.
	fund() {
		const entry = this.model.tracker.list[this.choice];
		if (!entry || entry.status !== 'active') return;
		const p = this.model.workers.indexOfId(entry.id);
		if (p < 0) return;
		const amount = Math.max(1, Number(this.goldInput.value) || 5);
		this.model.money.recordFunding(amount);
		this.model.workers.gold[p] += amount;
		this.model.tracker.fund(entry, amount);
		this.renderEntry(entry);
	}

	spawn() {
		const m = this.model;
		let cell = m.pinnedCell;
		if (cell < 0) {
			cell = -1;
			for (let i = 0; i < ECONOMY_SIZE; i++) if (m.actors[i] === ECONOMY_TOWN) { cell = i; break; }
		}
		if (cell < 0) return;
		const amount = Math.max(1, Number(this.goldInput.value) || 5);
		const w = m.workers.spawn((cell % ECONOMY_WIDTH) + 0.5, Math.floor(cell / ECONOMY_WIDTH) + 0.5, WORKER_STILL, 0, amount, 1, false);
		if (w < 0) return;
		m.money.recordFunding(amount);
		const entry = m.tracker.track(w, null, amount);
		if (entry) {
			m.tracker.note(entry, `spawned at ${m.tracker.place(cell)} with ${amount} g`);
			this.selectedId = entry.id;
			this.followedId = entry.id;
			this.choice = m.tracker.list.indexOf(entry);
		}
		this.refresh();
	}
}

if (typeof module === 'object') module.exports = { TrackedPanel };
