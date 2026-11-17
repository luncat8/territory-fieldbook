// owns: deterministic and integrated simulation checks
// edit for: prototype rule regression coverage
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({ console });
for (const name of ['world.js', 'party.js', 'sites.js', 'economy.js', 'game.js']) {
	vm.runInContext(fs.readFileSync(name, 'utf8'), context, { filename: name });
}
function run(code) { return vm.runInContext(code, context); }
function near(actual, expected, epsilon = 1e-5) { assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`); }

assert.equal(run('Array.from(makeWorld(42).terrain).join()'), run('Array.from(makeWorld(42).terrain).join()'));
assert.notEqual(run('Array.from(makeWorld(42).terrain).join()'), run('Array.from(makeWorld(43).terrain).join()'));
near(run('observationWeight(0, 2.7, false)'), 1);
assert.ok(run('observationWeight(1.25, 2.7, false) > observationWeight(1.5, 2.7, false)'));
assert.equal(run('observationWeight(2.7, 2.7, true)'), 0);
assert.ok(run('observationWeight(1.2, 3.5, true) <= 1'));
assert.ok(run('observationWeight(3.499, 3.5, true) < 0.001'));
assert.ok(run('observationWeight(1.2, 3.5, true) > observationWeight(1.2, 3.5, false)'));
assert.ok(run('observationRadius(2) < observationRadius(3) && observationRadius(5) > observationRadius(3)'));
run('var g = newGame(42); var p = g.parties[0]; var startMass = totalMass(g); var startEnergy = totalEnergy(g);');
assert.equal(run('g.tick'), 0);
run('for (let i = 0; i < 40; i++) tickGame(g)');
assert.equal(run('g.tick'), 40);
assert.equal(run('p.search[8 * 64 + 8]'), 100);
assert.equal(run('recordSite(g, p, g.sites[0])'), true);
assert.equal(run('recordSite(g, p, g.sites[0])'), false);
near(run('totalMass(g)'), run('startMass'));
near(run('totalEnergy(g)'), run('startEnergy + g.economy.sunlight'));
run('updateInfluence(g)');
assert.ok(run('g.territory[0] > 0'));
assert.equal(run('g.world.control[siteIndex(g.sites[0])]'), 0);
run('var d = g.sites[4]; p.x = d.x + .5; p.y = d.y + .5; p.search[siteIndex(d)] = 100; d.discovered[0] = true;');
assert.equal(run('recordSite(g, p, d)'), true);
run('updateInfluence(g); d.mining = true; g.economy.renewable[0] = true; g.world.terrain[siteIndex(d)] = 3;');
run('for (let i = 0; i < 20; i++) tickGame(g)');
assert.ok(run('d.stock < 40 && p.ore > 0 && g.economy.rubble > 0'));
assert.ok(run('g.world.disturbance[siteIndex(d)] > 0'));
near(run('totalMass(g)'), run('startMass'));
near(run('totalEnergy(g)'), run('startEnergy + g.economy.sunlight'));
assert.equal(run('recycle(g, p)'), true);
assert.equal(run('restoreCell(g, p, siteIndex(d))'), true);
near(run('totalMass(g)'), run('startMass'));
near(run('totalEnergy(g)'), run('startEnergy + g.economy.sunlight'));
assert.equal(run('hireMember(p, 2)'), true);
assert.equal(run('hireMember(p, 2)'), false);
assert.equal(run('trainMember(p, 0, 0)'), true);
assert.equal(run('victoryChecks(g).every(check => check.ok)'), false);
run('d.mining = false; for (let i = 0; i < 31; i++) tickGame(g)');
assert.ok(run('victoryChecks(g)[1].ok'));
assert.ok(run('victoryChecks(g)[2].ok'));
assert.ok(run('victoryChecks(g)[3].ok'));
run('g.territory[0] = g.territory[1] + 1');
assert.equal(run('declareVictory(g)'), true);
assert.equal(run('g.running'), false);
run('g.economy.renewable[0] = false');
assert.equal(run('victoryChecks(g)[2].ok'), false);
run('var lost = newGame(42); lost.parties[0].supplies = 0; for (let i = 0; i < 60; i++) tickGame(lost)');
assert.equal(run('lost.parties[0].failed'), true);
assert.equal(run('lost.parties[0].reason'), 'Supplies exhausted');
function snapshot() {
	return run(`(() => { const q = newGame(123); for (let i = 0; i < 150; i++) tickGame(q); return JSON.stringify({ tick: q.tick, sites: q.sites, territory: q.territory, p: [q.parties[0].supplies, q.parties[1].funds], rng: q.randomState }); })()`);
}
assert.equal(snapshot(), snapshot());
console.log('Simulation tests passed: seeded world, distance falloff, claims, rival, ledger, party, land, survival and victory.');
run(`var playable = newGame(42), explorer = playable.parties[0]; playable.economy.renewable[0] = true;
for (const index of [0, 1, 2, 4, 3]) {
	if (index === 3) hireMember(explorer, 2);
	const site = playable.sites[index]; moveParty(explorer, site.x, site.y);
	for (let i = 0; i < 55; i++) tickGame(playable);
	if (!recordSite(playable, explorer, site)) throw new Error('Could not record site ' + index);
	updateInfluence(playable, false);
}
for (let i = 0; i < 31; i++) tickGame(playable);`);
assert.ok(run('playable.territory[0] > playable.territory[1]'));
assert.equal(run('declareVictory(playable)'), true);
run(`var repeat = newGame(4), first = repeat.sites[0], traveller = repeat.parties[0]; traveller.search[siteIndex(first)] = 100; recordSite(repeat, traveller, first); var supplyAfter = traveller.supplies; first.owner = -1; recordSite(repeat, traveller, first);`);
near(run('traveller.supplies'), run('supplyAfter'));
run(`var expiry = newGame(4); expiry.parties[1].failed = true; expiry.sites[7].present = true; for (let i = 0; i < 220; i++) tickGame(expiry);`);
assert.equal(run('expiry.sites[7].present'), false);
console.log('End-to-end victory, one-time rewards and expiry passed.');
