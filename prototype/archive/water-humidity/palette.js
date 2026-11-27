// owns: field colour ramps and the cell painter shared by the browser canvas and the headless PNG tool
// edit for: palettes, display scales, composite overlays
'use strict';

const WATER_MODES = ['composite', 'height', 'water', 'group', 'humidity', 'rain', 'flow'];
const WATER_MODE_LABEL = {
	composite: 'Terrain + water + grouping',
	height: 'Heightmap / relief',
	water: 'Surface water',
	group: 'Water grouping demand',
	humidity: 'Air humidity',
	rain: 'Rainfall (last step)',
	flow: 'Flow direction'
};
const WATER_DISPLAY = {
	waterRef: 0.22,
	groupRef: 0.9,
	rainRef: 0.0012,
	flowRef: 1
};

function waterLut(stops) {
	const lut = new Uint8Array(256 * 3);
	let hi = 1;
	for (let i = 0; i < 256; i++) {
		const t = i / 255;
		while (hi < stops.length - 1 && t > stops[hi][0]) hi++;
		const a = stops[hi - 1];
		const b = stops[hi];
		const k = (t - a[0]) / (b[0] - a[0]);
		lut[i * 3] = a[1] + (b[1] - a[1]) * k;
		lut[i * 3 + 1] = a[2] + (b[2] - a[2]) * k;
		lut[i * 3 + 2] = a[3] + (b[3] - a[3]) * k;
	}
	return lut;
}

const WATER_LUT = {
	water: waterLut([[0, 10, 18, 30], [0.18, 30, 76, 132], [0.45, 52, 142, 196], [0.72, 122, 202, 232], [1, 236, 250, 255]]),
	group: waterLut([[0, 14, 12, 22], [0.2, 48, 30, 82], [0.45, 104, 56, 156], [0.72, 170, 108, 224], [1, 240, 204, 255]]),
	humidity: waterLut([[0, 9, 18, 24], [0.25, 22, 62, 76], [0.55, 42, 122, 138], [0.8, 104, 196, 210], [1, 206, 246, 252]]),
	rain: waterLut([[0, 8, 10, 16], [0.2, 44, 50, 68], [0.55, 150, 140, 96], [0.82, 236, 214, 130], [1, 255, 250, 226]]),
	height: waterLut([[0, 26, 58, 92], [0.18, 58, 96, 62], [0.45, 104, 132, 78], [0.72, 158, 146, 104], [1, 208, 192, 154]])
};

function waterMix(out, o, lut, t, alpha) {
	const k = t < 0 ? 0 : t > 1 ? 1 : t;
	const q = (k * 255) | 0;
	const b = q * 3;
	const inv = 1 - alpha;
	out[o] = out[o] * inv + lut[b] * alpha;
	out[o + 1] = out[o + 1] * inv + lut[b + 1] * alpha;
	out[o + 2] = out[o + 2] * inv + lut[b + 2] * alpha;
}

function waterPaint(model, mode, out, showRain) {
	const w = model.width;
	const h = model.rows;
	const elev = model.elev;
	const sea = model.sea;
	const d = WATER_DISPLAY;
	const relief = WATER_LUT.height;
	let humMean = 0;
	if (mode === 'humidity') {
		for (let i = 0; i < model.n; i++) humMean += model.humidity[i];
		humMean = humMean / model.n + 1e-6;
	}
	for (let y = 0; y < h; y++) {
		const row = y * w;
		for (let x = 0; x < w; x++) {
			const i = row + x;
			const o = i * 4;
			const isSea = sea[i] === 1;
			if (mode === 'composite' || mode === 'height') {
				const q = (Math.max(0, Math.min(1, (elev[i] - 0.28) / 0.5)) * 255) | 0;
				const e = q * 3;
				const dx = elev[i + (x < w - 1 ? 1 : 0)] - elev[i - (x > 0 ? 1 : 0)];
				const dy = elev[i + (y < h - 1 ? w : 0)] - elev[i - (y > 0 ? w : 0)];
				const shade = Math.max(0.45, Math.min(1.25, 0.82 - 16 * dx + 9 * dy));
				if (isSea) {
					out[o] = 18; out[o + 1] = 42; out[o + 2] = 72;
				} else {
					out[o] = relief[e] * shade;
					out[o + 1] = relief[e + 1] * shade;
					out[o + 2] = relief[e + 2] * shade;
				}
			} else {
				out[o] = 10; out[o + 1] = 12; out[o + 2] = 18;
			}
			out[o + 3] = 255;
			if (isSea) {
				if (mode === 'water') waterMix(out, o, WATER_LUT.water, 0.5, 1);
				continue;
			}
			if (mode === 'composite') {
				const wt = model.water[i] / (model.water[i] + d.waterRef);
				if (wt > 0.02) waterMix(out, o, WATER_LUT.water, wt, Math.min(1, 0.35 + wt));
				const gt = Math.pow(model.group[i], 1.3) * 0.5;
				if (gt > 0.01) {
					out[o] += gt * 150;
					out[o + 1] += gt * 70;
					out[o + 2] += gt * 190;
				}
				const rt = showRain === false ? 0 : Math.min(1, model.rain[i] / d.rainRef);
				if (rt > 0.02) {
					out[o] += rt * 190;
					out[o + 1] += rt * 190;
					out[o + 2] += rt * 170;
				}
			} else if (mode === 'water') {
				waterMix(out, o, WATER_LUT.water, model.water[i] / (model.water[i] + d.waterRef), 1);
			} else if (mode === 'group') {
				waterMix(out, o, WATER_LUT.group, model.group[i] / d.groupRef, 1);
			} else if (mode === 'humidity') {
				const t = Math.max(0, Math.min(1, 0.5 + 1.2 * (model.humidity[i] - humMean) / humMean));
				waterMix(out, o, WATER_LUT.humidity, t, 1);
			} else if (mode === 'rain') {
				waterMix(out, o, WATER_LUT.rain, Math.min(1, model.rain[i] / d.rainRef), 1);
			} else if (mode === 'flow') {
				const mag = model.fluxRate[i];
				const t = Math.sqrt(mag / (mag + d.flowRef));
				const vx = model.fluxX[i] / (mag + 1e-9);
				const vy = model.fluxY[i] / (mag + 1e-9);
				out[o] = 12 + t * (150 + 105 * vx);
				out[o + 1] = 14 + t * (110 + 105 * vy);
				out[o + 2] = 24 + t * (170 - 60 * vx);
			}
		}
	}
}

if (typeof module !== 'undefined') {
	module.exports = { WATER_MODES, WATER_MODE_LABEL, WATER_DISPLAY, WATER_LUT, waterPaint, waterMix };
}
