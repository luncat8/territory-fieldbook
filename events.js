// owns: the shared event feed and the transient status line
// edit for: feed length, event lifetime, wording

const EVENTS_KEEP = 40;
const EVENTS_LIFE_HOURS = 72;

const events = {
	list: [],
	version: 0,
	status: '',
	statusVersion: 0
};

function eventsReset() {
	events.list.length = 0;
	events.version++;
	events.status = '';
	events.statusVersion++;
}

function eventsAdd(text) {
	events.list.push({ text: text, life: EVENTS_LIFE_HOURS });
	if (events.list.length > EVENTS_KEEP) events.list.shift();
	events.version++;
}

function eventsStatus(text) {
	events.status = text;
	events.statusVersion++;
}

function eventsStep(minutes) {
	const hours = minutes / 60;
	const list = events.list;
	let write = 0;
	for (let i = 0; i < list.length; i++) {
		const item = list[i];
		item.life -= hours;
		if (item.life <= 0) continue;
		list[write] = item;
		write++;
	}
	if (write === list.length) return;
	list.length = write;
	events.version++;
}
