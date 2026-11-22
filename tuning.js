// owns: live playtest multipliers — knob table, group × kind products, shareable text form
// edit for: adding a tunable rate, knob labels, slider range

// Slider stops: round numbers read cleanly when a setting is pasted back into a chat,
// and the roughly logarithmic spacing gives slowdowns and speedups equal travel.
const TUNE_LADDER = [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8, 10];
const TUNE_LINE = 'tune:';

// [id, group, label]; a group row has an empty group and scales every kind listed under it.
const TUNE_TABLE = [
	['renewable', '', 'Renewables · all'],
	['forest', 'renewable', 'Forest regrowth'],
	['farm', 'renewable', 'Farm harvest'],
	['mines', '', 'Mines · all'],
	['coal', 'mines', 'Coal mines'],
	['iron', 'mines', 'Iron mines'],
	['fabs', '', 'Fabs · all'],
	['factory', 'fabs', 'Factory'],
	['sawmill', 'fabs', 'Sawmill felling'],
	['charcoal', 'fabs', 'Charcoal works'],
	['wood', 'fabs', 'Wood works'],
	['workshop', 'fabs', 'Workshops'],
	['build', 'fabs', 'Construction'],
	['siting', 'fabs', 'New fab siting'],
	['settle', '', 'Settlements · all'],
	['growth', 'settle', 'Growth'],
	['famine', 'settle', 'Famine decline'],
	['migration', 'settle', 'Migration'],
	['labour', 'settle', 'Fluid workforce'],
	['sites', '', 'Survey sites · all'],
	['discovery', 'sites', 'Discovery'],
	['extract', 'sites', 'Deposit work'],
	['spawn', 'sites', 'New timed sites'],
	['transport', '', 'Transport · all'],
	['haul', 'transport', 'Goods haulage'],
	['walk', 'transport', 'Worker walking'],
	['groundMeadow', '', 'Meadow speed'],
	['groundForest', '', 'Forest speed'],
	['groundSwamp', '', 'Swamp speed'],
	['groundHills', '', 'Hills speed'],
	['groundDesert', '', 'Desert speed']
];

const TUNE_HINT = {
	renewable: 'Scales every renewable source below',
	forest: 'Forest cover regrowth toward its humidity/CO2 target',
	farm: 'Food per farmland cell each harvest',
	mines: 'Scales coal and iron mine extraction',
	coal: 'Coal extracted per staffed mine per second',
	iron: 'Iron extracted per staffed mine per second',
	fabs: 'Scales every processing site below',
	factory: 'Coal + iron in and goods out per second, same recipe',
	sawmill: 'Felling effort per worker, so logs per second',
	charcoal: 'Logs in and coal out per second',
	wood: 'Logs in and goods out per second',
	workshop: 'Goods made by regional workshops',
	build: 'Construction progress and log use per second, same total cost',
	siting: 'How often the engine scans for a new fab site',
	settle: 'Scales every settlement rate below',
	growth: 'Population growth when towns are fed',
	famine: 'Population loss below the famine line',
	migration: 'People moving between neighbouring cells',
	labour: 'Fresh workforce generated per resident (Fluid field model)',
	sites: 'Scales every survey site rate below',
	discovery: 'Marked sites becoming identified',
	extract: 'Party and rival work on survey deposits',
	spawn: 'Chance of a new cache, relic or task appearing',
	transport: 'Scales goods and worker movement',
	haul: 'Goods flow, queue and shipment speed',
	walk: 'Worker travel to job sites',
	groundMeadow: 'Meadow transport speed (max stays 1.0)',
	groundForest: 'Forest transport speed',
	groundSwamp: 'Swamp transport speed',
	groundHills: 'Hills transport speed',
	groundDesert: 'Desert transport speed'
};

const TUNE_KNOBS = TUNE_TABLE.map(row => ({ id: row[0], group: row[1], label: row[2], value: 1 }));
const TUNE_INDEX = {};
for (let k = 0; k < TUNE_KNOBS.length; k++) TUNE_INDEX[TUNE_KNOBS[k].id] = k;

// Effective multipliers read by the simulation: a kind is its own slider times its group's.
const tune = {};
tuneApply();

