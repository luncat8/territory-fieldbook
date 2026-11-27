// Owns: economy inspector snapshot — worker states, gold breakdown, wages, prices, stall flags, history and copy text.
// Edit for: inspector metrics, stall-flag thresholds, worker "why" reasons, history columns and the pasteable stats text.
'use strict';

const DIAG_HISTORY_SECONDS = 10;
const DIAG_HISTORY_ROWS = 32;
const DIAG_STOP_SPEED = 1e-6;
const DIAG_ACTOR_LABELS = ['', 'mine', 'fact', 'town', 'gold', 'gard', 'farm', 'sawm'];
const DIAG_HISTORY_COLS = ['t', 'workers', 'walk', 'pool', 'shift', 'wait', 'room', 'still', 'forage', 'wallet%', 'townG', 'firmG', 'coal', 'coalFly', 'coalAsk', 'coalBid', 'wage', 'wages/s', 'taxes/s', 'pop', 'goods'];

class EconomyDiagnostics {
	constructor(model) {
		this.model = model;
		this.walletSort = new Float64Array(MAX_WORKERS);
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
		const values = [s.seconds, s.workers, s.walking, s.pool, s.shift, s.wait, s.room, s.still, s.forage, s.walletShare * 100, s.townPurse, s.firmPurse, s.coalTotal, s.coalFlight, s.coalAsk, s.coalBestBuyer, s.wageAtFirms, s.wageRate, s.taxRate, s.pop, s.goodsTotal];
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
		this.countPrices(s, m);
		s.flags = this.flags(s);
		return s;
	}

