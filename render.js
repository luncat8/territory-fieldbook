// owns: canvas painting, view modes and map overlays
// edit for: view routing, terrain painting and survey overlays

const VIEW = {
	TERRAIN: 0,
	INVESTIGATION: 1,
	INFLUENCE: 2,
	DISTURBANCE: 3,
	BIOSPHERE: 4,
	DEMAND: 5,
	AMOUNT: 6,
	PAIRED: 7
};
const VIEW_NAME = [
	'terrain', 'investigation', 'influence', 'waste', 'forest',
	'demand', 'amount', 'amount + demand'
];
const CELL_PX = 12;
const TAU = Math.PI * 2;
const RES_CSS = ['#4fae6a', '#9a7440', '#9c9ca6', '#74d2e4', '#a89a52', '#e6d178'];
const SITE_CSS = ['#c9c05a', '#b48ce0', '#6ec8ff', '#e08a5a', '#d8d8d8'];
const FACTION_CSS = ['#60cad6', '#d45c54', '#d8a046'];
const SETTLE_CSS = '#f2e2b0';
const STORAGE_CSS = '#6fa8b8';
const MINE_LOCK_FILL = '#6d7682';
const MINE_LOCK_STROKE = '#b8644c';
const FACTORY_CSS = ['', '#e0a458', '#f0ede6', '#7c858e'];
const DASH_REACH = [4, 5];
const DASH_CAMP = [3, 3];
const DASH_NONE = [];

const render = {
	canvas: null,
	ctx: null,
	demandCtx: null,
	fieldStyle: 0,
	showFlow: true,
	animateFlow: true,
	flowArrows: false,
	showContours: false,
	showGrid: false,
	smoothDemand: false,
	showSettlements: true,
	showSources: true,
	showLabels: false,
	showSurvey: true,
	off: null,
	offCtx: null,
	image: null,
	pixels: null,
	size: 0,
	view: 0,
	markX: -1,
	markY: -1
};

function renderInit(canvas, demandCanvas) {
	render.canvas = canvas;
	render.size = world.size * CELL_PX;
	render.ctx = renderMapContext(canvas);
	render.demandCtx = renderMapContext(demandCanvas);
	render.off = document.createElement('canvas');
	render.off.width = world.size;
	render.off.height = world.size;
	render.offCtx = render.off.getContext('2d');
	render.image = render.offCtx.createImageData(world.size, world.size);
	render.pixels = render.image.data;
	render.view = mapScene.id ? VIEW.PAIRED : VIEW.AMOUNT;
	if (mapScene.id) mape.viewItem = mape.viewItemDemand = MAPE_RES.COAL;
	renderEconomyInit();
	renderMarkersInit();
}

function renderMapContext(canvas) {
	canvas.width = canvas.height = render.size;
	const ctx = canvas.getContext('2d');
	ctx.imageSmoothingEnabled = false;
	return ctx;
}

function renderIsFieldView(view) {
	return view === VIEW.DEMAND || view === VIEW.AMOUNT || view === VIEW.PAIRED;
}

function renderIsPaired() {
	return render.view === VIEW.PAIRED;
}

// Population is a continuous field there: a town ring would cover the cell colour it explains.
function renderSettlementIcons(view) {
	if (!renderIsFieldView(view)) return true;
	return renderViewItem(view) !== MAPE_VIEW_ITEM.POPULATION;
}

function renderHasAmount() {
	return render.view === VIEW.AMOUNT || renderIsPaired();
}

function renderDraw() {
	if (!render.ctx) return;
	renderDrawMap(render.ctx, renderIsPaired() ? VIEW.AMOUNT : render.view);
	if (renderIsPaired()) renderDrawMap(render.demandCtx, VIEW.DEMAND);
}

function renderDrawMap(ctx, view) {
	const field = renderIsFieldView(view);
	if (field) renderEconomyCells(view);
	else renderPaintCells(view);
	render.offCtx.putImageData(render.image, 0, 0);
	ctx.imageSmoothingEnabled = view === VIEW.DEMAND && render.smoothDemand;
	ctx.drawImage(render.off, 0, 0, render.size, render.size);
	if (field) renderEconomyOverlays(ctx, view);
	if (render.showSettlements && renderSettlementIcons(view)) renderSettlements(ctx, field);
	if (render.showSources) renderIndustry(ctx, field, view);
	if (field && render.showLabels) renderActorLabels(ctx, view);
	if (!mapScene.id && render.showSurvey) {
		if (!field) {
			renderReach(ctx);
			renderSites(ctx);
			renderRivals(ctx);
		}
		renderParty(ctx);
	}
	if (field) renderHover(ctx);
	renderMark(ctx);
	renderSelection(ctx);
}

