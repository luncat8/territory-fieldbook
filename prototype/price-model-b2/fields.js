// Owns: cell-aligned heatmaps, price isolines, realized stock/gold flux arrows and cell inspection.
// Edit for: palette scaling, worker-gold flow arrows and B2 wallet/tax/settlement tooltip readouts.
'use strict';

const STOCK_COLORS = [[0,'#19181b'],[0.12,'#35272a'],[0.26,'#6d3a26'],[0.41,'#a95627'],[0.55,'#e18a36'],[0.7,'#ffca70'],[1,'#fff1c6']];
const PRICE_COLORS = [[0,'#17151f'],[0.16,'#271f34'],[0.3,'#3b2a52'],[0.48,'#634187'],[0.69,'#9364c0'],[0.88,'#c094e5'],[1,'#edcfff']];
const ISO_EDGES = [[],[3,0],[0,1],[3,1],[1,2],[3,0,1,2],[0,2],[3,2],[2,3],[0,2],[0,1,2,3],[1,2],[1,3],[0,1],[0,3],[]];
const STOCK_EXPOSURE = 6000;
const STOCK_LOG = Math.log1p(STOCK_EXPOSURE);
const SCALE_FLOOR = { price:0.5, gold:1 };
const ACTOR_NAMES = ['Cell','Mine','Factory','Town','Gold mine'];
const ACTOR_TAGS = ['','M','F','T','G'];
const ACTOR_INK = [[],['#77512c','#ffdb9f','#ffd69b'],['#2f4a3f','#9fe0c0','#a9e8c8'],['#514065','#e6d3ff','#e2cff4'],['#5c4a12','#f7d65a','#f7dc78']];
const cellName = i => `${String(i % ECONOMY_WIDTH).padStart(2,'0')}, ${String(Math.floor(i / ECONOMY_WIDTH)).padStart(2,'0')}`;

// 1-2-5 steps keep the legend and contour spacing still while uncapped prices drift.
function niceCeil(value) {
	const power = 10 ** Math.floor(Math.log10(value));
	const n = value / power;
	return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * power;
}

function fieldPalette(stops) {
	const colors = stops.map(([t, hex]) => [t, parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5),16)]);
	const lut = new Uint32Array(1025);
	let hi = 1;
	for (let i = 0; i < lut.length; i++) {
		const t = i / 1024;
		while (t > colors[hi][0]) hi++;
		const a = colors[hi-1], b = colors[hi], blend = (t-a[0])/(b[0]-a[0]);
		const r = Math.round(a[1]+(b[1]-a[1])*blend), g = Math.round(a[2]+(b[2]-a[2])*blend), blue = Math.round(a[3]+(b[3]-a[3])*blend);
		lut[i] = (255<<24) | (blue<<16) | (g<<8) | r;
	}
	return lut;
}

class FieldPlot {
	constructor(canvas, isStock) {
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d', { alpha:false });
		this.isStock = isStock;
		this.resource = 'coal';
		this.tooltip = canvas.nextElementSibling;
		this.view = new Float64Array(ECONOMY_SIZE);
		this.goldFlow = { flowX: new Float64Array(ECONOMY_SIZE), flowY: new Float64Array(ECONOMY_SIZE) };
		this.scale = 1;
		this.legendKey = '';
		this.scaleLabel = canvas.closest('.field-card').querySelector('.scale-label');
		const colors = isStock ? STOCK_COLORS : PRICE_COLORS;
		this.palette = fieldPalette(colors);
		canvas.closest('.field-card').querySelector('.ramp').style.background = `linear-gradient(90deg,${colors.map(([t,c]) => `${c} ${t*100}%`).join(',')})`;
		this.raster = document.createElement('canvas');
		this.raster.width = ECONOMY_WIDTH;
		this.raster.height = ECONOMY_HEIGHT;
		this.rasterCtx = this.raster.getContext('2d');
		this.image = this.rasterCtx.createImageData(ECONOMY_WIDTH, ECONOMY_HEIGHT);
		this.pixels = new Uint32Array(this.image.data.buffer);
		this.grid = document.createElement('canvas');
		this.ex = new Float64Array(4);
		this.ey = new Float64Array(4);
		this.markers = [];
	}

	fit() {
		const { canvas } = this;
		this.w = canvas.clientWidth;
		this.h = canvas.clientHeight;
		this.dpr = Math.min(3, window.devicePixelRatio || 1);
		canvas.width = this.grid.width = Math.round(this.w * this.dpr);
		canvas.height = this.grid.height = Math.round(this.h * this.dpr);
		this.left = 22;
		this.top = 9;
		this.pw = this.w - this.left - 10;
		this.ph = this.h - this.top - 18;
		this.cw = this.pw / ECONOMY_WIDTH;
		this.ch = this.ph / ECONOMY_HEIGHT;
		this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
		this.cacheGrid();
	}

