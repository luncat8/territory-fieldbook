// owns: rival agents, their target choice, travel, claims and extraction
// edit for: rival speed, target scoring, work share, stuck escape

const RIVAL_COUNT = 2;
const RIVAL_SPEED = 0.6;
const RIVAL_WORK_SHARE = 0.7;
const RIVAL_HOME_RANGE = 18;
const RIVAL_STRAY = 5;
const RIVAL_WANDER_MIN = 20;
const RIVAL_WANDER_MAX = 60;
const RIVAL_STEPS_PER_TICK = 8;
const RIVAL_TRIES = 200;
const RIVAL_MIN_NEIGHBOURS = 6;
const RIVAL_STUCK_LIMIT = 3;
const RIVAL_AVOID_SEC = 120;
const RIVAL_SCOUT_SEC = 10;
const RIVAL_SCOUT_CHANCE = 0.25;

const rivals = {
	x: new Uint8Array(RIVAL_COUNT),
	y: new Uint8Array(RIVAL_COUNT),
	homeX: new Uint8Array(RIVAL_COUNT),
	homeY: new Uint8Array(RIVAL_COUNT),
	target: new Int16Array(RIVAL_COUNT),
	avoid: new Int16Array(RIVAL_COUNT),
	avoidTime: new Float32Array(RIVAL_COUNT),
	moveCarry: new Float32Array(RIVAL_COUNT),
	wander: new Float32Array(RIVAL_COUNT),
	scout: new Float32Array(RIVAL_COUNT),
	stuck: new Uint8Array(RIVAL_COUNT),
	faction: new Uint8Array(RIVAL_COUNT)
};

function rivalsFreeNeighbours(x, y) {
	let free = 0;
	for (let dy = -1; dy <= 1; dy++) {
		for (let dx = -1; dx <= 1; dx++) {
			if (dx === 0 && dy === 0) continue;
			if (worldWalkableAt(x + dx, y + dy)) free++;
		}
	}
	return free;
}

function rivalsSpawn() {
	randomSeed(world.seed ^ 0x2f6e2b1);
	for (let k = 0; k < RIVAL_COUNT; k++) {
		rivals.faction[k] = k === 0 ? FACTION_A : FACTION_B;
		rivals.target[k] = -1;
		rivals.avoid[k] = -1;
		rivals.avoidTime[k] = 0;
		rivals.moveCarry[k] = 0;
		rivals.wander[k] = 0;
		rivals.scout[k] = 0;
		rivals.stuck[k] = 0;
		let best = worldRandomWalkable();
		let bestScore = -1;
		for (let t = 0; t < RIVAL_TRIES; t++) {
			const idx = worldRandomWalkable();
			const x = idx % MAP_SIZE;
			const y = (idx / MAP_SIZE) | 0;
			const free = rivalsFreeNeighbours(x, y);
			if (free < RIVAL_MIN_NEIGHBOURS) continue;
			const dx = x - world.startX;
			const dy = y - world.startY;
			let score = Math.sqrt(dx * dx + dy * dy) * (0.5 + free / 16);
			if (k > 0) {
				const rx = x - rivals.x[0];
				const ry = y - rivals.y[0];
				score += Math.sqrt(rx * rx + ry * ry) * 0.5;
			}
			if (score <= bestScore) continue;
			bestScore = score;
			best = idx;
		}
		rivals.x[k] = best % MAP_SIZE;
		rivals.y[k] = (best / MAP_SIZE) | 0;
		rivals.homeX[k] = rivals.x[k];
		rivals.homeY[k] = rivals.y[k];
		territoryAddCamp(rivals.faction[k], rivals.x[k], rivals.y[k]);
	}
}

function rivalsTargetOk(i, k) {
	if (i < 0) return false;
	if (sites.state[i] !== SITE_STATE.VISIBLE) return false;
	const claim = sites.claim[i];
	return claim === 0 || claim === rivals.faction[k] + 1;
}

function rivalsPickTarget(k) {
	let best = -1;
	let bestScore = RIVAL_HOME_RANGE * RIVAL_HOME_RANGE;
	for (let i = 0; i < SITE_CAP; i++) {
		if (i === rivals.avoid[k]) continue;
		if (sites.claim[i] !== 0) continue;
		if (sites.state[i] !== SITE_STATE.VISIBLE) continue;
		const hx = sites.x[i] - rivals.homeX[k];
		const hy = sites.y[i] - rivals.homeY[k];
		if (hx * hx + hy * hy > bestScore) continue;
		const dx = sites.x[i] - rivals.x[k];
		const dy = sites.y[i] - rivals.y[k];
		let score = dx * dx + dy * dy;
		if (sites.kind[i] === SITE.DEPOSIT) score *= 0.5;
		if (score < bestScore) {
			bestScore = score;
			best = i;
		}
	}
	return best;
}

function rivalsStepToward(k, sx, sy) {
	const x = rivals.x[k];
	const y = rivals.y[k];
	if (sx !== 0 && worldWalkableAt(x + sx, y)) {
		rivals.x[k] = x + sx;
		return true;
	}
	if (sy !== 0 && worldWalkableAt(x, y + sy)) {
		rivals.y[k] = y + sy;
		return true;
	}
	if (sx !== 0 && worldWalkableAt(x + sx, y + 1)) {
		rivals.x[k] = x + sx;
		rivals.y[k] = y + 1;
		return true;
	}
	if (sx !== 0 && worldWalkableAt(x + sx, y - 1)) {
		rivals.x[k] = x + sx;
		rivals.y[k] = y - 1;
		return true;
	}
	if (sy !== 0 && worldWalkableAt(x + 1, y + sy)) {
		rivals.x[k] = x + 1;
		rivals.y[k] = y + sy;
		return true;
	}
	if (sy !== 0 && worldWalkableAt(x - 1, y + sy)) {
		rivals.x[k] = x - 1;
		rivals.y[k] = y + sy;
		return true;
	}
	return false;
}

