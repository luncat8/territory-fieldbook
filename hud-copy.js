// owns: ⧉ copy buttons on panels worth pasting into chat — inspector, site, workforce, party, around, events
// edit for: which panels copy, the copied header line, clipboard fallback

const HUD_COPY_GLYPH = '⧉';
const HUD_COPY_FLASH_MS = 1200;
// [button id, header title, source element ids]; null sources = the full event feed.
const HUD_COPY_PANELS = [
	['ui-copy-inspect', 'inspector', ['ui-inspect']],
	['ui-copy-site', 'selected site', ['ui-jobsite']],
	['ui-copy-workforce', 'workforce', ['ui-workforce-stats']],
	['ui-copy-party', 'party', ['ui-stats', 'ui-skills', 'ui-members', 'ui-site', 'ui-victory']],
	['ui-copy-around', 'around', ['ui-nearby']],
	['ui-copy-log', 'events', null]
];

function hudCopyInit() {
	for (let k = 0; k < HUD_COPY_PANELS.length; k++) {
		const panel = HUD_COPY_PANELS[k];
		const button = $(panel[0]);
		button.textContent = HUD_COPY_GLYPH;
		button.onclick = function () { hudCopyRun(button, hudCopyText(panel)); };
	}
}

function hudCopyText(panel) {
	const sources = panel[2];
	const head = '# ' + panel[1] + ' · ' + hudClockText();
	if (!sources) return head + '\n' + hudCopyLogText();
	if (sources.length === 1) return head + '\n' + $(sources[0]).textContent;
	let text = head;
	for (let k = 0; k < sources.length; k++) text += '\n## ' + sources[k].slice(3) + '\n' + $(sources[k]).textContent;
	return text;
}

// The panel shows the newest 8 lines; the copy carries every kept event, oldest first, for chat.
function hudCopyLogText() {
	const list = events.list;
	const lines = [];
	if (events.status) lines.push('status: ' + events.status);
	for (let k = 0; k < list.length; k++) lines.push(list[k].text);
	return lines.join('\n');
}

function hudCopyRun(button, text) {
	const done = ok => hudCopyFlash(button, ok);
	if (!navigator.clipboard) {
		done(hudCopyFallback(text));
		return;
	}
	navigator.clipboard.writeText(text).then(() => done(true), () => done(hudCopyFallback(text)));
}

// file:// pages in some browsers refuse the clipboard API; a selected textarea still copies.
function hudCopyFallback(text) {
	const area = document.createElement('textarea');
	area.value = text;
	document.body.appendChild(area);
	area.select();
	const ok = document.execCommand('copy');
	area.remove();
	return ok;
}

function hudCopyFlash(button, ok) {
	button.textContent = ok ? '✓' : '✕';
	setTimeout(() => { button.textContent = HUD_COPY_GLYPH; }, HUD_COPY_FLASH_MS);
}

if (typeof module !== 'undefined') module.exports = { hudCopyText, hudCopyLogText, HUD_COPY_PANELS };
