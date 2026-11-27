// owns: the water/humidity fields, conservative transport, grouping memory and the moisture ledger
// edit for: flow, grouping, evaporation, rain and ledger constants
'use strict';

if (typeof module !== 'undefined') Object.assign(globalThis, require('./terrain.js'));

const WATER_WIDTH = 64;
const WATER_HEIGHT = 64;
const WATER_DT = 0.05;
const WATER_SEED = 20261119;
const WATER_SCENARIOS = ['coast', 'valleys', 'islands', 'basin', 'flat', 'blank'];
const RAIN_G_MIN = 0.25;
const RAIN_GATE_SCALE = 1 / (1 - RAIN_G_MIN);
const MAX_OUTFLOW_SHARE = 0.5;
const WET_LEVEL = 0.02;
const RIVER_LEVEL = 0.12;

const WATER_PARAMS = {
	flowK: 150,
	fillMix: 1,
	groupFlow: 4,
	surfacePull: 0.1,
	levelGate: 0.4,
	levelCap: 2,
	retention: 0.015,
	groupEmit: 1.2,
	groupSpeedRef: 2,
	groupSpeedEps: 0.05,
	groupWaterRef: 0.25,
	groupDiffuse: 0.25,
	groupDecay: 0.4,
	evapRate: 0.015,
	evapHold: 2,
	evapToAir: 0.4,
	filmRate: 0.9,
	filmRef: 0.06,
	filmFlowHold: 0.95,
	filmSpeedRef: 2,
	seaEvap: 0.01,
	humDiffuse: 3,
	humDecay: 0.012,
	windX: 1.4,
	windY: 0,
	rainRate: 1.4,
	springRate: 0.5,
	uniformRain: 0.06
};

class WaterLab {
	constructor(options) {
		const opts = options || {};
		this.width = opts.width || WATER_WIDTH;
		this.rows = opts.height || WATER_HEIGHT;
		this.n = this.width * this.rows;
		this.buildTerrain = opts.buildTerrain || waterBuild;
		this.params = Object.assign({}, WATER_PARAMS, opts.params);
		this.scenario = opts.scenario || 'coast';
		this.seed = opts.seed === undefined ? WATER_SEED : opts.seed;
		this.springs = new Int32Array(64);
		this.springCount = 0;
		this.elev = new Float64Array(this.n);
		this.filled = new Float64Array(this.n);
		this.sea = new Uint8Array(this.n);
		this.water = new Float64Array(this.n);
		this.group = new Float64Array(this.n);
		this.groupScratch = new Float64Array(this.n);
		this.humidity = new Float64Array(this.n);
		this.humidityScratch = new Float64Array(this.n);
		this.rain = new Float64Array(this.n);
		this.fluxRate = new Float64Array(this.n);
		this.fluxX = new Float64Array(this.n);
		this.fluxY = new Float64Array(this.n);
		this.pot = new Float64Array(this.n);
		this.mobile = new Float64Array(this.n);
		this.rawRight = new Float64Array(this.n);
		this.rawDown = new Float64Array(this.n);
		this.donorRight = new Int32Array(this.n);
		this.donorDown = new Int32Array(this.n);
		this.out = new Float64Array(this.n);
		this.scale = new Float64Array(this.n);
		this.fluxAbs = new Float64Array(this.n);
		this.grouping = true;
		this.wind = true;
		this.rainMode = 'local';
		this.reset(this.scenario, this.seed);
	}

	reset(scenario, seed) {
		this.scenario = scenario || this.scenario;
		this.seed = seed === undefined ? this.seed : seed;
		this.time = 0;
		this.ticks = 0;
		this.springIn = 0;
		this.drizzleIn = 0;
		this.seaEvap = 0;
		this.seaDrain = 0;
		this.groundDrain = 0;
		this.humidityLost = 0;
		this.evaporated = 0;
		this.rained = 0;
		this.water.fill(0);
		this.group.fill(0);
		this.groupScratch.fill(0);
		this.humidity.fill(0);
		this.humidityScratch.fill(0);
		this.rain.fill(0);
		this.fluxRate.fill(0);
		this.fluxX.fill(0);
		this.fluxY.fill(0);
		this.buildTerrain(this, this.scenario, this.seed);
		this.initialMass = this.sumWater() + this.sumHumidity();
	}

	sumWater() {
		let sum = 0;
		for (let i = 0; i < this.n; i++) sum += this.water[i];
		return sum;
	}

	sumHumidity() {
		let sum = 0;
		for (let i = 0; i < this.n; i++) sum += this.humidity[i];
		return sum;
	}

