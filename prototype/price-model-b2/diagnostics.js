// Owns: economy inspector snapshot for the cell B2 lab — stock and flow totals, gold buckets, stall flags, history and copy text.
// Edit for: inspector metrics, stall-flag thresholds, history columns and the pasteable stats text.
'use strict';

const DIAG_HISTORY_SECONDS = 10;
const DIAG_HISTORY_ROWS = 32;
const DIAG_ACTOR_LABELS = ['', 'mine', 'fact', 'town', 'gold', 'saw', 'farm'];
const DIAG_HISTORY_COLS = ['t', 'fresh', 'labor', 'depleted', 'away', 'coal', 'coalFly', 'goods', 'goodsFly', 'wage', 'wages/s', 'taxes/s', 'townG', 'firmG', 'food', 'wood'];

class EconomyDiagnostics {
	constructor(model) {
		this.model = model;
		this.history = new Float64Array(DIAG_HISTORY_ROWS * DIAG_HISTORY_COLS.length);
		this.s = {};
		this.reset();
	}

	reset() {
		this.rows = 0;
		this.stride = Math.round(DIAG_HISTORY_SECONDS / ECONOMY_DT);
	}

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
		const values = [s.seconds, s.fresh, s.labor, s.depleted, s.away, s.coalHeld, s.coalInFlight, s.goodsHeld, s.goodsInFlight, s.wageFieldMax, s.wageRate, s.taxRate, s.townPurse, s.firmPurse, s.foodHeld, s.woodHeld];
		for (let c = 0; c < cols; c++) h[o + c] = values[c];
	}

	snapshot() {
		const s = this.s, m = this.model, money = m.money;
		s.seconds = m.ticks * ECONOMY_DT;
		this.countActors(s, m);
		this.countPeople(s, m);
		this.countGold(s, m);
		this.countPrices(s, m);
		s.wageRate = money.wageRate;
		s.taxRate = money.taxRate;
		s.mineRate = money.mineRate;
		s.flags = this.flags(s);
		return s;
	}

	countActors(s, m) {
		s.mines = s.factories = s.towns = s.sawmills = s.farms = 0;
		s.pop = s.rooms = 0;
		s.townFood = s.townCoal = s.townGoods = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = m.actors[i];
			if (a === ECONOMY_MINE) s.mines++;
			else if (a === ECONOMY_FACTORY) s.factories++;
			else if (a === ECONOMY_SAWMILL) s.sawmills++;
			else if (a === ECONOMY_FARM) s.farms++;
			if (a !== ECONOMY_TOWN) continue;
			s.towns++;
			s.pop += m.pop[i];
			s.rooms += m.rooms[i];
			s.townFood += m.food[i];
			s.townCoal += m.coal[i];
			s.townGoods += m.goods[i];
		}
	}

	countPeople(s, m) {
		let fresh = 0, labor = 0, depleted = 0, away = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			fresh += m.fresh[i];
			labor += m.labor[i];
			depleted += m.depleted[i];
			away += m.away[i];
		}
		s.fresh = fresh;
		s.labor = labor;
		s.depleted = depleted;
		s.away = away;
		s.people = fresh + labor + depleted;
		s.suppliedLabor = m.suppliedLabor;
		s.workedLabor = m.workedLabor;
		s.emittedDepleted = m.emittedDepleted;
		s.restedDepleted = m.restedDepleted;
		s.seededWorkers = m.seededWorkers;
		s.splitWorkers = m.splitWorkers;
		s.starvedWorkers = m.starvedWorkers;
		s.laborInFlight = sumRequests(m.laborFlow);
		s.depletedInFlight = sumRequests(m.depletedFlow);
	}

	// Buckets partition money.total() exactly: town purses, firm purses, resident purses, carried wallet gold and stream coins.
	countGold(s, m) {
		const money = m.money;
		s.goldTotal = money.total();
		s.townPurse = s.firmPurse = s.workerPurse = s.carried = s.coins = s.firmOwed = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (m.actors[i] === ECONOMY_TOWN) s.townPurse += money.purse[i];
			else if (m.actors[i]) { s.firmPurse += money.purse[i]; s.firmOwed += money.owedAt(i); }
			s.workerPurse += money.workerPurse[i];
		}
		for (let k = 0; k < money.streams.length; k++) {
			const coin = money.streams[k].coin;
			for (let i = 0; i < ECONOMY_SIZE; i++) s.coins += coin[i];
		}
		for (let i = 0; i < ECONOMY_SIZE; i++) s.carried += m.workerGoldAt(i);
		s.seeded = money.seeded;
		s.mined = money.mined;
		s.settled = money.settled;
		s.wagesPaid = money.wages;
		s.taxesPaid = money.taxes;
		s.walletShare = s.goldTotal > 1e-9 ? s.carried / s.goldTotal : 0;
	}

	countPrices(s, m) {
		let coalSum = 0, coalMax = 0, coalBest = 0, goodsSum = 0, goodsMax = 0, goodsBest = 0;
		let wageSum = 0, wageMax = 0, wageCells = 0;
		let coalHeld = 0, goodsHeld = 0, foodHeld = 0, woodHeld = 0, laborHeld = 0;
		let coalInFlight = 0, goodsInFlight = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const pc = m.priceCoal[i], pg = m.priceGoods[i], pl = m.priceLabor[i];
			coalSum += pc; goodsSum += pg;
			if (pc > coalMax) coalMax = pc;
			if (pg > goodsMax) goodsMax = pg;
			if (pl > 0) { wageSum += pl; wageCells++; if (pl > wageMax) wageMax = pl; }
			const a = m.actors[i];
			if ((a === ECONOMY_FACTORY || a === ECONOMY_TOWN) && pc > coalBest) coalBest = pc;
			if (a === ECONOMY_TOWN && pg > goodsBest) goodsBest = pg;
			coalHeld += m.coal[i];
			goodsHeld += m.goods[i];
			foodHeld += m.food[i];
			woodHeld += m.wood[i];
			laborHeld += m.labor[i];
		}
		coalInFlight = sumRequests(m.coalFlow);
		goodsInFlight = sumRequests(m.goodsFlow);
		s.coalFieldMean = coalSum / ECONOMY_SIZE;
		s.coalFieldMax = coalMax;
		s.coalBestBuyer = coalBest;
		s.goodsFieldMean = goodsSum / ECONOMY_SIZE;
		s.goodsFieldMax = goodsMax;
		s.goodsBestBuyer = goodsBest;
		s.wageFieldMean = wageCells ? wageSum / wageCells : 0;
		s.wageFieldMax = wageMax;
		s.coalHeld = coalHeld;
		s.goodsHeld = goodsHeld;
		s.foodHeld = foodHeld;
		s.woodHeld = woodHeld;
		s.laborHeld = laborHeld;
		s.coalInFlight = coalInFlight;
		s.goodsInFlight = goodsInFlight;
		s.coalMade = m.producedCoal;
		s.coalBurned = m.burnedCoal;
		s.goodsMade = m.producedGoods;
		s.goodsEaten = m.consumedGoods;
		s.foodMade = m.producedFood;
		s.woodMade = m.producedWood;
		s.woodUsed = m.harvest.usedWood + m.harvest.builtWood;
		s.foodEaten = m.harvest.eatenFood;
	}

	flags(s) {
		const out = [];
		const pct = v => `${Math.round(v * 100)}%`;
		if (!s.towns) out.push('no towns left: nobody buys coal or goods, so every firm bid collapses to zero');
		if (s.coalInFlight > 1 && s.coalBestBuyer <= 0) out.push(`${s.coalInFlight.toFixed(1)} coal in flight with no buyer bid on the field: it can only pile up`);
		if (s.goodsInFlight > 1 && s.goodsBestBuyer <= 0) out.push(`${s.goodsInFlight.toFixed(1)} goods in flight with no town bid`);
		if (s.people > 30 && s.wageFieldMax <= 0) out.push(`${s.people.toFixed(1)} residents and no wage pull anywhere: labor circulates without pay`);
		if (s.depleted > 20) out.push(`${s.depleted.toFixed(1)} tired walkers waiting: rest capacity lags the shift cycle`);
		if (s.towns && s.townFood < 0.05 * Math.max(1, s.pop)) out.push(`towns hold ${s.townFood.toFixed(2)} food for ${s.pop.toFixed(0)} residents: bazaars starve`);
		if (s.firmOwed > 1 && s.firmPurse < 1) out.push(`firms owe ${s.firmOwed.toFixed(2)} g back-pay but hold ${s.firmPurse.toFixed(2)} g`);
		if (s.walletShare > 0.5) out.push(`${pct(s.walletShare)} of gold rides in carried worker wallets`);
		if (s.laborInFlight > 5 && s.wageRate <= 0) out.push(`${s.laborInFlight.toFixed(1)} labor in flight but no wages paid on this stride`);
		return out;
	}

	text() {
		const s = this.snapshot(), m = this.model;
		const f = (v, d = 3) => v.toFixed(d);
		const sec = Math.floor(s.seconds);
		const lines = [
			`# price-model B2 stats · t=${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')} (${m.ticks} ticks) · decay=${m.decay} derived=${m.derived} suppression=${m.suppression} wrap=${typeof MAP_WRAP !== 'undefined' ? MAP_WRAP : '?'}`,
			'## flags',
			...(s.flags.length ? s.flags.map(t => `- ${t}`) : ['- none']),
			'## actors & towns',
			`mines=${s.mines} factories=${s.factories} towns=${s.towns} sawmills=${s.sawmills} farms=${s.farms} pop=${f(s.pop, 1)}/${f(s.rooms, 1)} town_food=${f(s.townFood)} town_coal=${f(s.townCoal)} town_goods=${f(s.townGoods)}`,
			'## people',
			`fresh=${f(s.fresh)} labor=${f(s.labor)} depleted=${f(s.depleted)} away=${f(s.away)} total=${f(s.people)} supplied=${f(s.suppliedLabor)} worked=${f(s.workedLabor)} emitted=${f(s.emittedDepleted)} rested=${f(s.restedDepleted)}`,
			`seeded=${f(s.seededWorkers)} split=${f(s.splitWorkers)} starved=${f(s.starvedWorkers)} labor_in_flight=${f(s.laborInFlight)} depleted_in_flight=${f(s.depletedInFlight)}`,
			'## gold',
			`total=${f(s.goldTotal)} seeded=${f(s.seeded)} mined=${f(s.mined)} settled=${f(s.settled)} town_purse=${f(s.townPurse)} firm_purse=${f(s.firmPurse)} resident_purse=${f(s.workerPurse)} carried=${f(s.carried)} stream_coins=${f(s.coins)}`,
			`wallet_share=${f(s.walletShare * 100, 1)}% firm_owed=${f(s.firmOwed)} wages_paid=${f(s.wagesPaid, 2)} taxes_paid=${f(s.taxesPaid, 2)} wage_rate=${f(s.wageRate, 4)} g/s tax_rate=${f(s.taxRate, 4)} g/s mine_rate=${f(s.mineRate, 4)} g/s`,
			'## prices (field = diffused bid, best = strongest buyer cell)',
			`coal: held=${f(s.coalHeld)} in_flight=${f(s.coalInFlight)} field_mean=${f(s.coalFieldMean, 4)} field_max=${f(s.coalFieldMax, 4)} best_buyer=${f(s.coalBestBuyer, 4)} made=${f(s.coalMade, 2)} burned=${f(s.coalBurned, 2)}`,
			`goods: held=${f(s.goodsHeld)} in_flight=${f(s.goodsInFlight)} field_mean=${f(s.goodsFieldMean, 4)} field_max=${f(s.goodsFieldMax, 4)} best_buyer=${f(s.goodsBestBuyer, 4)} made=${f(s.goodsMade, 2)} eaten=${f(s.goodsEaten, 2)}`,
			`labor: held=${f(s.laborHeld)} wage_field_mean=${f(s.wageFieldMean, 4)} wage_field_max=${f(s.wageFieldMax, 4)}`,
			'## flows & matter',
			`food: held=${f(s.foodHeld)} made=${f(s.foodMade, 2)} eaten=${f(s.foodEaten, 2)} · wood: held=${f(s.woodHeld)} made=${f(s.woodMade, 2)} used=${f(s.woodUsed, 2)}`,
			this.actorRows(),
			this.historyText()
		];
		return lines.join('\n');
	}

	actorRows() {
		const m = this.model, money = m.money;
		const rows = ['## actors', 'kind  cell    coal   goods  labor  depl   food   priceCoal priceGoods purse   owed'];
		const f = (v, n = 7, d = 2) => v.toFixed(d).padStart(n);
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = m.actors[i];
			if (!a) continue;
			rows.push(`${DIAG_ACTOR_LABELS[a].padEnd(5)} ${cellName(i)} ${f(m.coal[i])} ${f(m.goods[i])} ${f(m.labor[i])} ${f(m.depleted[i])} ${f(m.food[i])} ${f(m.priceCoal[i], 8, 3)} ${f(m.priceGoods[i], 9, 3)} ${f(money.purse[i])} ${f(money.owedAt(i))}`);
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
}

