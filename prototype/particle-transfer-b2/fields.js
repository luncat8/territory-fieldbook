// Owns: dual map rendering — dimmed terrain/water, docked cell stocks, live goods/worker particles, contours and inspection.
// Edit for: particle colour ramps, Monastery garden & actor markers, coarse forage view and cell tooltip readouts.
'use strict';

const STOCK_COLORS = [[0,'#19181b'],[0.12,'#35272a'],[0.26,'#6d3a26'],[0.41,'#a95627'],[0.55,'#e18a36'],[0.7,'#ffca70'],[1,'#fff1c6']];
const PRICE_COLORS = [[0,'#17151f'],[0.16,'#271f34'],[0.3,'#3b2a52'],[0.48,'#634187'],[0.69,'#9364c0'],[0.88,'#c094e5'],[1,'#edcfff']];
const ITEM_STOPS = [[0,'#63b7d6'],[0.35,'#e69b45'],[0.7,'#ffcf6e'],[1,'#fff3cf']];
const WALLET_STOPS = [[0,'#7f8ab8'],[0.4,'#c2a4f0'],[0.75,'#f4cf65'],[1,'#fff3b8']];
const TERRAIN_TINT = [[28, 31, 27], [23, 34, 26], [38, 31, 24], [19, 36, 54]];
const ISO_EDGES = [[],[3,0],[0,1],[3,1],[1,2],[3,0,1,2],[0,2],[3,2],[2,3],[0,2],[0,1,2,3],[1,2],[1,3],[0,1],[0,3],[]];
const STOCK_EXPOSURE = 800;
const STOCK_LOG = Math.log1p(STOCK_EXPOSURE);
const SCALE_FLOOR = { price: 0.5, gold: 1 };
const ACTOR_NAMES = ['Cell', 'Mine', 'Factory', 'Town', 'Gold mine', 'Monastery garden', 'Food farm', 'Sawmill'];
const ACTOR_TAGS = ['', 'M', 'F', 'T', 'G', 'A', 'H', 'S'];
const ACTOR_INK = [
	[],
	['#77512c', '#ffdb9f', '#ffd69b'],
	['#2f4a3f', '#9fe0c0', '#a9e8c8'],
	['#514065', '#e6d3ff', '#e2cff4'],
	['#5c4a12', '#f7d65a', '#f7dc78'],
	['#2f4a2c', '#b9f09b', '#ccf5b5'],
	['#544821', '#f1dc83', '#f4e9a7'],
	['#8a4a32', '#ffb59a', '#ffc7b2']
];
const cellName = i => `${String(i % ECONOMY_WIDTH).padStart(2, '0')}, ${String(Math.floor(i / ECONOMY_WIDTH)).padStart(2, '0')}`;

function niceCeil(value) {
	const power = 10 ** Math.floor(Math.log10(value));
	const n = value / power;
	return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * power;
}

function buildRgbStops(stops) {
	return stops.map(([t, hex]) => [t, parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5), 16)]);
}

function sampleStops(colors, t) {
	let hi = 1;
	while (hi < colors.length - 1 && t > colors[hi][0]) hi++;
	const a = colors[hi - 1], b = colors[hi], blend = (t - a[0]) / (b[0] - a[0] || 1);
	return [Math.round(a[1] + (b[1] - a[1]) * blend), Math.round(a[2] + (b[2] - a[2]) * blend), Math.round(a[3] + (b[3] - a[3]) * blend)];
}

function fieldPalette(stops) {
	const colors = buildRgbStops(stops);
	const lut = new Uint32Array(1025);
	for (let i = 0; i < lut.length; i++) {
		const [r, g, b] = sampleStops(colors, i / 1024);
		lut[i] = (255 << 24) | (b << 16) | (g << 8) | r;
	}
	return lut;
}

function cssRamp(stops, steps) {
	const colors = buildRgbStops(stops), out = new Array(steps);
	for (let i = 0; i < steps; i++) {
		const [r, g, b] = sampleStops(colors, i / (steps - 1));
		out[i] = `rgb(${r},${g},${b})`;
	}
	return out;
}

