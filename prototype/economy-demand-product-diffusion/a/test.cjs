// Run with: node economy-proto/test.cjs
// Exercise the actual inline simulation without browser or external packages.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(require('node:path').join(__dirname, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const ctx2d = {createImageData: (w, h) => ({data: new Uint8ClampedArray(w * h * 4)}), putImageData() {}, fillRect() {}, beginPath() {}, arc() {}, stroke() {}};
const element = () => ({getContext: () => ctx2d, addEventListener() {}, getBoundingClientRect: () => ({left: 0, top: 0, width: 120, height: 120}), textContent: '', innerHTML: ''});
const elements = new Map();
const document = {getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, querySelectorAll: () => []};
const context = vm.createContext({document, performance: {now: () => 0}, requestAnimationFrame() {}, console});
vm.runInContext(script, context);
const run = code => vm.runInContext(code, context);
const close = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

// Reflecting boundaries: pure diffusion conserves a bounded field, including corners.
run(`init(0, false); settlementsEnabled = false; sinkEnabled = false; demand.fill(0); demand[0] = 1;`);
const demandBefore = run(`demand.reduce((a,b) => a+b, 0)`);
run(`stepDemand()`);
close(run(`demand.reduce((a,b) => a+b, 0)`), demandBefore * run('Math.exp(-DECAY * DT)'));
assert.ok(run(`demand[0] > 0 && demand[1] > 0 && demand[N] > 0`));
assert.ok(run(`demand.every(v => Number.isFinite(v) && v >= 0 && v <= 1)`));

// A settlement builds a smooth hill which spreads and then adapts after it is disabled.
run(`init(0, false); sources.length = 0; consumers.length = 1; settlementsEnabled = true; sinkEnabled = false; feedback = 'fixed'; for (let i=0; i<100; i++) stepDemand()`);
assert.ok(run(`demand[idx(consumers[0].x + 8, consumers[0].y)] > 0`));
const hill = run(`demand[idx(consumers[0].x, consumers[0].y)]`);
run(`settlementsEnabled = false; for (let i=0; i<100; i++) stepDemand()`);
assert.ok(run(`demand[idx(consumers[0].x, consumers[0].y)]`) < hill);

// Forward transport conserves mass, including convergence on a peak.
run(`init(0, false); sources.length = 0; settlementsEnabled = false; for (let y=0; y<N; y++) for (let x=0; x<N; x++) { res[idx(x,y)] = 1; demand[idx(x,y)] = Math.max(0, 1 - Math.hypot(x-60,y-60)/85); }`);
const before = run(`res.reduce((a,b) => a+b, 0)`);
run(`for (let i=0; i<100; i++) stepResources()`);
close(run(`res.reduce((a,b) => a+b, 0)`), before, 1e-6);
assert.ok(run(`res.every(v => Number.isFinite(v) && v >= 0)`));
assert.ok(run(`res[idx(60,60)] > 1`));

// Zero demand cannot become negative. Ambient replenishment makes outflow
// possible from a mine even with no consumers and a zero initial field.
run(`init(0, false); sources.splice(1); settlementsEnabled = false; sinkEnabled = true; for (let i=0; i<400; i++) tick()`);
assert.ok(run(`demand.every(v => Number.isFinite(v) && v >= 0 && v <= 1)`));
assert.ok(run(`res.reduce((sum,v,i) => sum + (i === idx(sources[0].x,sources[0].y) ? 0 : v), 0) > 10`));
close(run(`res.reduce((a,b) => a+b, 0)`), run(`produced - consumed`), 1e-6);

// A hungry settlement attracts coal, consumes a finite amount, and feedback
// reduces the signal with abundant local stock instead of producing a black hole.
run(`init(0, false); sources.length = 0; consumers.length = 1; settlementsEnabled = true; sinkEnabled = false; feedback = 'stock'; const c = consumers[0]; neighborhood(c, i => {res[i] = 2});`);
const starting = run(`localStock(consumers[0])`);
run(`for (let i=0; i<100; i++) tick()`);
assert.ok(run(`consumers[0].signal < 0.5`));
assert.ok(run(`consumed > 0 && consumed < CONSUME_RATE * time`));
close(run(`res.reduce((a,b) => a+b, 0) + consumed`), starting, 1e-6);

// Both fills and the full default scenario remain bounded and conserve mass.
for (const fill of [0, 0.5]) {
  run(`init(${fill}, false); settlementsEnabled = true; sinkEnabled = false; feedback = 'stock'; for (let i=0; i<600; i++) tick()`);
  assert.ok(run(`demand.every(v => Number.isFinite(v) && v >= 0 && v <= 1)`));
  assert.ok(run(`res.every(v => Number.isFinite(v) && v >= 0)`));
  close(run(`res.reduce((a,b) => a+b, 0)`), run(`produced - consumed`), 1e-5);
  console.log(`fill ${fill}:`, run(`({time, produced, consumed, maxDemand: Math.max(...demand), maxCoal: Math.max(...res)})`));
}
console.log('All economy field tests passed.');
