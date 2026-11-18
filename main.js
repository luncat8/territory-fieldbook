// owns: boot, wiring, the shared clock (1 s = 1 day on 1x) and the fixed-step tick order
// edit for: load order effects, tick order, speed table

const $ = id => document.getElementById(id);

const SIM_STEP_SEC = 0.2;
const SPEED_TICKS = [0, 5, 10, 20];
const FRAME_MAX_SECONDS = 0.5;
const FRAME_MAX_TICKS = 64;
const START_SEED = 20261117;

const clock = {
	seconds: 0,
	speed: 1,
	acc: 0,
	last: 0
};

const main = {
	setup: mainSetup,
	boot: mainBoot,
	step: mainStep
};

function mainSetup(seed) {
	worldGenerate(seed === undefined ? START_SEED : seed);
	landInit();
	economyInit();
	eventsReset();
	sitesPopulate();
	investigationInit();
	partySpawn(world.startX, world.startY);
	investigationSeed(party.x, party.y);
	territoryInit();
	rivalsSpawn();
	mapeInit();
	victoryReset();
	clock.seconds = 0;
	clock.speed = 1;
	clock.acc = 0;
	eventsAdd('The survey begins: ' + party.members.length + ' members, ' + Math.round(party.funds) + ' funds.');
	eventsAdd('Camp to recover, investigate to unlock deposits, trade at settlements.');
}

function mainStep(seconds) {
	clock.seconds += seconds;
	partyStep(seconds);
	investigationStep(seconds);
	sitesStep(seconds);
	rivalsStep(seconds);
	territoryStep(seconds);
	landStep(seconds);
	economyStep(seconds);
	mapeStep(seconds);
	eventsStep(seconds);
}

function mainBoot() {
	mainSetup();
	renderInit($('ui-canvas'));
	inputInit($('ui-canvas'));
	hudInit();
	renderDraw();
	requestAnimationFrame(mainFrame);
}

function mainFrame(now) {
	const dt = clock.last === 0 ? 0 : Math.min((now - clock.last) / 1000, FRAME_MAX_SECONDS);
	clock.last = now;
	if (clock.speed > 0) {
		clock.acc += dt * SPEED_TICKS[clock.speed];
		let guard = FRAME_MAX_TICKS;
		while (clock.acc >= 1 && guard > 0) {
			mainStep(SIM_STEP_SEC);
			clock.acc -= 1;
			guard--;
		}
		if (clock.acc > 8) clock.acc = 8;
	}
	renderDraw();
	hudTick(dt);
	requestAnimationFrame(mainFrame);
}

if (typeof document !== 'undefined') mainBoot();
if (typeof module !== 'undefined') module.exports = { main, clock, SIM_STEP_SEC, SPEED_TICKS };