const ITEM_CSS = cssRamp(ITEM_STOPS, 64);
const WALLET_CSS = cssRamp(WALLET_STOPS, 64);
const STOCK_RGB = buildRgbStops(STOCK_COLORS);

class FieldPlot {
	constructor(canvas, isStock) {
			this.canvas = canvas;
			this.ctx = canvas.getContext('2d', { alpha: false });
			this.isStock = isStock;
			this.resource = 'coal';
			this.shape = 'triangles';
			this.tooltip = canvas.nextElementSibling;
			this.view = new Float64Array(ECONOMY_SIZE);
			this.goldFlow = { flowX: new Float64Array(ECONOMY_SIZE), flowY: new Float64Array(ECONOMY_SIZE) };
			this.scale = 1;
			this.legendKey = '';
		this.scaleLabel = canvas.closest('.field-card').querySelector('.scale-label');
		const colors = isStock ? STOCK_COLORS : PRICE_COLORS;
		this.palette = fieldPalette(colors);
		canvas.closest('.field-card').querySelector('.ramp').style.background = `linear-gradient(90deg,${colors.map(([t, c]) => `${c} ${t * 100}%`).join(',')})`;
		this.raster = document.createElement('canvas');
		this.raster.width = ECONOMY_WIDTH;
		this.raster.height = ECONOMY_HEIGHT;
		this.rasterCtx = this.raster.getContext('2d');
		this.image = this.rasterCtx.createImageData(ECONOMY_WIDTH, ECONOMY_HEIGHT);
		this.pixels = new Uint32Array(this.image.data.buffer);
		this.grid = document.createElement('canvas');
		this.labels = document.createElement('canvas');
		this.ex = new Float64Array(4);
		this.ey = new Float64Array(4);
		this.markers = [];
	}

	fit() {
		const { canvas } = this;
		this.w = canvas.clientWidth;
		this.h = canvas.clientHeight;
		this.dpr = Math.min(3, window.devicePixelRatio || 1);
		canvas.width = this.grid.width = this.labels.width = Math.round(this.w * this.dpr);
		canvas.height = this.grid.height = this.labels.height = Math.round(this.h * this.dpr);
		this.left = 22;
		this.top = 9;
		this.pw = this.w - this.left - 10;
		this.ph = this.h - this.top - 18;
		this.cw = this.pw / ECONOMY_WIDTH;
		this.ch = this.ph / ECONOMY_HEIGHT;
		this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		this.cacheGrid();
		this.cacheLabels();
	}

	cacheGrid() {
		const g = this.grid.getContext('2d');
		const { dpr, left, top, cw, ch, pw, ph } = this;
		g.setTransform(dpr, 0, 0, dpr, left * dpr, top * dpr);
		g.beginPath();
		for (let x = 0; x <= ECONOMY_WIDTH; x++) { g.moveTo(x * cw, 0); g.lineTo(x * cw, ph); }
		for (let y = 0; y <= ECONOMY_HEIGHT; y++) { g.moveTo(0, y * ch); g.lineTo(pw, y * ch); }
		g.lineWidth = 0.6;
		g.strokeStyle = this.isStock ? '#c9ac8129' : '#c6b0dc20';
		g.stroke();
		g.font = '8px monospace';
		g.fillStyle = '#8c8995';
		g.textAlign = 'center';
		for (let x = 0; x < ECONOMY_WIDTH; x += 8) g.fillText(String(x).padStart(2, '0'), (x + 0.5) * cw, ph + 12);
		g.textAlign = 'right';
		for (let y = 0; y < ECONOMY_HEIGHT; y += 8) g.fillText(String(y).padStart(2, '0'), -5, (y + 0.5) * ch + 3);
	}

