// Owns: economy inspector snapshot — worker states, gold breakdown, wages, taxes, price/ask gaps, stall flags, history and copy text.
// Edit for: inspector metrics, stall-flag thresholds, worker "why" reasons, history columns and the pasteable stats text.
'use strict';

const DIAG_HISTORY_SECONDS = 10;
const DIAG_HISTORY_ROWS = 32;
const DIAG_STOP_SPEED = 1e-6;
const DIAG_ACTOR_LABELS = ['', 'mine', 'fact', 'town', 'gold'];
const DIAG_HISTORY_COLS = ['t', 'workers', 'walk', 'stopped', 'queued', 'wallet%', 'townG', 'resG', 'coal', 'coalFly', 'coalAsk', 'coalBid', 'wage', 'wages/s', 'taxes/s', 'pop', 'goods'];

class EconomyDiagnostics {
	constructor(model) {
		this.model = model;
		this.walletSort = new Float64Array(WORKER_CAP);
		this.history = new Float64Array(DIAG_HISTORY_ROWS * DIAG_HISTORY_COLS.length);
		this.s = {};
		this.reset();
	}

	reset() {
		this.rows = 0;
		this.stride = Math.round(DIAG_HISTORY_SECONDS / ECONOMY_DT);
		this.lastWages = this.lastTaxes = this.lastTick = 0;
		this.wageRate = this.taxRate = 0;
	}

	// Per-tick hook: only every history stride does real work, so the frame loop stays allocation-free.
	record() {
		const m = this.model;
		if (m.ticks % this.stride) return;
		this.snapshot();
		if (this.rows === DIAG_HISTORY_ROWS) this.halveHistory();
		this.writeRow(this.rows++);
	}

	halveHistory() {
		const cols = DIAG_HISTORY_COLS.length;
		this.rows /= 2;
		this.stride *= 2;
		for (let r = 0; r < this.rows; r++) this.history.copyWithin(r * cols, r * 2 * cols, r * 2 * cols + cols);
	}

	writeRow(r) {
		const s = this.s, cols = DIAG_HISTORY_COLS.length, h = this.history, o = r * cols;
		const values = [s.seconds, s.workers, s.walking, s.stopped, s.queuedFirm, s.walletShare * 100, s.townPurse, s.residentPurse, s.coalTotal, s.coalFlight, s.coalAsk, s.coalBestBuyer, s.wageAtFirms, s.wageRate, s.taxRate, s.pop, s.goodsTotal];
		for (let c = 0; c < cols; c++) h[o + c] = values[c];
	}

	// Rates are measured over the gap since the previous snapshot, so a fast refresh does not zero them.
	updateRates() {
		const m = this.model, money = m.money;
		const dt = (m.ticks - this.lastTick) * ECONOMY_DT;
		if (dt < 1) return;
		this.wageRate = (money.wages - this.lastWages) / dt;
		this.taxRate = (money.taxes - this.lastTaxes) / dt;
		this.lastWages = money.wages;
		this.lastTaxes = money.taxes;
		this.lastTick = m.ticks;
	}

	snapshot() {
		this.updateRates();
		const s = this.s, m = this.model;
		s.seconds = m.ticks * ECONOMY_DT;
		s.wageRate = this.wageRate;
		s.taxRate = this.taxRate;
		this.countActors(s, m);
		this.countWorkers(s, m);
		this.countGold(s, m);
		this.countWages(s, m);
		this.countPrices(s, m, ITEM_COAL, 'coal');
		this.countPrices(s, m, ITEM_GOODS, 'goods');
		s.coalTotal = m.totalItem(ITEM_COAL);
		s.goodsTotal = m.totalItem(ITEM_GOODS);
		s.flags = this.flags(s);
		return s;
	}

