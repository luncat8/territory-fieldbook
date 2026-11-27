// Owns: the shared Economy Inspector shell — grouped stat rows, stall-flag list and the ⧉ copy of the full stats dump.
// Edit for: panel chrome only. Row definitions and snapshots come from each lab's diagnostics.js.
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
			labCopyHtml('Copy all stats, flags, watched workers and history for chat') + '</header>' +
			'<div class="economy-props" data-props></div>' +
			'<ul class="economy-flags" data-flags></ul>';
		document.body.appendChild(root);
		this.root = root;
		this.props = root.querySelector('[data-props]');
		this.flagList = root.querySelector('[data-flags]');
		this.count = root.querySelector('[data-count]');
		labBindCopy(root.querySelector('[data-copy]'), () => this.diagnostics.text(this.watched()));
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
}

if (typeof module === 'object') module.exports = { EconomyPanel };
