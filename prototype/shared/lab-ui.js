// Owns: shared lab UI helpers — the DOM id lookup, the inline SVG icon set and ⧉ clipboard copy buttons.
// Edit for: icon path data, copy flash and helper signatures only. Resource titles and tool kinds stay per lab.
'use strict';

const $ = id => document.getElementById(id);
const ICON_PATHS = {
	book:'M12 6c-3-2-7-2-10-1v13c3-1 7-1 10 1 3-2 7-2 10-1V5c-3-1-7-1-10 1Zm0 0v13',
	pause:'M9 5v14M15 5v14',play:'m8 4 12 8-12 8z',step:'m5 5 10 7-10 7zM19 5v14',chevron:'m6 9 6 6 6-6',
	box:'m3 7 9-5 9 5v10l-9 5-9-5zM3 7l9 5 9-5M12 12v10',
	radio:'M12 10a2 2 0 1 0 .01 0M7.8 7.8a6 6 0 0 0 0 8.4m8.4-8.4a6 6 0 0 1 0 8.4M5 4.8a10 10 0 0 0 0 14.4M19 4.8a10 10 0 0 1 0 14.4',
	up:'M3 17l6-6 4 4 8-10m-7 0h7v7',down:'m3 7 6 6 4-4 8 10m-7 0h7v-7',
	grid:'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',check:'m5 12 4 4L19 6',
	layers:'m2 8 10-5 10 5-10 5zM2 12l10 5 10-5M2 16l10 5 10-5',
	contour:'M3 12c0-4 3-4 5-7 4-5 11-2 11 3 0 4 5 6 2 10-2 4-6 1-10 3-5 1-9-3-8-9Zm4 0c0-2 3-3 4-5 3-2 5 0 5 3 0 3 4 5 1 7-2 1-3-1-6 0-3 1-5-2-4-5Zm4 0c1-3 4-3 4 1 0 3-4 3-4-1Z',
	sliders:'M3 7h4m5 0h9M3 17h10m5 0h3M7 4h5v6H7zM13 14h5v6h-5z',
	cursor:'m4 3 6.5 18 3.2-7.5L21 10z',crosshair:'M12 3v5m0 8v5M3 12h5m8 0h5M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
	diamond:'m12 2 10 10-10 10L2 12z',hexagon:'M12 2l8.7 5v10L12 22l-8.7-5V7z',square:'M4 4h16v16H4z',circle:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
	triangle:'M12 3 21 19H3z',pentagon:'M12 2.5 21 9l-3.4 10.5H6.4L3 9z',
	leaf:'M11 20A7 7 0 0 1 4 13C4 7 11 4 20 4c0 9-3 16-9 16Zm0 0v-7',
	erase:'m3 14 10-10a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 8H9l-6-6Zm6-6 8 8M12 20h9',
	reset:'M3 4v6h6M4 9a8 8 0 1 1 .7 8',clear:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',close:'m6 6 12 12M18 6 6 18'
};
const labIcon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON_PATHS[name]}"/></svg>`;

const LAB_COPY_GLYPH = '⧉';
const LAB_COPY_FLASH_MS = 1200;
const labCopyHtml = title => `<button type="button" class="copy-button" data-copy title="${title}" aria-label="${title}">${LAB_COPY_GLYPH}</button>`;

function labBindCopy(button, read) {
	button.addEventListener('click', () => labCopy(read()).then(ok => {
		button.textContent = ok ? '✓' : '✕';
		setTimeout(() => { button.textContent = LAB_COPY_GLYPH; }, LAB_COPY_FLASH_MS);
	}));
}

function labCopy(text) {
	if (!navigator.clipboard) return Promise.resolve(labCopyFallback(text));
	return navigator.clipboard.writeText(text).then(() => true, () => labCopyFallback(text));
}

// file:// pages in some browsers lack clipboard permission; a selected textarea still copies.
function labCopyFallback(text) {
	const area = document.createElement('textarea');
	area.value = text;
	document.body.appendChild(area);
	area.select();
	const ok = document.execCommand('copy');
	area.remove();
	return ok;
}
