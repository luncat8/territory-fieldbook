// Owns: measured session histories, throughput readouts and the live balance sheet.
'use strict';

class EconomyTelemetry {
	constructor() {
		this.cards = Array.from(document.querySelectorAll('.metric'), card => {
			const canvas = card.querySelector('canvas');
			return { canvas, ctx:canvas.getContext('2d'), label:card.querySelector('strong'), samples:new Float64Array(64), color:getComputedStyle(card.querySelector('.icon')).color };
		});
		this.values = new Float64Array(4);
		this.relief = new FieldRelief($('field-relief'));
		this.clock = $('sim-time');
		this.made = $('made-total');
		this.used = $('consumed-total');
		this.held = $('held-total');
	}

	reset(model) {
		this.count = 0;
		this.stride = 15;
		this.record(model);
	}

	measure(model) {
		let stock = 0, demand = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) { stock += model.stock[i]; demand += model.demand[i]; }
		this.values[0] = stock;
		this.values[1] = demand / ECONOMY_SIZE;
		this.values[2] = model.productionRate;
		this.values[3] = model.uptakeRate;
	}

	record(model) {
		if (model.ticks % this.stride) return;
		// Retain the whole experiment, including cold start, in a bounded sample buffer.
		if (this.count === this.cards[0].samples.length) {
			this.count /= 2;
			this.stride *= 2;
			for (const card of this.cards) for (let i = 0; i < this.count; i++) card.samples[i] = card.samples[i*2];
		}
		this.measure(model);
		for (let i = 0; i < this.cards.length; i++) this.cards[i].samples[this.count] = this.values[i];
		this.count++;
	}

	fit() {
		this.relief.fit();
		const ratio = Math.min(3, window.devicePixelRatio || 1);
		for (const card of this.cards) {
			const { canvas, ctx } = card;
			card.w = canvas.clientWidth; card.h = canvas.clientHeight;
			canvas.width = Math.round(card.w * ratio); canvas.height = Math.round(card.h * ratio);
			ctx.setTransform(ratio,0,0,ratio,0,0);
			card.fill = ctx.createLinearGradient(0,0,0,card.h);
			card.fill.addColorStop(0,card.color);
			card.fill.addColorStop(1,'transparent');
		}
	}

	refresh(model) {
		this.relief.draw(model.demand);
		this.measure(model);
		for (let i = 0; i < this.cards.length; i++) {
			const card = this.cards[i];
			card.label.textContent = this.values[i].toFixed(2);
			this.sparkline(card);
		}
		this.made.textContent = model.produced.toFixed(3);
		this.used.textContent = model.consumed.toFixed(3);
		this.held.textContent = this.values[0].toFixed(3);
		const seconds = Math.floor(model.ticks * ECONOMY_DT);
		this.clock.textContent = `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
	}

	sparkline(card) {
		const { ctx:g, samples, w, h, color } = card;
		const n = this.count;
		g.clearRect(0,0,w,h);
		if (n < 2) return;
		let peak = 0.00001;
		for (let i = 0; i < n; i++) peak = Math.max(peak,samples[i]);
		const dx = (w-5)/(n-1), scale = (h-8)/peak;
		g.lineWidth = 1.35; g.strokeStyle = color; g.beginPath();
		for (let i = 0; i < n; i++) {
			const x = 2+i*dx, y = h-3-samples[i]*scale;
			if (!i) g.moveTo(x,y); else g.lineTo(x,y);
		}
		g.stroke(); g.lineTo(w-3,h); g.lineTo(2,h); g.closePath(); g.fillStyle = card.fill; g.globalAlpha = 0.22; g.fill(); g.globalAlpha = 1;
		g.beginPath(); g.arc(w-3,h-3-samples[n-1]*scale,1.8,0,Math.PI*2); g.fillStyle = color; g.fill();
	}
}
