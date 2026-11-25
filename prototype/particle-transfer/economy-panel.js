// Owns: economy inspector panel — grouped averages for workers, gold, wages and prices, stall flags and the copy-all-stats button.
// Edit for: which snapshot fields show as rows, row labels and the clipboard fallback. Metrics themselves: diagnostics.js.
'use strict';

const ECONOMY_PANEL_ROWS = [
	['Workers', [
		['Workers', s => `${s.workers} / ${s.workerCap}`, s => s.workers >= s.workerCap],
		['Fresh · tired', s => `${s.fresh} · ${s.tired}`],
		['Docked firm · town', s => `${s.dockFirm} · ${s.dockTown}${s.parked ? ` · ${s.parked} open` : ''}`],
		['Walking · moving', s => `${s.walking} · ${s.moving}`],
		['Stopped walkers', s => `${s.stopped}`, s => s.walking > 20 && s.stopped / s.walking > 0.6],
		['Queued at firms', s => `${s.queuedFirm}`, s => s.queuedFirm > 20],
		['Unemployed', s => s.unemployed.toFixed(1)],
		['Town supply', s => `${s.laborSupplyRate.toFixed(2)} /s`]
	]],
	['Gold', [
		['Gold total', s => `${s.goldTotal.toFixed(2)} g`],
		['Town · residents', s => `${s.townPurse.toFixed(2)} · ${s.residentPurse.toFixed(2)} g`, s => s.towns && s.townPurse + s.residentPurse < 0.05 * s.goldTotal],
		['Worker wallets', s => `${(s.dockedWallets + s.walkingWallets).toFixed(2)} g · ${Math.round(s.walletShare * 100)}%`, s => s.walletShare > 0.5],
		['Wallet mean · median', s => `${s.walletMean.toFixed(3)} · ${s.walletMedian.toFixed(3)}`],
		['Broke workers', s => `${s.walletBroke}`],
		['Firms held · owed', s => `${s.firmPurse.toFixed(2)} · ${s.firmOwed.toFixed(2)} g`, s => s.firmOwed > s.firmPurse && s.firmOwed > 1],
		['Haul vault', s => `${s.vault.toFixed(2)} g`]
	]],
	['Wages & taxes', [
		['Wage bid at firms', s => `${s.wageBid.toFixed(3)} g/u`],
		['Wage field firms · max', s => `${s.wageAtFirms.toFixed(3)} · ${s.wageFieldMax.toFixed(3)}`],
		['Entry wage / worker', s => `${s.entryWage.toFixed(4)} g`],
		['Pay per labor unit', s => `${s.payPerLabor.toFixed(3)} g`],
		['Wages · taxes rate', s => `${s.wageRate.toFixed(3)} · ${s.taxRate.toFixed(3)} g/s`],
		['Rest tax · tax mult', s => `${s.restTax.toFixed(3)} · ${s.taxMult.toFixed(2)}`],
		['Pop · comfort', s => `${s.pop.toFixed(1)} · ${s.comfort.toFixed(2)}`]
	]],
	['Prices', [
		['Coal best buyer', s => `${s.coalBestBuyer.toFixed(3)} g/u`],
		['Coal ask in flight', s => `${s.coalAsk.toFixed(3)} g/u`, s => s.coalFlight > 1 && s.coalAsk > s.coalBestBuyer],
		['Coal haul · book', s => `${s.coalHaulCost.toFixed(3)} · ${s.coalBookCost.toFixed(3)}`],
		['Coal flying · stopped', s => `${s.coalFlight.toFixed(1)} u · ${s.coalStopped}/${s.coalParticles}`],
		['Goods best town', s => `${s.goodsBestBuyer.toFixed(3)} g/u`],
		['Goods ask in flight', s => `${s.goodsAsk.toFixed(3)} g/u`, s => s.goodsFlight > 1 && s.goodsAsk > s.goodsBestBuyer],
		['Goods flying', s => `${s.goodsFlight.toFixed(2)} u · ${s.goodsParticles} p`]
	]]
];

class EconomyPanel {
	constructor(diagnostics, watched) {
		this.diagnostics = diagnostics;
		this.watched = watched;
		this.props = $('economy-props');
		this.flagList = $('economy-flags');
		this.status = $('economy-copy-state');
		$('economy-copy').addEventListener('click', () => this.copy());
	}

	refresh() {
		const s = this.diagnostics.snapshot();
		let html = '';
		for (const [title, rows] of ECONOMY_PANEL_ROWS) {
			html += `<h3>${title}</h3>`;
			for (const [label, value, alarm] of rows) html += `<div${alarm && alarm(s) ? ' class="off"' : ''}><span>${label}</span><strong>${value(s)}</strong></div>`;
		}
		this.props.innerHTML = html;
		this.flagList.innerHTML = s.flags.length ? s.flags.map(text => `<li>${text}</li>`).join('') : '<li class="calm">No stall detected.</li>';
	}

	async copy() {
		const text = this.diagnostics.text(this.watched());
		const lines = text.split('\n').length;
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// file:// pages in some browsers lack clipboard permission; a selected textarea still copies.
			const area = document.createElement('textarea');
			area.value = text;
			document.body.append(area);
			area.select();
			document.execCommand('copy');
			area.remove();
		}
		this.status.textContent = `Copied ${lines} lines`;
	}
}

if (typeof module === 'object') module.exports = { EconomyPanel };
