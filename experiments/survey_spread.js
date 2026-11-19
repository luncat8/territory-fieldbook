// owns: survey spread measurement — what one press records inside the float reach
// run: node experiments/survey_spread.js
// kept while the survey numbers in plan-prototype.md are being tuned; prune when they close.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g), match => match[1]);
const context = vm.createContext({ console: console });
for (const file of scripts) {
	const code = fs.readFileSync(path.join(root, file), 'utf8');
	vm.runInContext(code, context, { filename: file });
}

function run(code) {
	return vm.runInContext(code, context);
}

const BANDS = [[0, 1.2], [1.2, 2], [2, 2.5], [2.5, 3], [3, 5]];
const TERRAIN_NAMES = run('TERRAIN_NAME');

const FIND = `(function (terrain) {
	for (let y = 4; y < MAP_SIZE - 4; y++) {
		for (let x = 4; x < MAP_SIZE - 4; x++) {
			if (world.terrain[y * MAP_SIZE + x] !== terrain) continue;
			let land = 0;
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) if (worldWalkableAt(x + dx, y + dy)) land++;
			}
			if (land === 9) return [x, y];
		}
	}
	return [-1, -1];
})`;

// One press on clean ground: the spread must come from the real survey path, not a copy of it.
function press(terrain, condition, morale) {
	run('main.setup(20261117);');
	const cell = run(`(${FIND})(${terrain === 1 ? 0 : terrain})`);
	if (cell[0] < 0) return null;
	run(`party.x = ${cell[0]}; party.y = ${cell[1]}; party.condition = ${condition}; party.morale = ${morale}; party.working = false;`);
	run('economy.biomass[party.y * MAP_SIZE + party.x] = ' + (terrain === 1 ? 1 : 0));
	run('investigation.progress.fill(0); investigation.surveyLeft = 0;');
	const pressed = run('investigationSurvey()');
	const again = run('investigationSurvey()');
	const spread = run(`
	(function () {
		const bands = ${JSON.stringify(BANDS)};
		const sums = [0, 0, 0, 0, 0];
		const counts = [0, 0, 0, 0, 0];
		const reach = investigationReach();
		const r = Math.ceil(reach);
		let full = 0;
		let marked = 0;
		for (let dy = -r; dy <= r; dy++) {
			for (let dx = -r; dx <= r; dx++) {
				const x = party.x + dx;
				const y = party.y + dy;
				if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) continue;
				const i = y * MAP_SIZE + x;
				if (world.terrain[i] === TERRAIN.WATER) continue;
				const p = investigation.progress[i];
				if (p >= 1) full++;
				if (p >= 0.2) marked++;
				const dist = Math.sqrt(dx * dx + dy * dy);
				for (let b = 0; b < bands.length; b++) {
					if (dist < bands[b][0] || dist >= bands[b][1]) continue;
					sums[b] += p;
					counts[b]++;
					break;
				}
			}
		}
		const means = [];
		for (let b = 0; b < bands.length; b++) means.push(counts[b] ? sums[b] / counts[b] : 0);
		return { reach: reach, full: full, marked: marked, means: means, counts: counts };
	})()
	`, context);
	spread.pressed = pressed;
	spread.again = again;
	return spread;
}

const rows = [];
for (const terrain of [0, 1, 4, 5]) {
	for (const rest of [false, true]) {
		const row = press(terrain, rest ? 95 : 70, rest ? 80 : 60);
		if (!row) continue;
		row.terrain = terrain;
		row.rest = rest;
		rows.push(row);
		console.log('terrain=' + TERRAIN_NAMES[terrain] +
			' cond=' + (rest ? 95 : 70) +
			' reach=' + row.reach.toFixed(1) +
			' full_cells=' + row.full +
			' marked_cells=' + row.marked +
			' band_means=' + row.means.map(v => v.toFixed(2)).join('/') +
			' band_cells=' + row.counts.join('/') +
			' pressed=' + (row.pressed ? 1 : 0) +
			' second_press=' + (row.again ? 1 : 0));
	}
}

let failures = 0;
function check(name, ok, detail) {
	if (!ok) failures++;
	console.log('check_' + name + '=' + (ok ? 'pass' : 'fail') + (detail === undefined ? '' : ' ' + detail));
}

const meadow = rows.find(row => row.terrain === 0 && !row.rest);
const hillsRest = rows.find(row => row.terrain === 4 && row.rest);
const forest = rows.find(row => row.terrain === 1 && !row.rest);
const desert = rows.find(row => row.terrain === 5 && !row.rest);
check('survey_presses', rows.every(row => row.pressed), 'cooldown_empty=1');
check('survey_cooldown_blocks_second', rows.every(row => !row.again));
check('readable_core_records', meadow.means[0] > 0.9 && hillsRest.means[0] > 0.9);
check('core_not_whole_disk', meadow.full < 10, 'full_cells=' + meadow.full);
check('ring_is_partial', meadow.means[2] < 0.75 && meadow.means[3] < 0.4,
	'mid=' + meadow.means[2].toFixed(2) + ' outer=' + meadow.means[3].toFixed(2));
check('rough_terrain_marks_only', forest.reach < meadow.reach && desert.full === 0,
	'forest_marked=' + forest.marked + ' desert_marked=' + desert.marked);
check('sites_marked_outward', meadow.marked > 15, 'marked_cells=' + meadow.marked);

if (failures > 0) {
	console.log('survey_spread_failures=' + failures);
	process.exit(1);
}
console.log('survey_spread_failures=0');