	cacheGrid() {
		const g = this.grid.getContext('2d');
		const { dpr, left, top, cw, ch, pw, ph } = this;
		g.setTransform(dpr,0,0,dpr,left*dpr,top*dpr);
		g.beginPath();
		for (let x = 0; x <= ECONOMY_WIDTH; x++) { g.moveTo(x*cw,0); g.lineTo(x*cw,ph); }
		for (let y = 0; y <= ECONOMY_HEIGHT; y++) { g.moveTo(0,y*ch); g.lineTo(pw,y*ch); }
		g.lineWidth = 0.6;
		g.strokeStyle = this.isStock ? '#c9ac8129' : '#c6b0dc20';
		g.stroke();
		g.beginPath();
		for (let y = 4; y < ECONOMY_HEIGHT; y += 4) {
			for (let x = 4; x < ECONOMY_WIDTH; x += 4) {
				g.moveTo(x*cw-2,y*ch); g.lineTo(x*cw+2,y*ch);
				g.moveTo(x*cw,y*ch-2); g.lineTo(x*cw,y*ch+2);
			}
		}
		g.strokeStyle = '#ece4ed40';
		g.stroke();
		g.font = '8px monospace';
		g.fillStyle = '#8c8995';
		g.textAlign = 'center';
		for (let x = 0; x < ECONOMY_WIDTH; x += 8) g.fillText(String(x).padStart(2,'0'),(x+0.5)*cw,ph+12);
		g.textAlign = 'right';
		for (let y = 0; y < ECONOMY_HEIGHT; y += 8) g.fillText(String(y).padStart(2,'0'),-5,(y+0.5)*ch+3);
	}

	readActors(actors) {
		const counts = [0,0,0,0,0];
		this.markers.length = 0;
		for (let i = 0; i < actors.length; i++) {
			const kind = actors[i];
			if (kind) this.markers.push({ i, kind, label: `${ACTOR_TAGS[kind]}${++counts[kind]}` });
		}
	}

	fieldFor(model) {
		if (this.resource === 'gold') return this.goldView(model);
		if (this.resource === 'depleted') return this.isStock ? model.depleted : model.priceHome;
		if (this.resource === 'labor') return this.isStock ? model.labor : model.priceLabor;
		if (this.isStock) return this.resource === 'coal' ? model.coal : model.goods;
		return this.resource === 'coal' ? model.priceCoal : model.priceGoods;
	}

	goldView(model) {
		const { view, isStock } = this, { money, priceHome } = model, [coal, goods] = money.streams;
		for (let i = 0; i < ECONOMY_SIZE; i++) view[i] = isStock ? money.held(i) : coal.ask[i] + goods.ask[i] + priceHome[i] * 0.25;
		return view;
	}

	intensity(value) {
		if (!this.isStock) return Math.min(1, value / this.scale);
		if (this.resource === 'gold') return Math.log1p(value) / Math.log1p(this.scale);
		return Math.log1p(STOCK_EXPOSURE * value) / STOCK_LOG;
	}

	rescale(data) {
		let peak = this.isStock ? SCALE_FLOOR.gold : SCALE_FLOOR.price;
		for (let i = 0; i < ECONOMY_SIZE; i++) peak = Math.max(peak, data[i]);
		this.scale = niceCeil(peak);
		const key = this.isStock && this.resource !== 'gold' ? 'stock' : `${this.resource} ${this.scale}`;
		if (key !== this.legendKey) this.showScale(key);
	}

	showScale(key) {
		this.legendKey = key;
		const unit = this.resource === 'gold' ? (this.isStock ? ' g' : '') : this.resource === 'depleted' ? '' : ' g/u';
		if (key === 'stock') this.scaleLabel.innerHTML = 'Log scale <b>0 – 1</b>';
		else this.scaleLabel.innerHTML = `${this.isStock ? 'Log' : 'Linear'} scale <b>0 – ${this.scale}${unit}</b>`;
	}

