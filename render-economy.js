// owns: economy palettes, cached grid, demand isolines and accepted-flow traces
// edit for: display presets, field exposure, contour spacing and flow animation

const RENDER_STYLE = { FIELDBOOK: 0, A: 1, B: 2 };
const RENDER_STYLE_NAME = ['Fieldbook', 'Prototype A', 'Prototype B'];
const RENDER_DEMAND_MAX = 6;
const RENDER_STOCK_MAX = 8;
const RENDER_A_STOCK_MAX = 10;
const RENDER_B_EXPOSURE = 6000;
const RENDER_B_LOG = Math.log1p(RENDER_B_EXPOSURE);
const RENDER_A_LOG = Math.log1p(RENDER_A_STOCK_MAX);
const RENDER_B_STOCK = [[0, 25, 24, 27], [0.12, 53, 39, 42], [0.26, 109, 58, 38], [0.41, 169, 86, 39], [0.55, 225, 138, 54], [0.7, 255, 202, 112], [1, 255, 241, 198]];
const RENDER_B_NEED = [[0, 23, 21, 31], [0.16, 39, 31, 52], [0.3, 59, 42, 82], [0.48, 99, 65, 135], [0.69, 147, 100, 192], [0.88, 192, 148, 229], [1, 237, 207, 255]];
const RENDER_POP_RAMP = [[0, 30, 26, 30], [0.12, 110, 74, 78], [0.3, 190, 126, 96], [0.55, 240, 186, 112], [1, 255, 246, 214]];
const RENDER_ISO_EDGES = [[], [3, 0], [0, 1], [3, 1], [1, 2], [3, 0, 1, 2], [0, 2], [3, 2], [2, 3], [0, 2], [0, 1, 2, 3], [1, 2], [1, 3], [0, 1], [0, 3], []];
const RENDER_FLOW_SOFT = ['rgba(151, 225, 255, 0.46)', 'rgba(151, 225, 255, 0.46)', 'rgba(255, 225, 173, 0.46)'];
const RENDER_FLOW_BRIGHT = ['rgba(222, 249, 255, 0.86)', 'rgba(222, 249, 255, 0.86)', 'rgba(255, 240, 202, 0.90)'];

const renderEconomy = {
	stockPalette: null,
	needPalette: null,
	popPalette: null,
	grid: null,
	isoX: new Float64Array(4),
	isoY: new Float64Array(4)
};

function renderEconomyInit() {
	renderEconomy.stockPalette = renderFieldPalette(RENDER_B_STOCK);
	renderEconomy.needPalette = renderFieldPalette(RENDER_B_NEED);
	renderEconomy.popPalette = renderFieldPalette(RENDER_POP_RAMP);
	renderEconomy.grid = document.createElement('canvas');
	renderEconomy.grid.width = renderEconomy.grid.height = render.size;
	const ctx = renderEconomy.grid.getContext('2d');
	ctx.beginPath();
	for (let p = 0.5; p < render.size; p += CELL_PX) {
		ctx.moveTo(p, 0);
		ctx.lineTo(p, render.size);
		ctx.moveTo(0, p);
		ctx.lineTo(render.size, p);
	}
	ctx.lineWidth = 0.65;
	ctx.strokeStyle = 'rgba(202, 187, 199, 0.14)';
	ctx.stroke();
	ctx.beginPath();
	for (let y = 4; y < world.size; y += 4) {
		for (let x = 4; x < world.size; x += 4) {
			ctx.moveTo(x * CELL_PX - 2, y * CELL_PX);
			ctx.lineTo(x * CELL_PX + 2, y * CELL_PX);
			ctx.moveTo(x * CELL_PX, y * CELL_PX - 2);
			ctx.lineTo(x * CELL_PX, y * CELL_PX + 2);
		}
	}
	ctx.strokeStyle = 'rgba(236, 228, 237, 0.25)';
	ctx.stroke();
	renderSetStyle(mapScene.id === 'a' ? RENDER_STYLE.A : mapScene.id === 'b' ? RENDER_STYLE.B : RENDER_STYLE.FIELDBOOK);
}

