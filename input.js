// owns: canvas clicks and keyboard bindings
// edit for: key maps, click semantics

const input = {
	canvas: null,
	lastX: -1,
	lastY: -1
};

function inputInit(canvas) {
	input.canvas = canvas;
	canvas.addEventListener('click', inputClick);
	window.addEventListener('keydown', inputKey);
}

function inputCellOf(event) {
	const rect = input.canvas.getBoundingClientRect();
	const x = Math.floor((event.clientX - rect.left) / rect.width * world.size);
	const y = Math.floor((event.clientY - rect.top) / rect.height * world.size);
	if (x < 0 || y < 0 || x >= world.size || y >= world.size) return false;
	input.lastX = x;
	input.lastY = y;
	render.markX = x;
	render.markY = y;
	return true;
}

function inputClick(event) {
	if (!inputCellOf(event)) return;
	if (!actionsMoveTo(input.lastX, input.lastY)) return;
	renderDraw();
}

function inputKey(event) {
	const key = event.key;
	if (key === ' ') {
		event.preventDefault();
		actionsTogglePause();
		return;
	}
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
	if (key >= '1' && key <= '5') {
		hudSetView(Number(key) - 1);
	}
}