	// Labels are text and only move when actors change, so they are drawn here once, never per paint.
	// readActors() runs before the first fit(); fit() caches again once the canvas is sized.
	cacheLabels() {
		if (!this.w) return;
		const g = this.labels.getContext('2d');
		const { dpr, left, top, cw, ch } = this;
		const r = Math.max(3.5, Math.min(6.5, cw * 0.55));
		g.setTransform(1, 0, 0, 1, 0, 0);
		g.clearRect(0, 0, this.labels.width, this.labels.height);
		g.setTransform(dpr, 0, 0, dpr, left * dpr, top * dpr);
		g.font = '9px monospace'; g.textBaseline = 'middle'; g.textAlign = 'left';
		for (const marker of this.markers) {
			const x = (marker.i % ECONOMY_WIDTH + 0.5) * cw, y = (Math.floor(marker.i / ECONOMY_WIDTH) + 0.5) * ch;
			const labelWidth = marker.label.length * 5.5 + 5;
			const lx = x + r + labelWidth + 2 < this.pw ? x + r + 3 : x - r - labelWidth - 3;
			g.fillStyle = '#15141be3'; g.fillRect(lx, y - 7, labelWidth, 13);
			g.fillStyle = ACTOR_INK[marker.kind][2];
			g.fillText(marker.label, lx + 2.5, y - 0.3);
		}
	}

	readActors(actors) {
		const counts = [0, 0, 0, 0, 0, 0, 0];
		this.markers.length = 0;
		for (let i = 0; i < actors.length; i++) {
			const kind = actors[i];
			if (kind) this.markers.push({ i, kind, label: `${ACTOR_TAGS[kind]}${++counts[kind]}` });
		}
		this.cacheLabels();
	}

	fieldFor(model) {
		const v = this.view;
		if (this.resource === 'gold') {
			for (let i = 0; i < ECONOMY_SIZE; i++) v[i] = this.isStock ? model.money.held(i) : model.priceHome[i] * 0.5 + model.priceLabor[i];
			return v;
		}
		if (this.resource === 'forage') return this.isStock ? model.forage.buildStockView() : model.forage.buildGradientView();
		if (this.resource === 'land') return this.isStock ? model.land.rest : model.land.site;
		if (this.resource === 'depleted') {
			if (this.isStock) {
				for (let i = 0; i < ECONOMY_SIZE; i++) v[i] = model.depleted[i] + model.roomCount[i] * 0.35;
				return v;
			}
			for (let i = 0; i < ECONOMY_SIZE; i++) v[i] = 0.5 * (model.priceHome[i] + model.priceRest[i]);
			return v;
		}
		if (this.resource === 'labor') return this.isStock ? model.labor : model.priceLabor;
		if (this.isStock) {
			const k = this.resource === 'coal' ? ITEM_COAL : this.resource === 'wood' ? ITEM_WOOD : this.resource === 'food' ? ITEM_FOOD : ITEM_GOODS;
			const st = model.stocks[k], sp = model.goodsPool.spawnAmount[k];
			for (let i = 0; i < ECONOMY_SIZE; i++) v[i] = st[i] + sp[i];
			return v;
		}
		return this.resource === 'coal' ? model.priceCoal : this.resource === 'wood' ? model.priceWood : this.resource === 'food' ? model.priceFood : model.priceGoods;
	}

	intensity(value) {
		if (!this.isStock || this.resource === 'land' || this.resource === 'forage') return Math.min(1, value / this.scale);
		if (this.resource === 'gold' || this.resource === 'labor' || this.resource === 'depleted') return Math.log1p(value) / Math.log1p(this.scale);
		return Math.log1p(STOCK_EXPOSURE * value) / STOCK_LOG;
	}

	rescale(data) {
		let peak = this.isStock ? SCALE_FLOOR.gold : SCALE_FLOOR.price;
		for (let i = 0; i < ECONOMY_SIZE; i++) peak = Math.max(peak, data[i]);
		this.scale = niceCeil(peak);
		const key = `${this.isStock ? 'S' : 'P'}:${this.resource}:${this.scale}`;
		if (key !== this.legendKey) {
			this.legendKey = key;
			const unit = this.resource === 'gold' && this.isStock ? ' g' : (!this.isStock && (this.resource === 'coal' || this.resource === 'food' || this.resource === 'goods' || this.resource === 'labor')) ? ' g/u' : '';
			this.scaleLabel.innerHTML = `${this.isStock && this.resource !== 'land' && this.resource !== 'forage' ? 'Log' : 'Linear'} scale <b>0 – ${this.scale}${unit}</b>`;
		}
	}

