// owns: canvas field plots, flow/source vector overlay and pointer-to-cell mapping
// edit for: display options, arrow density, hover readouts
'use strict';

class WaterPlot {
	constructor(canvas, overlay) {
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d', { alpha: false });
		this.overlay = overlay || null;
		this.octx = overlay ? overlay.getContext('2d') : null;
		this.image = null;
		this.cellSize = 0;
	}

	bind(model) {
		this.canvas.width = model.width;
		this.canvas.height = model.rows;
		this.image = this.ctx.createImageData(model.width, model.rows);
		if (this.overlay) {
			this.overlay.width = model.width * 8;
			this.overlay.height = model.rows * 8;
			this.cellSize = 8;
		}
	}

	paint(model, mode, showRain) {
		if (!this.image) return;
		waterPaint(model, mode, this.image.data, showRain);
		this.ctx.putImageData(this.image, 0, 0);
	}

	vectors(model, showFlow, showSprings) {
		if (!this.octx) return;
		const g = this.octx;
		const s = this.cellSize;
		g.clearRect(0, 0, this.overlay.width, this.overlay.height);
		if (showFlow) {
			g.strokeStyle = 'rgba(198, 236, 255, 0.75)';
			g.lineWidth = 1;
			g.beginPath();
			for (let y = 1; y < model.rows - 1; y += 2) {
				for (let x = 1; x < model.width - 1; x += 2) {
					const i = y * model.width + x;
					if (model.sea[i] || model.fluxRate[i] < 0.05) continue;
					const mag = model.fluxRate[i];
					const len = Math.min(1, mag / 2) * s * 0.9;
					const fx = model.fluxX[i];
					const fy = model.fluxY[i];
					const norm = Math.hypot(fx, fy);
					if (norm < 1e-9) continue;
					const cx = (x + 0.5) * s;
					const cy = (y + 0.5) * s;
					const dx = fx / norm * len;
					const dy = fy / norm * len;
					g.moveTo(cx - dx * 0.5, cy - dy * 0.5);
					g.lineTo(cx + dx * 0.5, cy + dy * 0.5);
				}
			}
			g.stroke();
		}
		if (showSprings) {
			g.fillStyle = 'rgba(255, 238, 168, 0.95)';
			g.beginPath();
			for (let k = 0; k < model.springCount; k++) {
				const i = model.springs[k];
				const x = (i % model.width + 0.5) * s;
				const y = (((i / model.width) | 0) + 0.5) * s;
				g.moveTo(x + 2.2 * s / 8, y);
				g.arc(x, y, 2.2 * s / 8, 0, Math.PI * 2);
			}
			g.fill();
		}
	}

	cellAt(event, model) {
		const box = this.canvas.getBoundingClientRect();
		if (box.width <= 0 || box.height <= 0) return -1;
		const x = Math.floor((event.clientX - box.left) / box.width * model.width);
		const y = Math.floor((event.clientY - box.top) / box.height * model.rows);
		if (x < 0 || y < 0 || x >= model.width || y >= model.rows) return -1;
		return y * model.width + x;
	}
}

class WaterSpark {
	constructor(canvas, color) {
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d');
		this.color = color;
		this.values = new Float64Array(120);
		this.count = 0;
	}

	push(value) {
		if (this.count < this.values.length) this.values[this.count++] = value;
		else {
			this.values.copyWithin(0, 1);
			this.values[this.values.length - 1] = value;
		}
	}

	reset() {
		this.count = 0;
	}

	draw() {
		const g = this.ctx;
		const w = this.canvas.width;
		const h = this.canvas.height;
		g.clearRect(0, 0, w, h);
		if (this.count < 2) return;
		let max = 1e-9;
		for (let k = 0; k < this.count; k++) if (this.values[k] > max) max = this.values[k];
		g.strokeStyle = this.color;
		g.lineWidth = 1.5;
		g.beginPath();
		for (let k = 0; k < this.count; k++) {
			const x = k / (this.values.length - 1) * w;
			const y = h - 3 - (this.values[k] / max) * (h - 8);
			if (k === 0) g.moveTo(x, y);
			else g.lineTo(x, y);
		}
		g.stroke();
	}
}

if (typeof module !== 'undefined') module.exports = { WaterPlot, WaterSpark };
