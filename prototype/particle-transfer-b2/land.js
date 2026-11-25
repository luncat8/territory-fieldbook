// Owns: terrain (meadow, forest, desert, water), moisture, shoreline flags, facility wasteland, town claims and site quality.
// Edit for: water bodies, terrain walk speeds, rest bonuses, wasteland cones and town spacing.
'use strict';

const TERRAIN_MEADOW = 0;
const TERRAIN_FOREST = 1;
const TERRAIN_DESERT = 2;
const TERRAIN_WATER = 3;
const TERRAIN_NAMES = ['Meadow', 'Forest', 'Desert', 'Water'];
const TERRAIN_SPEED = [1, 0.75, 0.85, 0];
const TERRAIN_REST = [1.1, 1, 0.45, 0];
const WATER_EDGE_SITE = 1.22;
const FOREST_TERRAIN = 0.6;
const DESERT_DRYNESS = 0.72;
const WASTE_REACH = 4;
const WASTE_DEPTH = 0.7;
const TOWN_SPACING = 7;
const LAKES = [[18, 4, 2.2], [35, 22, 2.4], [2, 4, 1.8]];

class Land {
	constructor(model) {
		this.model = model;
		this.terrain = new Uint8Array(ECONOMY_SIZE);
		this.woodland = new Float64Array(ECONOMY_SIZE);
		this.moisture = new Float64Array(ECONOMY_SIZE);
		this.waterEdge = new Uint8Array(ECONOMY_SIZE);
		this.waste = new Float64Array(ECONOMY_SIZE);
		this.claim = new Float64Array(ECONOMY_SIZE);
		this.speed = new Float64Array(ECONOMY_SIZE);
		this.rest = new Float64Array(ECONOMY_SIZE);
		this.site = new Float64Array(ECONOMY_SIZE);
		this.seedTerrain();
	}

	// Deterministic waves and three compact lakes away from reference sites keep tests reproducible and connected.
	seedTerrain() {
		const { actors } = this.model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const x = i % ECONOMY_WIDTH, y = Math.floor(i / ECONOMY_WIDTH);
			let lakeDist = 99;
			for (let k = 0; k < LAKES.length; k++) {
				const d = Math.hypot(x - LAKES[k][0], y - LAKES[k][1]) - LAKES[k][2];
				if (d < lakeDist) lakeDist = d;
			}
			if (lakeDist < 0 && !actors[i]) {
				this.terrain[i] = TERRAIN_WATER;
				this.woodland[i] = 0;
				this.moisture[i] = 1;
				continue;
			}
			const wave = 0.5 + 0.4 * Math.sin(x * 0.42 + 1.3) * Math.cos(y * 0.57 - 0.4) + 0.2 * Math.sin((x + y) * 0.21);
			const dryness = 0.5 + 0.35 * Math.sin(x * 0.16 - 2.2) * Math.cos(y * 0.2 - 2.6) + 0.15 * Math.sin((x - y) * 0.27);
			const wetLift = Math.max(0, 1 - lakeDist / 5) * 0.35;
			const desert = dryness - wetLift > DESERT_DRYNESS;
			this.woodland[i] = desert ? 0 : Math.min(1, Math.max(0, wave + wetLift * 0.4));
			this.moisture[i] = desert ? 0.12 : Math.min(0.95, 0.42 + 0.32 * this.woodland[i] + wetLift);
			this.terrain[i] = desert ? TERRAIN_DESERT : this.woodland[i] >= FOREST_TERRAIN ? TERRAIN_FOREST : TERRAIN_MEADOW;
		}
	}

	// Recomputes shoreline flags, wasteland/claim cones and steering conductance whenever terrain or actors change.
	refresh() {
		const { actors } = this.model;
		this.waste.fill(0);
		this.claim.fill(0);
		this.waterEdge.fill(0);
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (this.terrain[i] === TERRAIN_WATER) continue;
			const base = i * DEGREE;
			for (let k = 0; k < DEGREE; k++) {
				const to = NEIGHBORS[base + k];
				if (to >= 0 && this.terrain[to] === TERRAIN_WATER) {
					this.waterEdge[i] = 1;
					break;
				}
			}
		}
		for (let a = 0; a < ECONOMY_SIZE; a++) {
			const kind = actors[a];
			if (kind === ECONOMY_TOWN) this.stampCone(this.claim, a, TOWN_SPACING, 1);
			else if (kind && kind !== ECONOMY_GARDEN) this.stampCone(this.waste, a, WASTE_REACH, WASTE_DEPTH);
		}
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const t = this.terrain[i];
			this.speed[i] = TERRAIN_SPEED[t];
			this.rest[i] = TERRAIN_REST[t] * (1 - this.waste[i]);
			const shore = this.waterEdge[i] && t !== TERRAIN_DESERT ? WATER_EDGE_SITE : 1;
			this.site[i] = actors[i] || t === TERRAIN_WATER ? 0 : this.rest[i] * shore * (1 - this.claim[i]);
		}
		if (this.model.steering) this.model.steering.rebuildConductance();
	}

	stampCone(field, c, reach, depth) {
		const cx = c % ECONOMY_WIDTH, cy = Math.floor(c / ECONOMY_WIDTH), r = Math.ceil(reach);
		for (let y = Math.max(0, cy - r); y <= Math.min(ECONOMY_HEIGHT - 1, cy + r); y++) {
			for (let x = Math.max(0, cx - r); x <= Math.min(ECONOMY_WIDTH - 1, cx + r); x++) {
				const i = economyIndex(x, y);
				field[i] = Math.max(field[i], depth * Math.max(0, 1 - Math.hypot(x - cx, y - cy) / reach));
			}
		}
	}
}

if (typeof module === 'object') module.exports = { Land };
