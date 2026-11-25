// Owns: the low-res food gradient (half-grid, multi-tick step), wild shoreline/forest food and Monastery gardens.
// Edit for: coarse grid resolution/stride, wild food capacities and Monastery garden farm yields/free rations.
'use strict';

const FORAGE_SCALE = 2;
const FORAGE_STRIDE = 4;
const FORAGE_DIFFUSE = 2.0;
const FORAGE_DECAY = 0.22;
const FORAGE_RESPONSE = 2.4;
const WATER_FOOD_CAP = 0.7;
const FOREST_FOOD_CAP = 0.55;
const MEADOW_FOOD_CAP = 0.05;
const WILD_REGROW = 0.045;
const WILD_PICK_RATE = 0.16;
const WILD_SIGNAL = 1.6;
const GARDEN_RADIUS = 1;
const GARDEN_SEASON_SEC = 6;
const GARDEN_CELL_YIELD = 0.55;
const GARDEN_STOCK_CAP = 8;
const GARDEN_SPOIL = 0.012;
const GARDEN_PICK_RATE = 0.55;
const GARDEN_SIGNAL = 3.2;

class ForageSystem {
	constructor(model) {
		this.model = model;
		this.cw = Math.ceil(ECONOMY_WIDTH / FORAGE_SCALE);
		this.ch = Math.ceil(ECONOMY_HEIGHT / FORAGE_SCALE);
		this.cn = this.cw * this.ch;
		this.field = new Float64Array(this.cn);
		this.nextField = new Float64Array(this.cn);
		this.coarseSource = new Float64Array(this.cn);
		this.coarseNeighbors = this.buildCoarseNeighbors();
		this.wildCap = new Float64Array(ECONOMY_SIZE);
		this.wildFood = new Float64Array(ECONOMY_SIZE);
		this.plotOwner = new Int32Array(ECONOMY_SIZE);
		this.gardenStock = new Float64Array(ECONOMY_SIZE);
		this.gardenCrop = new Float64Array(ECONOMY_SIZE);
		this.gardenClock = new Float64Array(ECONOMY_SIZE);
		this.fineView = new Float64Array(ECONOMY_SIZE);
		this.stockView = new Float64Array(ECONOMY_SIZE);
		this.regrowShare = 1 - Math.exp(-ECONOMY_DT * WILD_REGROW);
		this.spoilShare = 1 - Math.exp(-ECONOMY_DT * GARDEN_SPOIL);
	}

	buildCoarseNeighbors() {
		const res = new Int16Array(this.cn * DEGREE).fill(-1);
		for (let ci = 0; ci < this.cn; ci++) {
			const cx = ci % this.cw, cy = Math.floor(ci / this.cw);
			for (let k = 0; k < DEGREE; k++) {
				const nx = cx + DIRECTIONS[k].x, ny = cy + DIRECTIONS[k].y;
				if (nx >= 0 && nx < this.cw && ny >= 0 && ny < this.ch) res[ci * DEGREE + k] = ny * this.cw + nx;
			}
		}
		return res;
	}