	draw(model, selection, vectors) {
		const { ctx:g, isStock, pw, ph, left, top, cw, ch } = this;
		const data = this.fieldFor(model);
		this.rescale(data);
		for (let i = 0; i < ECONOMY_SIZE; i++) this.pixels[i] = this.palette[Math.round(this.intensity(data[i])*1024)];
		this.rasterCtx.putImageData(this.image,0,0);
		g.fillStyle = isStock ? '#191819' : '#1b1822';
		g.fillRect(0,0,this.w,this.h);
		g.save();
		g.translate(left,top);
		g.beginPath(); g.rect(0,0,pw,ph); g.clip();
		g.imageSmoothingEnabled = !isStock;
		g.drawImage(this.raster,0,0,pw,ph);
		if (!isStock) this.contours(data);
		g.restore();
		g.drawImage(this.grid,0,0,this.w,this.h);
		g.save();
		g.translate(left,top);
		if (isStock && vectors) this.drawFlows(model);
		for (const marker of this.markers) this.drawMarker(marker);
		if (selection >= 0) {
			g.strokeStyle = '#fff3d9'; g.lineWidth = 1.5;
			g.strokeRect((selection%ECONOMY_WIDTH)*cw,Math.floor(selection/ECONOMY_WIDTH)*ch,cw,ch);
		}
		g.restore();
	}

	contours(field) {
		const { ctx:g, cw, ch, ex, ey } = this;
		const w = ECONOMY_WIDTH, h = ECONOMY_HEIGHT, interval = this.scale / 26;
		g.beginPath();
		for (let y = -1; y < h; y++) {
			const row = Math.max(0,y)*w, next = Math.min(h-1,y+1)*w, py = (y+0.5)*ch;
			for (let x = -1; x < w; x++) {
				const l = Math.max(0,x), r = Math.min(w-1,x+1), px = (x+0.5)*cw;
				const a = field[row+l], b = field[row+r], c = field[next+r], d = field[next+l];
				const lo = Math.floor(Math.min(a,b,c,d)/interval)+1, hi = Math.floor(Math.max(a,b,c,d)/interval);
				for (let band = lo; band <= hi; band++) {
					const t = band*interval;
					let mask = (a>=t) | ((b>=t)<<1) | ((c>=t)<<2) | ((d>=t)<<3);
					if ((mask === 5 || mask === 10) && (a+b+c+d)*0.25 >= t) mask = 15-mask;
					const edges = ISO_EDGES[mask];
					ex[0] = px+cw*(t-a)/(b-a); ey[0] = py;
					ex[1] = px+cw; ey[1] = py+ch*(t-b)/(c-b);
					ex[2] = px+cw*(t-d)/(c-d); ey[2] = py+ch;
					ex[3] = px; ey[3] = py+ch*(t-a)/(d-a);
					for (let j = 0; j < edges.length; j += 2) {
						g.moveTo(ex[edges[j]],ey[edges[j]]); g.lineTo(ex[edges[j+1]],ey[edges[j+1]]);
					}
				}
			}
		}
		g.lineWidth = 0.85; g.strokeStyle = '#ddc0ff70'; g.stroke();
	}