function renderSelection(ctx) {
	if (input.selX < 0) return;
	const cx = (input.selX + 0.5) * CELL_PX;
	const cy = (input.selY + 0.5) * CELL_PX;
	ctx.strokeStyle = '#79c9d4';
	ctx.lineWidth = 1.6;
	ctx.setLineDash([4, 3]);
	ctx.beginPath();
	ctx.arc(cx, cy, CELL_PX * 0.66, 0, TAU);
	ctx.stroke();
	ctx.setLineDash(DASH_NONE);
}

function renderPaintCells(view) {
	const pixels = render.pixels;
	const size = world.size;
	const n = world.n;
	const terrain = world.terrain;
	const height = world.height;
	const progress = investigation.progress;
	const disturbed = land.disturbed;
	const fields = territory.fields;
	const biomass = economy.biomass;
	const originX = party.x;
	const originY = party.y;
	const here = terrain[originY * size + originX];
	let vision = 3 + (party.unlocks.route ? 2 : 0);
	if (here === TERRAIN.HILLS) vision += 1;
	vision -= biomass[originY * size + originX];
	const vision2 = vision * vision;
	let o = 0;
	for (let y = 0; y < size; y++) {
		const row = y * size;
		const dy = y - originY;
		for (let x = 0; x < size; x++) {
			const i = row + x;
			const t = terrain[i];
			const rgb = TERRAIN_RGB[t];
			const relief = 0.9 + height[i] * 0.2;
			let r = rgb[0] * relief;
			let g = rgb[1] * relief;
			let b = rgb[2] * relief;
			if (t !== TERRAIN.WATER) {
				const cover = biomass[i];
				r += (32 - r) * cover;
				g += (98 - g) * cover;
				b += (48 - b) * cover;
			}
			if (view === VIEW.TERRAIN) {
				const d = disturbed[i];
				if (d > 0) {
					r += (132 - r) * d * 0.75;
					g += (100 - g) * d * 0.75;
					b += (72 - b) * d * 0.75;
				}
				const dx = x - originX;
				const seen = progress[i];
				let fog = 0.4;
				if (seen > 0) fog = 0.65 + seen * 0.35;
				else if (dx * dx + dy * dy <= vision2) fog = 0.64;
				r *= fog;
				g *= fog;
				b *= fog;
			} else if (view === VIEW.INVESTIGATION) {
				const k = 0.18 + progress[i] * 0.82;
				r = 26 + 60 * k;
				g = 32 + 164 * k;
				b = 40 + 64 * k;
			} else if (view === VIEW.INFLUENCE) {
				const pa = fields[i];
				const pb = fields[n + i];
				const pc = fields[n + n + i];
				let faction = FACTION_NONE;
				let value = TERRITORY_MIN;
				if (pa > value) { faction = FACTION_PLAYER; value = pa; }
				if (pb > value) { faction = FACTION_A; value = pb; }
				if (pc > value) { faction = FACTION_B; value = pc; }
				r *= 0.28;
				g *= 0.28;
				b *= 0.28;
				if (faction !== FACTION_NONE) {
					const tint = FACTION_RGB[faction];
					const k = value > 0.66 ? 1 : value * 1.5;
					r += (tint[0] - r) * k;
					g += (tint[1] - g) * k;
					b += (tint[2] - b) * k;
				}
			} else if (view === VIEW.DISTURBANCE) {
				const d = disturbed[i];
				r = 52 + 124 * d;
				g = 118 - 14 * d;
				b = 62 - 36 * d;
			} else if (view === VIEW.BIOSPHERE) {
				const k = biomass[i];
				r = 18 + 54 * k;
				g = 30 + 158 * k;
				b = 30 + 62 * k;
				const d = disturbed[i];
				if (d > 0) {
					r += (146 - r) * d * 0.7;
					g += (104 - g) * d * 0.7;
					b += (70 - b) * d * 0.7;
				}
			}
			pixels[o] = r;
			pixels[o + 1] = g;
			pixels[o + 2] = b;
			pixels[o + 3] = 255;
			o += 4;
		}
	}
}

function renderReach(ctx) {
	const reach = investigationReach();
	ctx.strokeStyle = 'rgba(240, 246, 250, 0.35)';
	ctx.lineWidth = 1;
	ctx.setLineDash(DASH_REACH);
	ctx.beginPath();
	ctx.arc((party.x + 0.5) * CELL_PX, (party.y + 0.5) * CELL_PX, reach * CELL_PX, 0, TAU);
	ctx.stroke();
	ctx.setLineDash(DASH_NONE);
}