	reset() {
		this.field.fill(0);
		this.nextField.fill(0);
		this.plotOwner.fill(0);
		this.gardenStock.fill(0);
		this.gardenCrop.fill(0);
		this.gardenClock.fill(0);
		this.stepCounter = this.coarseUpdates = 0;
		this.wildPicked = this.gardenGrown = this.gardenFed = this.gardenSpoiled = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (this.model.actors[i] === ECONOMY_GARDEN) {
				this.claimPlots(i);
				this.gardenStock[i] = 1.6;
				this.gardenGrown += 1.6;
			}
		}
		this.refreshWildCaps();
		this.wildFood.set(this.wildCap);
	}

	warm() {
		this.refreshWildCaps();
		for (let n = 0; n < 16; n++) this.stepCoarse();
	}

	// Claims walkable surrounding plots like a farm; clearing trims plot canopy and releases back on erase.
	claimPlots(g) {
		const { actors, land, settlements } = this.model;
		const gx = g % ECONOMY_WIDTH, gy = Math.floor(g / ECONOMY_WIDTH), tag = g + 1;
		for (let y = Math.max(0, gy - GARDEN_RADIUS); y <= Math.min(ECONOMY_HEIGHT - 1, gy + GARDEN_RADIUS); y++) {
			for (let x = Math.max(0, gx - GARDEN_RADIUS); x <= Math.min(ECONOMY_WIDTH - 1, gx + GARDEN_RADIUS); x++) {
				const i = economyIndex(x, y);
				if (land.terrain[i] === TERRAIN_WATER || (actors[i] && i !== g) || this.plotOwner[i] !== 0 || this.model.farms.plotOwner[i]) continue;
				this.plotOwner[i] = tag;
				settlements.forest[i] *= 0.25;
			}
		}
	}

	releasePlots(g) {
		const tag = g + 1;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (this.plotOwner[i] === tag) this.plotOwner[i] = 0;
		}
		this.gardenStock[g] = this.gardenCrop[g] = this.gardenClock[g] = 0;
	}

	plotCount(g) {
		const gx = g % ECONOMY_WIDTH, gy = Math.floor(g / ECONOMY_WIDTH), tag = g + 1;
		let count = 0;
		for (let y = Math.max(0, gy - GARDEN_RADIUS); y <= Math.min(ECONOMY_HEIGHT - 1, gy + GARDEN_RADIUS); y++) {
			for (let x = Math.max(0, gx - GARDEN_RADIUS); x <= Math.min(ECONOMY_WIDTH - 1, gx + GARDEN_RADIUS); x++) {
				if (this.plotOwner[economyIndex(x, y)] === tag) count++;
			}
		}
		return count;
	}

	plotQuality(i) {
		const { land } = this.model;
		if (land.terrain[i] === TERRAIN_WATER) return 0;
		if (land.terrain[i] === TERRAIN_DESERT) return 0.14 * (1 - land.waste[i]);
		const shore = land.waterEdge[i] ? 0.2 : 0;
		return Math.min(1.15, (0.42 + 0.55 * land.moisture[i] + shore) * (1 - land.waste[i]));
	}

	refreshWildCaps() {
		const { land, settlements } = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const t = land.terrain[i];
			if (t === TERRAIN_WATER || t === TERRAIN_DESERT) {
				this.wildCap[i] = 0;
				if (this.wildFood[i] > 0) this.wildFood[i] = 0;
				continue;
			}
			const shore = land.waterEdge[i] ? WATER_FOOD_CAP : 0;
			const woods = FOREST_FOOD_CAP * settlements.forest[i];
			this.wildCap[i] = (MEADOW_FOOD_CAP + shore + woods) * (1 - land.waste[i]);
		}
	}

	// Resident monks maintain base tending while visiting foragers help bring the seasonal harvest to full yield.
	stepGarden(g) {
		const plots = this.plotCount(g);
		if (plots <= 0) return;
		const helpers = this.model.forageCount[g];
		const crew = Math.min(plots, plots * 0.72 + helpers * 0.5);
		this.gardenCrop[g] += crew * ECONOMY_DT;
		if (this.gardenStock[g] > 0) {
			const lost = this.gardenStock[g] * this.spoilShare;
			this.gardenStock[g] = Math.max(0, this.gardenStock[g] - lost);
			this.gardenSpoiled += lost;
		}
		this.gardenClock[g] += ECONOMY_DT;
		if (this.gardenClock[g] < GARDEN_SEASON_SEC) return;
		this.gardenClock[g] -= GARDEN_SEASON_SEC;
		const workShare = Math.min(1, this.gardenCrop[g] / (plots * GARDEN_SEASON_SEC));
		this.gardenCrop[g] = 0;
		const gx = g % ECONOMY_WIDTH, gy = Math.floor(g / ECONOMY_WIDTH), tag = g + 1;
		let harvest = 0;
		for (let y = Math.max(0, gy - GARDEN_RADIUS); y <= Math.min(ECONOMY_HEIGHT - 1, gy + GARDEN_RADIUS); y++) {
			for (let x = Math.max(0, gx - GARDEN_RADIUS); x <= Math.min(ECONOMY_WIDTH - 1, gx + GARDEN_RADIUS); x++) {
				const i = economyIndex(x, y);
				if (this.plotOwner[i] === tag) harvest += GARDEN_CELL_YIELD * this.plotQuality(i) * workShare;
			}
		}
		const room = Math.max(0, GARDEN_STOCK_CAP - this.gardenStock[g]);
		const added = Math.min(room, harvest);
		this.gardenStock[g] += added;
		this.gardenGrown += added;
	}

	step() {
		const { actors } = this.model;
		this.refreshWildCaps();
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			this.wildFood[i] += this.regrowShare * (this.wildCap[i] - this.wildFood[i]);
			if (actors[i] === ECONOMY_GARDEN) this.stepGarden(i);
		}
		if (this.stepCounter++ % FORAGE_STRIDE === 0) this.stepCoarse();
	}

	// Single-pass coarse diffusion every FORAGE_STRIDE ticks keeps wild-food reach cheap as map size scales.
	stepCoarse() {
		const { actors } = this.model;
		const src = this.coarseSource, field = this.field, next = this.nextField;
		const dt = FORAGE_STRIDE * ECONOMY_DT;
		const decay = this.model.decay ? FORAGE_DECAY : 0;
		const cellArea = FORAGE_SCALE * FORAGE_SCALE;
		src.fill(0);
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const cx = Math.floor((i % ECONOMY_WIDTH) / FORAGE_SCALE);
			const cy = Math.floor(Math.floor(i / ECONOMY_WIDTH) / FORAGE_SCALE);
			const ci = cy * this.cw + cx;
			let s = (this.wildFood[i] * WILD_SIGNAL) / cellArea;
			if (actors[i] === ECONOMY_GARDEN && this.gardenStock[i] > 1e-4) {
				s += GARDEN_SIGNAL * (this.gardenStock[i] / (this.gardenStock[i] + 0.4));
			}
			src[ci] += s;
		}
		const keep = Math.exp(-decay * dt);
		for (let ci = 0; ci < this.cn; ci++) {
			const here = field[ci], base = ci * DEGREE;
			let laplacian = 0;
			for (let k = 0; k < DEGREE; k++) {
				const to = this.coarseNeighbors[base + k];
				if (to >= 0) laplacian += DIRECTIONS[k].weight * (field[to] - here);
			}
			const ambient = Math.max(0, (here + dt * (FORAGE_DIFFUSE / 6) * laplacian) * keep);
			const target = src[ci];
			next[ci] = target <= ambient ? ambient : Math.max(ambient, here + dt * FORAGE_RESPONSE * (target - here));
		}
		this.field = next;
		this.nextField = field;
		this.coarseUpdates++;
	}

	fineRichness(i) {
		let r = this.wildFood[i] * WILD_SIGNAL;
		if (this.model.actors[i] === ECONOMY_GARDEN && this.gardenStock[i] > 1e-4) {
			r += GARDEN_SIGNAL * (this.gardenStock[i] / (this.gardenStock[i] + 0.4));
		}
		return r;
	}

	// Bilinear sample of the coarse gradient plus local richness lands walkers on the exact garden or shore cell.
	scoreAtCell(i) {
		if (this.model.land.terrain[i] === TERRAIN_WATER) return 0;
		const fx = (i % ECONOMY_WIDTH + 0.5) / FORAGE_SCALE - 0.5;
		const fy = (Math.floor(i / ECONOMY_WIDTH) + 0.5) / FORAGE_SCALE - 0.5;
		const x0 = Math.max(0, Math.min(this.cw - 1, Math.floor(fx)));
		const y0 = Math.max(0, Math.min(this.ch - 1, Math.floor(fy)));
		const x1 = Math.min(this.cw - 1, x0 + 1);
		const y1 = Math.min(this.ch - 1, y0 + 1);
		const tx = Math.max(0, Math.min(1, fx - x0));
		const ty = Math.max(0, Math.min(1, fy - y0));
		const f = this.field;
		const top = f[y0 * this.cw + x0] * (1 - tx) + f[y0 * this.cw + x1] * tx;
		const bot = f[y1 * this.cw + x0] * (1 - tx) + f[y1 * this.cw + x1] * tx;
		return top * (1 - ty) + bot * ty + 0.35 * this.fineRichness(i);
	}

	// Monastery gardens hand out free rations first; otherwise the worker gathers slowly from wild shore/forest food.
	pickAt(i, need) {
		if (need <= 0) return 0;
		if (this.model.actors[i] === ECONOMY_GARDEN && this.gardenStock[i] > 1e-6) {
			const free = Math.min(need, this.gardenStock[i], GARDEN_PICK_RATE * ECONOMY_DT);
			this.gardenStock[i] -= free;
			this.gardenFed += free;
			return free;
		}
		const avail = this.wildFood[i];
		if (avail <= 1e-4) return 0;
		const rate = WILD_PICK_RATE * (avail / (avail + 0.12));
		const picked = Math.min(need, avail, rate * ECONOMY_DT);
		this.wildFood[i] -= picked;
		this.wildPicked += picked;
		return picked;
	}

	buildStockView() {
		const out = this.stockView, { actors } = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			out[i] = this.wildFood[i] + (actors[i] === ECONOMY_GARDEN ? this.gardenStock[i] * 0.25 : this.plotOwner[i] ? 0.12 : 0);
		}
		return out;
	}

	buildGradientView() {
		const out = this.fineView;
		for (let i = 0; i < ECONOMY_SIZE; i++) out[i] = this.scoreAtCell(i);
		return out;
	}
}

if (typeof module === 'object') module.exports = { ForageSystem, FORAGE_SCALE, FORAGE_STRIDE };
