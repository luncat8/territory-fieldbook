// Owns: terrain ladder (meadow/forest/desert/water/hills/swamp + edges), build ease, wild food, wasteland, litter/CO2, claims, rest and site.
// Edit for: build ladder, housing, water barriers, consumption waste shares and healing. Engine-neutral: read per cell or per particle.
'use strict';

const TERRAIN_MEADOW = 0;
const TERRAIN_FOREST = 1;
const TERRAIN_DESERT = 2;
const TERRAIN_WATER = 3;
const TERRAIN_HILLS = 4;
const TERRAIN_SWAMP = 5;
const TERRAIN_NAMES = ['Meadow', 'Forest', 'Desert', 'Water', 'Hills', 'Swamp'];
const TERRAIN_REST = [1.1, 1, 0.45, 0, 0.95, 0.6];
// Build ease ladder: shore > forest/meadow glade > meadow > hills > forest > swamp edge > swamp.
const TERRAIN_BUILD = [1, 0.7, 0.6, 0, 0.8, 0.4];
const SHORE_BUILD = 1.25;
const GLADE_BUILD = 1.1;
const MARSH_EDGE_BUILD = 0.55;
const HOUSING_FLOOR = 0.4;
const TERRAIN_FOOD = [0.06, 0.5, 0, 0, 0.12, 0.35];
const SHORE_FOOD = 0.7;
const FOREST_TERRAIN = 0.6;
const DESERT_DRYNESS = 0.72;
const WASTE_REACH = 4;
const WASTE_DEPTH = 0.7;
const TOWN_SPACING = 7;
// [x, y, radius, swamp margin]; kept clear of reference actors and test cells so the chain stays connected.
const LAKES = [[18, 4, 2.2, 0], [35, 22, 2.4, 1.4], [44, 4, 1.8, 0]];
const HILLS = [[24, 25, 2.5], [44, 11, 2], [5, 1, 1.8]];
const USE_COAL = 0;
const USE_GOODS = 1;
const USE_FOOD = 2;
const USE_WOOD = 3;
// Share of each used unit that leaves as CO2 and as litter; the rest dissipates (heat, body, wear).
const USE_CO2 = [0.9, 0, 0.3, 0.6];
const USE_LITTER = [0.04, 0.05, 0.05, 0.05];
// Logistic healing peaks at LITTER_RECOVER/4 per cell; a busy town's neighbours stay well below that tipping point.
const LITTER_RECOVER = 0.08;
const LAND_STRIDE = 30;

class Land {
	constructor(model) {
		this.model = model;
		this.terrain = new Uint8Array(ECONOMY_SIZE);
		this.woodland = new Float64Array(ECONOMY_SIZE);
		this.moisture = new Float64Array(ECONOMY_SIZE);
		this.waterEdge = new Uint8Array(ECONOMY_SIZE);
		this.build = new Float64Array(ECONOMY_SIZE);
		this.foodCap = new Float64Array(ECONOMY_SIZE);
		this.waste = new Float64Array(ECONOMY_SIZE);
		this.litter = new Float64Array(ECONOMY_SIZE);
		this.claim = new Float64Array(ECONOMY_SIZE);
		this.rest = new Float64Array(ECONOMY_SIZE);
		this.site = new Float64Array(ECONOMY_SIZE);
		this.water = new Int32Array(ECONOMY_SIZE);
		this.waterCount = 0;
		this.seedTerrain();
		this.reset();
	}

	reset() {
		this.litter.fill(0);
		this.seed = 0x2545f491;
		this.ticks = this.used = this.co2 = this.littered = this.recovered = 0;
	}

