// owns: the tuning panel — multiplier sliders, copy/apply text, saved knobs and panel visibility
// edit for: tuning panel layout, copy header, persistence keys

const HUD_TUNE_STORE = 'territory-fieldbook.tune';
const HUD_TUNE_HIDDEN_STORE = 'territory-fieldbook.tune-hidden';

const hudTune = { panel: null, toggle: null, text: null, note: null, inputs: [], outputs: [], rows: [] };

function hudTuneInit() {
	hudTune.panel = $('ui-tune-panel');
	hudTune.toggle = $('ui-tune-toggle');
	hudTune.text = $('ui-tune-text');
	hudTune.note = $('ui-tune-note');
	const list = $('ui-tune-knobs');
	for (let k = 0; k < TUNE_KNOBS.length; k++) list.appendChild(hudTuneRow(k));
	tuneDecode(hudTuneLoad(HUD_TUNE_STORE) || TUNE_LINE);
	hudTune.toggle.onclick = () => hudTuneShow(hudTune.panel.hidden);
	$('ui-tune-close').onclick = () => hudTuneShow(false);
	$('ui-tune-copy').onclick = hudTuneCopy;
	$('ui-tune-apply').onclick = hudTuneApplyText;
	$('ui-tune-reset').onclick = () => {
		tuneReset();
		hudTuneChanged('All multipliers back to ×1.');
	};
	hudTuneShow(hudTuneLoad(HUD_TUNE_HIDDEN_STORE) !== '1');
	hudTuneSync();
}

function hudTuneRow(k) {
	const knob = TUNE_KNOBS[k];
	const row = document.createElement('label');
	const name = document.createElement('span');
	const input = document.createElement('input');
	const output = document.createElement('output');
	row.className = knob.group ? 'ui-tune-row' : 'ui-tune-row ui-tune-group';
	row.title = TUNE_HINT[knob.id] + '. Double-click for ×1.';
	name.textContent = knob.label;
	input.type = 'range';
	input.min = '0';
	input.max = String(TUNE_LADDER.length - 1);
	input.step = '1';
	input.addEventListener('input', () => {
		tuneSet(knob.id, tuneValueAt(Number(input.value)));
		hudTuneChanged('');
	});
	input.addEventListener('dblclick', () => {
		tuneSet(knob.id, 1);
		hudTuneChanged('');
	});
	row.appendChild(name);
	row.appendChild(input);
	row.appendChild(output);
	hudTune.rows.push(row);
	hudTune.inputs.push(input);
	hudTune.outputs.push(output);
	return row;
}

function hudTuneChanged(note) {
	hudTuneSync();
	hudTuneSave(HUD_TUNE_STORE, tuneEncode());
	hudTune.note.textContent = note;
}

function hudTuneSync() {
	let moved = false;
	for (let k = 0; k < TUNE_KNOBS.length; k++) {
		const knob = TUNE_KNOBS[k];
		const text = tuneFormat(knob.value);
		const changed = knob.value !== 1;
		moved = moved || changed;
		hudTune.inputs[k].value = String(tuneNotchOf(knob.value));
		hudTune.inputs[k].setAttribute('aria-valuetext', text);
		hudTune.outputs[k].textContent = text;
		hudTune.outputs[k].title = 'effective ' + tuneFormat(tune[knob.id]);
		hudTune.rows[k].classList.toggle('ui-tune-moved', changed);
	}
	hudTune.toggle.textContent = moved ? 'Tuning •' : 'Tuning';
}

function hudTuneShow(show) {
	hudTune.panel.hidden = !show;
	hudTune.toggle.className = show ? 'ui-chip on' : 'ui-chip';
	hudTune.toggle.setAttribute('aria-expanded', show ? 'true' : 'false');
	hudTuneSave(HUD_TUNE_HIDDEN_STORE, show ? '0' : '1');
}

function hudTuneHeader() {
	let fabs = 0;
	for (let f = 0; f < mape.factoryCount; f++) if (mape.factoryState[f] === MAPE_FACTORY_STATE.ACTIVE) fabs++;
	const where = mapScene.id ? 'scene ' + mapScene.id.toUpperCase() : 'survey';
	return 'Territory Fieldbook tuning · ' + where + ' · day ' + (Math.floor(clock.seconds) + 1) +
		' · ' + MAPE_ENGINE_NAME[mape.engine] + ' · ' + MAPE_WORKFORCE_MODE_NAME[mape.workforceMode] +
		'\npop ' + Math.round(mape.totalPop) + ' · active fabs ' + fabs + ' · mined ' + mape.minedTotal.toFixed(0);
}

// The text box doubles as the fallback: if the clipboard API is refused the summary stays
// selected there, so a manual copy still works.
function hudTuneCopy() {
	const text = tuneSummary(hudTuneHeader());
	hudTune.text.value = text;
	hudTune.text.select();
	if (!navigator.clipboard) {
		hudTuneCopied(document.execCommand('copy'));
		return;
	}
	navigator.clipboard.writeText(text).then(() => hudTuneCopied(true), () => hudTuneCopied(document.execCommand('copy')));
}

function hudTuneCopied(ok) {
	hudTune.note.textContent = ok ? 'Copied — paste it into the chat.' : 'Copy blocked: the text is selected above, press Ctrl+C.';
}

function hudTuneApplyText() {
	const applied = tuneDecode(hudTune.text.value);
	if (applied < 0) {
		hudTune.note.textContent = 'No tune: line found in the box.';
		return;
	}
	hudTuneChanged(applied ? 'Applied ' + applied + ' multipliers; the rest are ×1.' : 'All multipliers back to ×1.');
}

function hudTuneLoad(key) {
	return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
}

function hudTuneSave(key, value) {
	if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
}

if (typeof module !== 'undefined') module.exports = { hudTuneInit, hudTuneHeader };