	ledgerResidual() {
		const expected = this.initialMass + this.springIn + this.drizzleIn + this.seaEvap - this.seaDrain - this.groundDrain - this.humidityLost;
		return this.sumWater() + this.sumHumidity() - expected;
	}

	step(dt) {
		const d = dt === undefined ? WATER_DT : dt;
		this.time += d;
		this.ticks++;
		this.rain.fill(0);
		this.emitSprings(d);
		if (this.rainMode === 'uniform') this.emitDrizzle(d);
		this.transportWater(d);
		if (this.grouping) this.updateGroup(d);
		else this.group.fill(0);
		this.evaporate(d);
		this.diffuseHumidity(d);
		if (this.rainMode === 'local') this.condense(d);
		this.applySea();
	}

	emitSprings(dt) {
		const q = this.params.springRate * dt;
		for (let k = 0; k < this.springCount; k++) {
			this.water[this.springs[k]] += q;
			this.springIn += q;
		}
	}

	emitDrizzle(dt) {
		const q = this.params.uniformRain * dt;
		for (let i = 0; i < this.n; i++) {
			if (this.sea[i]) continue;
			this.water[i] += q;
			this.rain[i] += q;
			this.drizzleIn += q;
		}
	}

	// Two independent fluxes: downhill always advances a river's nose; up-G only pulls water into channels.
	transportWater(dt) {
		const w = this.width;
		const h = this.rows;
		const p = this.params;
		const water = this.water;
		const elev = this.filled;
		const sea = this.sea;
		const pot = this.pot;
		const mobile = this.mobile;
		const k = p.flowK * dt;
		const kg = this.grouping ? p.groupFlow * dt : 0;
		for (let i = 0; i < this.n; i++) {
			if (sea[i]) {
				pot[i] = elev[i];
				mobile[i] = 0;
				continue;
			}
			const surface = water[i] - p.levelGate;
			const level = surface > 0 ? (surface < p.levelCap ? surface : p.levelCap) : 0;
			pot[i] = elev[i] - (1 - p.fillMix) * (elev[i] - this.elev[i]) + p.surfacePull * level;
			const m = water[i] - p.retention;
			mobile[i] = m > 0 ? m : 0;
		}
		this.rawRight.fill(0);
		this.rawDown.fill(0);
		this.donorRight.fill(-1);
		this.donorDown.fill(-1);
		this.out.fill(0);
		this.fluxAbs.fill(0);
		this.fluxX.fill(0);
		this.fluxY.fill(0);
		for (let y = 0; y < h; y++) {
			const row = y * w;
			for (let x = 0; x < w; x++) {
				const i = row + x;
				if (x < w - 1) this.propose(i, i + 1, this.rawRight, this.donorRight, k, kg);
				if (y < h - 1) this.propose(i, i + w, this.rawDown, this.donorDown, k, kg);
			}
		}
		const scale = this.scale;
		for (let i = 0; i < this.n; i++) {
			const limit = MAX_OUTFLOW_SHARE * mobile[i];
			scale[i] = this.out[i] > limit ? limit / this.out[i] : 1;
		}
		for (let y = 0; y < h; y++) {
			const row = y * w;
			for (let x = 0; x < w; x++) {
				const i = row + x;
				if (x < w - 1) this.applyEdge(i, i + 1, this.rawRight, this.donorRight, scale, 1, 0);
				if (y < h - 1) this.applyEdge(i, i + w, this.rawDown, this.donorDown, scale, 0, 1);
			}
		}
		const inv = 1 / dt;
		for (let i = 0; i < this.n; i++) this.fluxRate[i] = this.fluxAbs[i] * inv;
	}

	propose(i, j, raw, donor, k, kg) {
		const mi = this.mobile[i];
		const mj = this.mobile[j];
		if (mi <= 0 && mj <= 0) return;
		const p = this.params;
		const groundI = this.filled[i] - (1 - p.fillMix) * (this.filled[i] - this.elev[i]);
		const groundJ = this.filled[j] - (1 - p.fillMix) * (this.filled[j] - this.elev[j]);
		const dh = groundI - groundJ;
		const ds = this.pot[i] - this.pot[j] - dh;
		const dg = this.group[j] - this.group[i];
		let f = 0;
		if (dh > 0) f += k * mi * dh;
		else if (dh < 0) f -= k * mj * -dh;
		// Bound only lake leveling: four neighbours must not over-correct a depth ripple.
		const levelLimit = p.surfacePull > 0 ? 0.125 / p.surfacePull : Infinity;
		if (ds > 0) f += Math.min(k * mi, levelLimit) * ds;
		else if (ds < 0) f -= Math.min(k * mj, levelLimit) * -ds;
		if (dg > 0) f += kg * mi * dg;
		else if (dg < 0) f -= kg * mj * -dg;
		if (f === 0) return;
		if (f > 0) {
			raw[i] = f;
			donor[i] = i;
			this.out[i] += f;
			return;
		}
		raw[i] = f;
		donor[i] = j;
		this.out[j] -= f;
	}