	paintCells(model, data) {
		const { terrain } = model.land, { plotOwner } = model.forage;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const t = Math.min(1, Math.max(0, this.intensity(data[i])));
			if (!this.isStock) {
				this.pixels[i] = this.palette[Math.round(t * 1024)];
				continue;
			}
			const base = TERRAIN_TINT[terrain[i]];
			let br = base[0], bg = base[1], bb = base[2];
			if (plotOwner[i] || model.farms.plotOwner[i]) { br += 10; bg += 22; bb += 8; }
			const [sr, sg, sb] = sampleStops(STOCK_RGB, t);
			const mix = t > 0.01 ? 0.2 + 0.8 * t : 0;
			const r = Math.round(br * (1 - mix) + sr * mix);
			const g = Math.round(bg * (1 - mix) + sg * mix);
			const b = Math.round(bb * (1 - mix) + sb * mix);
			this.pixels[i] = (255 << 24) | (b << 16) | (g << 8) | r;
		}
	}

	draw(model, selection, showParticles) {
		const { ctx: g, isStock, pw, ph, left, top, cw, ch } = this;
		const data = this.fieldFor(model);
		this.rescale(data);
		this.paintCells(model, data);
		this.rasterCtx.putImageData(this.image, 0, 0);
		g.fillStyle = isStock ? '#191819' : '#1b1822';
		g.fillRect(0, 0, this.w, this.h);
		g.save();
		g.translate(left, top);
		g.beginPath(); g.rect(0, 0, pw, ph); g.clip();
		g.imageSmoothingEnabled = !isStock;
		g.drawImage(this.raster, 0, 0, pw, ph);
		if (!isStock) this.contours(data);
		g.restore();
		g.drawImage(this.grid, 0, 0, this.w, this.h);
		g.save();
		g.translate(left, top);
		if (isStock && showParticles) {
			if (this.resource === 'gold') this.drawFlows(model);
			this.drawParticles(model, showParticles);
		}
		for (const marker of this.markers) this.drawMarker(marker, model);
		g.drawImage(this.labels, -left, -top, this.w, this.h);
		this.drawWatchedRing(model);
		if (selection >= 0) {
			g.strokeStyle = '#fff3d9'; g.lineWidth = 1.5;
			g.strokeRect((selection % ECONOMY_WIDTH) * cw, Math.floor(selection / ECONOMY_WIDTH) * ch, cw, ch);
		}
		g.restore();
	}

	// Goods: delivered unit price -> color; workers: carried wallet per worker -> color; amount -> size.
	// Shape follows this.shape: heading triangles (default), single-pixel points, or a large triangle on every 8th particle.
	drawParticles(model, vectors) {
		const { ctx: g } = this;
		g.lineWidth = 1.1;
		g.lineCap = 'round';
		if (this.resource === 'coal' || this.resource === 'wood' || this.resource === 'food' || this.resource === 'goods') {
			const kind = this.resource === 'coal' ? ITEM_COAL : this.resource === 'wood' ? ITEM_WOOD : this.resource === 'food' ? ITEM_FOOD : ITEM_GOODS;
			const pool = model.goodsPool;
			const priceRef = Math.max(1, START_PRICE * 1.6);
			for (let p = 0; p < pool.count; p++) {
				if (pool.kind[p] !== kind) continue;
				const priceIdx = Math.min(63, Math.max(0, Math.round((pool.unitPrice(p) / priceRef) * 63)));
				this.drawParticle(pool, p, ITEM_CSS[priceIdx], Math.sqrt(pool.amount[p] / SPAWN_UNIT), vectors);
			}
			return;
		}
		const { workers } = model;
		const goldRef = Math.max(1e-12, model.towns.walletMean() * 2.5);
		for (let w = 0; w < workers.count; w++) {
			const st = workers.state[w];
			if (!workers.isWalking(st)) continue;
			if (this.resource === 'forage' && st !== WORKER_FORAGE) continue;
			const color = st === WORKER_FORAGE
				? '#84f3a9'
				: WALLET_CSS[Math.min(63, Math.max(0, Math.round((workers.gold[w] / goldRef) * 63)))];
			this.drawParticle(workers, w, color, 1, vectors);
		}
	}

	drawParticle(pool, p, color, size, vectors) {
		const { ctx: g, cw, ch, shape } = this;
		if (size <= 0 || (shape === 'large' && (p & 7))) return;
		const px = pool.x[p] * cw, py = pool.y[p] * ch;
		const hx = pool.hx[p], hy = pool.hy[p];
		if (vectors && hx * hx + hy * hy > 0.04) {
			g.strokeStyle = '#14131ad8';
			g.globalAlpha = 0.55;
			g.beginPath();
			g.moveTo(px, py);
			g.lineTo(px - hx * cw * 0.12, py - hy * ch * 0.12);
			g.stroke();
			g.globalAlpha = 1;
		}
		g.fillStyle = color;
		if (shape === 'points') {
			g.fillRect(px, py, 1 / this.dpr, 1 / this.dpr);
			return;
		}
		const unit = Math.max(3, Math.min(cw, ch) * 0.5);
		const len = (shape === 'large' ? 1.9 : 1) * unit * (0.72 + 0.4 * Math.min(1, size));
		this.drawTriangle(px, py, hx, hy, len);
	}

	// One flock-style triangle: tip along the smoothed heading, base across it; a parked particle points up.
	drawTriangle(px, py, hx, hy, len) {
		const g = this.ctx;
		const speed2 = hx * hx + hy * hy;
		let ux = 0, uy = -1;
		if (speed2 > 1e-6) {
			const inv = 1 / Math.sqrt(speed2);
			ux = hx * inv;
			uy = hy * inv;
		}
		const tip = len * 0.5, wing = len * 0.3;
		g.beginPath();
		g.moveTo(px + ux * tip, py + uy * tip);
		g.lineTo(px - ux * tip - uy * wing, py - uy * tip + ux * wing);
		g.lineTo(px - ux * tip + uy * wing, py - uy * tip - ux * wing);
		g.closePath();
		g.fill();
	}

	// Gold arrows show goods-particle value flux plus gold-weighted walking wallets heading across the map.
	buildGoldFlows(model) {
		const { flowX, flowY } = this.goldFlow;
		const { goodsPool, workers } = model;
		flowX.fill(0);
		flowY.fill(0);
		for (let p = 0; p < goodsPool.count; p++) {
			const i = economyIndex(Math.floor(goodsPool.x[p]), Math.floor(goodsPool.y[p]));
			const value = goodsPool.amount[p] * goodsPool.unitPrice(p);
			flowX[i] += goodsPool.hx[p] * value;
			flowY[i] += goodsPool.hy[p] * value;
		}
		for (let w = 0; w < workers.count; w++) {
			if (!workers.isWalking(workers.state[w])) continue;
			const i = workers.cell[w];
			flowX[i] += workers.hx[w] * workers.gold[w];
			flowY[i] += workers.hy[w] * workers.gold[w];
		}
		return this.goldFlow;
	}

	drawFlows(model) {
		this.drawVectors(model, this.buildGoldFlows(model));
	}

	drawVectors(model, scratch) {
		const { ctx: g, cw, ch } = this;
		g.strokeStyle = '#fff0ca';
		g.lineWidth = 1;
		g.lineCap = 'round';
		const time = model.ticks * ECONOMY_DT;
		for (let y = 0; y < ECONOMY_HEIGHT; y += 2) {
			for (let x = (y / 2) % 2; x < ECONOMY_WIDTH; x += 2) {
				const i = economyIndex(x, y);
				const vx = scratch.flowX[i], vy = scratch.flowY[i], mag = Math.hypot(vx, vy);
				if (mag < 0.0002) continue;
				const screenLength = Math.hypot(vx * cw, vy * ch);
				const dx = vx * cw / screenLength, dy = vy * ch / screenLength;
				const offset = ((time * 1.3 + i * .618) % 1 - 0.5) * cw * 0.75;
				const cx = (x + 0.5) * cw + dx * offset, cy = (y + 0.5) * ch + dy * offset;
				const len = Math.max(3, Math.min(cw, ch) * 0.57), wing = len * 0.5;
				const tx = cx + len * dx, ty = cy + len * dy;
				g.globalAlpha = 0.35 + Math.min(0.55, mag * 16);
				g.beginPath();
				g.moveTo(cx - len * dx, cy - len * dy);
				g.lineTo(tx, ty);
				g.moveTo(tx - wing * (dx + dy), ty - wing * (dy - dx));
				g.lineTo(tx, ty);
				g.lineTo(tx - wing * (dx - dy), ty - wing * (dy + dx));
				g.stroke();
			}
		}
		g.globalAlpha = 1;
	}

	drawWatchedRing(model) {
		const w = model.workers.indexOfId(model.workers.watchedId);
		if (w < 0) return;
		const { ctx: g, cw, ch } = this;
		const px = model.workers.x[w] * cw, py = model.workers.y[w] * ch;
		g.strokeStyle = '#ffffff';
		g.lineWidth = 1.6;
		g.beginPath();
		g.arc(px, py, Math.max(5.5, cw * 0.45), 0, Math.PI * 2);
		g.stroke();
	}

	contours(field) {
		const { ctx: g, cw, ch, ex, ey } = this;
		const w = ECONOMY_WIDTH, h = ECONOMY_HEIGHT, interval = this.scale / 22;
		g.beginPath();
		for (let y = -1; y < h; y++) {
			const row = Math.max(0, y) * w, next = Math.min(h - 1, y + 1) * w, py = (y + 0.5) * ch;
			for (let x = -1; x < w; x++) {
				const l = Math.max(0, x), r = Math.min(w - 1, x + 1), px = (x + 0.5) * cw;
				const a = field[row + l], b = field[row + r], c = field[next + r], d = field[next + l];
				const lo = Math.floor(Math.min(a, b, c, d) / interval) + 1, hi = Math.floor(Math.max(a, b, c, d) / interval);
				for (let band = lo; band <= hi; band++) {
					const t = band * interval;
					let mask = (a >= t) | ((b >= t) << 1) | ((c >= t) << 2) | ((d >= t) << 3);
					if ((mask === 5 || mask === 10) && (a + b + c + d) * 0.25 >= t) mask = 15 - mask;
					const edges = ISO_EDGES[mask];
					ex[0] = px + cw * (t - a) / (b - a); ey[0] = py;
					ex[1] = px + cw; ey[1] = py + ch * (t - b) / (c - b);
					ex[2] = px + cw * (t - d) / (c - d); ey[2] = py + ch;
					ex[3] = px; ey[3] = py + ch * (t - a) / (d - a);
					for (let j = 0; j < edges.length; j += 2) {
						g.moveTo(ex[edges[j]], ey[edges[j]]); g.lineTo(ex[edges[j + 1]], ey[edges[j + 1]]);
					}
				}
			}
		}
		g.lineWidth = 0.85; g.strokeStyle = '#ddc0ff70'; g.stroke();
	}

	drawMarker(marker, model) {
		const { ctx: g, cw, ch } = this;
		const x = (marker.i % ECONOMY_WIDTH + 0.5) * cw, y = (Math.floor(marker.i / ECONOMY_WIDTH) + 0.5) * ch;
		const r = Math.max(3.5, Math.min(6.5, cw * 0.55));
		const ink = ACTOR_INK[marker.kind];
		g.fillStyle = ink[0]; g.strokeStyle = ink[1];
		g.lineWidth = model.founding.isBuilding(marker.i) ? 1.1 : 1.7;
		g.beginPath();
		if (marker.kind === ECONOMY_MINE) { g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); }
		else if (marker.kind === ECONOMY_FACTORY) g.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
		else if (marker.kind === ECONOMY_GOLD) this.polygon(x, y, r, 6, Math.PI / 6);
		else if (marker.kind === ECONOMY_GARDEN) this.polygon(x, y, r * 0.95, 8, Math.PI / 8);
		else if (marker.kind === ECONOMY_SAWMILL) this.polygon(x, y, r, 3, -Math.PI / 2);
		else g.arc(x, y, r * 0.88, 0, Math.PI * 2);
		g.fill(); g.stroke();
		g.fillStyle = g.strokeStyle;
		g.beginPath(); g.arc(x, y, r * 0.28, 0, Math.PI * 2); g.fill();
	}

	polygon(x, y, r, sides, offset) {
		const g = this.ctx;
		for (let k = 0; k < sides; k++) {
			const a = offset + (k * Math.PI * 2) / sides;
			if (k) g.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
			else g.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
		}
		g.closePath();
	}

	coordsAt(event) {
		const rect = this.canvas.getBoundingClientRect();
		const gx = (event.clientX - rect.left - this.left) / this.cw;
		const gy = (event.clientY - rect.top - this.top) / this.ch;
		return [gx, gy];
	}

	cellAt(event) {
		const [gx, gy] = this.coordsAt(event);
		const x = Math.floor(gx), y = Math.floor(gy);
		return x < 0 || y < 0 || x >= ECONOMY_WIDTH || y >= ECONOMY_HEIGHT ? -1 : economyIndex(x, y);
	}

	showReading(i, model, pinned) {
		const tip = this.tooltip;
		tip.hidden = i < 0;
		if (i < 0) return;
		const { money, actors, settlements, land, forage, founding } = model, actor = actors[i];
		const occPct = actor && actor !== ECONOMY_GARDEN ? Math.round(model.poolOccupancy(i) * 100) : 0;
		let detail = '';
		if (actor === ECONOMY_TOWN) {
			detail = ` · ${WEALTH_NAMES[model.wealthClass[i]]} · Tier ${Math.round(settlements.tier[i] * 100)}% · Occ ${model.pop[i].toFixed(0)}/${model.rooms[i].toFixed(1)} · Wait ${occPct}% · Tax ${model.townRestTax(i).toFixed(2)}g`;
		} else if (actor === ECONOMY_FARM) {
			detail = ` · Fields ${model.farms.plots[i]} · Crew ${model.shiftCount[i]}/${model.farms.crewTarget(i)} · Build ${Math.round(model.founding.buildProgress[i] * 100)}% · Harvest ${(FARM_SEASON_SECONDS - model.farms.clock[i]).toFixed(1)}s`;
		} else if (actor === ECONOMY_GARDEN) {
			detail = ` · Plots ${forage.plotCount(i)} · Free food ${forage.gardenStock[i].toFixed(2)} · Next ${(GARDEN_SEASON_SEC - forage.gardenClock[i]).toFixed(1)}s`;
		} else if (actor) {
			const bld = founding.isBuilding(i) ? ` · Build ${Math.round(founding.buildProgress[i] * 100)}%` : '';
			detail = `${bld} · Scale ${(model.scale[i] || 1).toFixed(2)}× · Shift ${model.shiftCount[i].toFixed(0)}/${model.optimizer.shiftSlots(i)} · Pool ${occPct}%`;
		}
		const name = settlements.isYoungTown(i) ? 'Young town' : ACTOR_NAMES[actor];
		const head = `${pinned ? 'Pinned · ' : ''}${name} ${cellName(i)}${detail}`;
		const stocks = `Food ${model.food[i].toFixed(2)} · Coal ${model.coal[i].toFixed(2)} · Goods ${model.goods[i].toFixed(2)} · Wood ${model.wood[i].toFixed(2)} · Fresh ${model.labor[i].toFixed(2)} · Tired ${model.depleted[i].toFixed(2)} · Forage ${model.forageCount[i].toFixed(0)}`;
		const prices = `Food ${model.priceFood[i].toFixed(2)} · Coal ${model.priceCoal[i].toFixed(2)} · Goods ${model.priceGoods[i].toFixed(2)} · Wood ${model.priceWood[i].toFixed(2)} · Wage ${model.priceLabor[i].toFixed(2)} · Home ${model.priceHome[i].toFixed(2)}/${model.priceRest[i].toFixed(2)} · FoodGrad ${forage.scoreAtCell(i).toFixed(2)}`;
		const wallet = actor === ECONOMY_TOWN
			? `Town ${money.cash(i).toFixed(2)}g · Rations ${model.food[i].toFixed(2)} · WorkerGold ${model.workerGold[i].toFixed(2)}g · Profit ${model.profit[i].toFixed(2)}/s`
			: `Budget ${money.cash(i).toFixed(2)}g · Owner #${model.owners.ownerAt(i)} (${(model.owners.accountAt(i)?.cash || 0).toFixed(2)}g) · Facility #${model.owners.cell[i]} · WorkerGold ${model.workerGold[i].toFixed(2)}g · Owed ${money.wageDebt(i).toFixed(2)}g · Vault ${money.vault.toFixed(2)}g`;
		const shore = land.waterEdge[i] ? ' (Shore)' : '';
		const ground = `${TERRAIN_NAMES[land.terrain[i]]}${shore} · WildFood ${forage.wildFood[i].toFixed(2)} · Rest ${land.rest[i].toFixed(2)} · Site ${land.site[i].toFixed(2)} · Forest ${settlements.forest[i].toFixed(2)}`;
		const settle = `Intent ${settlements.cellIntent[i].toFixed(2)} · Gathered ${settlements.gather[i].toFixed(1)} · IdleFresh ${founding.idle[i].toFixed(1)}`;
		tip.textContent = `${head}\n${stocks}\n${prices}\n${wallet}\n${ground}\n${settle}`;
		const x = this.left + (i % ECONOMY_WIDTH + 0.5) * this.cw, y = this.top + (Math.floor(i / ECONOMY_WIDTH) + 0.5) * this.ch;
		tip.style.left = `${Math.max(3, Math.min(this.w - tip.offsetWidth - 3, x + 10))}px`;
		tip.style.top = `${y + tip.offsetHeight + 12 < this.h ? y + 10 : Math.max(2, y - tip.offsetHeight - 8)}px`;
	}
}