	// Fixed smooth waves plus listed lakes and hills, so every reset and test sees the same map; a desert grows no wood.
	seedTerrain() {
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const x = i % ECONOMY_WIDTH, y = Math.floor(i / ECONOMY_WIDTH);
			const wave = 0.5 + 0.4 * Math.sin(x * 0.42 + 1.3) * Math.cos(y * 0.57 - 0.4) + 0.2 * Math.sin((x + y) * 0.21);
			const dryness = 0.5 + 0.35 * Math.sin(x * 0.16 - 2.2) * Math.cos(y * 0.2 - 2.6) + 0.15 * Math.sin((x - y) * 0.27);
			const desert = dryness > DESERT_DRYNESS;
			this.moisture[i] = Math.min(1, Math.max(0, 1 - dryness));
			this.woodland[i] = desert ? 0 : Math.min(1, Math.max(0, wave));
			this.terrain[i] = desert ? TERRAIN_DESERT : this.woodland[i] >= FOREST_TERRAIN ? TERRAIN_FOREST : TERRAIN_MEADOW;
			this.stampFeatures(i, x, y);
		}
	}

	stampFeatures(i, x, y) {
		for (const [hx, hy, r] of HILLS) {
			if (Math.hypot(x - hx, y - hy) >= r) continue;
			this.terrain[i] = TERRAIN_HILLS;
			this.woodland[i] *= 0.6;
		}
		for (const [lx, ly, r, marsh] of LAKES) {
			const d = Math.hypot(x - lx, y - ly) - r;
			if (d < 0) {
				this.terrain[i] = TERRAIN_WATER;
				this.woodland[i] = 0;
			} else if (d < marsh) {
				this.terrain[i] = TERRAIN_SWAMP;
				this.woodland[i] = 0.3;
			}
		}
	}

	// Actors change only on placement, removal and founding, so both cones are stamped then, never per tick.
	// Facilities spoil the land they stand on (wasteland, lower rest); towns claim theirs (no new town nearby).
	refresh() {
		const { actors } = this.model;
		this.waste.fill(0);
		this.claim.fill(0);
		for (let a = 0; a < ECONOMY_SIZE; a++) {
			const kind = actors[a];
			if (kind === ECONOMY_TOWN) this.stampCone(this.claim, a, TOWN_SPACING, 1);
			else if (kind === ECONOMY_SAWMILL || kind === ECONOMY_FARM) this.stampCone(this.claim, a, 3.5, 1);
			else if (kind) this.stampCone(this.waste, a, WASTE_REACH, WASTE_DEPTH);
		}
		this.waterCount = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (this.terrain[i] === TERRAIN_WATER) this.water[this.waterCount++] = i;
			this.readEdges(i);
		}
		this.rebuildRest();
	}

	// Edges decide build ease and wild food: a swamp edge spoils a shore, a shore beats a forest glade.
	readEdges(i) {
		const t = this.terrain[i];
		let shore = 0, marsh = 0, glade = 0;
		for (let k = 0; k < DEGREE; k++) {
			const to = NEIGHBORS[i * DEGREE + k];
			if (to < 0) continue;
			const n = this.terrain[to];
			if (n === TERRAIN_WATER) shore = 1;
			else if (n === TERRAIN_SWAMP) marsh = 1;
			else if ((t === TERRAIN_MEADOW && n === TERRAIN_FOREST) || (t === TERRAIN_FOREST && n === TERRAIN_MEADOW)) glade = 1;
		}
		const edged = t !== TERRAIN_WATER && t !== TERRAIN_SWAMP && t !== TERRAIN_DESERT;
		this.waterEdge[i] = shore && t !== TERRAIN_WATER ? 1 : 0;
		if (this.waterEdge[i] && t !== TERRAIN_DESERT) this.moisture[i] = Math.max(this.moisture[i], 0.62);
		this.build[i] = TERRAIN_BUILD[t];
		if (edged && marsh) this.build[i] = MARSH_EDGE_BUILD;
		else if (edged && shore) this.build[i] = SHORE_BUILD;
		else if (glade) this.build[i] = GLADE_BUILD;
		this.foodCap[i] = this.waterEdge[i] && t !== TERRAIN_DESERT ? Math.max(SHORE_FOOD, TERRAIN_FOOD[t]) : TERRAIN_FOOD[t];
	}

	rebuildRest() {
		const { actors } = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const t = this.terrain[i];
			this.rest[i] = TERRAIN_REST[t] * (1 - this.waste[i]) * (1 - this.litter[i]);
			this.site[i] = actors[i] || t === TERRAIN_WATER ? 0 : this.rest[i] * this.build[i] * (1 - this.claim[i]);
		}
	}

	// Housing room a town gets from its own cell: easy ground grows big, costly ground stays small.
	housing(i) {
		return HOUSING_FLOOR + (1 - HOUSING_FLOOR) * this.build[i];
	}

	// Cell-engine flows never enter water; prices still diffuse across it.
	blockWater(cap) {
		for (let k = 0; k < this.waterCount; k++) cap[this.water[k]] = 0;
	}

	addLitter(to, amount) {
		if (to < 0 || amount <= 0 || this.terrain[to] === TERRAIN_WATER) return;
		const added = Math.min(1 - this.litter[to], amount);
		this.litter[to] += added;
		this.littered += added;
	}

	// Every consumed unit is accounted: part burns to CO2, part is pushed as litter to a random neighbour, the rest dissipates.
	dispose(i, mass, use) {
		if (mass <= 0) return;
		this.used += mass;
		this.co2 += mass * USE_CO2[use];
		this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
		let to = NEIGHBORS[i * DEGREE + (this.seed >>> 29)];
		if (to < 0 || this.terrain[to] === TERRAIN_WATER) to = i;
		this.addLitter(to, mass * USE_LITTER[use]);
	}

	// Recovery speed scales with (1 − d): light litter heals near the base rate, fully spoiled land never does.
	step() {
		if (++this.ticks % LAND_STRIDE) return;
		const keep = LITTER_RECOVER * LAND_STRIDE * ECONOMY_DT;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const d = this.litter[i];
			if (d <= 0) continue;
			const healed = d * keep * (1 - d);
			this.litter[i] = d - healed;
			this.recovered += healed;
		}
		this.rebuildRest();
	}

	litterHeld() {
		let total = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) total += this.litter[i];
		return total;
	}

	stampCone(field, c, reach, depth) {
		const cx = c % ECONOMY_WIDTH, cy = Math.floor(c / ECONOMY_WIDTH), r = Math.ceil(reach);
		for (let dy = -r; dy <= r; dy++) {
			for (let dx = -r; dx <= r; dx++) {
				const i = wrapCell(cx + dx, cy + dy);
				if (i < 0) continue;
				field[i] = Math.max(field[i], depth * Math.max(0, 1 - Math.hypot(dx, dy) / reach));
			}
		}
	}
}

if (typeof module === 'object') module.exports = { Land };
