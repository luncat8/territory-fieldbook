// owns: boot, wiring, the shared clock and the fixed-step tick order
// edit for: load order effects, tick order, speed table

const $ = id => document.getElementById(id);

const SIM_STEP_MINUTES = 1;
const SPEED_TICKS = [0, 6, 12, 24];
const FRAME_MAX_SECONDS = 0.5;
const FRAME_MAX_TICKS = 64;
const START_SEED = 20261117;

const clock = {
	hours: 6,
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
	victoryReset();
	clock.hours = 6;
	clock.speed = 1;
	clock.acc = 0;
	eventsAdd('The survey begins: ' + party.members.length + ' members, ' + Math.round(party.funds) + ' funds.');
	eventsAdd('Camp to recover, investigate to find sites, sell at towns.');
}

function mainStep(minutes) {
	clock.hours += minutes / 60;
	partyStep(minutes);
	investigationStep(minutes);
	sitesStep(minutes);
	rivalsStep(minutes);
	territoryStep(minutes);
	landStep(minutes);
	economyStep(minutes);
	eventsStep(minutes);
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
			mainStep(SIM_STEP_MINUTES);
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
if (typeof module !== 'undefined') module.exports = { main, clock, SPEED_TICKS };