function rivalsGiveUp(k, target) {
	rivals.avoid[k] = target;
	rivals.avoidTime[k] = RIVAL_AVOID_SEC;
	rivals.target[k] = -1;
	rivals.stuck[k] = 0;
	rivals.moveCarry[k] = 0;
}

function rivalsMove(k, target, seconds) {
	rivals.moveCarry[k] += RIVAL_SPEED * seconds;
	let steps = Math.floor(rivals.moveCarry[k]);
	if (steps <= 0) return;
	if (steps > RIVAL_STEPS_PER_TICK) steps = RIVAL_STEPS_PER_TICK;
	rivals.moveCarry[k] -= steps;
	const tx = sites.x[target];
	const ty = sites.y[target];
	while (steps > 0) {
		steps--;
		const dx = tx - rivals.x[k];
		const dy = ty - rivals.y[k];
		if (dx === 0 && dy === 0) return;
		const sx = dx === 0 ? 0 : dx > 0 ? 1 : -1;
		const sy = dy === 0 ? 0 : dy > 0 ? 1 : -1;
		if (rivalsStepToward(k, sx, sy)) {
			rivals.stuck[k] = 0;
			continue;
		}
		rivals.stuck[k]++;
		if (rivals.stuck[k] < RIVAL_STUCK_LIMIT) continue;
		rivalsGiveUp(k, target);
		return;
	}
}

function rivalsScout(k, seconds) {
	rivals.scout[k] -= seconds;
	if (rivals.scout[k] > 0) return;
	rivals.scout[k] = RIVAL_SCOUT_SEC;
	const range = RIVAL_HOME_RANGE * RIVAL_HOME_RANGE;
	for (let i = 0; i < SITE_CAP; i++) {
		if (sites.state[i] !== SITE_STATE.MARKED) continue;
		const dx = sites.x[i] - rivals.homeX[k];
		const dy = sites.y[i] - rivals.homeY[k];
		if (dx * dx + dy * dy > range) continue;
		if (randomNext() >= RIVAL_SCOUT_CHANCE) continue;
		sites.state[i] = SITE_STATE.VISIBLE;
		sites.version++;
		return;
	}
}

function rivalsWork(k, target, seconds) {
	const owner = rivals.faction[k];
	if (sites.kind[target] === SITE.DEPOSIT) {
		sitesClaim(target, owner);
		sitesExtract(target, economyDepositRate(sites.res[target]) * RIVAL_WORK_SHARE * seconds, owner);
		if (sites.state[target] === SITE_STATE.DONE) rivals.target[k] = -1;
		return;
	}
	if (sites.claim[target] === 0) sitesClaim(target, owner);
	rivals.target[k] = -1;
}

function rivalsWanderStep(k, seconds) {
	rivals.wander[k] -= seconds;
	if (rivals.wander[k] > 0) return;
	rivals.wander[k] = randomRange(RIVAL_WANDER_MIN, RIVAL_WANDER_MAX);
	const awayX = rivals.homeX[k] - rivals.x[k];
	const awayY = rivals.homeY[k] - rivals.y[k];
	if (awayX * awayX + awayY * awayY > RIVAL_STRAY * RIVAL_STRAY) {
		const sx = awayX === 0 ? 0 : awayX > 0 ? 1 : -1;
		const sy = awayY === 0 ? 0 : awayY > 0 ? 1 : -1;
		if (rivalsStepToward(k, sx, sy)) return;
	}
	const dx = randomInt(3) - 1;
	const dy = randomInt(3) - 1;
	if (dx === 0 && dy === 0) return;
	if (!worldWalkableAt(rivals.x[k] + dx, rivals.y[k] + dy)) return;
	rivals.x[k] += dx;
	rivals.y[k] += dy;
}

function rivalsStep(seconds) {
	if (!party.alive) return;
	if (victory.result === 0) return;
	for (let k = 0; k < RIVAL_COUNT; k++) {
		territoryMaintain(rivals.faction[k], rivals.x[k], rivals.y[k]);
		rivalsScout(k, seconds);
		if (rivals.avoidTime[k] > 0) {
			rivals.avoidTime[k] -= seconds;
			if (rivals.avoidTime[k] <= 0) rivals.avoid[k] = -1;
		}
		let target = rivals.target[k];
		if (target >= 0 && !rivalsTargetOk(target, k)) {
			target = -1;
			rivals.target[k] = -1;
		}
		if (target < 0) {
			target = rivalsPickTarget(k);
			rivals.target[k] = target;
		}
		if (target < 0) {
			rivalsWanderStep(k, seconds);
			continue;
		}
		if (rivals.x[k] === sites.x[target] && rivals.y[k] === sites.y[target]) {
			rivalsWork(k, target, seconds);
			continue;
		}
		rivalsMove(k, target, seconds);
	}
}

if (typeof module !== 'undefined') module.exports = { rivals, rivalsSpawn, rivalsStep };
