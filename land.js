// owns: disturbed fraction per cell, productivity, natural recovery and restoration
// edit for: recovery rates, disturbance costs, restoration effect

// indexed by world terrain id: meadow, forest, water, swamp, hills, desert
const LAND_RECOVERY = [0.0020, 0.0028, 0, 0.0014, 0.0008, 0.0006];
const LAND_DISTURB_PER_UNIT = 0.006;
const LAND_RESTORE_AMOUNT = 0.25;
const LAND_RESTORE_FUNDS = 12;
const LAND_RESTORE_SUPPLIES = 2;
const LAND_DISTURB_LIMIT = 0.25;

const land = {
	disturbed: null
};

function landInit() {
	land.disturbed = new Float32Array(world.n);
}

function landProductivity(i) {
	return 1 - land.disturbed[i];
}

function landDisturb(i, amount) {
	const d = land.disturbed[i] + amount;
	land.disturbed[i] = d > 1 ? 1 : d;
}

function landRestore(i) {
	const before = land.disturbed[i];
	if (before <= 0) return false;
	land.disturbed[i] = before > LAND_RESTORE_AMOUNT ? before - LAND_RESTORE_AMOUNT : 0;
	eventsAdd('Restored ground at ' + (i % MAP_SIZE) + ',' + ((i / MAP_SIZE) | 0) + '.');
	return true;
}

function landStep(minutes) {
	const hours = minutes / 60;
	const disturbed = land.disturbed;
	const terrain = world.terrain;
	for (let i = 0; i < world.n; i++) {
		const d = disturbed[i];
		if (d <= 0) continue;
		// recovery slows as disturbance grows: d = 1 never recovers on its own,
		// light disturbance recovers near the terrain rate but never instantly,
		// so natural recovery cannot outrun waste from deposits and factories
		const rate = LAND_RECOVERY[terrain[i]] * (1 - d);
		const next = d - rate * hours;
		disturbed[i] = next > 0 ? next : 0;
	}
}

if (typeof module !== 'undefined') module.exports = { land, landInit, landProductivity, landDisturb, landStep };
