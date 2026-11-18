// owns: canvas clicks, hover target and keyboard bindings
// edit for: key maps, click and pointer hover semantics

const input = {
	lastX: -1,
	lastY: -1,
	hoverX: -1,
	hoverY: -1
};

function inputInit(canvas, demandCanvas) {
	inputBindMap(canvas);
	if (demandCanvas) inputBindMap(demandCanvas);
	window.addEventListener('keydown', inputKey);
}

function inputBindMap(canvas) {
	canvas.addEventListener('click', inputClick);
	canvas.addEventListener('pointermove', inputHover);
	canvas.addEventListener('pointerleave', inputLeave);
}

function inputReadCell(event, mark) {
	const rect = event.currentTarget.getBoundingClientRect();
	const x = Math.floor((event.clientX - rect.left) / rect.width * world.size);
	const y = Math.floor((event.clientY - rect.top) / rect.height * world.size);
	if (x < 0 || y < 0 || x >= world.size || y >= world.size) return false;
	if (mark) {
		input.lastX = x;
		input.lastY = y;
		render.markX = x;
		render.markY = y;
	} else {
		input.hoverX = x;
		input.hoverY = y;
	}
	return true;
}

function inputHover(event) {
	if (!inputReadCell(event, false)) inputLeave();
}

function inputLeave() {
	input.hoverX = -1;
	input.hoverY = -1;
}

function inputClearSelection() {
	inputLeave();
	input.lastX = input.lastY = render.markX = render.markY = -1;
}

function inputClick(event) {
	if (!inputReadCell(event, true)) return;
	if (mapScene.id) mapSceneEdit(input.lastX, input.lastY);
	else actionsMoveTo(input.lastX, input.lastY);
	hudRefresh(false);
	renderDraw();
}

function inputKey(event) {
	const key = event.key;
	const tag = event.target && event.target.tagName;
	if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'A') return;
	if (key === ' ') {
		event.preventDefault();
		actionsTogglePause();
		return;
	}
	if (key === '0') {
		hudSetView(VIEW.PAIRED);
		return;
	}
	if (mapScene.id) return;
	if (key === 'i' || key === 'I') {
		actionsSurvey();
		return;
	}
	if (key === 'c' || key === 'C') {
		actionsCamp();
		return;
	}
	if (key === 'w' || key === 'W') {
		actionsToggleWork();
		return;
	}
	if (key >= '1' && key <= '9') {
		const view = Number(key) - 1;
		if (view < VIEW_NAME.length) hudSetView(view);
	}
}
