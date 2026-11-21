// owns: balance speed sliders and the copy-settings control
// edit for: subsystem speed multipliers and the copied settings line

// Each slider drives one subsystem's clock: 1 = live rate, 0 stops it, above 1 speeds it up.
const MAPE_BALANCE_SLIDERS = [
	{ key: 'speedFactory', label: 'Factories', min: 0, max: 3, step: 0.1 },
	{ key: 'speedSettlement', label: 'Settlements', min: 0, max: 3, step: 0.1 },
	{ key: 'speedMine', label: 'Mines', min: 0, max: 3, step: 0.1 },
	{ key: 'speedSite', label: 'Sites', min: 0, max: 3, step: 0.1 },
	{ key: 'speedWorkshop', label: 'Workshops', min: 0, max: 3, step: 0.1 }
];

const hudBalance = { statusEl: null };

function hudBalanceInit() {
	const host = $('ui-balance');
	if (!host) return;
	host.textContent = '';
	for (const spec of MAPE_BALANCE_SLIDERS) {
		const row = document.createElement('div');
		row.className = 'ui-balance-row';
		const label = document.createElement('label');
		label.textContent = spec.label;
		const input = document.createElement('input');
		input.type = 'range';
		input.min = String(spec.min);
		input.max = String(spec.max);
		input.step = String(spec.step);
		input.value = String(mape[spec.key]);
		const value = document.createElement('span');
		value.className = 'ui-balance-val';
		const sync = () => { value.textContent = Number(input.value).toFixed(1) + '×'; };
		sync();
		input.addEventListener('input', () => {
			mape[spec.key] = Number(input.value);
			sync();
		});
		label.appendChild(input);
		row.appendChild(label);
		row.appendChild(value);
		host.appendChild(row);
	}
	host.appendChild(hudButton('Copy settings', true, hudBalanceCopy, 'ui-chip'));
	hudBalance.statusEl = $('ui-balance-status');
}

function hudBalanceCopy() {
	const parts = MAPE_BALANCE_SLIDERS.map(spec => spec.label + ' ' + Number(mape[spec.key]).toFixed(1));
	const text = 'balance: ' + parts.join(' · ');
	const mark = ok => {
		if (hudBalance.statusEl) hudBalance.statusEl.textContent = (ok ? 'Copied · ' : 'Set manually · ') + text;
	};
	if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(text).then(() => mark(true), () => hudBalanceCopyLegacy(text, mark));
		return;
	}
	hudBalanceCopyLegacy(text, mark);
}

// file:// is not a secure context, so the async clipboard API is often absent; fall back to a
// hidden textarea + execCommand so the copy works from a plain checkout too.
function hudBalanceCopyLegacy(text, mark) {
	if (typeof document === 'undefined' || !document.body || !document.execCommand) {
		mark(false);
		return;
	}
	const area = document.createElement('textarea');
	area.value = text;
	area.setAttribute('readonly', '');
	area.style.position = 'fixed';
	area.style.opacity = '0';
	document.body.appendChild(area);
	area.select();
	let ok = false;
	try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
	document.body.removeChild(area);
	mark(ok);
}