	countActors(s, m) {
		s.mines = s.factories = s.towns = s.goldMines = s.young = 0;
		s.pop = s.popCap = s.comfort = s.taxMult = s.restTax = s.blockedTowns = 0;
		s.blockedTown = -1;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = m.actors[i];
			if (a === ECONOMY_MINE) s.mines++;
			else if (a === ECONOMY_FACTORY) s.factories++;
			else if (a === ECONOMY_GOLD) s.goldMines++;
			if (a !== ECONOMY_TOWN) continue;
			s.towns++;
			if (m.settlements.isYoungTown(i)) s.young++;
			s.pop += m.pop[i];
			s.popCap += m.settlements.popCap(i);
			s.comfort += m.workforce.comfortAt(i);
			s.taxMult += m.taxMult[i] || 1;
			s.restTax += m.townRestTax(i);
			if (this.restBlocked(i)) { s.blockedTowns++; s.blockedTown = i; }
		}
		const towns = Math.max(1, s.towns);
		s.comfort /= towns;
		s.taxMult /= towns;
		s.restTax /= towns;
	}

	// Same bound as restWorkers in actors.js: rest stops once the fresh dock reaches the town's work cap.
	restBlocked(i) {
		const m = this.model;
		const workCap = Math.min(1, m.pop[i] * LABOR_PER_POP * BUFFER_SECONDS);
		return m.depleted[i] > 0.5 && m.labor[i] >= workCap - 1e-9;
	}

	countWorkers(s, m) {
		const w = m.workers;
		s.workers = w.count;
		s.workerCap = WORKER_CAP;
		s.fresh = s.tired = s.dockFirm = s.dockTown = s.parked = s.walking = s.moving = s.stopped = s.queuedFirm = s.queuedTown = 0;
		for (let p = 0; p < w.count; p++) {
			if (w.state[p] === STATE_FRESH) s.fresh++;
			else s.tired++;
			const dock = w.dockCell[p];
			if (dock >= 0) {
				if (w.isFirm(dock)) s.dockFirm++;
				else if (m.actors[dock] === ECONOMY_TOWN) s.dockTown++;
				else s.parked++;
				continue;
			}
			s.walking++;
			if (Math.hypot(w.vx[p], w.vy[p]) > DIAG_STOP_SPEED) { s.moving++; continue; }
			s.stopped++;
			const c = w.cellOf(p);
			if (w.isFirm(c)) s.queuedFirm++;
			else if (m.actors[c] === ECONOMY_TOWN) s.queuedTown++;
		}
		s.unemployed = w.unemploymentTotal / WORKER_UNIT;
		s.supplied = m.suppliedLabor;
		s.worked = m.workedLabor;
		s.laborSupplyRate = s.pop * LABOR_PER_POP / WORKER_UNIT;
	}

	// The buckets partition money.total() exactly: municipal + resident + firm purses, docked pool gold,
	// walking wallets and the haul vault. Owed amounts are liabilities and stay outside the sum.
	countGold(s, m) {
		const money = m.money, w = m.workers;
		s.goldTotal = money.total();
		s.townPurse = s.residentPurse = s.firmPurse = s.firmOwed = s.dockedWallets = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			s.dockedWallets += m.workerGoldAt(i);
			if (m.actors[i] === ECONOMY_TOWN) {
				s.townPurse += money.purse[i];
				s.residentPurse += money.workerPurse[i];
				continue;
			}
			s.firmPurse += money.purse[i] + money.workerPurse[i];
			if (m.actors[i]) s.firmOwed += money.owedAt(i);
		}
		s.walkingWallets = w.goldTotal();
		s.vault = money.transportVault;
		s.seeded = money.seeded;
		s.mined = money.mined;
		const wallets = s.dockedWallets + s.walkingWallets;
		s.walletShare = s.goldTotal > 1e-9 ? wallets / s.goldTotal : 0;
		s.walletMean = w.count ? wallets / w.count : 0;
		const sorted = this.walletSort.subarray(0, w.count);
		sorted.set(w.gold.subarray(0, w.count));
		sorted.sort();
		s.walletMedian = w.count ? sorted[w.count >> 1] : 0;
		s.walletMax = w.count ? sorted[w.count - 1] : 0;
		s.walletBroke = 0;
		for (let k = 0; k < w.count; k++) if (sorted[k] < 0.01) s.walletBroke++;
		let unpaid = 0;
		for (let k = 0; k < money.wageClaims.length; k++) unpaid += money.wageClaims[k].amount;
		s.unpaidWages = unpaid;
	}

	countWages(s, m) {
		const o = m.optimizer;
		let firms = 0, bid = 0, field = 0, fieldMax = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) fieldMax = Math.max(fieldMax, m.priceLabor[i]);
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = m.actors[i];
			if (!a || a === ECONOMY_TOWN) continue;
			const recipe = o.recipes[a];
			o.firmBids(i, recipe);
			bid += o.bidOut[recipe.inputs.length - 1];
			field += m.priceLabor[i];
			firms++;
		}
		s.wageBid = firms ? bid / firms : 0;
		s.wageAtFirms = firms ? field / firms : 0;
		s.wageFieldMax = fieldMax;
		s.entryWage = s.wageAtFirms * WORKER_UNIT;
		s.wagesPaid = m.money.wages;
		s.taxesPaid = m.money.taxes;
		s.payPerLabor = m.workedLabor > 1e-9 ? m.money.wages / m.workedLabor : 0;
	}

	// Ask = particle book cost + accrued haulage per unit; a shipment sells only where a buyer's field price clears it.
	countPrices(s, m, k, key) {
		const P = m.particles, price = m.pricesAt(k), buyers = P.buyers[k];
		let sum = 0, best = 0, n = 0, maxField = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			sum += price[i];
			maxField = Math.max(maxField, price[i]);
			if (!(buyers & (1 << m.actors[i]))) continue;
			best = Math.max(best, price[i]);
			n++;
		}
		let count = 0, stopped = 0, amount = 0, factory = 0, haul = 0;
		for (let p = 0; p < P.count; p++) {
			if (P.kind[p] !== k) continue;
			count++;
			amount += P.amount[p];
			factory += P.factoryCost[p];
			haul += P.transportCost[p];
			if (Math.hypot(P.vx[p], P.vy[p]) <= DIAG_STOP_SPEED) stopped++;
		}
		s[key + 'FieldMean'] = sum / ECONOMY_SIZE;
		s[key + 'FieldMax'] = maxField;
		s[key + 'BestBuyer'] = n ? best : 0;
		s[key + 'Particles'] = count;
		s[key + 'Stopped'] = stopped;
		s[key + 'Flight'] = amount;
		s[key + 'Ask'] = amount > 1e-12 ? (factory + haul) / amount : 0;
		s[key + 'BookCost'] = amount > 1e-12 ? factory / amount : 0;
		s[key + 'HaulCost'] = amount > 1e-12 ? haul / amount : 0;
		s[key + 'Spoiled'] = P.spoiled[k];
	}

	flags(s) {
		const out = [];
		const pct = v => `${Math.round(v * 100)}%`;
		if (s.workers >= s.workerCap) out.push(`worker pool at cap ${s.workers}/${s.workerCap}: towns keep turning labor supply (${s.laborSupplyRate.toFixed(1)} workers/s from pop ${s.pop.toFixed(1)}) into persistent workers that never retire`);
		if (s.walking > 20 && s.stopped / s.walking > 0.6) out.push(`${pct(s.stopped / s.walking)} of walkers are stopped (${s.stopped}/${s.walking}); wage slope below dock gate ${WORKER_DOCK_SLOPE.toExponential(1)}`);
		if (s.queuedFirm > 20) out.push(`${s.queuedFirm} walkers queued on full firm cells; the queue counts as held labor, so firm wage bids fall to ${s.wageBid.toFixed(3)} and the wage field flattens`);
		if (s.walletShare > 0.5) out.push(`${pct(s.walletShare)} of all gold sits in worker wallets (mean ${s.walletMean.toFixed(3)} g); it returns only through paid town rest`);
		if (s.towns && s.townPurse + s.residentPurse < 0.05 * s.goldTotal) out.push(`towns hold ${(s.townPurse + s.residentPurse).toFixed(2)} g of ${s.goldTotal.toFixed(2)} g: town bids for coal and goods collapse`);
		if (s.coalFlight > 1 && s.coalAsk > s.coalBestBuyer) out.push(`in-flight coal ask ${s.coalAsk.toFixed(3)} g/u > best buyer price ${s.coalBestBuyer.toFixed(3)} g/u: ${s.coalFlight.toFixed(1)} coal cannot sell; haulage is ${pct(s.coalHaulCost / Math.max(1e-9, s.coalAsk))} of the ask`);
		if (s.goodsFlight > 1 && s.goodsAsk > s.goodsBestBuyer) out.push(`in-flight goods ask ${s.goodsAsk.toFixed(3)} g/u > best town price ${s.goodsBestBuyer.toFixed(3)} g/u`);
		if (s.blockedTowns) out.push(`${s.blockedTowns} town(s) cannot rest anyone, e.g. ${this.model.tracker.place(s.blockedTown)}: fresh dock ${this.model.labor[s.blockedTown].toFixed(2)} fills the work cap and nobody leaves for a job, so tired walkers (${s.queuedTown}) queue outside`);
		if (s.firmOwed > s.firmPurse && s.firmOwed > 1) out.push(`firms owe ${s.firmOwed.toFixed(2)} g but hold ${s.firmPurse.toFixed(2)} g (unpaid wage claims ${s.unpaidWages.toFixed(2)} g)`);
		return out;
	}

	slope(field, alt, mix, i) {
		const steer = this.model.workers.steer;
		return steer.sampleGradient(field, alt, mix, i, -Infinity) ? steer.grad[2] : 0;
	}

	// Mirrors the release/advance rules in workers.js in words, so a stalled worker explains its own stall.
	workerReason(p) {
		const m = this.model, w = m.workers;
		const fresh = w.state[p] === STATE_FRESH;
		const dock = w.dockCell[p];
		const c = dock >= 0 ? dock : w.cellOf(p);
		const gate = WORKER_DOCK_SLOPE;
		const jobSlope = this.slope(m.priceLabor, null, 0, c);
		const homeSlope = this.slope(m.priceHome, m.priceRest, walletWeight(w.gold[p], w.amount[p], m.workforce.refFee), c);
		const jobs = `wage slope ${jobSlope.toExponential(1)}`, home = `home slope ${homeSlope.toExponential(1)}`, vs = ` vs gate ${gate.toExponential(1)}`;
		if (dock >= 0 && w.isFirm(dock)) {
			if (fresh && w.tired[p] < w.amount[p] - w.tired[p]) return 'working a shift at the firm';
			return homeSlope < gate ? `shift done, stuck at firm: ${home}${vs}` : 'shift done, heading home';
		}
		if (dock >= 0) {
			const where = m.actors[dock] === ECONOMY_TOWN ? 'in town' : 'parked in the open';
			if (fresh) return jobSlope < gate ? `idle ${where}: ${jobs}${vs} (no job pull)` : `leaving ${where} for a job`;
			return `resting ${where} · fee ${m.townRestTax(dock).toFixed(3)} g`;
		}
		if (Math.hypot(w.vx[p], w.vy[p]) > DIAG_STOP_SPEED) return fresh ? `walking to a job (${jobs})` : `walking home (${home})`;
		if (w.isFirm(c)) return `queued at a full firm: pool ${m.labor[c].toFixed(2)}/${m.laborFlow.cap[c].toFixed(2)}`;
		if (m.actors[c] === ECONOMY_TOWN) return `queued at a full town: depleted ${m.depleted[c].toFixed(2)}/1`;
		return `stalled in the open: ${fresh ? jobs : home}${vs}`;
	}

	workerText(entry) {
		const m = this.model, w = m.workers, tracker = m.tracker;
		const p = w.byWid(entry.id);
		const wallet = p >= 0 ? w.gold[p] : 0;
		const balance = entry.funded + entry.earned - entry.spent - wallet;
		const lines = [`## watched worker ${entry.name} (#${entry.id}) · ${entry.status}`];
		if (p >= 0) {
			const c = w.dockCell[p] >= 0 ? w.dockCell[p] : w.cellOf(p);
			lines.push(`state=${w.state[p] === STATE_FRESH ? 'fresh' : 'tired'} amount=${w.amount[p].toFixed(3)} tired=${w.tired[p].toFixed(3)} at=${tracker.place(c)} docked=${w.dockCell[p] >= 0}`);
			lines.push(`why=${this.workerReason(p)}`);
			lines.push(`cell_wage=${m.priceLabor[c].toFixed(4)} cell_home=${m.priceHome[c].toFixed(4)} cell_rest=${m.priceRest[c].toFixed(4)}`);
		}
		lines.push(`purse=${wallet.toFixed(4)} unpaid=${m.money.unpaidWages(entry.id).toFixed(4)} granted=${entry.funded.toFixed(3)} earned=${entry.earned.toFixed(4)} spent=${entry.spent.toFixed(4)} ledger=${Math.abs(balance) < 1e-6 ? 'exact' : balance.toExponential(2)}`);
		const stops = Object.keys(entry.stops).map(i => `${tracker.place(Number(i))} visits=${entry.stops[i].visits} tax=${entry.stops[i].tax.toFixed(3)}`);
		if (stops.length) lines.push(`rest_stops: ${stops.join(' | ')}`);
		if (entry.history.length) lines.push(`purse_history(every ${(TRACK_SAMPLE_STRIDE * ECONOMY_DT).toFixed(2)} s, last 12): ${entry.history.slice(-12).map(v => v.toFixed(3)).join(' ')}`);
		lines.push(...entry.events.map(text => `event: ${text}`));
		return lines.join('\n');
	}

	actorRows() {
		const m = this.model, money = m.money, o = m.optimizer, w = m.workers;
		const rows = ['## actors', 'kind  cell    pop/scale labor depl  queue coal   goods  wageBid wageFld coalPx goodsPx purse   resid   owed   profit'];
		const f = (v, n = 6, d = 2) => v.toFixed(d).padStart(n);
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = m.actors[i];
			if (!a) continue;
			let wageBid = 0;
			if (a !== ECONOMY_TOWN) {
				o.firmBids(i, o.recipes[a]);
				wageBid = o.bidOut[o.recipes[a].inputs.length - 1];
			}
			const size = a === ECONOMY_TOWN ? m.pop[i] : m.scale[i];
			rows.push(`${DIAG_ACTOR_LABELS[a].padEnd(5)} ${placeName(i)} ${f(size, 9)} ${f(m.labor[i], 5)} ${f(m.depleted[i], 5)} ${f(w.queuedAt(i), 5)} ${f(m.siteStockAt(ITEM_COAL, i))} ${f(m.siteStockAt(ITEM_GOODS, i))} ${f(wageBid, 7, 3)} ${f(m.priceLabor[i], 7, 3)} ${f(m.priceCoal[i], 6, 3)} ${f(m.priceGoods[i], 7, 3)} ${f(money.purse[i], 7)} ${f(money.workerPurse[i], 7)} ${f(money.owedAt(i))} ${f(m.profit[i], 6, 3)}`);
		}
		return rows.join('\n');
	}

	historyText() {
		const cols = DIAG_HISTORY_COLS.length;
		const lines = [`## history (every ${(this.stride * ECONOMY_DT).toFixed(0)} s)`, DIAG_HISTORY_COLS.map(name => name.padStart(8)).join('')];
		for (let r = 0; r < this.rows; r++) {
			let line = '';
			for (let c = 0; c < cols; c++) {
				const v = this.history[r * cols + c];
				line += (Number.isInteger(v) || Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3)).padStart(8);
			}
			lines.push(line);
		}
		return lines.join('\n');
	}

	text(watched) {
		const s = this.snapshot(), m = this.model;
		const f = (v, d = 3) => v.toFixed(d);
		const sec = Math.floor(s.seconds);
		const lines = [
			`# particle-transfer lab stats · t=${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')} (${m.ticks} ticks) · decay=${m.decay} derived=${m.derived} suppression=${m.suppression}`,
			'## flags',
			...(s.flags.length ? s.flags.map(t => `- ${t}`) : ['- none']),
			'## actors & towns',
			`mines=${s.mines} factories=${s.factories} towns=${s.towns} young=${s.young} gold_mines=${s.goldMines} pop=${f(s.pop, 2)}/${f(s.popCap, 1)} comfort=${f(s.comfort)} tax_mult=${f(s.taxMult)} rest_tax=${f(s.restTax)}`,
			'## workers',
			`count=${s.workers}/${s.workerCap} fresh=${s.fresh} tired=${s.tired} docked_firm=${s.dockFirm} docked_town=${s.dockTown} parked=${s.parked} walking=${s.walking} moving=${s.moving} stopped=${s.stopped} queued_firm=${s.queuedFirm} queued_town=${s.queuedTown} unemployed=${f(s.unemployed, 1)}`,
			`labor_supplied=${f(s.supplied, 2)} labor_worked=${f(s.worked, 2)} town_supply_rate=${f(s.laborSupplyRate, 2)} workers/s`,
			'## gold',
			`total=${f(s.goldTotal)} seeded=${f(s.seeded)} mined=${f(s.mined)} town_purse=${f(s.townPurse)} resident_purse=${f(s.residentPurse)} firm_purse=${f(s.firmPurse)} docked_wallets=${f(s.dockedWallets)} walking_wallets=${f(s.walkingWallets)} haul_vault=${f(s.vault)}`,
			`wallet_share=${f(s.walletShare * 100, 1)}% wallet_mean=${f(s.walletMean, 4)} wallet_median=${f(s.walletMedian, 4)} wallet_max=${f(s.walletMax)} broke_workers=${s.walletBroke} firm_owed=${f(s.firmOwed)} unpaid_wage_claims=${f(s.unpaidWages)}`,
			'## wages & taxes',
			`wage_bid_at_firms=${f(s.wageBid, 4)} wage_field_at_firms=${f(s.wageAtFirms, 4)} wage_field_max=${f(s.wageFieldMax, 4)} entry_wage_per_worker=${f(s.entryWage, 4)} pay_per_labor_unit=${f(s.payPerLabor, 4)}`,
			`wages_paid=${f(s.wagesPaid, 2)} taxes_paid=${f(s.taxesPaid, 2)} wages_rate=${f(s.wageRate, 4)} g/s taxes_rate=${f(s.taxRate, 4)} g/s`,
			'## prices (field = diffused buyer bid, ask = in-flight unit cost + haulage)'
		];
		for (const key of ['coal', 'goods']) {
			lines.push(`${key}: total=${f(s[key + 'Total'], 2)} in_flight=${f(s[key + 'Flight'], 2)} particles=${s[key + 'Particles']} stopped=${s[key + 'Stopped']} field_mean=${f(s[key + 'FieldMean'], 4)} field_max=${f(s[key + 'FieldMax'], 4)} best_buyer=${f(s[key + 'BestBuyer'], 4)} ask=${f(s[key + 'Ask'], 4)} book=${f(s[key + 'BookCost'], 4)} haul=${f(s[key + 'HaulCost'], 4)} spoiled=${f(s[key + 'Spoiled'], 2)}`);
		}
		lines.push(`flows: coal_made=${f(m.producedCoal, 2)} coal_burned=${f(m.burnedCoal, 2)} goods_made=${f(m.producedGoods, 2)} goods_eaten=${f(m.consumedGoods, 2)} deliveries=${m.particles.deliveries} realized_profit=${f(m.particles.realizedProfit, 2)}`);
		for (const entry of watched) lines.push(this.workerText(entry));
		lines.push(this.actorRows(), this.historyText());
		return lines.join('\n');
	}
}

if (typeof module === 'object') module.exports = { EconomyDiagnostics };