function renderSetStyle(style) {
	render.fieldStyle = style;
	const fancy = style === RENDER_STYLE.B;
	render.showFlow = style !== RENDER_STYLE.A;
	render.animateFlow = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	render.flowArrows = render.showContours = render.showGrid = render.smoothDemand = render.showLabels = fancy;
	render.showSettlements = render.showSources = true;
	render.showSurvey = style === RENDER_STYLE.FIELDBOOK;
}

function renderFieldPalette(stops) {
	const lut = new Uint8ClampedArray(1025 * 3);
	let hi = 1;
	for (let k = 0; k <= 1024; k++) {
		const t = k / 1024;
		while (hi < stops.length - 1 && t > stops[hi][0]) hi++;
		const a = stops[hi - 1], b = stops[hi];
		const blend = (t - a[0]) / (b[0] - a[0]);
		for (let c = 0; c < 3; c++) lut[k * 3 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * blend;
	}
	return lut;
}

function renderDemandMax(item) {
	return mape.engine !== MAPE_ENGINE.DIFFUSION && item <= MAPE_RES.CO2 && mapeIsMarketItem(item) ? 1 : RENDER_DEMAND_MAX;
}

// Amount reads stocks, demand reads the pull each stock follows: fresh to jobs, depleted home to rest.
const RENDER_POOL_LOG = Math.log1p(MAPE_VIEW_POOL_MAX);

function renderViewItem(view) {
	return view === VIEW.DEMAND ? mape.viewItemDemand : mape.viewItem;
}

function renderItemField(item, demand) {
	if (item === MAPE_VIEW_ITEM.POPULATION) return mape.pop;
	if (item === MAPE_VIEW_ITEM.JOBS) return demand ? mape.workforce : mape.jobNeed;
	if (item === MAPE_VIEW_ITEM.FRESH) return demand ? mape.workforce : mape.wfFresh;
	if (item === MAPE_VIEW_ITEM.DEPLETED) return demand ? mape.wfRestPull : mape.wfDepleted;
	return demand ? mape.demandView[item] : mape.goodsView[item];
}

function renderItemNorm(item, value, demand) {
	const v = value <= 0 ? 0 : value;
	if (item === MAPE_VIEW_ITEM.POPULATION) return Math.sqrt(Math.min(1, v / MAPE_VIEW_POP_MAX));
	if (item === MAPE_VIEW_ITEM.JOBS) return Math.sqrt(Math.min(1, v / MAPE_VIEW_JOB_MAX));
	if (item === MAPE_VIEW_ITEM.FRESH || item === MAPE_VIEW_ITEM.DEPLETED) {
		if (demand) return v / (v + MAPE_VIEW_PULL_REF);
		return Math.min(1, Math.log1p(v) / RENDER_POOL_LOG);
	}
	return -1;
}

function renderEconomyCells(view) {
	const pixels = render.pixels;
	const item = renderViewItem(view);
	const demand = view === VIEW.DEMAND;
	const civic = item === MAPE_VIEW_ITEM.POPULATION;
	const field = renderItemField(item, demand);
	const demandMax = renderDemandMax(item);
	const style = render.fieldStyle;
	const palette = civic ? renderEconomy.popPalette : demand ? renderEconomy.needPalette : renderEconomy.stockPalette;
	for (let i = 0, p = 0; i < world.n; i++, p += 4) {
		const value = field[i];
		const norm = renderItemNorm(item, value, demand);
		if (item !== MAPE_RES.CO2 && world.terrain[i] === TERRAIN.WATER) {
			pixels[p] = 21;
			pixels[p + 1] = 34;
			pixels[p + 2] = 53;
		} else if (demand && value < 0) {
			const k = Math.sqrt(Math.min(1, -value / demandMax));
			pixels[p] = 27 + 43 * k;
			pixels[p + 1] = 15 + 204 * k;
			pixels[p + 2] = 23 + 137 * k;
		} else if (norm >= 0) {
			const k = norm;
			if (civic || style === RENDER_STYLE.B) {
				const at = Math.round(k * 1024) * 3;
				pixels[p] = palette[at];
				pixels[p + 1] = palette[at + 1];
				pixels[p + 2] = palette[at + 2];
			} else if (style === RENDER_STYLE.A) {
				pixels[p] = demand ? 35 + 220 * Math.sqrt(k) : 11 + 230 * k;
				pixels[p + 1] = demand ? 12 + 218 * k : 20 + 225 * k;
				pixels[p + 2] = demand ? 16 + 35 * k : 32 + 218 * k;
			} else if (!demand) {
				const shine = k * k * k;
				pixels[p] = 9 + 35 * k + 196 * shine;
				pixels[p + 1] = 17 + 148 * k + 85 * shine;
				pixels[p + 2] = 29 + 186 * k + 40 * shine;
			} else {
				pixels[p] = 27 + 228 * k;
				pixels[p + 1] = 15 + 214 * k * k;
				pixels[p + 2] = 23 + 68 * k * k;
			}
		} else if (style === RENDER_STYLE.B) {
			const k = demand ? Math.min(1, value / demandMax) : Math.min(1, Math.log1p(RENDER_B_EXPOSURE * value / RENDER_STOCK_MAX) / RENDER_B_LOG);
			const at = Math.round(k * 1024) * 3;
			pixels[p] = palette[at];
			pixels[p + 1] = palette[at + 1];
			pixels[p + 2] = palette[at + 2];
		} else if (style === RENDER_STYLE.A) {
			const k = demand ? Math.min(1, value / demandMax) : Math.min(1, Math.log1p(value) / RENDER_A_LOG);
			pixels[p] = demand ? 35 + 220 * Math.sqrt(k) : 11 + 230 * k;
			pixels[p + 1] = demand ? 12 + 218 * k : 20 + 225 * k;
			pixels[p + 2] = demand ? 16 + 35 * k : 32 + 218 * k;
		} else if (!demand) {
			const k = Math.sqrt(Math.min(1, value / RENDER_STOCK_MAX));
			const shine = k * k * k;
			pixels[p] = 9 + 35 * k + 196 * shine;
			pixels[p + 1] = 17 + 148 * k + 85 * shine;
			pixels[p + 2] = 29 + 186 * k + 40 * shine;
		} else {
			const k = Math.sqrt(Math.min(1, value / demandMax));
			pixels[p] = 27 + 228 * k;
			pixels[p + 1] = 15 + 214 * k * k;
			pixels[p + 2] = 23 + 68 * k * k;
		}
		pixels[p + 3] = 255;
	}
}

function renderEconomyOverlays(ctx, view) {
	const item = renderViewItem(view);
	if (view === VIEW.DEMAND && render.showContours && item <= MAPE_RES.CO2) renderDemandContours(ctx);
	if (render.showGrid) ctx.drawImage(renderEconomy.grid, 0, 0);
	if (view === VIEW.AMOUNT && renderHasFlowItem(mape.viewItem)) renderGoodsFlow(ctx);
}

function renderDemandContours(ctx) {
	const item = mape.viewItemDemand;
	if (item > MAPE_RES.CO2) return;
	const field = mape.demandView[item];
	const landOnly = item !== MAPE_RES.CO2;
	const terrain = world.terrain;
	const size = world.size;
	const max = renderDemandMax(item);
	const interval = max * 0.035;
	const ex = renderEconomy.isoX, ey = renderEconomy.isoY;
	ctx.beginPath();
	for (let y = 0; y < size - 1; y++) {
		for (let x = 0; x < size - 1; x++) {
			const i = y * size + x;
			if (landOnly && (terrain[i] === TERRAIN.WATER || terrain[i + 1] === TERRAIN.WATER || terrain[i + size] === TERRAIN.WATER || terrain[i + size + 1] === TERRAIN.WATER)) continue;
			const a = field[i], b = field[i + 1], c = field[i + size + 1], d = field[i + size];
			const lo = Math.max(-28, Math.floor(Math.min(a, b, c, d) / interval) + 1);
			const hi = Math.min(28, Math.floor(Math.max(a, b, c, d) / interval));
			const px = (x + 0.5) * CELL_PX, py = (y + 0.5) * CELL_PX;
			for (let band = lo; band <= hi; band++) {
				const t = band * interval;
				let mask = (a >= t) | ((b >= t) << 1) | ((c >= t) << 2) | ((d >= t) << 3);
				if ((mask === 5 || mask === 10) && (a + b + c + d) * 0.25 >= t) mask = 15 - mask;
				const edges = RENDER_ISO_EDGES[mask];
				if (!edges.length) continue;
				ex[0] = px + CELL_PX * (t - a) / (b - a); ey[0] = py;
				ex[1] = px + CELL_PX; ey[1] = py + CELL_PX * (t - b) / (c - b);
				ex[2] = px + CELL_PX * (t - d) / (c - d); ey[2] = py + CELL_PX;
				ex[3] = px; ey[3] = py + CELL_PX * (t - a) / (d - a);
				for (let k = 0; k < edges.length; k += 2) {
					ctx.moveTo(ex[edges[k]], ey[edges[k]]);
					ctx.lineTo(ex[edges[k + 1]], ey[edges[k + 1]]);
				}
			}
		}
	}
	ctx.lineWidth = 1;
	ctx.strokeStyle = render.fieldStyle === RENDER_STYLE.B ? 'rgba(221, 192, 255, 0.48)' : 'rgba(255, 232, 163, 0.40)';
	ctx.stroke();
}

function renderFlowBand(ctx, time, min, max, bright) {
	const { flowX, flowY, viewItem } = mape;
	const { n, size } = world;
	const offset = viewItem * n;
	const cell = CELL_PX;
	ctx.beginPath();
	for (let i = 0; i < n; i++) {
		const x = i % size, y = (i / size) | 0;
		if (!bright && (x + y) % 2) continue;
		const dx = flowX[offset + i], dy = flowY[offset + i];
		const length2 = dx * dx + dy * dy;
		if (length2 < min || length2 >= max) continue;
		const length = Math.sqrt(length2);
		const vx = dx / length, vy = dy / length;
		const phase = time + ((Math.imul(i + 1, 1597334677) >>> 24) / 256);
		const t = render.animateFlow ? phase - Math.floor(phase) : 0.5;
		const cx = (x + 0.5 + vx * (t - 0.5) * 0.8) * cell;
		const cy = (y + 0.5 + vy * (t - 0.5) * 0.8) * cell;
		const trail = cell * (bright ? 0.37 : 0.27) * (1 - Math.abs(2 * t - 1));
		const tx = cx + vx * trail, ty = cy + vy * trail;
		ctx.moveTo(cx - vx * trail, cy - vy * trail);
		ctx.lineTo(tx, ty);
		if (!render.flowArrows) continue;
		const wing = trail * 0.7;
		ctx.moveTo(tx - wing * (vx + vy), ty - wing * (vy - vx));
		ctx.lineTo(tx, ty);
		ctx.lineTo(tx - wing * (vx - vy), ty - wing * (vy + vx));
	}
	ctx.lineWidth = bright ? 1.75 : 1.25;
	ctx.strokeStyle = bright ? RENDER_FLOW_BRIGHT[render.fieldStyle] : RENDER_FLOW_SOFT[render.fieldStyle];
	ctx.stroke();
}

function renderHasFlowItem(item) {
	return item < MAPE_RES.CO2 || (mape.workforceMode === MAPE_WORKFORCE_MODE.FLUID && (item === MAPE_VIEW_ITEM.FRESH || item === MAPE_VIEW_ITEM.DEPLETED));
}

function renderGoodsFlow(ctx) {
	if (!render.showFlow || !renderHasFlowItem(mape.viewItem) || mape.flowDt <= 0) return;
	// Accepted transfers share simulation time; pausing freezes both animation and stock.
	const time = (clock.seconds + clock.acc) * 0.73;
	const low = mape.flowDt * 0.06;
	const high = mape.flowDt * 0.30;
	ctx.lineCap = 'round';
	renderFlowBand(ctx, time, low * low, high * high, false);
	renderFlowBand(ctx, time, high * high, Infinity, true);
	ctx.lineCap = 'butt';
}