	applyEdge(i, j, raw, donor, scale, axisX, axisY) {
		const d = donor[i];
		if (d < 0) return;
		const signed = raw[i];
		const f = (signed < 0 ? -signed : signed) * scale[d];
		if (f <= 0) return;
		const water = this.water;
		if (signed > 0) { water[i] -= f; water[j] += f; }
		else { water[j] -= f; water[i] += f; }
		this.fluxAbs[i] += f;
		this.fluxAbs[j] += f;
		const fx = f * axisX;
		const fy = f * axisY;
		if (signed > 0) {
			this.fluxX[i] += fx; this.fluxX[j] -= fx;
			this.fluxY[i] += fy; this.fluxY[j] -= fy;
		} else {
			this.fluxX[i] -= fx; this.fluxX[j] += fx;
			this.fluxY[i] -= fy; this.fluxY[j] += fy;
		}
	}

	// Emission needs both moving water and depth: still seas and thin films emit nothing.
	updateGroup(dt) {
		const w = this.width;
		const h = this.rows;
		const p = this.params;
		const src = this.group;
		const dst = this.groupScratch;
		const mix = Math.min(0.24, p.groupDiffuse * dt);
		const decay = Math.exp(-p.groupDecay * dt);
		const gain = p.groupEmit * dt;
		for (let y = 0; y < h; y++) {
			const row = y * w;
			for (let x = 0; x < w; x++) {
				const i = row + x;
				if (this.sea[i]) { dst[i] = 0; continue; }
				let lap = 0;
				lap += x > 0 ? src[i - 1] - src[i] : 0;
				lap += x < w - 1 ? src[i + 1] - src[i] : 0;
				lap += y > 0 ? src[i - w] - src[i] : 0;
				lap += y < h - 1 ? src[i + w] - src[i] : 0;
				const depth = this.water[i];
				const speed = this.fluxRate[i] / (depth + p.groupSpeedEps);
				const s2 = speed * speed;
				const d2 = depth * depth;
				const fast = s2 / (s2 + p.groupSpeedRef * p.groupSpeedRef);
				const deep = d2 / (d2 + p.groupWaterRef * p.groupWaterRef);
				const value = (src[i] + mix * lap + gain * fast * deep) * decay;
				dst[i] = value > 1 ? 1 : value < 0 ? 0 : value;
			}
		}
		this.group = dst;
		this.groupScratch = src;
	}

	// Humidity spawn ~ water / (1 + hold * G); shallow films infiltrate fast instead of recycling into rain.
	evaporate(dt) {
		const p = this.params;
		const water = this.water;
		const humidity = this.humidity;
		const group = this.group;
		for (let i = 0; i < this.n; i++) {
			if (this.sea[i]) {
				const q = p.seaEvap * Math.max(0, 1 - humidity[i]) * dt;
				humidity[i] += q;
				this.seaEvap += q;
				continue;
			}
			const depth = water[i];
			const shallow = depth / p.filmRef;
			const s2 = shallow * shallow;
			const speed = this.fluxRate[i] / (depth + p.groupSpeedEps);
			const fast = speed * speed / (speed * speed + p.filmSpeedRef * p.filmSpeedRef);
			const protect = group[i] > fast ? group[i] : fast;
			const film = p.filmRate / (1 + s2 * s2 * s2) * (1 - p.filmFlowHold * protect);
			const rate = p.evapRate / (1 + p.evapHold * group[i]) + film;
			const e = depth * (1 - Math.exp(-rate * dt));
			const toAir = e * p.evapToAir;
			water[i] -= e;
			humidity[i] += toAir;
			this.evaporated += toAir;
			this.groundDrain += e - toAir;
		}
	}