	countActors(s, m) {
		s.mines = s.factories = s.towns = s.goldMines = s.gardens = s.farms = s.sawmills = s.young = 0;
		s.pop = s.rooms = s.wait = s.comfort = s.restTax = 0;
		s.bazaarEmpty = s.idleFarms = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = m.actors[i];
			if (a === ECONOMY_MINE) s.mines++;
			else if (a === ECONOMY_FACTORY) s.factories++;
			else if (a === ECONOMY_GOLD) s.goldMines++;
			else if (a === ECONOMY_GARDEN) s.gardens++;
			else if (a === ECONOMY_SAWMILL) s.sawmills++;
			else if (a === ECONOMY_FARM) {
				s.farms++;
				if (m.farms.plots[i] > 0 && m.shiftCount[i] <= 0) s.idleFarms++;
			}
			if (a !== ECONOMY_TOWN) continue;
			s.towns++;
			if (m.settlements.isYoungTown(i)) s.young++;
			s.pop += m.pop[i];
			s.rooms += m.rooms[i];
			s.wait += m.waitCount[i];
			s.comfort += m.workforce.comfortAt(i);
			s.restTax += m.townRestTax(i);
			if (m.pop[i] > 0.5 && m.food[i] < 0.01) s.bazaarEmpty++;
		}
		const towns = Math.max(1, s.towns);
		s.comfort /= towns;
		s.restTax /= towns;
	}

	countWorkers(s, m) {
		const w = m.workers;
		s.workers = w.count;
		s.workerCap = MAX_WORKERS;
		s.walkJob = s.pool = s.shift = s.walkHome = s.wait = s.room = s.still = s.forage = 0;
		s.walking = s.stalled = s.hungry = 0;
		let wallets = 0;
		for (let p = 0; p < w.count; p++) {
			const st = w.state[p];
			if (st === WORKER_WALK_JOB) s.walkJob++;
			else if (st === WORKER_FIRM_POOL) s.pool++;
			else if (st === WORKER_SHIFT) s.shift++;
			else if (st === WORKER_WALK_HOME) s.walkHome++;
			else if (st === WORKER_TOWN_WAIT) s.wait++;
			else if (st === WORKER_ROOM) s.room++;
			else if (st === WORKER_STILL) s.still++;
			else if (st === WORKER_FORAGE) s.forage++;
			if (w.isWalking(st)) {
				s.walking++;
				if (Math.abs(w.hx[p]) + Math.abs(w.hy[p]) <= DIAG_STOP_SPEED) s.stalled++;
			}
			if (w.food[p] < FOOD_HUNGRY) s.hungry++;
			wallets += w.gold[p];
		}
		s.wallets = wallets;
		s.fresh = s.still + s.walkJob;
		s.tired = s.workers - s.fresh;
		s.queuedFirm = s.pool;
		s.queuedTown = s.wait;
		s.births = w.births;
		s.starved = m.workerLife.deaths;
		s.worked = m.workedLabor;
		s.rested = m.restedDepleted;
	}

	// The buckets partition money.total() exactly: town purses, firm purses, worker wallets and the haul vault.
	// Owed wages and claims are liabilities and stay outside the sum.
	countGold(s, m) {
		const money = m.money;
		s.goldTotal = money.total();
		s.townPurse = s.firmPurse = s.firmOwed = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = m.actors[i];
			if (a === ECONOMY_TOWN) s.townPurse += money.purse[i];
			else if (a) { s.firmPurse += money.purse[i]; s.firmOwed += money.owedWage[i]; }
		}
		s.vault = money.vault;
		s.seeded = money.seeded;
		s.mined = money.mined;
		s.walletShare = s.goldTotal > 1e-9 ? s.wallets / s.goldTotal : 0;
		s.walletMean = s.workers ? s.wallets / s.workers : 0;
		const sorted = this.walletSort.subarray(0, s.workers);
		sorted.set(m.workers.gold.subarray(0, s.workers));
		sorted.sort();
		s.walletMedian = s.workers ? sorted[s.workers >> 1] : 0;
		s.walletMax = s.workers ? sorted[s.workers - 1] : 0;
		s.walletBroke = 0;
		for (let k = 0; k < s.workers; k++) if (sorted[k] < 0.01) s.walletBroke++;
		let unpaid = 0;
		for (let k = 0; k < money.claimCount; k++) unpaid += money.claimAmount[k];
		s.unpaidWages = unpaid;
	}

	countWages(s, m) {
		let firms = 0, field = 0, fieldMax = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			fieldMax = Math.max(fieldMax, m.priceLabor[i]);
			const a = m.actors[i];
			if (!a || a === ECONOMY_TOWN || a === ECONOMY_GARDEN) continue;
			field += m.priceLabor[i];
			firms++;
		}
		s.wageAtFirms = firms ? field / firms : 0;
		s.wageFieldMax = fieldMax;
		s.entryWage = s.wageAtFirms * WORKER_UNIT;
		s.wagesPaid = m.money.wages;
		s.taxesPaid = m.money.taxes;
		s.payPerLabor = m.workedLabor > 1e-9 ? m.money.wages / m.workedLabor : 0;
	}

	// Ask = particle book cost + accrued haulage per unit; a shipment sells only where a buyer's field price clears it.
	countPrices(s, m) {
		const P = m.goodsPool;
		let coalSum = 0, coalMax = 0, coalBest = 0, goodsSum = 0, goodsMax = 0, goodsBest = 0;
		let foodSum = 0, foodMax = 0, foodBest = 0;
		let woodSum = 0, woodMax = 0, woodBest = 0;
		let coalTotal = m.goodsPool.spawnBufferTotal(ITEM_COAL) + m.goodsPool.inTransitTotal(ITEM_COAL);
		let goodsTotal = m.goodsPool.spawnBufferTotal(ITEM_GOODS) + m.goodsPool.inTransitTotal(ITEM_GOODS);
		let foodTotal = m.goodsPool.spawnBufferTotal(ITEM_FOOD) + m.goodsPool.inTransitTotal(ITEM_FOOD);
		let woodTotal = m.goodsPool.spawnBufferTotal(ITEM_WOOD) + m.goodsPool.inTransitTotal(ITEM_WOOD);
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const pc = m.priceCoal[i], pg = m.priceGoods[i], pf = m.priceFood[i], pw = m.priceWood[i];
			coalSum += pc; goodsSum += pg; foodSum += pf; woodSum += pw;
			if (pc > coalMax) coalMax = pc;
			if (pg > goodsMax) goodsMax = pg;
			if (pf > foodMax) foodMax = pf;
			if (pw > woodMax) woodMax = pw;
			const a = m.actors[i];
			if ((a === ECONOMY_FACTORY || a === ECONOMY_TOWN) && pc > coalBest) coalBest = pc;
			if (a === ECONOMY_TOWN && pg > goodsBest) goodsBest = pg;
			if (a === ECONOMY_TOWN && pf > foodBest) foodBest = pf;
			if ((a === ECONOMY_TOWN || a === ECONOMY_FARM) && pw > woodBest) woodBest = pw;
			coalTotal += m.coal[i];
			goodsTotal += m.goods[i];
			foodTotal += m.food[i];
			woodTotal += m.wood[i];
		}
		s.coalFieldMean = coalSum / ECONOMY_SIZE;
		s.coalFieldMax = coalMax;
		s.coalBestBuyer = coalBest;
		s.goodsFieldMean = goodsSum / ECONOMY_SIZE;
		s.goodsFieldMax = goodsMax;
		s.goodsBestBuyer = goodsBest;
		s.foodFieldMean = foodSum / ECONOMY_SIZE;
		s.foodFieldMax = foodMax;
		s.foodBestBuyer = foodBest;
		s.woodFieldMean = woodSum / ECONOMY_SIZE;
		s.woodFieldMax = woodMax;
		s.woodBestBuyer = woodBest;
		s.coalTotal = coalTotal;
		s.goodsTotal = goodsTotal;
		s.foodTotal = foodTotal;
		s.woodTotal = woodTotal;
		s.coalParticles = s.coalStopped = 0;
		s.goodsParticles = s.goodsStopped = 0;
		s.foodParticles = s.foodStopped = 0;
		s.woodParticles = s.woodStopped = 0;
		let coalFly = 0, coalBook = 0, coalHaul = 0, goodsFly = 0, goodsBook = 0, goodsHaul = 0;
		let foodFly = 0, foodBook = 0, foodHaul = 0;
		let woodFly = 0, woodBook = 0, woodHaul = 0;
		for (let p = 0; p < P.count; p++) {
			const k = P.kind[p], amt = P.amount[p];
			const stopped = Math.abs(P.hx[p]) + Math.abs(P.hy[p]) <= DIAG_STOP_SPEED ? 1 : 0;
			if (k === ITEM_COAL) {
				s.coalParticles++;
				s.coalStopped += stopped;
				coalFly += amt; coalBook += P.factoryCost[p]; coalHaul += P.transportCost[p];
			} else if (k === ITEM_GOODS) {
				s.goodsParticles++;
				s.goodsStopped += stopped;
				goodsFly += amt; goodsBook += P.factoryCost[p]; goodsHaul += P.transportCost[p];
			} else if (k === ITEM_FOOD) {
				s.foodParticles++;
				s.foodStopped += stopped;
				foodFly += amt; foodBook += P.factoryCost[p]; foodHaul += P.transportCost[p];
			} else if (k === ITEM_WOOD) {
				s.woodParticles++;
				s.woodStopped += stopped;
				woodFly += amt; woodBook += P.factoryCost[p]; woodHaul += P.transportCost[p];
			}
		}
		s.coalFlight = coalFly;
		s.goodsFlight = goodsFly;
		s.foodFlight = foodFly;
		s.woodFlight = woodFly;
		s.coalAsk = coalFly > 1e-12 ? (coalBook + coalHaul) / coalFly : 0;
		s.coalBookCost = coalFly > 1e-12 ? coalBook / coalFly : 0;
		s.coalHaulCost = coalFly > 1e-12 ? coalHaul / coalFly : 0;
		s.goodsAsk = goodsFly > 1e-12 ? (goodsBook + goodsHaul) / goodsFly : 0;
		s.goodsBookCost = goodsFly > 1e-12 ? goodsBook / goodsFly : 0;
		s.goodsHaulCost = goodsFly > 1e-12 ? goodsHaul / goodsFly : 0;
		s.foodAsk = foodFly > 1e-12 ? (foodBook + foodHaul) / foodFly : 0;
		s.foodBookCost = foodFly > 1e-12 ? foodBook / foodFly : 0;
		s.foodHaulCost = foodFly > 1e-12 ? foodHaul / foodFly : 0;
		s.woodAsk = woodFly > 1e-12 ? (woodBook + woodHaul) / woodFly : 0;
		s.woodBookCost = woodFly > 1e-12 ? woodBook / woodFly : 0;
		s.woodHaulCost = woodFly > 1e-12 ? woodHaul / woodFly : 0;
		s.coalSpoiled = P.spoiled[ITEM_COAL];
		s.goodsSpoiled = P.spoiled[ITEM_GOODS];
		s.foodSpoiled = P.spoiled[ITEM_FOOD];
		s.woodSpoiled = P.spoiled[ITEM_WOOD];
		s.deliveries = P.arrivals;
		s.coalMade = m.producedCoal;
		s.coalBurned = m.burnedCoal;
		s.goodsMade = m.producedGoods;
		s.goodsEaten = m.consumedGoods;
		s.foodMade = m.producedFood;
		s.foodEaten = m.consumedFood;
		s.woodMade = m.producedWood;
		s.woodEaten = m.consumedWood;
		s.gardenFed = m.forage.gardenFed;
		s.wildPicked = m.forage.wildPicked;
	}

	flags(s) {
		const out = [];
		const pct = v => `${Math.round(v * 100)}%`;
		if (s.towns && !s.workers) out.push('no workers are alive: everyone starved, so towns have nobody to feed, rest or tax');
		if (s.workers >= s.workerCap) out.push(`worker pool at cap ${s.workers}/${s.workerCap}: splits pause until workers leave or starve`);
		if (s.walking > 8 && s.stalled / s.walking > 0.3) out.push(`${pct(s.stalled / s.walking)} of walkers are stopped (${s.stalled}/${s.walking}): no price pull clears the dock gate ${DOCK_SLOPE.toExponential(1)}`);
		if (s.queuedFirm > 20) out.push(`${s.queuedFirm} workers queued in firm pools; pools fill faster than shifts open, so entry-wage bids cool`);
		if (s.queuedTown > 20) out.push(`${s.queuedTown} workers waiting for town rooms at ${s.restTax.toFixed(3)} g rest tax`);
		if (s.hungry > 0) out.push(`${s.hungry} worker(s) below the hunger gate — they drop work for FORAGE mode`);
		if (s.walletShare > 0.5) out.push(`${pct(s.walletShare)} of all gold sits in worker wallets (mean ${s.walletMean.toFixed(3)} g); it returns only through paid town rest`);
		if (s.towns && s.townPurse < 0.05 * s.goldTotal) out.push(`towns hold ${s.townPurse.toFixed(2)} g of ${s.goldTotal.toFixed(2)} g: town bids for coal and goods collapse`);
		if (s.coalFlight > 1 && s.coalAsk > s.coalBestBuyer) out.push(`in-flight coal ask ${s.coalAsk.toFixed(3)} g/u > best buyer ${s.coalBestBuyer.toFixed(3)} g/u: ${s.coalFlight.toFixed(1)} coal cannot sell`);
		if (s.goodsFlight > 1 && s.goodsAsk > s.goodsBestBuyer) out.push(`in-flight goods ask ${s.goodsAsk.toFixed(3)} g/u > best town price ${s.goodsBestBuyer.toFixed(3)} g/u`);
		if (s.foodFlight > 1 && s.foodAsk > s.foodBestBuyer) out.push(`in-flight food ask ${s.foodAsk.toFixed(3)} g/u > best town bid ${s.foodBestBuyer.toFixed(3)} g/u: ${s.foodFlight.toFixed(1)} food cannot sell`);
		if (s.firmOwed > s.firmPurse && s.firmOwed > 1) out.push(`firms owe ${s.firmOwed.toFixed(2)} g but hold ${s.firmPurse.toFixed(2)} g (unpaid wage claims ${s.unpaidWages.toFixed(2)} g)`);
		if (s.bazaarEmpty) out.push(`${s.bazaarEmpty} town bazaar(s) are empty while populated: food bids go dead until a farm delivers`);
		if (s.idleFarms) out.push(`${s.idleFarms} farm(s) hold fields but no crew on this tick`);
		return out;
	}

	// Mirrors the release/admission rules in workers.js in words, so a stalled worker explains its own stall.
	workerReason(w) {
		const m = this.model, pool = m.workers;
		const st = pool.state[w], c = pool.cell[w], gate = DOCK_SLOPE;
		const pct = v => `${Math.round(v * 100)}%`;
		if (st === WORKER_WALK_JOB) {
			m.steering.sampleField(m.priceLabor, null, 0, c, 0);
			const slope = m.steering.grad.bestPull;
			const hiring = m.optimizer.isHiringFirm(c) ? '' : ' · no hiring firm here';
			return slope < gate
				? `walking to work, stalled: wage slope ${slope.toExponential(1)} below gate ${gate.toExponential(1)}${hiring}`
				: `walking to a job: wage slope ${slope.toExponential(1)}${hiring}`;
		}
		if (st === WORKER_FIRM_POOL) {
			const places = m.optimizer.shiftSlots(c) + m.optimizer.poolSlots(c);
			return `queued in the firm pool: ${m.poolCount[c].toFixed(1)}/${places} places · wage ${m.priceLabor[c].toFixed(3)} g/u`;
		}
		if (st === WORKER_SHIFT) return `working a shift: tired ${pct(pool.tired[w])} · wage ${m.priceLabor[c].toFixed(3)} g/u`;
		if (st === WORKER_WALK_HOME) {
			const wMix = walletWeight(pool.gold[w], pool.amount[w], BASE_REST_FEE);
			m.steering.sampleField(m.priceHome, m.priceRest, wMix, c, 0);
			const slope = m.steering.grad.bestPull;
			return slope < gate
				? `walking home, stalled: home slope ${slope.toExponential(1)} below gate ${gate.toExponential(1)}`
				: `walking home: home slope ${slope.toExponential(1)}`;
		}
		if (st === WORKER_TOWN_WAIT) return `waiting for a room: ${m.waitCount[c].toFixed(1)}/${m.towns.waitCap(c).toFixed(1)} · fee ${m.towns.restTax(c).toFixed(3)} g · wallet ${pool.gold[w].toFixed(2)} g`;
		if (st === WORKER_ROOM) return `resting in a room: paid rest ${pct(pool.paidRest[w] / Math.max(1e-9, pool.amount[w]))} · rate ${m.towns.roomRestRate(c).toFixed(2)}/s`;
		if (st === WORKER_FORAGE) {
			const atGarden = m.actors[c] === ECONOMY_GARDEN;
			return `foraging: food ${pct(pool.food[w])} · ${atGarden ? 'free garden rations' : `food gradient ${m.forage.scoreAtCell(c).toFixed(2)}`}`;
		}
		if (pool.tired[w] > 1e-6) return `shelter-resting: tired ${pct(pool.tired[w] / Math.max(1e-9, pool.amount[w]))} · rest pace ×${m.land.rest[c].toFixed(2)}`;
		m.steering.sampleField(m.priceLabor, null, 0, c, 0);
		const slope = m.steering.grad.bestPull;
		return slope < gate
			? `idle: wage slope ${slope.toExponential(1)} below gate ${gate.toExponential(1)} — no job pull`
			: `idle, ready: wage slope ${slope.toExponential(1)} — job available`;
	}

	workerText(entry) {
		const m = this.model, w = m.workers;
		const p = w.indexOfId(entry.id);
		const wallet = p >= 0 ? w.gold[p] : 0;
		const balance = entry.funded + entry.earned - entry.spent - entry.splitShared - wallet;
		const lines = [`## watched worker ${entry.name} (#${entry.id}) · ${entry.status}`];
		if (p >= 0) {
			lines.push(`state=${WORKER_STATE_NAMES[w.state[p]]} amount=${w.amount[p].toFixed(3)} tired=${w.tired[p].toFixed(3)} food=${w.food[p].toFixed(3)} at=${m.tracker.place(w.cell[p])}`);
			lines.push(`why=${this.workerReason(p)}`);
			lines.push(`cell_wage=${m.priceLabor[w.cell[p]].toFixed(4)} cell_home=${m.priceHome[w.cell[p]].toFixed(4)} cell_rest=${m.priceRest[w.cell[p]].toFixed(4)}`);
		}
		lines.push(`purse=${wallet.toFixed(4)} unpaid=${m.money.unpaidWages(entry.id).toFixed(4)} granted=${entry.funded.toFixed(3)} earned=${entry.earned.toFixed(4)} spent=${entry.spent.toFixed(4)} split=${entry.splitShared.toFixed(4)} ledger=${Math.abs(balance) < 1e-6 ? 'exact' : balance.toExponential(2)}`);
		const stops = Object.keys(entry.stops).map(i => `${m.tracker.place(Number(i))} visits=${entry.stops[i].visits} tax=${entry.stops[i].tax.toFixed(3)}`);
		if (stops.length) lines.push(`rest_stops: ${stops.join(' | ')}`);
		if (entry.history.length) lines.push(`purse_history(every ${(TRACK_SAMPLE_STRIDE * ECONOMY_DT).toFixed(2)} s, last 12): ${entry.history.slice(-12).map(v => v.toFixed(3)).join(' ')}`);
		lines.push(...entry.events.map(text => `event: ${text}`));
		return lines.join('\n');
	}

	actorRows() {
		const m = this.model, money = m.money;
		const rows = ['## actors', 'kind  cell    labor depl  queue coal   goods  wageFld coalPx goodsPx purse   owed   profit'];
		const f = (v, n = 6, d = 2) => v.toFixed(d).padStart(n);
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = m.actors[i];
			if (!a) continue;
			rows.push(`${DIAG_ACTOR_LABELS[a].padEnd(5)} ${placeName(i)} ${f(m.labor[i], 5)} ${f(m.depleted[i], 5)} ${f(m.poolCount[i], 5)} ${f(m.coal[i])} ${f(m.goods[i])} ${f(m.priceLabor[i], 7, 3)} ${f(m.priceCoal[i], 6, 3)} ${f(m.priceGoods[i], 7, 3)} ${f(money.purse[i], 7)} ${f(money.owedWage[i])} ${f(m.profit[i], 6, 3)}`);
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
			`# particle-transfer B2 stats · t=${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')} (${m.ticks} ticks) · decay=${m.decay} derived=${m.derived} suppression=${m.suppression} wrap=${typeof MAP_WRAP !== 'undefined' ? MAP_WRAP : '?'}`,
			'## flags',
			...(s.flags.length ? s.flags.map(t => `- ${t}`) : ['- none']),
			'## actors & towns',
			`mines=${s.mines} factories=${s.factories} towns=${s.towns} young=${s.young} gold_mines=${s.goldMines} gardens=${s.gardens} farms=${s.farms} sawmills=${s.sawmills} pop=${f(s.pop, 2)}/${f(s.rooms, 1)} wait=${f(s.wait, 1)} comfort=${f(s.comfort)} rest_tax=${f(s.restTax)}`,
			'## workers',
			`count=${s.workers}/${s.workerCap} walk_job=${s.walkJob} pool=${s.pool} shift=${s.shift} walk_home=${s.walkHome} wait=${s.wait} room=${s.room} still=${s.still} forage=${s.forage} walking=${s.walking} stalled=${s.stalled} hungry=${s.hungry}`,
			`labor_worked=${f(s.worked, 2)} rested=${f(s.rested, 2)} births=${s.births} starved=${s.starved}`,
			'## gold',
			`total=${f(s.goldTotal)} seeded=${f(s.seeded)} mined=${f(s.mined)} town_purse=${f(s.townPurse)} firm_purse=${f(s.firmPurse)} wallets=${f(s.wallets)} haul_vault=${f(s.vault)}`,
			`wallet_share=${f(s.walletShare * 100, 1)}% wallet_mean=${f(s.walletMean, 4)} wallet_median=${f(s.walletMedian, 4)} wallet_max=${f(s.walletMax)} broke_workers=${s.walletBroke} firm_owed=${f(s.firmOwed)} unpaid_wage_claims=${f(s.unpaidWages)}`,
			'## wages & taxes',
			`wage_field_at_firms=${f(s.wageAtFirms, 4)} wage_field_max=${f(s.wageFieldMax, 4)} entry_wage_per_worker=${f(s.entryWage, 4)} pay_per_labor_unit=${f(s.payPerLabor, 4)}`,
			`wages_paid=${f(s.wagesPaid, 2)} taxes_paid=${f(s.taxesPaid, 2)} wages_rate=${f(s.wageRate, 4)} g/s taxes_rate=${f(s.taxRate, 4)} g/s`,
			'## prices (field = diffused buyer bid, ask = in-flight unit cost + haulage)'
		];
		for (const key of ['coal', 'goods', 'food', 'wood']) {
			lines.push(`${key}: total=${f(s[key + 'Total'], 2)} in_flight=${f(s[key + 'Flight'], 2)} particles=${s[key + 'Particles']} stopped=${s[key + 'Stopped']} field_mean=${f(s[key + 'FieldMean'], 4)} field_max=${f(s[key + 'FieldMax'], 4)} best_buyer=${f(s[key + 'BestBuyer'], 4)} ask=${f(s[key + 'Ask'], 4)} book=${f(s[key + 'BookCost'], 4)} haul=${f(s[key + 'HaulCost'], 4)} spoiled=${f(s[key + 'Spoiled'], 2)}`);
		}
		lines.push(`flows: coal_made=${f(s.coalMade, 2)} coal_burned=${f(s.coalBurned, 2)} goods_made=${f(s.goodsMade, 2)} goods_eaten=${f(s.goodsEaten, 2)} food_made=${f(s.foodMade, 2)} food_eaten=${f(s.foodEaten, 2)} wood_made=${f(s.woodMade, 2)} wood_built=${f(s.woodEaten, 2)} deliveries=${s.deliveries} garden_rations=${f(s.gardenFed, 2)} wild_rations=${f(s.wildPicked, 2)}`);
		for (const entry of watched) lines.push(this.workerText(entry));
		lines.push(this.actorRows(), this.historyText());
		return lines.join('\n');
	}
}

