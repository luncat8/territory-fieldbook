// owns: survey water-cycle setup and the root-zone moisture index used by forest cover
// edit for: weather cadence, soil retention and drainage

const HYDRO_INTERVAL = 0.2;
const hydrology = { model: null, soil: null, elapsed: 0 };

function hydrologyTerrain(model, scenario, seed) {
	model.elev.set(world.height);
	for (let i = 0; i < world.n; i++) {
		model.sea[i] = world.terrain[i] === TERRAIN.WATER;
		model.humidity[i] = 0.12 * world.soilBaseline[i];
	}
	waterPrepare(model, scenario, seed);
}

function hydrologyInit() {
	hydrology.model = new WaterLab({ width: world.size, height: world.size, seed: world.seed,
		scenario: mapScene.id ? 'blank' : 'survey', buildTerrain: hydrologyTerrain });
	hydrology.soil = world.soilBaseline.slice();
	for (let i = 0; i < world.n; i++) if (hydrology.model.sea[i]) hydrology.soil[i] = 0;
	hydrology.elapsed = 0;
}

function hydrologySoil() {
	const model = hydrology.model, soil = hydrology.soil, size = world.size;
	const water = model.water;
	for (let i = 0; i < world.n; i++) {
		if (model.sea[i]) continue;
		const x = i % size;
		// Bank seepage reaches adjacent ground, but deep sea cannot saturate an entire coast.
		let bank = x ? water[i - 1] : 0;
		if (x < size - 1) bank = Math.max(bank, water[i + 1]);
		if (i >= size) bank = Math.max(bank, water[i - size]);
		if (i + size < world.n) bank = Math.max(bank, water[i + size]);
		const wet = water[i] + 0.25 * Math.min(1, bank);
		const hill = world.terrain[i] === TERRAIN.HILLS;
		const recharge = (hill ? 0.14 : 0.26) * wet / (wet + 0.15);
		const air = model.humidity[i];
		const target = world.soilBaseline[i] - (hill ? 0.055 : 0.025) + recharge + 0.09 * air / (air + 0.12);
		soil[i] += 0.025 * (Math.max(0, Math.min(1, target)) - soil[i]);
	}
}

function hydrologyStep(seconds) {
	hydrology.elapsed += seconds;
	while (hydrology.elapsed + 1e-9 >= HYDRO_INTERVAL) {
		hydrology.model.step(WATER_DT);
		hydrologySoil();
		hydrology.elapsed -= HYDRO_INTERVAL;
	}
}
