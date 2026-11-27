// Owns: the shared Economy Inspector shell — grouped stat rows, stall-flag list and the "Copy all stats" clipboard dump.
// Edit for: panel chrome and clipboard fallback only. Row definitions and snapshots come from each lab's diagnostics.js.
'use strict';

class EconomyPanel {
	constructor(diagnostics, rows, watched) {
		this.diagnostics = diagnostics;
		this.rows = rows;
		this.watched = watched || (() => []);
		const root = document.createElement('aside');
		root.id = 'economy-panel';
		root.className = 'economy-panel';
		root.innerHTML =
			'<header class="economy-head"><strong>Economy Inspector</strong><span class="economy-count" data-count></span>' +
			'<button type="button" class="text-button" data-copy>Copy all stats</button></header>' +
			'<div class="economy-props" data-props></div>' +
			'<ul class="economy-flags" data-flags></ul>' +
			'<footer class="economy-foot"><span data-status role="status"></span></footer>';
		document.body.appendChild(root);
		this.root = root;
		this.props = root.querySelector('[data-props]');
		this.flagList = root.querySelector('[data-flags]');
		this.count = root.querySelector('[data-count]');
		this.status = root.querySelector('[data-status]');
		root.querySelector('[data-copy]').addEventListener('click', () => this.copy());
	}

	refresh() {
		const s = this.diagnostics.snapshot();
		let html = '';
		for (const [title, rows] of this.rows) {
			html += `<h3>${title}</h3>`;
			for (const [label, value, alarm] of rows) html += `<div${alarm && alarm(s) ? ' class="off"' : ''}><span>${label}</span><strong>${value(s)}</strong></div>`;
		}
		this.props.innerHTML = html;
		this.flagList.innerHTML = s.flags.length
			? s.flags.map(text => `<li>${text}</li>`).join('')
			: '<li class="calm">No stall detected.</li>';
		this.count.textContent = s.flags.length ? `${s.flags.length} flag${s.flags.length > 1 ? 's' : ''}` : 'clear';
	}

	async copy() {
		const text = this.diagnostics.text(this.watched());
		const lines = text.split('\n').length;
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// file:// pages in some browsers lack clipboard permission; a selected textarea still copies.
			const area = document.createElement('textarea');
			area.value = text;
			document.body.appendChild(area);
			area.select();
			document.execCommand('copy');
			area.remove();
		}
		this.status.textContent = `Copied ${lines} lines`;
	}
}

if (typeof module === 'object') module.exports = { EconomyPanel };