	// Gold arrows combine seller coin streams with wages carried inside moving workers' wallets.
	buildGoldFlows(model) {
		const { flowX, flowY } = this.goldFlow;
		const { streams } = model.money;
		const { depleted, depletedFlow, labor, laborFlow } = model;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			let vx = 0, vy = 0;
			for (let s = 0; s < streams.length; s++) {
				vx += streams[s].scratch.flowX[i];
				vy += streams[s].scratch.flowY[i];
			}
			if (depleted[i] > 1e-9 && depletedFlow.gold[i] > 0) {
				const w = depletedFlow.gold[i] / depleted[i];
				vx += depletedFlow.flowX[i] * w;
				vy += depletedFlow.flowY[i] * w;
			}
			if (labor[i] > 1e-9 && laborFlow.gold[i] > 0) {
				const w = laborFlow.gold[i] / labor[i];
				vx += laborFlow.flowX[i] * w;
				vy += laborFlow.flowY[i] * w;
			}
			flowX[i] = vx;
			flowY[i] = vy;
		}
		return this.goldFlow;
	}

	drawFlows(model) {
		if (this.resource === 'coal') this.drawVectors(model, model.coalFlow);
		else if (this.resource === 'goods') this.drawVectors(model, model.goodsFlow);
		else if (this.resource === 'labor') this.drawVectors(model, model.laborFlow);
		else if (this.resource === 'depleted') this.drawVectors(model, model.depletedFlow);
		else this.drawVectors(model, this.buildGoldFlows(model));
	}

	drawVectors(model, scratch) {
		const { ctx:g, cw, ch } = this;
		g.strokeStyle = '#fff0ca'; g.lineWidth = 1; g.lineCap = 'round';
		const time = model.ticks * ECONOMY_DT;
		for (let y = 0; y < ECONOMY_HEIGHT; y += 2) {
			for (let x = (y/2)%2; x < ECONOMY_WIDTH; x += 2) {
				const i = economyIndex(x,y);
				const vx = scratch.flowX[i], vy = scratch.flowY[i], mag = Math.hypot(vx,vy);
				if (mag < 0.0002) continue;
				const screenLength = Math.hypot(vx*cw,vy*ch);
				const dx = vx*cw/screenLength, dy = vy*ch/screenLength;
				const offset = ((time*1.3+i*.618)%1-0.5)*cw*0.75;
				const cx = (x+0.5)*cw+dx*offset, cy = (y+0.5)*ch+dy*offset;
				const len = Math.max(3,Math.min(cw,ch)*0.57), wing = len*0.5;
				const tx = cx+len*dx, ty = cy+len*dy;
				g.globalAlpha = 0.35 + Math.min(0.55,mag*16);
				g.beginPath(); g.moveTo(cx-len*dx,cy-len*dy); g.lineTo(tx,ty);
				g.moveTo(tx-wing*(dx+dy),ty-wing*(dy-dx)); g.lineTo(tx,ty); g.lineTo(tx-wing*(dx-dy),ty-wing*(dy+dx)); g.stroke();
			}
		}
		g.globalAlpha = 1;
	}

	drawMarker(marker) {
		const { ctx:g, cw, ch } = this;
		const x = (marker.i%ECONOMY_WIDTH+0.5)*cw, y = (Math.floor(marker.i/ECONOMY_WIDTH)+0.5)*ch;
		const r = Math.max(3.5,Math.min(6.5,cw*0.55));
		const ink = ACTOR_INK[marker.kind];
		g.fillStyle = ink[0]; g.strokeStyle = ink[1];
		g.lineWidth = 1.7;
		g.beginPath();
		if (marker.kind === ECONOMY_MINE) { g.moveTo(x,y-r); g.lineTo(x+r,y); g.lineTo(x,y+r); g.lineTo(x-r,y); g.closePath(); }
		else if (marker.kind === ECONOMY_FACTORY) g.rect(x-r*0.85,y-r*0.85,r*1.7,r*1.7);
		else if (marker.kind === ECONOMY_GOLD) this.hexagon(x,y,r);
		else g.arc(x,y,r*0.88,0,Math.PI*2);
		g.fill(); g.stroke();
		g.fillStyle = g.strokeStyle;
		g.beginPath(); g.arc(x,y,r*0.29,0,Math.PI*2); g.fill();
		const labelWidth = marker.label.length*5.5+5;
		const lx = x+r+labelWidth+2 < this.pw ? x+r+3 : x-r-labelWidth-3;
		g.fillStyle = '#15141be3'; g.fillRect(lx,y-7,labelWidth,13);
		g.fillStyle = ink[2];
		g.font = '9px monospace'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(marker.label,lx+2.5,y-0.3);
	}

	hexagon(x, y, r) {
		const g = this.ctx;
		for (let k = 0; k < 6; k++) {
			const a = Math.PI/6 + k*Math.PI/3;
			if (k) g.lineTo(x+r*Math.cos(a),y+r*Math.sin(a)); else g.moveTo(x+r*Math.cos(a),y+r*Math.sin(a));
		}
		g.closePath();
	}

	cellAt(event) {
		const rect = this.canvas.getBoundingClientRect();
		const x = Math.floor((event.clientX-rect.left-this.left)/this.cw);
		const y = Math.floor((event.clientY-rect.top-this.top)/this.ch);
		return x < 0 || y < 0 || x >= ECONOMY_WIDTH || y >= ECONOMY_HEIGHT ? -1 : economyIndex(x,y);
	}

	showReading(i, model, pinned) {
		const tip = this.tooltip;
		tip.hidden = i < 0;
		if (i < 0) return;
		const { money, actors, settlements } = model, actor = actors[i];
		const carried = model.workerGoldAt(i);
		const occPct = actor ? Math.round(model.poolOccupancy(i) * 100) : 0;
		const detail = actor === ECONOMY_TOWN
			? ` · ${WEALTH_NAMES[model.wealthClass[i]]} · Tier ${Math.round(settlements.tier[i] * 100)}% · Pop ${model.pop[i].toFixed(1)} · Wait ${occPct}% · Tax ${model.townRestTax(i).toFixed(2)}g (${Math.round((model.taxMult[i] || 1) * 100)}%)`
			: actor ? ` · Scale ${(model.scale[i] || 1).toFixed(2)}× · Pool ${occPct}%${actor === ECONOMY_GOLD ? '' : ` · Ask ${model.sellPrice(i).toFixed(2)}`}` : '';
		const head = `${pinned ? 'Pinned · ' : ''}${settlements.isYoungTown(i) ? 'Young town' : ACTOR_NAMES[actor]} ${cellName(i)}${detail}`;
		const stocks = `Coal ${model.coal[i].toFixed(3)} · Goods ${model.goods[i].toFixed(3)} · Labor ${model.labor[i].toFixed(3)} · Depl ${model.depleted[i].toFixed(3)}`;
		const prices = `Coal ${model.priceCoal[i].toFixed(2)} · Goods ${model.priceGoods[i].toFixed(2)} · Wage ${model.priceLabor[i].toFixed(2)} · Home ${model.priceHome[i].toFixed(2)}/${model.priceRest[i].toFixed(2)}`;
		const wallet = actor === ECONOMY_TOWN
			? `Town ${money.purse[i].toFixed(2)}g · Residents ${money.workerPurse[i].toFixed(2)}g · Carried ${carried.toFixed(2)}g · Profit ${model.profit[i].toFixed(2)}/s`
			: `Held ${money.held(i).toFixed(2)}g · WorkerPay ${carried.toFixed(2)}g · Owed ${money.owedAt(i).toFixed(2)}g${actor ? ` · Profit ${model.profit[i].toFixed(2)}/s` : ''}`;
		const land = `Forest ${settlements.forest[i].toFixed(2)}/${settlements.forestCap[i].toFixed(2)} · Still ${model.depletedFlow.still[i].toFixed(2)} · Gathered ${settlements.still[i].toFixed(3)}`;
		tip.textContent = `${head}\n${stocks}\n${prices}\n${wallet}\n${land}`;
		const x = this.left+(i%ECONOMY_WIDTH+0.5)*this.cw, y = this.top+(Math.floor(i/ECONOMY_WIDTH)+0.5)*this.ch;
		tip.style.left = `${Math.max(3,Math.min(this.w-tip.offsetWidth-3,x+10))}px`;
		tip.style.top = `${y+tip.offsetHeight+12 < this.h ? y+10 : Math.max(2,y-tip.offsetHeight-8)}px`;
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
		const { canvas, ctx:g, cols, rows } = this;
		this.w = canvas.clientWidth; this.h = canvas.clientHeight;
		if (!this.w) return;
		const dpr = Math.min(3, window.devicePixelRatio || 1);
		canvas.width = Math.round(this.w*dpr); canvas.height = Math.round(this.h*dpr);
		g.setTransform(dpr,0,0,dpr,0,0);
		this.ink = g.createLinearGradient(0,0,0,this.h);
		this.ink.addColorStop(0,'#c8acee'); this.ink.addColorStop(1,'#42384e');
		for (let r = 0; r < rows; r++) {
			for (let c = 0; c < cols; c++) {
				const u = c/(cols-1), v = r/(rows-1), i = r*cols+c;
				this.x[i] = this.w*(0.37+0.61*u-0.35*v);
				this.base[i] = this.h*(0.38+0.22*u+0.38*v);
				this.cells[i] = economyIndex(Math.round(u*(ECONOMY_WIDTH-1)),Math.round(v*(ECONOMY_HEIGHT-1)));
			}
		}
	}

	draw(field) {
		if (!this.w) return;
		const { ctx:g, x, y, base, cols, rows } = this;
		g.clearRect(0,0,this.w,this.h);
		let peak = START_PRICE;
		for (let i = 0; i < x.length; i++) peak = Math.max(peak,field[this.cells[i]]);
		const gain = this.h*0.56/peak;
		for (let i = 0; i < x.length; i++) y[i] = base[i]-gain*field[this.cells[i]];
		g.lineWidth = 0.8; g.strokeStyle = this.ink; g.fillStyle = '#19171e';
		for (let r = 1; r < rows; r++) {
			const back = (r-1)*cols, front = r*cols;
			g.beginPath(); g.moveTo(x[back],y[back]);
			for (let c = 1; c < cols; c++) g.lineTo(x[back+c],y[back+c]);
			for (let c = cols-1; c >= 0; c--) g.lineTo(x[front+c],y[front+c]);
			g.closePath(); g.fill(); g.stroke();
			g.beginPath();
			for (let c = 1; c < cols-1; c++) { g.moveTo(x[back+c],y[back+c]); g.lineTo(x[front+c],y[front+c]); }
			g.stroke();
		}
	}
}