	diffuseHumidity(dt) {
		const w = this.width;
		const h = this.rows;
		const p = this.params;
		const src = this.humidity;
		const dst = this.humidityScratch;
		const mix = Math.min(0.24, p.humDiffuse * dt);
		const decay = Math.exp(-p.humDecay * dt);
		const vx = this.wind ? Math.min(p.windX, 4) : 0;
		const vy = this.wind ? Math.min(p.windY, 4) : 0;
		const advStep = dt;
		let lost = 0;
		for (let y = 0; y < h; y++) {
			const row = y * w;
			for (let x = 0; x < w; x++) {
				const i = row + x;
				const cur = src[i];
				let lap = 0;
				lap += x > 0 ? src[i - 1] - cur : 0;
				lap += x < w - 1 ? src[i + 1] - cur : 0;
				lap += y > 0 ? src[i - w] - cur : 0;
				lap += y < h - 1 ? src[i + w] - cur : 0;
				let adv = 0;
				if (vx > 0) {
					const back = x > 0 ? src[i - 1] : 0;
					adv -= vx * (cur - back);
					if (x === w - 1) lost += vx * cur * advStep;
				}
				if (vx < 0) {
					const back = x < w - 1 ? src[i + 1] : 0;
					adv += vx * (cur - back);
					if (x === 0) lost -= vx * cur * advStep;
				}
				if (vy > 0) {
					const back = y > 0 ? src[i - w] : 0;
					adv -= vy * (cur - back);
					if (y === h - 1) lost += vy * cur * advStep;
				}
				if (vy < 0) {
					const back = y < h - 1 ? src[i + w] : 0;
					adv += vy * (cur - back);
					if (y === 0) lost -= vy * cur * advStep;
				}
				const beforeDecay = cur + mix * lap + adv * advStep;
				const next = beforeDecay * decay;
				lost += beforeDecay * (1 - decay);
				if (next < 0) { dst[i] = 0; lost += next; }
				else dst[i] = next;
			}
		}
		this.humidity = dst;
		this.humidityScratch = src;
		this.humidityLost += lost;
	}

	// Despawn is condensation: rain only where the grouping field is strong, never over the sea.
	condense(dt) {
		const p = this.params;
		const water = this.water;
		const humidity = this.humidity;
		const group = this.group;
		const rain = this.rain;
		for (let i = 0; i < this.n; i++) {
			if (this.sea[i]) continue;
			const g = group[i];
			if (g <= RAIN_G_MIN) continue;
			const t = (g - RAIN_G_MIN) * RAIN_GATE_SCALE;
			const gate = t * t;
			const r = humidity[i] * (1 - Math.exp(-p.rainRate * gate * dt));
			if (r <= 0) continue;
			humidity[i] -= r;
			water[i] += r;
			rain[i] += r;
			this.rained += r;
		}
	}

	applySea() {
		const water = this.water;
		for (let i = 0; i < this.n; i++) {
			if (!this.sea[i]) continue;
			const delta = water[i] - SEA_DEPTH;
			this.seaDrain += delta;
			water[i] = SEA_DEPTH;
			this.group[i] = 0;
		}
	}
}

function waterMetrics(model) {
	const n = model.n;
	let land = 0;
	let landWater = 0;
	let wet = 0;
	let riverWater = 0;
	let rainTotal = 0;
	let rainGrouped = 0;
	let rainOnSea = 0;
	let groupMax = 0;
	let humiditySum = 0;
	let fluxSum = 0;
	for (let i = 0; i < n; i++) {
		const g = model.group[i];
		if (g > groupMax) groupMax = g;
		humiditySum += model.humidity[i];
		fluxSum += model.fluxRate[i];
		if (model.rain[i] > 0) {
			rainTotal += model.rain[i];
			if (g > 0.4) rainGrouped += model.rain[i];
			if (model.sea[i]) rainOnSea += model.rain[i];
		}
		if (model.sea[i]) continue;
		land++;
		const w = model.water[i];
		landWater += w;
		if (w > WET_LEVEL) wet++;
		if (w > RIVER_LEVEL) riverWater += w;
	}
	return {
		time: model.time,
		landCells: land,
		landWater: landWater,
		wetFraction: land ? wet / land : 0,
		riverShare: landWater > 0 ? riverWater / landWater : 0,
		rainTotal: rainTotal,
		groupedRainShare: rainTotal > 0 ? rainGrouped / rainTotal : 0,
		rainOnSea: rainOnSea,
		groupMax: groupMax,
		humidityMean: humiditySum / n,
		fluxMean: fluxSum / n,
		ledgerResidual: model.ledgerResidual(),
		totalWater: model.sumWater(),
		totalHumidity: model.sumHumidity()
	};
}

if (typeof module !== 'undefined') {
	module.exports = {
		WaterLab, WATER_PARAMS, WATER_DT, WATER_WIDTH, WATER_HEIGHT, WATER_SCENARIOS,
		WATER_SEED, SEA_LEVEL, SEA_DEPTH, SEA_HEIGHT, WET_LEVEL, RIVER_LEVEL, RAIN_G_MIN,
		waterIndex, waterFbm, waterBuild, waterFill, waterMetrics
	};
}