class FieldRelief {
	constructor(canvas) {
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d');
		this.cols = 25;
		this.rows = 15;
		const n = this.cols * this.rows;
		this.x = new Float32Array(n);
		this.base = new Float32Array(n);
		this.y = new Float32Array(n);
		this.cells = new Int16Array(n);
	}

	fit() {
		const { canvas, ctx: g, cols, rows } = this;
		this.w = canvas.clientWidth; this.h = canvas.clientHeight;
		if (!this.w) return;
		const dpr = Math.min(3, window.devicePixelRatio || 1);
		canvas.width = Math.round(this.w * dpr); canvas.height = Math.round(this.h * dpr);
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.ink = g.createLinearGradient(0, 0, 0, this.h);
		this.ink.addColorStop(0, '#c8acee'); this.ink.addColorStop(1, '#42384e');
		for (let r = 0; r < rows; r++) {
			for (let c = 0; c < cols; c++) {
				const u = c / (cols - 1), v = r / (rows - 1), i = r * cols + c;
				this.x[i] = this.w * (0.37 + 0.61 * u - 0.35 * v);
				this.base[i] = this.h * (0.38 + 0.22 * u + 0.38 * v);
				this.cells[i] = economyIndex(Math.round(u * (ECONOMY_WIDTH - 1)), Math.round(v * (ECONOMY_HEIGHT - 1)));
			}
		}
	}

