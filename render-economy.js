// owns: economy heat palettes and animated traces of accepted goods transfers
// edit for: field contrast, flow speed, density and direction markers

const RENDER_DEMAND_MAX = 6;
const RENDER_STOCK_MAX = 8;
const RENDER_FLOW_SOFT = 'rgba(151, 225, 255, 0.46)';
const RENDER_FLOW_BRIGHT = 'rgba(222, 249, 255, 0.86)';

function renderEconomyCells(view) {
	const pixels = render.pixels;
	const item = mape.viewItem;
	const demand = view === VIEW.DEMAND;
	const landOnly = item !== MAPE_RES.CO2;
	const field = demand ? mape.demandView[item] : mape.goodsView[item];
	const demandMax = mape.engine !== MAPE_ENGINE.DIFFUSION && mapeIsMarketItem(item) ? 1 : RENDER_DEMAND_MAX;
	for (let i = 0, p = 0; i < world.n; i++, p += 4) {
		const value = field[i];
		if (landOnly && world.terrain[i] === TERRAIN.WATER) {
			pixels[p] = 21;
			pixels[p + 1] = 34;
			pixels[p + 2] = 53;
		} else if (!demand) {
			const k = Math.sqrt(Math.min(1, value / RENDER_STOCK_MAX));
			const shine = k * k * k;
			pixels[p] = 9 + 35 * k + 196 * shine;
			pixels[p + 1] = 17 + 148 * k + 85 * shine;
			pixels[p + 2] = 29 + 186 * k + 40 * shine;
		} else if (value < 0) {
			const k = Math.sqrt(Math.min(1, -value / demandMax));
			pixels[p] = 27 + 43 * k;
			pixels[p + 1] = 15 + 204 * k;
			pixels[p + 2] = 23 + 137 * k;
		} else {
			const k = Math.sqrt(Math.min(1, value / demandMax));
			pixels[p] = 27 + 228 * k;
			pixels[p + 1] = 15 + 214 * k * k;
			pixels[p + 2] = 23 + 68 * k * k;
		}
		pixels[p + 3] = 255;
	}
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
		const t = phase - Math.floor(phase);
		const cx = (x + 0.5 + vx * (t - 0.5) * 0.8) * cell;
		const cy = (y + 0.5 + vy * (t - 0.5) * 0.8) * cell;
		const trail = cell * (bright ? 0.37 : 0.27) * (1 - Math.abs(2 * t - 1));
		ctx.moveTo(cx - vx * trail, cy - vy * trail);
		ctx.lineTo(cx + vx * trail, cy + vy * trail);
	}
	ctx.lineWidth = bright ? 1.75 : 1.25;
	ctx.strokeStyle = bright ? RENDER_FLOW_BRIGHT : RENDER_FLOW_SOFT;
	ctx.stroke();
}

function renderGoodsFlow(ctx) {
	if (!render.showFlow || mape.viewItem === MAPE_RES.CO2 || mape.flowDt <= 0) return;
	// The trace phase follows displayed simulation time, including a partial tick; pause freezes it.
	const time = (clock.seconds + clock.acc) * 0.73;
	const low = mape.flowDt * 0.06;
	const high = mape.flowDt * 0.30;
	ctx.lineCap = 'round';
	renderFlowBand(ctx, time, low * low, high * high, false);
	renderFlowBand(ctx, time, high * high, Infinity, true);
	ctx.lineCap = 'butt';
}
