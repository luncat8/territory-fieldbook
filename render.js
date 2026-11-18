// owns: canvas painting, view modes and map overlays
// edit for: palette, view modes, marker shapes

const VIEW = {
	TERRAIN: 0,
	INVESTIGATION: 1,
	INFLUENCE: 2,
	DISTURBANCE: 3,
	BIOSPHERE: 4,
	POPULATION: 5,
	DEMAND: 6,
	SUPPLY: 7,
	WORKFORCE: 8
};
const VIEW_NAME = [
	'terrain', 'investigation', 'influence', 'disturbance', 'biosphere',
	'population', 'demand', 'supply', 'workforce'
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
	off: null,
	offCtx: null,
	image: null,
	pixels: null,
	size: 0,
	view: 0,
	markX: -1,
	markY: -1
};

function renderInit(canvas) {
	render.canvas = canvas;
	render.ctx = canvas.getContext('2d');
	render.size = world.size * CELL_PX;
	canvas.width = render.size;
	canvas.height = render.size;
	render.off = document.createElement('canvas');
	render.off.width = world.size;
	render.off.height = world.size;
	render.offCtx = render.off.getContext('2d');
	render.image = render.offCtx.createImageData(world.size, world.size);
	render.pixels = render.image.data;
	render.view = 0;
}

function renderDraw() {
	if (!render.ctx) return;
	renderPaintCells();
	render.offCtx.putImageData(render.image, 0, 0);
	const ctx = render.ctx;
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(render.off, 0, 0, render.size, render.size);
	renderReach(ctx);
	renderSettlements(ctx);
	renderIndustry(ctx);
	renderSites(ctx);
	renderRivals(ctx);
	renderParty(ctx);
	renderMark(ctx);
}

function renderPaintCells() {
	const pixels = render.pixels;
	const size = world.size;
	const n = world.n;
	const view = render.view;
	const terrain = world.terrain;
	const height = world.height;
	const progress = investigation.progress;
	const disturbed = land.disturbed;
	const fields = territory.fields;
	const biomass = economy.biomass;
	const pop = mape.pop;
	const work = mape.workforce;
	const itemOffset = mape.viewItem * n;
	const demand = mape.demand;
	const goods = mape.goods;
	const originX = party.x;
	const originY = party.y;
	const here = terrain[originY * size + originX];
	let vision = 3 + (party.unlocks.route ? 2 : 0);
	if (here === TERRAIN.HILLS) vision += 1;
	if (here === TERRAIN.FOREST) vision -= 1;
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
			} else if (t === TERRAIN.WATER) {
				r *= 0.72;
				g *= 0.72;
				b *= 0.78;
			} else if (view === VIEW.POPULATION) {
				const p = pop[i];
				if (p <= 0) {
					r *= 0.22;
					g *= 0.22;
					b *= 0.24;
				} else {
					const raw = p / MAPE_POP_CAP;
					const k = Math.sqrt(raw > 1 ? 1 : raw);
					r = 58 + 192 * k;
					g = 44 + 186 * k;
					b = 28 + 132 * k;
				}
			} else if (view === VIEW.DEMAND) {
				const v = demand[itemOffset + i];
				r = 38;
				g = 42;
				b = 48;
				if (v < 0) {
					const raw = -v / MAPE_VIEW_DEMAND_MAX;
					const k = raw > 1 ? 1 : raw;
					r += (44 - r) * k;
					g += (196 - g) * k;
					b += (114 - b) * k;
				} else if (v > 0) {
					const raw = v / MAPE_VIEW_DEMAND_MAX;
					const k = raw > 1 ? 1 : raw;
					r += (220 - r) * k;
					g += (76 - g) * k;
					b += (68 - b) * k;
				}
			} else if (view === VIEW.SUPPLY) {
				const raw = goods[itemOffset + i] / MAPE_VIEW_GOODS_MAX;
				const k = raw <= 0 ? 0 : Math.sqrt(raw > 1 ? 1 : raw);
				r = 24 + 196 * k;
				g = 30 + 198 * k;
				b = 38 + 156 * k;
			} else {
				const raw = work[i] / MAPE_VIEW_WORK_MAX;
				const k = raw <= 0 ? 0 : Math.sqrt(raw > 1 ? 1 : raw);
				r = 26 + 212 * k;
				g = 28 + 152 * k;
				b = 36 + 32 * k;
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

// One batched path covers all ~82 settlements so marker cost does not scale into per-site draw calls.
function renderSettlements(ctx) {
	const count = mape.settleCount;
	if (count === 0) return;
	const cells = mape.settleCells;
	const pop = mape.pop;
	const size = world.size;
	const cell = CELL_PX;
	ctx.fillStyle = SETTLE_CSS;
	ctx.beginPath();
	for (let k = 0; k < count; k++) {
		const idx = cells[k];
		const cx = ((idx % size) + 0.5) * cell;
		const cy = (((idx / size) | 0) + 0.5) * cell;
		const ratio = pop[idx] / MAPE_POP_CAP;
		const radius = cell * (0.12 + 0.18 * (ratio > 1 ? 1 : ratio));
		ctx.moveTo(cx + radius, cy);
		ctx.arc(cx, cy, radius, 0, TAU);
	}
	ctx.fill();
}

function renderIndustry(ctx) {
	const cell = CELL_PX;
	ctx.fillStyle = STORAGE_CSS;
	const box = cell * 0.22;
	for (let k = 0; k < mape.storageCount; k++) {
		const slot = mape.storageSite[k];
		if (slot < 255 && sites.state[slot] !== SITE_STATE.VISIBLE) continue;
		ctx.fillRect((mape.storageX[k] + 0.5) * cell - box * 0.5, (mape.storageY[k] + 0.5) * cell - box * 0.5, box, box);
	}
	for (let m = 0; m < mape.mineCount; m++) {
		const slot = mape.mineSite[m];
		if (sites.state[slot] !== SITE_STATE.VISIBLE) continue;
		const cx = (mape.mineX[m] + 0.5) * cell;
		const cy = (mape.mineY[m] + 0.5) * cell;
		const open = mape.mineUnlocked[m] === 1;
		ctx.fillStyle = open ? RES_CSS[sites.res[slot]] : MINE_LOCK_FILL;
		ctx.beginPath();
		ctx.moveTo(cx, cy - cell * 0.32);
		ctx.lineTo(cx + cell * 0.30, cy + cell * 0.26);
		ctx.lineTo(cx - cell * 0.30, cy + cell * 0.26);
		ctx.closePath();
		ctx.fill();
		if (!open) {
			ctx.strokeStyle = MINE_LOCK_STROKE;
			ctx.lineWidth = 1;
			ctx.stroke();
		}
	}
	const fsize = cell * 0.56;
	for (let f = 0; f < mape.factoryCount; f++) {
		const st = mape.factoryState[f];
		if (st === MAPE_FACTORY_STATE.GONE) continue;
		const cx = (mape.factoryX[f] + 0.5) * cell - fsize * 0.5;
		const cy = (mape.factoryY[f] + 0.5) * cell - fsize * 0.5;
		if (st === MAPE_FACTORY_STATE.BUILDING) {
			ctx.strokeStyle = FACTORY_CSS[st];
			ctx.lineWidth = 2;
			ctx.strokeRect(cx, cy, fsize, fsize);
		} else {
			ctx.fillStyle = FACTORY_CSS[st];
			ctx.fillRect(cx, cy, fsize, fsize);
		}
	}
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
