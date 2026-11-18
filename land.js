// owns: disturbed fraction per cell, productivity, natural recovery and restoration
// edit for: recovery rates, disturbance costs, restoration effect

// indexed by world terrain id: meadow, forest, water, swamp, hills, desert (per second)
const LAND_RECOVERY = [0.00020, 0.00028, 0, 0.00014, 0.00008, 0.00006];
const LAND_DISTURB_PER_UNIT = 0.006;
const LAND_MINE_DISTURB_PER_UNIT = 0.00025;
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

function landStep(seconds) {
	const disturbed = land.disturbed;
	const terrain = world.terrain;
	for (let i = 0; i < world.n; i++) {
		const d = disturbed[i];
		if (d <= 0) continue;
		// Recovery scales with (1 - d): d = 1 never recovers on its own, and active waste outruns it.
		const rate = LAND_RECOVERY[terrain[i]] * (1 - d);
		const next = d - rate * seconds;
		disturbed[i] = next > 0 ? next : 0;
	}
}

if (typeof module !== 'undefined') module.exports = { land, landInit, landProductivity, landDisturb, landStep };
