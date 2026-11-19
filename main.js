// owns: boot, wiring, the shared clock (1 s = 1 day on 1x) and the fixed-step tick order
// edit for: load order effects, tick order, speed table

const $ = id => document.getElementById(id);

const SIM_STEP_SEC = 0.05;
const CLOCK_RATES = [0, 1, 2, 4];
const CLOCK_DEFAULT_SPEED = 3;
const FRAME_MAX_SECONDS = 0.15;
const FRAME_MAX_ACC = 0.4;
const START_SEED = 20261117;

const clock = {
	seconds: 0,
	speed: CLOCK_DEFAULT_SPEED,
	resumeSpeed: CLOCK_DEFAULT_SPEED,
	acc: 0,
	last: 0
};

const main = {
	setup: mainSetup,
	boot: mainBoot,
	step: mainStep
};

function mainSetup(seed = START_SEED, scene = '', fill = 0, mode = mapSceneEngine(scene)) {
	mapScene.id = scene;
	if (scene) mapSceneWorld(seed);
	else worldGenerate(seed);
	landInit();
	economyInit();
	eventsReset();
	if (scene) sitesReset();
	else sitesPopulate();
	investigationInit();
	partySpawn(world.startX, world.startY);
	investigationSeed(party.x, party.y);
	territoryInit();
	if (!scene) rivalsSpawn();
	mapeInit(mode, !!scene);
	if (scene) mapSceneSeed();
	else mapeSeedSurvey();
	mapeFinishSetup(fill, !scene);
	victoryReset();
	clock.seconds = clock.acc = clock.last = 0;
	clock.speed = clock.resumeSpeed = CLOCK_DEFAULT_SPEED;
	if (scene) return;
	eventsAdd('The survey begins: ' + party.members.length + ' members, ' + Math.round(party.funds) + ' funds.');
	eventsAdd('Camp to recover, investigate to unlock deposits, trade at settlements.');
}

function mainStep(seconds) {
	clock.seconds += seconds;
	if (!mapScene.id) {
		partyStep(seconds);
		investigationStep(seconds);
		sitesStep(seconds);
		rivalsStep(seconds);
		territoryStep(seconds);
	}
	landStep(seconds);
	mapeStep(seconds);
	eventsStep(seconds);
}

function mainBoot() {
	mainSetup(START_SEED, mapSceneFromQuery(window.location.search));
	const canvas = $('ui-canvas');
	const demand = $('ui-demand-canvas');
	renderInit(canvas, demand);
	inputInit(canvas, demand);
	hudInit();
	renderDraw();
	requestAnimationFrame(mainFrame);
}

function mainFrame(now) {
	const dt = clock.last === 0 ? 0 : Math.min(Math.max(0, (now - clock.last) / 1000), FRAME_MAX_SECONDS);
	clock.last = now;
	if (clock.speed > 0) {
		clock.acc = Math.min(FRAME_MAX_ACC, clock.acc + dt * CLOCK_RATES[clock.speed]);
		while (clock.acc + 1e-9 >= SIM_STEP_SEC) {
			mainStep(SIM_STEP_SEC);
			clock.acc = Math.max(0, clock.acc - SIM_STEP_SEC);
		}
	}
	renderDraw();
	hudTick(dt);
	requestAnimationFrame(mainFrame);
}

if (typeof document !== 'undefined') mainBoot();
if (typeof module !== 'undefined') module.exports = { main, clock, SIM_STEP_SEC, CLOCK_RATES };
