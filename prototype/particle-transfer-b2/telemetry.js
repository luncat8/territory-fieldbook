// Owns: sparkline histories, live conservation balance sheet and the watched-worker inspector readout.
// Edit for: ledger counters, particle stock totals and watched-worker event formatting.
'use strict';

class EconomyTelemetry {
	constructor() {
		this.cards = Array.from(document.querySelectorAll('.metric'), card => {
			const canvas = card.querySelector('canvas');
			return { canvas, ctx: canvas.getContext('2d'), label: card.querySelector('strong'), samples: new Float64Array(64), color: getComputedStyle(card.querySelector('.icon')).color };
		});
		this.values = new Float64Array(this.cards.length);
		this.relief = new FieldRelief($('field-relief'));
		this.clock = $('sim-time');
		this.coalMade = $('coal-made');
		this.coalBurned = $('coal-burned');
		this.coalHeld = $('coal-held');
		this.goodsMade = $('goods-made');
		this.goodsEaten = $('goods-eaten');
		this.goodsSpoiled = $('goods-spoiled');
		this.goodsHeld = $('goods-held');
		this.foodBalance = $('food-balance');
		this.woodBalance = $('wood-balance');
		this.headSeeded = $('head-seeded');
		this.headBirths = $('head-births');
		this.headDeaths = $('head-deaths');
		this.headActive = $('head-active');
		this.tiredWorked = $('tired-worked');
		this.tiredRested = $('tired-rested');
		this.tiredHeld = $('tired-held');
		this.goldSeeded = $('gold-seeded');
		this.goldMined = $('gold-mined');
		this.goldHeld = $('gold-held');
		this.workerCarried = $('worker-carried');
		this.vaultHeld = $('vault-held');
		this.forageGarden = $('forage-garden');
		this.forageWild = $('forage-wild');
	}

	reset(model) {
		this.count = 0;
		this.stride = 15;
		this.record(model);
	}

	measure(model) {
		let coal = model.goodsPool.spawnBufferTotal(ITEM_COAL) + model.goodsPool.inTransitTotal(ITEM_COAL);
		let goods = model.goodsPool.spawnBufferTotal(ITEM_GOODS) + model.goodsPool.inTransitTotal(ITEM_GOODS);
		let coalPrice = 0, goodsPrice = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			coal += model.coal[i];
			goods += model.goods[i];
			coalPrice += model.priceCoal[i];
			goodsPrice += model.priceGoods[i];
		}
		this.values[0] = coal;
		this.values[1] = goods;
		this.values[2] = coalPrice / ECONOMY_SIZE;
		this.values[3] = goodsPrice / ECONOMY_SIZE;
		this.values[4] = model.money.total();
	}

	record(model) {
		if (model.ticks % this.stride) return;
		if (this.count === this.cards[0].samples.length) {
			this.count /= 2;
			this.stride *= 2;
			for (const card of this.cards) for (let i = 0; i < this.count; i++) card.samples[i] = card.samples[i * 2];
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
			ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
			card.fill = ctx.createLinearGradient(0, 0, 0, card.h);
			card.fill.addColorStop(0, card.color);
			card.fill.addColorStop(1, 'transparent');
		}
	}

	refresh(model) {
		this.relief.draw(model.priceGoods);
		this.measure(model);
		for (let i = 0; i < this.cards.length; i++) {
			const card = this.cards[i];
			card.label.textContent = this.values[i].toFixed(2);
			this.sparkline(card);
		}
		this.coalMade.textContent = model.producedCoal.toFixed(3);
		this.coalBurned.textContent = (model.burnedCoal + model.goodsPool.spoiled[ITEM_COAL]).toFixed(3);
		this.coalHeld.textContent = this.values[0].toFixed(3);
		this.goodsMade.textContent = model.producedGoods.toFixed(3);
		this.goodsEaten.textContent = model.consumedGoods.toFixed(3);
		this.goodsSpoiled.textContent = model.goodsPool.spoiled[ITEM_GOODS].toFixed(3);
		this.goodsHeld.textContent = this.values[1].toFixed(3);
		let foodHeld = model.goodsPool.spawnBufferTotal(ITEM_FOOD) + model.goodsPool.inTransitTotal(ITEM_FOOD);
		for (let i = 0; i < ECONOMY_SIZE; i++) foodHeld += model.food[i];
		this.foodBalance.textContent = `${model.producedFood.toFixed(3)} harvested − ${model.consumedFood.toFixed(3)} sold − ${model.goodsPool.spoiled[ITEM_FOOD].toFixed(3)} spoiled ≈ ${foodHeld.toFixed(3)} held+transit`;
		let woodHeld = model.goodsPool.spawnBufferTotal(ITEM_WOOD) + model.goodsPool.inTransitTotal(ITEM_WOOD);
		for (let i = 0; i < ECONOMY_SIZE; i++) woodHeld += model.wood[i];
		this.woodBalance.textContent = `${model.seededWood.toFixed(3)} seeded + ${model.producedWood.toFixed(3)} felled − ${model.consumedWood.toFixed(3)} built − ${model.goodsPool.spoiled[ITEM_WOOD].toFixed(3)} spoiled ≈ ${woodHeld.toFixed(3)} held+transit`;
		this.headSeeded.textContent = model.workers.seededWorkers.toFixed(0);
		this.headBirths.textContent = model.workers.births.toFixed(0);
		this.headDeaths.textContent = model.workerLife.deaths.toFixed(0);
		this.headActive.textContent = model.workers.totalAmount().toFixed(0);
		this.tiredWorked.textContent = (model.workers.seededTired + model.workedLabor).toFixed(2);
		this.tiredRested.textContent = (model.restedDepleted + model.workerLife.removedTired).toFixed(2);
		this.tiredHeld.textContent = model.workers.totalTired().toFixed(2);
		this.goldSeeded.textContent = model.money.initial.toFixed(2);
		this.goldMined.textContent = model.money.mined.toFixed(2);
		this.goldHeld.textContent = this.values[4].toFixed(2);
		this.workerCarried.textContent = model.workers.totalGold().toFixed(2);
		this.vaultHeld.textContent = (model.money.transport + model.money.custody).toFixed(2);
		this.forageGarden.textContent = model.forage.gardenFed.toFixed(2);
		this.forageWild.textContent = model.forage.wildPicked.toFixed(2);
		const seconds = Math.floor(model.ticks * ECONOMY_DT);
		this.clock.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
	}

	sparkline(card) {
		const { ctx: g, samples, w, h, color } = card;
		const n = this.count;
		g.clearRect(0, 0, w, h);
		if (n < 2) return;
		let peak = 0.00001;
		for (let i = 0; i < n; i++) peak = Math.max(peak, samples[i]);
		const dx = (w - 5) / (n - 1), scale = (h - 8) / peak;
		g.lineWidth = 1.35; g.strokeStyle = color; g.beginPath();
		for (let i = 0; i < n; i++) {
			const x = 2 + i * dx, y = h - 3 - samples[i] * scale;
			if (!i) g.moveTo(x, y); else g.lineTo(x, y);
		}
		g.stroke(); g.lineTo(w - 3, h); g.lineTo(2, h); g.closePath(); g.fillStyle = card.fill; g.globalAlpha = 0.22; g.fill(); g.globalAlpha = 1;
		g.beginPath(); g.arc(w - 3, h - 3 - samples[n - 1] * scale, 1.8, 0, Math.PI * 2); g.fillStyle = color; g.fill();
	}
}

if (typeof module === 'object') module.exports = { EconomyTelemetry };
