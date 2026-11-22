// owns: reproducible economy layouts and the scene-only actor tools
// edit for: reference positions, initial fill and replay setup

const MAPE_SCENE_LAYOUTS = {
	a: {
		name: 'Catchment field',
		// The first A layout (seed 1337), projected from 120×120 onto the survey grid.
		mines: [[45, 34], [20, 13], [29, 22], [40, 26], [20, 41]],
		towns: [[30, 39], [32, 7], [57, 56], [17, 31], [56, 28], [50, 15], [45, 55]]
	},
	b: {
		name: 'Queue field',
		// B's 48×28 reference positions, centered without stretching the routes.
		mines: [[15, 26], [30, 39], [47, 25]],
		towns: [[27, 23], [17, 38], [42, 36]]
	}
};
const MAPE_SCENE_TOOLS = ['Inspect', 'Mine', 'Settlement', 'Erase', 'Factory', 'Sawmill', 'Charcoal works', 'Wood works', 'Farm'];
const MAPE_SCENE_POP = 100;
const MAPE_SCENE_FLUID_POP = 60;

const mapScene = { id: '', tool: 0 };

function mapSceneFromQuery(query) {
	const params = new URLSearchParams(query);
	const id = params.get('scene');
	return id === 'a' || id === 'b' ? id : '';
}

function mapSceneEngine(id) {
	if (id === 'a') return MAPE_ENGINE.CATCHMENT;
	if (id === 'b') return MAPE_ENGINE.QUEUE;
}

function mapSceneWorld(seed) {
	world.seed = seed;
	randomSeed(seed);
	world.terrain.fill(TERRAIN.MEADOW);
	world.height.fill(0.5);
	world.soilBaseline.fill(0.5);
	world.startX = world.startY = world.size >> 1;
	worldSettleValues();
}

function mapSceneSeed() {
	const layout = MAPE_SCENE_LAYOUTS[mapScene.id];
	for (const [x, y] of layout.mines) mapSceneAddMine(y * world.size + x);
	for (const [x, y] of layout.towns) mapePlaceSettlement(y * world.size + x, (mape.workforceMode === MAPE_WORKFORCE_MODE.FLUID ? MAPE_SCENE_FLUID_POP : MAPE_SCENE_POP), false);
	eventsReset();
}

function mapSceneAddMine(idx) {
	if (mape.mineCount >= MAPE_MINE_CAP) return false;
	const site = sitesPlaceDeposit(idx, RES.FUEL, SITE_STATE.VISIBLE);
	if (site < 0) return false;
	mapeUnlockMine(mapeAddMine(site));
	mape.pop[idx] = MAPE_MINE_WORKERS;
	return true;
}

function mapSceneAddFactory(idx, kind = MAPE_FACTORY_KIND.GENERAL) {
	const x = idx % world.size;
	const y = (idx / world.size) | 0;
	const f = mapeAddFactory(x, y, MAPE_FACTORY_STATE.ACTIVE, kind);
	if (f < 0) return false;
	mape.pop[idx] = MAPE_FACTORY_WORKERS;
	return true;
}

function mapSceneEdit(x, y) {
	if (!mapScene.tool) return;
	const idx = y * world.size + x;
	const mine = mapeMineAt(x, y);
	const factory = mapeFactoryAt(x, y);
	const town = mapeIsSettlement(idx);
	const before = mape.pop[idx];
	if (mapScene.tool === 3) {
		if (!town && mine < 0 && factory < 0) return eventsStatus('No actor in this cell.');
		if (mine >= 0) mapeRemoveMine(mine);
		if (factory >= 0) mapeRemoveFactory(factory);
		mape.pop[idx] = 0;
		eventsStatus('Actor removed. Stored resources stay in circulation.');
	} else {
		if (town || mine >= 0 || mapeFactoryAt(x, y) >= 0) return eventsStatus('This cell already has an actor.');
		if (mapScene.tool === 1 && !mapSceneAddMine(idx)) return eventsStatus('No room for another mine.');
		if (mapScene.tool === 2) mapePlaceSettlement(idx, (mape.workforceMode === MAPE_WORKFORCE_MODE.FLUID ? MAPE_SCENE_FLUID_POP : MAPE_SCENE_POP), false);
		if (mapScene.tool >= 4) {
			const kind = mapScene.tool === 4 ? MAPE_FACTORY_KIND.GENERAL : mapScene.tool - 4;
			if (!mapSceneAddFactory(idx, kind)) return eventsStatus('No room for another factory.');
		}
		eventsStatus(MAPE_SCENE_TOOLS[mapScene.tool] + ' placed at ' + x + ',' + y + '.');
	}
	mape.popDelta += mape.pop[idx] - before;
	mapeSyncCells();
	mapeRebuildSettlements();
}

if (typeof module !== 'undefined') module.exports = { mapScene, mapSceneFromQuery, mapSceneEngine, mapSceneSeed };