const PANEL_ROWS = [
	['Workers', [
		['Pool', s => `${s.workers}/${s.workerCap}`, s => s.workers >= s.workerCap],
		['Walk job · home', s => `${s.walkJob} · ${s.walkHome}`],
		['Pool · shift', s => `${s.pool} · ${s.shift}`, s => s.pool > 20],
		['Wait · room', s => `${s.wait} · ${s.room}`, s => s.wait > 20],
		['Still · forage', s => `${s.still} · ${s.forage}`],
		['Walking · stalled', s => `${s.walking} · ${s.stalled}`, s => s.walking > 8 && s.stalled / s.walking > 0.3],
		['Hungry · births', s => `${s.hungry} · ${s.births}`, s => s.hungry > 0],
		['Labor worked', s => s.worked.toFixed(2)],
		['Restored', s => s.rested.toFixed(2)]
	]],
	['Gold', [
		['Total', s => `${s.goldTotal.toFixed(1)} g`],
		['Town purse', s => `${s.townPurse.toFixed(1)} g`],
		['Firm purses', s => `${s.firmPurse.toFixed(1)} g`],
		['Worker wallets', s => `${s.wallets.toFixed(1)} g`],
		['Wallet share', s => `${(s.walletShare * 100).toFixed(0)}%`, s => s.walletShare > 0.5],
		['Wallet mean/median', s => `${s.walletMean.toFixed(3)} / ${s.walletMedian.toFixed(3)} g`],
		['Wallet max', s => `${s.walletMax.toFixed(2)} g`],
		['Broke workers', s => `${s.walletBroke}`, s => s.walletBroke > 0],
		['Haul vault', s => `${s.vault.toFixed(1)} g`],
		['Unpaid wages', s => `${s.unpaidWages.toFixed(2)} g`, s => s.unpaidWages > 1e-6],
		['Owed by firms', s => `${s.firmOwed.toFixed(2)} g`, s => s.firmOwed > s.firmPurse && s.firmOwed > 1],
		['Seeded / mined', s => `${s.seeded.toFixed(1)} / ${s.mined.toFixed(1)} g`]
	]],
	['Wages', [
		['Wage at firms', s => `${s.wageAtFirms.toFixed(3)} g/u`, s => s.workers > 0 && s.wageAtFirms < 1e-6],
		['Wage field max', s => `${s.wageFieldMax.toFixed(3)} g/u`],
		['Entry wage / worker', s => `${s.entryWage.toFixed(3)} g`],
		['Wages paid', s => `${s.wagesPaid.toFixed(1)} g`],
		['Taxes paid', s => `${s.taxesPaid.toFixed(1)} g`],
		['Wages / taxes rate', s => `${s.wageRate.toFixed(3)} · ${s.taxRate.toFixed(3)} g/s`],
		['Pay per labor unit', s => `${s.payPerLabor.toFixed(3)} g`]
	]],
	['Prices', [
		['Coal total', s => `${s.coalTotal.toFixed(1)} u`],
		['Coal in flight', s => `${s.coalFlight.toFixed(1)} u`, s => s.coalStopped > 8],
		['Coal ask · buyer', s => `${s.coalAsk.toFixed(3)} · ${s.coalBestBuyer.toFixed(3)} g/u`, s => s.coalFlight > 1 && s.coalAsk > s.coalBestBuyer],
		['Coal field mean/max', s => `${s.coalFieldMean.toFixed(3)} / ${s.coalFieldMax.toFixed(3)}`],
		['Goods total', s => `${s.goodsTotal.toFixed(1)} u`],
		['Goods in flight', s => `${s.goodsFlight.toFixed(1)} u`, s => s.goodsStopped > 8],
		['Goods ask · town', s => `${s.goodsAsk.toFixed(3)} · ${s.goodsBestBuyer.toFixed(3)} g/u`, s => s.goodsFlight > 1 && s.goodsAsk > s.goodsBestBuyer],
		['Goods field mean/max', s => `${s.goodsFieldMean.toFixed(3)} / ${s.goodsFieldMax.toFixed(3)}`],
		['Food total', s => `${s.foodTotal.toFixed(1)} u`],
		['Food in flight', s => `${s.foodFlight.toFixed(1)} u`, s => s.foodStopped > 8],
		['Food ask · town', s => `${s.foodAsk.toFixed(3)} · ${s.foodBestBuyer.toFixed(3)} g/u`, s => s.foodFlight > 1 && s.foodAsk > s.foodBestBuyer],
		['Food field mean/max', s => `${s.foodFieldMean.toFixed(3)} / ${s.foodFieldMax.toFixed(3)}`],
		['Wood total', s => `${s.woodTotal.toFixed(1)} u`],
		['Wood in flight', s => `${s.woodFlight.toFixed(1)} u`, s => s.woodStopped > 8],
		['Wood ask · buyer', s => `${s.woodAsk.toFixed(3)} · ${s.woodBestBuyer.toFixed(3)} g/u`, s => s.woodFlight > 1 && s.woodAsk > s.woodBestBuyer],
		['Wood field mean/max', s => `${s.woodFieldMean.toFixed(3)} / ${s.woodFieldMax.toFixed(3)}`],
		['Spoiled coal/goods/food/wood', s => `${s.coalSpoiled.toFixed(2)} · ${s.goodsSpoiled.toFixed(2)} · ${s.foodSpoiled.toFixed(2)} · ${s.woodSpoiled.toFixed(2)} u`],
		['Deliveries', s => `${s.deliveries}`]
	]],
	['Flow', [
		['Coal made · burned', s => `${s.coalMade.toFixed(1)} · ${s.coalBurned.toFixed(1)} u`],
		['Goods made · eaten', s => `${s.goodsMade.toFixed(1)} · ${s.goodsEaten.toFixed(1)} u`],
		['Food made · eaten', s => `${s.foodMade.toFixed(1)} · ${s.foodEaten.toFixed(1)} u`],
		['Wood made · built', s => `${s.woodMade.toFixed(1)} · ${s.woodEaten.toFixed(1)} u`],
		['Garden · wild rations', s => `${s.gardenFed.toFixed(1)} · ${s.wildPicked.toFixed(1)}`]
	]],
	['Towns & farms', [
		['Towns · young', s => `${s.towns} · ${s.young}`],
		['Population · rooms', s => `${s.pop.toFixed(0)} · ${s.rooms.toFixed(0)}`],
		['Wait · comfort', s => `${s.wait.toFixed(0)} · ${s.comfort.toFixed(2)}`],
		['Rest tax', s => `${s.restTax.toFixed(3)} g`, s => s.restTax > 2],
		['Empty bazaars', s => `${s.bazaarEmpty}`, s => s.bazaarEmpty > 0],
		['Farms · idle crews', s => `${s.farms} · ${s.idleFarms}`, s => s.idleFarms > 0]
	]]
];

if (typeof module === 'object') module.exports = { EconomyDiagnostics, PANEL_ROWS };
