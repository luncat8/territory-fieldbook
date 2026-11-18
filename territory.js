// owns: influence fields per faction, cell control, share and contest
// edit for: source strengths, decay, control threshold

const FACTION_PLAYER = 0;
const FACTION_A = 1;
const FACTION_B = 2;
const FACTION_COUNT = 3;
const FACTION_NAME = ['our party', 'Ash Company', 'Salt Guild'];
const FACTION_RGB = [
	[96, 202, 214],
	[212, 92, 84],
	[216, 160, 70]
];
const FACTION_NONE = 255;
const SOURCE_CAP = 96;
const MAINTAIN_RANGE = 6;
const TERRITORY_MIN = 0.05;
const TERRITORY_CONTESTED = 0.25;
const CAMP_STRENGTH = 1.0;
const CAMP_RADIUS = 4.5;
const CAMP_DECAY = 0.003;
const INFLUENCE_EPSILON = 0.01;

const territory = {
	fields: null,
	control: null,
	share: new Float32Array(FACTION_COUNT),
	sources: []
};

function territoryInit() {
	territory.fields = new Float32Array(world.n * FACTION_COUNT);
	territory.control = new Uint8Array(world.n);
	territory.control.fill(FACTION_NONE);
	territory.share.fill(0);
	territory.sources.length = 0;
}

function territoryAddSource(owner, x, y, base, radius, decay) {
	if (territory.sources.length >= SOURCE_CAP) return null;
	const source = {
		owner: owner,
		x: x,
		y: y,
		base: base,
		radius: radius,
		decay: decay,
		strength: base,
		maintained: true,
		camp: false
	};
	territory.sources.push(source);
	return source;
}

function territoryAddCamp(owner, x, y) {
	const source = territoryAddSource(owner, x, y, CAMP_STRENGTH, CAMP_RADIUS, CAMP_DECAY);
	if (source) source.camp = true;
	return source;
}

function territorySetCamp(owner, x, y) {
	const sources = territory.sources;
	for (let s = 0; s < sources.length; s++) {
		const source = sources[s];
		if (!source.camp || source.owner !== owner) continue;
		source.x = x;
		source.y = y;
		source.strength = CAMP_STRENGTH;
		source.maintained = true;
		return;
	}
	territoryAddCamp(owner, x, y);
}

function territoryClearCamp(owner) {
	const sources = territory.sources;
	for (let s = 0; s < sources.length; s++) {
		if (!sources[s].camp || sources[s].owner !== owner) continue;
		sources.splice(s, 1);
		return;
	}
}

function territoryMaintain(owner, x, y) {
	const sources = territory.sources;
	for (let s = 0; s < sources.length; s++) {
		const source = sources[s];
		if (source.owner !== owner) continue;
		const dx = source.x - x;
		const dy = source.y - y;
		if (Math.max(dx < 0 ? -dx : dx, dy < 0 ? -dy : dy) <= MAINTAIN_RANGE) source.maintained = true;
	}
}

function territoryContest(i, faction) {
	const fields = territory.fields;
	const mine = fields[faction * world.n + i];
	for (let f = 0; f < FACTION_COUNT; f++) {
		if (f === faction) continue;
		if (fields[f * world.n + i] > mine + INFLUENCE_EPSILON) return TERRITORY_CONTESTED;
	}
	return 1;
}

function territoryStep(seconds) {
	const sources = territory.sources;
	const fields = territory.fields;
	const n = world.n;
	fields.fill(0);
	for (let s = 0; s < sources.length; s++) {
		const source = sources[s];
		if (source.maintained) {
			source.strength = source.base;
			source.maintained = false;
		} else {
			source.strength -= source.decay * seconds;
			if (source.strength < 0) source.strength = 0;
		}
		if (source.strength <= 0) continue;
		const offset = source.owner * n;
		const radius = source.radius;
		const radius2 = radius * radius;
		const r = Math.ceil(radius);
		const x0 = Math.max(0, source.x - r);
		const x1 = Math.min(MAP_SIZE - 1, source.x + r);
		const y0 = Math.max(0, source.y - r);
		const y1 = Math.min(MAP_SIZE - 1, source.y + r);
		for (let y = y0; y <= y1; y++) {
			const dy = y - source.y;
			const row = y * MAP_SIZE;
			for (let x = x0; x <= x1; x++) {
				const dx = x - source.x;
				const d2 = dx * dx + dy * dy;
				if (d2 > radius2) continue;
				fields[offset + row + x] += source.strength * (1 - d2 / radius2);
			}
		}
	}
	let player = 0;
	let rivalA = 0;
	let rivalB = 0;
	const control = territory.control;
	for (let i = 0; i < n; i++) {
		const pa = fields[i];
		const pb = fields[n + i];
		const pc = fields[n + n + i];
		let best = FACTION_NONE;
		let value = TERRITORY_MIN;
		if (pa > value) { best = FACTION_PLAYER; value = pa; }
		if (pb > value) { best = FACTION_A; value = pb; }
		if (pc > value) { best = FACTION_B; value = pc; }
		control[i] = best;
		if (best === FACTION_PLAYER) player++;
		else if (best === FACTION_A) rivalA++;
		else if (best === FACTION_B) rivalB++;
	}
	territory.share[FACTION_PLAYER] = player / n;
	territory.share[FACTION_A] = rivalA / n;
	territory.share[FACTION_B] = rivalB / n;
}

if (typeof module !== 'undefined') module.exports = { territory, territoryInit, territoryStep, FACTION_PLAYER, FACTION_COUNT };