function tuneApply() {
	for (let k = 0; k < TUNE_KNOBS.length; k++) {
		const knob = TUNE_KNOBS[k];
		tune[knob.id] = knob.group ? knob.value * TUNE_KNOBS[TUNE_INDEX[knob.group]].value : knob.value;
	}
	if (typeof transportRebuild === 'function') transportRebuild();
}

function tuneSet(id, value) {
	const k = TUNE_INDEX[id];
	if (k === undefined || !(value > 0)) return false;
	TUNE_KNOBS[k].value = tuneValueAt(tuneNotchOf(value));
	tuneApply();
	return true;
}

function tuneReset() {
	for (let k = 0; k < TUNE_KNOBS.length; k++) TUNE_KNOBS[k].value = 1;
	tuneApply();
}

function tuneNotchOf(value) {
	const log = Math.log(value);
	let best = 0;
	for (let k = 1; k < TUNE_LADDER.length; k++) {
		if (Math.abs(Math.log(TUNE_LADDER[k]) - log) < Math.abs(Math.log(TUNE_LADDER[best]) - log)) best = k;
	}
	return best;
}

function tuneValueAt(notch) {
	return TUNE_LADDER[notch];
}

function tuneFormat(value) {
	return '×' + +value.toFixed(2);
}

function tuneChanged(knob) {
	return knob.value !== 1;
}

// Only moved knobs are listed: the text is meant to be pasted into a chat, where a full
// table of ×1.00 rows would bury the two values that matter.
function tuneSummary(header) {
	const lines = [header];
	const pairs = [];
	for (let k = 0; k < TUNE_KNOBS.length; k++) {
		const knob = TUNE_KNOBS[k];
		if (knob.group || !tuneGroupMoved(k)) continue;
		lines.push(knob.label + ' ' + tuneFormat(knob.value));
		if (tuneChanged(knob)) pairs.push(knob.id + '=' + knob.value);
		for (let c = k + 1; c < TUNE_KNOBS.length && TUNE_KNOBS[c].group === knob.id; c++) {
			const kind = TUNE_KNOBS[c];
			if (!tuneChanged(kind)) continue;
			const effective = knob.value === 1 ? '' : ' = ' + tuneFormat(tune[kind.id]);
			lines.push('  ' + kind.label + ' ' + tuneFormat(kind.value) + effective);
			pairs.push(kind.id + '=' + kind.value);
		}
	}
	if (pairs.length === 0) lines.push('all multipliers at defaults (×1)');
	lines.push(TUNE_LINE + (pairs.length ? ' ' + pairs.join(' ') : ''));
	return lines.join('\n');
}

function tuneGroupMoved(k) {
	if (tuneChanged(TUNE_KNOBS[k])) return true;
	const id = TUNE_KNOBS[k].id;
	for (let c = k + 1; c < TUNE_KNOBS.length && TUNE_KNOBS[c].group === id; c++) {
		if (tuneChanged(TUNE_KNOBS[c])) return true;
	}
	return false;
}

function tuneEncode() {
	const pairs = [];
	for (let k = 0; k < TUNE_KNOBS.length; k++) {
		if (tuneChanged(TUNE_KNOBS[k])) pairs.push(TUNE_KNOBS[k].id + '=' + TUNE_KNOBS[k].value);
	}
	return TUNE_LINE + ' ' + pairs.join(' ');
}

// Reads the `tune:` line of a pasted summary (or a bare `id=value` list); unknown ids are skipped.
// -1 means nothing recognisable was pasted, so the current knobs are kept.
function tuneDecode(text) {
	const at = text.lastIndexOf(TUNE_LINE);
	const body = (at >= 0 ? text.slice(at + TUNE_LINE.length) : text).split('\n')[0];
	const pairs = body.match(/[a-z]+=[0-9.]+/g) || [];
	if (at < 0 && pairs.length === 0) return -1;
	tuneReset();
	let applied = 0;
	for (const pair of pairs) {
		const eq = pair.indexOf('=');
		if (tuneSet(pair.slice(0, eq), parseFloat(pair.slice(eq + 1)))) applied++;
	}
	return applied;
}

if (typeof module !== 'undefined') {
	module.exports = { tune, TUNE_KNOBS, tuneSet, tuneReset, tuneSummary, tuneEncode, tuneDecode, tuneNotchOf, tuneValueAt, tuneFormat, TUNE_LADDER };
}
