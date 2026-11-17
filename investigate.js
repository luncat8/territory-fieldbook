// owns: investigation progress per cell, search radius and distance falloff
// edit for: investigation rates, falloff shape, radius choices

// indexed by world terrain id: meadow, forest, water, swamp, hills, desert
const INV_RATE = [0.50, 0.30, 0, 0.26, 0.40, 0.20];
const INV_RADIUS_CHOICES = [1, 2];

const investigation = {
	progress: null,
	radius: 2
};

function investigationInit() {
	investigation.progress = new Float32Array(world.n);
	investigation.radius = 2;
}

function investigationSeed(x, y) {
	for (let dy = -1; dy <= 1; dy++) {
		for (let dx = -1; dx <= 1; dx++) {
			if (!worldWalkableAt(x + dx, y + dy)) continue;
			investigation.progress[(y + dy) * MAP_SIZE + x + dx] = 0.5;
		}
	}
}

function investigationReach() {
	const here = world.terrain[party.y * MAP_SIZE + party.x];
	let reach = investigation.radius + 2;
	if (here === TERRAIN.HILLS) reach += 1;
	if (here === TERRAIN.FOREST) reach -= 1;
	return reach > investigation.radius + 1 ? reach : investigation.radius + 1;
}

function investigationStep(minutes) {
	if (!party.alive) return;
	const progress = investigation.progress;
	const hours = minutes / 60;
	const centre = investigation.radius;
	const reach = investigationReach();
	const span = reach - centre;
	const originX = party.x;
	const originY = party.y;
	const effort = party.investigateFactor();
	const r = Math.ceil(reach);
	const x0 = Math.max(0, originX - r);
	const x1 = Math.min(MAP_SIZE - 1, originX + r);
	const y0 = Math.max(0, originY - r);
	const y1 = Math.min(MAP_SIZE - 1, originY + r);
	for (let y = y0; y <= y1; y++) {
		const dy = y - originY;
		const row = y * MAP_SIZE;
		for (let x = x0; x <= x1; x++) {
			const dx = x - originX;
			const i = row + x;
			const cheb = Math.max(dx < 0 ? -dx : dx, dy < 0 ? -dy : dy);
			let m = 0;
			if (cheb <= centre) m = 1;
			else {
				const dist = Math.sqrt(dx * dx + dy * dy);
				let t = (reach - dist) / span;
				if (t > 1) t = 1;
				if (t > 0) m = t * t * (3 - 2 * t);
			}
			if (m <= 0 || world.terrain[i] === TERRAIN.WATER) continue;
			const rate = INV_RATE[world.terrain[i]] * m * effort * hours * territoryContest(i, FACTION_PLAYER);
			const next = progress[i] + rate;
			progress[i] = next > 1 ? 1 : next;
		}
	}
}

if (typeof module !== 'undefined') module.exports = { investigation, investigationInit, investigationStep };
