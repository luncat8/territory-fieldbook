// Owns: economy inspector checks — exact gold and worker partitions, the from-start watched worker ledger and the copy text.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const file of ['simulation.js', 'steering.js', 'particles.js', 'worker-lifecycle.js', 'workers.js', 'track.js', 'actors.js', 'gold.js', 'workforce.js', 'land.js', 'settlement.js', 'diagnostics.js']) {
	vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });
}

function run(model, diagnostics, seconds, each) {
	for (let n = 0; n < Math.round(seconds / ECONOMY_DT); n++) {
		model.step();
		diagnostics.record();
		model.tracker.watchFirst();
		model.tracker.sampleAll();
		if (each) each();
	}
}

test('first worker is watched from start and his ledger stays exact', () => {
	const model = new PriceEconomy();
	const diagnostics = new EconomyDiagnostics(model);
	run(model, diagnostics, 40, () => {
		const entry = model.tracker.list[0];
		if (!entry || entry.status !== 'active') return;
		const p = model.workers.byWid(entry.id);
		const wallet = p >= 0 ? model.workers.gold[p] : 0;
		assert.ok(Math.abs(entry.funded + entry.earned - entry.spent - wallet) < 1e-9, `ledger drift at tick ${model.ticks}`);
	});
	assert.equal(model.tracker.list.length, 1);
	assert.equal(model.tracker.list[0].id, 1);
	model.reset();
	assert.equal(model.tracker.list.length, 0);
	assert.equal(model.tracker.autoWatch, true);
});

test('snapshot partitions gold and workers exactly', () => {
	const model = new PriceEconomy();
	const diagnostics = new EconomyDiagnostics(model);
	run(model, diagnostics, 30);
	const s = diagnostics.snapshot();
	const gold = s.townPurse + s.residentPurse + s.firmPurse + s.dockedWallets + s.walkingWallets + s.vault;
	assert.ok(Math.abs(gold - s.goldTotal) < 1e-9, `${gold} ≠ ${s.goldTotal}`);
	assert.equal(s.fresh + s.tired, s.workers);
	assert.equal(s.dockFirm + s.dockTown + s.parked + s.walking, s.workers);
	assert.equal(s.moving + s.stopped, s.walking);
	assert.ok(s.coalAsk >= s.coalBookCost);
	assert.equal(diagnostics.rows, 3);
});

test('copy text carries every section and a reason for the watched worker', () => {
	const model = new PriceEconomy();
	const diagnostics = new EconomyDiagnostics(model);
	run(model, diagnostics, 20);
	const text = diagnostics.text(model.tracker.list);
	for (const heading of ['## flags', '## workers', '## gold', '## wages & taxes', '## prices', '## watched worker', 'why=', '## actors', '## history']) {
		assert.ok(text.includes(heading), `missing ${heading}`);
	}
});
