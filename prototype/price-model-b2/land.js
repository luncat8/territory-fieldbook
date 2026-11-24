// Owns: lab terrain (meadow / forest / desert), wasteland around facilities, town land claim, the rest factor and town site quality.
// Edit for: terrain rest bonuses, wasteland reach, town spacing. Engine-neutral: cells and particles read rest/site per position.
'use strict';

const TERRAIN_MEADOW = 0;
const TERRAIN_FOREST = 1;
const TERRAIN_DESERT = 2;
const TERRAIN_NAMES = ['Meadow', 'Forest', 'Desert'];
const TERRAIN_REST = [1.1, 1, 0.45];
const FOREST_TERRAIN = 0.6;
const DESERT_DRYNESS = 0.72;
const WASTE_REACH = 4;
const WASTE_DEPTH = 0.7;
const TOWN_SPACING = 7;

class Land {
	constructor(model) {
		this.model = model;
		this.terrain = new Uint8Array(ECONOMY_SIZE);
		this.woodland = new Float64Array(ECONOMY_SIZE);
		this.waste = new Float64Array(ECONOMY_SIZE);
		this.claim = new Float64Array(ECONOMY_SIZE);
		this.rest = new Float64Array(ECONOMY_SIZE);
		this.site = new Float64Array(ECONOMY_SIZE);
		this.seedTerrain();
	}

	// Fixed smooth waves, so every reset and test sees the same map; a desert grows no wood.
	seedTerrain() {
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const x = i % ECONOMY_WIDTH, y = Math.floor(i / ECONOMY_WIDTH);
			const wave = 0.5 + 0.4 * Math.sin(x * 0.42 + 1.3) * Math.cos(y * 0.57 - 0.4) + 0.2 * Math.sin((x + y) * 0.21);
			const dryness = 0.5 + 0.35 * Math.sin(x * 0.16 - 2.2) * Math.cos(y * 0.2 - 2.6) + 0.15 * Math.sin((x - y) * 0.27);
			const desert = dryness > DESERT_DRYNESS;
			this.woodland[i] = desert ? 0 : Math.min(1, Math.max(0, wave));
			this.terrain[i] = desert ? TERRAIN_DESERT : this.woodland[i] >= FOREST_TERRAIN ? TERRAIN_FOREST : TERRAIN_MEADOW;
		}
	}

	// Actors change only on placement, removal and founding, so both cones are stamped then, never per tick.
	// Facilities spoil the land they stand on (wasteland, lower rest); towns claim theirs (no new town nearby).
	refresh() {
		const { actors } = this.model;
		this.waste.fill(0);
		this.claim.fill(0);
		for (let a = 0; a < ECONOMY_SIZE; a++) {
			if (actors[a] === ECONOMY_TOWN) this.stampCone(this.claim, a, TOWN_SPACING, 1);
			else if (actors[a]) this.stampCone(this.waste, a, WASTE_REACH, WASTE_DEPTH);
		}
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			this.rest[i] = TERRAIN_REST[this.terrain[i]] * (1 - this.waste[i]);
			this.site[i] = actors[i] ? 0 : this.rest[i] * (1 - this.claim[i]);
		}
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
