// owns: investigation progress per cell and Euclidean distance falloff
// edit for: investigation rates, falloff shape, float radius

const INV_RATE = [0.50, 0.30, 0, 0.26, 0.40, 0.20];
const INV_RADIUS = 3.5;
const INV_INNER = 1.2;
const INV_NEARBY_RANGE = 8;
const INV_NEARBY_CAP = 16;
const INV_SURVEY_HOURS = 2.5;
const INV_SURVEY_CONDITION = 2;
const INV_SURVEY_COOLDOWN = 6;

const investigation = {
	progress: null,
	nearby: new Int16Array(INV_NEARBY_CAP),
	nearbyCount: 0,
	surveyTicks: 0
};

function investigationInit() {
	investigation.progress = new Float32Array(world.n);
	investigation.nearbyCount = 0;
	investigation.surveyTicks = 0;
}

function investigationSeed(x, y) {
	const progress = investigation.progress;
	for (let dy = -2; dy <= 2; dy++) {
		for (let dx = -2; dx <= 2; dx++) {
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist > 1.6) continue;
			if (!worldWalkableAt(x + dx, y + dy)) continue;
			progress[(y + dy) * MAP_SIZE + x + dx] = 0.5;
		}
	}
}

function investigationReach() {
	const here = world.terrain[party.y * MAP_SIZE + party.x];
	let reach = INV_RADIUS;
	if (here === TERRAIN.HILLS) reach += 1;
	if (here === TERRAIN.FOREST) reach -= 1;
	return reach < 2 ? 2 : reach;
}

function investigationFalloff(dx, dy, reach) {
	const dist = Math.sqrt(dx * dx + dy * dy);
	if (dist >= reach) return 0;
	if (dist <= INV_INNER) return 1;
	const t = (reach - dist) / (reach - INV_INNER);
	return t * t * (3 - 2 * t);
}

function investigationStep(minutes) {
	if (!party.alive) return;
	if (investigation.surveyTicks > 0) investigation.surveyTicks -= minutes;
	investigationSweep(minutes);
}

// A survey is the standing sweep delivered at once, then a cooldown: no separate falloff or bonus.
function investigationSurvey() {
	if (!investigationSurveyReady()) return false;
	investigation.surveyTicks = INV_SURVEY_COOLDOWN * 60;
	investigationSweep(INV_SURVEY_HOURS * 60);
	return true;
}

function investigationSurveyReady() {
	return party.alive && investigation.surveyTicks <= 0;
}

function investigationSurveyCooldown() {
	return Math.ceil(investigation.surveyTicks / 60);
}

function investigationSweep(minutes) {
	const progress = investigation.progress;
	const hours = minutes / 60;
	const reach = investigationReach();
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
			const m = investigationFalloff(dx, dy, reach);
			if (m <= 0 || world.terrain[i] === TERRAIN.WATER) continue;
			const rate = INV_RATE[world.terrain[i]] * m * effort * hours * territoryContest(i, FACTION_PLAYER);
			const next = progress[i] + rate;
			progress[i] = next > 1 ? 1 : next;
		}
	}
}

function investigationCollectNearby() {
	const originX = party.x;
	const originY = party.y;
	const range = INV_NEARBY_RANGE;
	const range2 = range * range;
	const nearby = investigation.nearby;
	let count = 0;
	for (let i = 0; i < SITE_CAP; i++) {
		const state = sites.state[i];
		if (state === SITE_STATE.GONE || state === SITE_STATE.HIDDEN) continue;
		const dx = sites.x[i] - originX;
		const dy = sites.y[i] - originY;
		if (dx * dx + dy * dy > range2) continue;
		if (count < INV_NEARBY_CAP) {
			nearby[count] = i;
			count++;
			continue;
		}
		let worst = 0;
		let worstD = -1;
		for (let k = 0; k < INV_NEARBY_CAP; k++) {
			const j = nearby[k];
			const ddx = sites.x[j] - originX;
			const ddy = sites.y[j] - originY;
			const d = ddx * ddx + ddy * ddy;
			if (d <= worstD) continue;
			worstD = d;
			worst = k;
		}
		if (dx * dx + dy * dy < worstD) nearby[worst] = i;
	}
	for (let a = 1; a < count; a++) {
		const slot = nearby[a];
		const sdx = sites.x[slot] - originX;
		const sdy = sites.y[slot] - originY;
		const sd = sdx * sdx + sdy * sdy;
		let b = a;
		while (b > 0) {
			const prev = nearby[b - 1];
			const pdx = sites.x[prev] - originX;
			const pdy = sites.y[prev] - originY;
			if (pdx * pdx + pdy * pdy <= sd) break;
			nearby[b] = prev;
			b--;
		}
		nearby[b] = slot;
	}
	investigation.nearbyCount = count;
}

if (typeof module !== 'undefined') module.exports = { investigation, investigationInit, investigationStep, investigationSurvey };