	draw(field) {
		if (!this.w) return;
		const { ctx: g, x, y, base, cols, rows } = this;
		g.clearRect(0, 0, this.w, this.h);
		let peak = START_PRICE;
		for (let i = 0; i < x.length; i++) peak = Math.max(peak, field[this.cells[i]]);
		const gain = this.h * 0.56 / peak;
		for (let i = 0; i < x.length; i++) y[i] = base[i] - gain * field[this.cells[i]];
		g.lineWidth = 0.8; g.strokeStyle = this.ink; g.fillStyle = '#19171e';
		for (let r = 1; r < rows; r++) {
			const back = (r - 1) * cols, front = r * cols;
			g.beginPath(); g.moveTo(x[back], y[back]);
			for (let c = 1; c < cols; c++) g.lineTo(x[back + c], y[back + c]);
			for (let c = cols - 1; c >= 0; c--) g.lineTo(x[front + c], y[front + c]);
			g.closePath(); g.fill(); g.stroke();
			g.beginPath();
			for (let c = 1; c < cols - 1; c++) { g.moveTo(x[back + c], y[back + c]); g.lineTo(x[front + c], y[front + c]); }
			g.stroke();
		}
	}
}

if (typeof module === 'object') module.exports = { FieldPlot, FieldRelief };