function sumRequests(flow) {
	let sum = 0;
	const requests = flow.requests;
	for (let i = 0; i < requests.length; i++) sum += requests[i];
	return sum;
}

const PANEL_ROWS = [
	['People', [
		['Fresh · away', s => `${s.fresh.toFixed(1)} · ${s.away.toFixed(1)}`],
		['Labor held', s => `${s.labor.toFixed(1)} u`, s => s.people > 30 && s.wageFieldMax <= 0],
		['Labor in flight', s => `${s.laborInFlight.toFixed(1)} u`],
		['Tired · in flight', s => `${s.depleted.toFixed(1)} · ${s.depletedInFlight.toFixed(1)}`, s => s.depleted > 20],
		['Supplied · worked', s => `${s.suppliedLabor.toFixed(1)} · ${s.workedLabor.toFixed(1)}`],
		['Seeded · split · starved', s => `${s.seededWorkers.toFixed(1)} · ${s.splitWorkers.toFixed(1)} · ${s.starvedWorkers.toFixed(1)}`]
	]],
	['Gold', [
		['Total', s => `${s.goldTotal.toFixed(1)} g`],
		['Town purse', s => `${s.townPurse.toFixed(1)} g`],
		['Firm purses', s => `${s.firmPurse.toFixed(1)} g`],
		['Resident purses', s => `${s.workerPurse.toFixed(1)} g`],
		['Carried wallets', s => `${s.carried.toFixed(1)} g`, s => s.walletShare > 0.5],
		['Stream coins', s => `${s.coins.toFixed(1)} g`],
		['Wallet share', s => `${(s.walletShare * 100).toFixed(0)}%`],
		['Owed back-pay', s => `${s.firmOwed.toFixed(2)} g`, s => s.firmOwed > 1 && s.firmPurse < 1],
		['Seeded / mined', s => `${s.seeded.toFixed(1)} / ${s.mined.toFixed(1)} g`]
	]],
	['Wages', [
		['Wage field mean', s => `${s.wageFieldMean.toFixed(3)} g/u`, s => s.people > 30 && s.wageFieldMax <= 0],
		['Wage field max', s => `${s.wageFieldMax.toFixed(3)} g/u`],
		['Wages paid', s => `${s.wagesPaid.toFixed(1)} g`],
		['Taxes paid', s => `${s.taxesPaid.toFixed(1)} g`],
		['Wage · tax rate', s => `${s.wageRate.toFixed(3)} · ${s.taxRate.toFixed(3)} g/s`]
	]],
	['Prices', [
		['Coal held · flight', s => `${s.coalHeld.toFixed(1)} · ${s.coalInFlight.toFixed(1)} u`, s => s.coalInFlight > 1 && s.coalBestBuyer <= 0],
		['Coal ask · buyer', s => `${s.coalFieldMean.toFixed(3)} · ${s.coalBestBuyer.toFixed(3)} g/u`],
		['Goods held · flight', s => `${s.goodsHeld.toFixed(1)} · ${s.goodsInFlight.toFixed(1)} u`, s => s.goodsInFlight > 1 && s.goodsBestBuyer <= 0],
		['Goods ask · town', s => `${s.goodsFieldMean.toFixed(3)} · ${s.goodsBestBuyer.toFixed(3)} g/u`],
		['Food held', s => `${s.foodHeld.toFixed(1)} u`],
		['Wood held', s => `${s.woodHeld.toFixed(1)} u`]
	]],
	['Towns', [
		['Towns', s => `${s.towns}`, s => !s.towns],
		['Population · rooms', s => `${s.pop.toFixed(0)} · ${s.rooms.toFixed(0)}`],
		['Town food', s => `${s.townFood.toFixed(1)} u`, s => s.towns && s.townFood < 0.05 * Math.max(1, s.pop)],
		['Town coal · goods', s => `${s.townCoal.toFixed(1)} · ${s.townGoods.toFixed(1)}`]
	]],
	['Matter', [
		['Coal made · burned', s => `${s.coalMade.toFixed(1)} · ${s.coalBurned.toFixed(1)} u`],
		['Goods made · eaten', s => `${s.goodsMade.toFixed(1)} · ${s.goodsEaten.toFixed(1)} u`],
		['Food made', s => `${s.foodMade.toFixed(1)} u`],
		['Wood made · used', s => `${s.woodMade.toFixed(1)} · ${s.woodUsed.toFixed(1)} u`]
	]]
];

if (typeof module === 'object') module.exports = { EconomyDiagnostics, PANEL_ROWS };