function renderSites(ctx) {
	const cell = CELL_PX;
	const pulse = 0.5 + 0.5 * Math.sin(clock.seconds * 0.2);
	for (let i = 0; i < SITE_CAP; i++) {
		const state = sites.state[i];
		if (state === SITE_STATE.GONE || state === SITE_STATE.HIDDEN) continue;
		const cx = sites.x[i] * cell + cell * 0.5;
		const cy = sites.y[i] * cell + cell * 0.5;
		if (state === SITE_STATE.MARKED) {
			const ready = investigation.progress[sites.y[i] * world.size + sites.x[i]] > SITE_REVEAL_PROGRESS;
			ctx.fillStyle = ready ? '#ffd166' : '#8c949c';
			ctx.beginPath();
			ctx.arc(cx, cy, cell * (ready ? 0.17 + 0.05 * pulse : 0.13), 0, TAU);
			ctx.fill();
			continue;
		}
		if (state === SITE_STATE.DONE) {
			ctx.fillStyle = '#5b6168';
			ctx.beginPath();
			ctx.arc(cx, cy, cell * 0.1, 0, TAU);
			ctx.fill();
			continue;
		}
		const kind = sites.kind[i];
		const res = sites.res[i];
		const isMine = kind === SITE.DEPOSIT && (res === RES.FUEL || res === RES.ORE);
		if (!isMine) {
			ctx.fillStyle = kind === SITE.DEPOSIT || kind === SITE.GATHER ? RES_CSS[res] : SITE_CSS[kind];
			renderSiteShape(ctx, cx, cy, cell, kind);
		}
		if (sites.claim[i] === 0) continue;
		ctx.strokeStyle = FACTION_CSS[sites.claim[i] - 1];
		ctx.lineWidth = 2;
		ctx.strokeRect(cx - cell * 0.44, cy - cell * 0.44, cell * 0.88, cell * 0.88);
	}
}

function renderSiteShape(ctx, cx, cy, cell, kind) {
	if (kind === SITE.DEPOSIT) {
		ctx.beginPath();
		ctx.arc(cx, cy, cell * 0.3, 0, TAU);
		ctx.fill();
		return;
	}
	if (kind === SITE.TASK) {
		ctx.beginPath();
		ctx.moveTo(cx, cy - cell * 0.32);
		ctx.lineTo(cx + cell * 0.32, cy + cell * 0.26);
		ctx.lineTo(cx - cell * 0.32, cy + cell * 0.26);
		ctx.closePath();
		ctx.fill();
		return;
	}
	if (kind === SITE.GATHER) {
		ctx.beginPath();
		ctx.moveTo(cx, cy - cell * 0.3);
		ctx.lineTo(cx + cell * 0.3, cy);
		ctx.lineTo(cx, cy + cell * 0.3);
		ctx.lineTo(cx - cell * 0.3, cy);
		ctx.closePath();
		ctx.fill();
		return;
	}
	if (kind === SITE.ITEM) {
		ctx.fillRect(cx - cell * 0.22, cy - cell * 0.22, cell * 0.44, cell * 0.44);
		return;
	}
	ctx.beginPath();
	ctx.arc(cx, cy, cell * 0.26, 0, TAU);
	ctx.fill();
	ctx.fillStyle = '#0d1117';
	ctx.beginPath();
	ctx.arc(cx, cy, cell * 0.12, 0, TAU);
	ctx.fill();
}

function renderRivals(ctx) {
	const cell = CELL_PX;
	for (let k = 0; k < RIVAL_COUNT; k++) {
		ctx.fillStyle = FACTION_CSS[rivals.faction[k]];
		ctx.strokeStyle = '#0d1117';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc((rivals.x[k] + 0.5) * cell, (rivals.y[k] + 0.5) * cell, cell * 0.32, 0, TAU);
		ctx.fill();
		ctx.stroke();
	}
}

function renderParty(ctx) {
	const cell = CELL_PX;
	const cx = (party.x + 0.5) * cell;
	const cy = (party.y + 0.5) * cell;
	ctx.fillStyle = party.alive ? '#f4f7f2' : '#7d848c';
	ctx.strokeStyle = '#0d1117';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.arc(cx, cy, cell * 0.4, 0, TAU);
	ctx.fill();
	ctx.stroke();
	if (party.camped) {
		ctx.strokeStyle = 'rgba(244, 247, 242, 0.7)';
		ctx.setLineDash(DASH_CAMP);
		ctx.beginPath();
		ctx.arc(cx, cy, cell * 0.72, 0, TAU);
		ctx.stroke();
		ctx.setLineDash(DASH_NONE);
	}
	if (party.working) {
		ctx.strokeStyle = '#ffd166';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(cx, cy, cell * 0.55, 0, TAU);
		ctx.stroke();
	}
}

function renderMark(ctx) {
	if (render.markX < 0) return;
	ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
	ctx.lineWidth = 1;
	const cx = (render.markX + 0.5) * CELL_PX;
	const cy = (render.markY + 0.5) * CELL_PX;
	ctx.strokeRect(cx - CELL_PX * 0.45, cy - CELL_PX * 0.45, CELL_PX * 0.9, CELL_PX * 0.9);
}

function renderHover(ctx) {
	if (input.hoverX < 0 || (input.hoverX === render.markX && input.hoverY === render.markY)) return;
	ctx.strokeStyle = 'rgba(255, 255, 255, 0.52)';
	ctx.lineWidth = 1;
	ctx.strokeRect(input.hoverX * CELL_PX + 0.5, input.hoverY * CELL_PX + 0.5, CELL_PX - 1, CELL_PX - 1);
}
