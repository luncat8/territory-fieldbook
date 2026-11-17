// owns: the seeded random streams used by generation, sites and rivals
// edit for: determinism guarantees, stream seeding

const random = {
	seed: 1
};

function randomSeed(seed) {
	random.seed = seed >>> 0;
}

function randomNext() {
	random.seed = (Math.imul(random.seed, 1664525) + 1013904223) >>> 0;
	return random.seed / 4294967296;
}

function randomRange(min, max) {
	return min + randomNext() * (max - min);
}

function randomInt(max) {
	return Math.floor(randomNext() * max);
}

if (typeof module !== 'undefined') module.exports = { random, randomSeed, randomNext, randomRange, randomInt };
