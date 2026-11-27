// Owns: economy inspector checks for the cell lab — exact gold and people partitions plus the copy text sections.
// Edit for: inspector snapshot fields and the section list of diagnostics.text().
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPTS = ['simulation.js', 'actors.js', 'towns.js', 'gold.js', 'workforce.js', 'land.js', 'settlement.js', 'harvest.js', 'farms.js', 'fields.js', 'diagnostics.js'];
for (const file of SCRIPTS) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });

function run(model, diagnostics, seconds) {
	for (let n = 0; n < Math.round(seconds / ECONOMY_DT); n++) {
		model.step();
		diagnostics.record();
	}
}

test('snapshot partitions gold and people exactly', () => {
	const model = new PriceEconomy();
	const diagnostics = new EconomyDiagnostics(model);
	run(model, diagnostics, 20);
	const s = diagnostics.snapshot();
	const gold = s.townPurse + s.firmPurse + s.workerPurse + s.carried + s.coins;
	assert.ok(Math.abs(gold - s.goldTotal) < 1e-9, `${gold} ≠ ${s.goldTotal}`);
	assert.ok(Math.abs(s.people - model.totalWorkers()) < 1e-9, 'fresh + labor + depleted equals the resident headcount');
	assert.equal(diagnostics.rows, 2, 'ten-second strides over twenty seconds');
});

test('copy text carries every section', () => {
	const model = new PriceEconomy();
	const diagnostics = new EconomyDiagnostics(model);
	run(model, diagnostics, 15);
	const text = diagnostics.text();
	for (const heading of ['## flags', '## actors & towns', '## people', '## gold', '## prices', '## flows & matter', '## actors', '## history']) {
		assert.ok(text.includes(heading), `missing ${heading}`);
	}
});
