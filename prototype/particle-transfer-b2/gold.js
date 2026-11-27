// Owns: conserved gold — scenario starting gold, town purses, owner settlement waterfall, wage claims, transport and custody accounts.
// Edit for: starting gold per worker and its allocation, entry-wage prepayment, reserve horizon, earned-work bonuses and T0/T1 drip.
'use strict';

const PURSE_SECONDS = 15;
const RESERVE_SECONDS = 4;
const RESERVE_HORIZON_SECONDS = 16;
const BONUS_BATCH = 0.2;
const START_GOLD_PER_WORKER = 1;
// Scenario allocation of starting gold; shares sum to 1 and every bucket is recorded once as initial gold.
const START_SHARES = { bank: 0.25, owners: 0.35, towns: 0.2, wallets: 0.2 };
const WALLET_REFERENCE = 8;
const VAULT_DRIP_RATE = 0.35;
const WAGE_CLAIM_CAP = 128;

class GoldMoney {
	constructor(model) {
		this.model = model;
		this.purse = new Float64Array(ECONOMY_SIZE);
		// SoA FIFO of unpaid entry wages: debt belongs to the owner and the original hire, even after either moves on.
		this.claimOwner = new Int32Array(WAGE_CLAIM_CAP);
		this.claimWorkerId = new Int32Array(WAGE_CLAIM_CAP);
		this.claimAmount = new Float64Array(WAGE_CLAIM_CAP);
		this.claimCap = WAGE_CLAIM_CAP;
		this.claimCount = 0;
		this.transportPreset = 'T0';
		this.startTaxPerPop = START_PRICE / (INPUT_SHARE * (GOODS_COMFORT / TOWN_GOODS_NEED));
		this.dripShare = 1 - Math.exp(-ECONOMY_DT * VAULT_DRIP_RATE);
	}

	// Clears every gold balance (owner cash, wage claims, bank book) but keeps owner identities and facility links.
	reset() {
		const { owners, bank } = this.model;
		this.purse.fill(0);
		this.claimCount = 0;
		if (owners) for (const col of [owners.cash, owners.capital, owners.owed]) col.fill(0);
		if (bank) bank.reset();
		this.transport = this.custody = 0;
		this.initial = this.mined = this.wages = this.bonuses = this.taxes = this.transportEarned = this.redistributed = 0;
		this.mineRate = this.wageRate = this.taxRate = 0;
	}

	// Scenario starting gold is recorded once (plan M.1): bank equity, named owners, town treasuries and wallets.
	// A bucket with no recipients folds into bank equity, so the total always equals perWorker × workers.
	fundScenario(perWorker, shares) {
		const m = this.model, { owners, workers, actors } = m;
		const total = perWorker * workers.count;
		let towns = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) if (actors[i] === ECONOMY_TOWN) towns++;
		const named = owners.count - 1;
		const ownerEach = named ? total * shares.owners / named : 0;
		const townEach = towns ? total * shares.towns / towns : 0;
		const walletEach = workers.count ? total * shares.wallets / workers.count : 0;
		const walletSeed = walletEach > 0 ? walletEach : perWorker * 0.2;
		for (let o = 1; o < owners.count; o++) this.fundOwner(o, ownerEach);
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (actors[i] !== ECONOMY_TOWN) continue;
			this.fund(i, townEach);
			m.localWealth[i] = walletSeed;
		}
		for (let w = 0; w < workers.count; w++) this.fundWorker(w, walletEach);
		this.fundBank(total - ownerEach * named - townEach * towns - walletEach * workers.count);
	}

	fundOwner(o, amount) {
		this.model.owners.cash[o] += amount;
		this.model.owners.capital[o] += amount;
		this.initial += amount;
	}

	fundBank(amount) {
		this.model.bank.fund(amount);
		this.initial += amount;
	}

	fundWorker(w, amount) {
		this.model.workers.gold[w] += amount;
		this.initial += amount;
	}

	// Books gold a caller already placed in a wallet (debug grants, test spawns) as initial funding.
	recordFunding(amount) {
		this.initial += amount;
	}

	unitScale() {
		const count = this.model.workers.count;
		if (count <= 0) return 1;
		const supply = this.initial + this.mined;
		return (supply > 0 ? supply : this.model.workers.totalGold()) / count;
	}

	eps() {
		return Math.max(1e-30, (this.initial + this.mined) * 1e-12);
	}

	// Explicit scenario capital for the account behind a cell; recorded as initial gold, never a placement side effect.
	fund(cell, amount) {
		if (this.model.actors[cell] === ECONOMY_TOWN) this.purse[cell] += amount;
		else {
			const owners = this.model.owners, o = owners.ownerAt(cell);
			if (!o) { this.fundBank(amount); return; }
			owners.cash[o] += amount;
			owners.capital[o] += amount;
		}
		this.initial += amount;
	}

	// An erased town's treasury is an estate: it goes to custody, never vanishes and never mints.
	releaseTown(i) {
		this.custody += this.purse[i];
		this.purse[i] = 0;
	}

	isTown(i) {
		return this.model.actors[i] === ECONOMY_TOWN;
	}

	// Spendable budget at a cell: a town's purse, or a facility's bounded share of its owner's shared cash.
	cashAt(i) {
		return this.isTown(i) ? this.purse[i] : this.model.owners.budgetAt(i);
	}

	debit(i, amount) {
		if (this.isTown(i)) {
			this.purse[i] = Math.max(0, this.purse[i] - amount);
			return;
		}
		const owners = this.model.owners, o = owners.ownerAt(i);
		owners.cash[o] = Math.max(0, owners.cash[o] - amount);
	}

	creditOwner(o, amount) {
		if (amount <= 0) return;
		if (o) this.model.owners.cash[o] += amount;
		else this.custody += amount;
	}

	growClaims() {
		const cap = Math.max(16, this.claimCap * 2);
		const owner = new Int32Array(cap), worker = new Int32Array(cap), amount = new Float64Array(cap);
		owner.set(this.claimOwner);
		worker.set(this.claimWorkerId);
		amount.set(this.claimAmount);
		this.claimOwner = owner;
		this.claimWorkerId = worker;
		this.claimAmount = amount;
		this.claimCap = cap;
	}

	// Removes the claim at k, shifting later entries down so settlement keeps FIFO order.
	dropClaim(k) {
		const last = --this.claimCount;
		for (let j = k; j < last; j++) {
			this.claimOwner[j] = this.claimOwner[j + 1];
			this.claimWorkerId[j] = this.claimWorkerId[j + 1];
			this.claimAmount[j] = this.claimAmount[j + 1];
		}
	}

	dig(i, amount) {
		this.creditOwner(this.model.owners.ownerAt(i), amount);
		this.mined += amount;
	}

	creditCool(i, budget) {
		const owed = this.model.owners.owedAt(i);
		if (owed <= 0) return 1;
		return budget > 0 ? 1 + owed / budget : Infinity;
	}

	townCool(i, budget) {
		const cash = this.purse[i];
		if (cash <= 0) return Infinity;
		if (budget <= 0) return 1;
		return (cash >= budget ? 1 : budget / cash) * this.creditCool(i, budget);
	}

	// Prepays the shift at pool entry from the facility budget; any shortfall books an SoA wage claim on the owner
	// in favour of the original worker, settled FIFO from later owner cash.
	payEntryWage(firmCell, workerIdx, bill) {
		if (bill <= 0) return 0;
		const m = this.model, owners = m.owners, o = owners.ownerAt(firmCell), eps = this.eps();
		const paid = Math.min(bill, owners.budgetAt(firmCell));
		owners.cash[o] = Math.max(0, owners.cash[o] - paid);
		m.workers.gold[workerIdx] += paid;
		if (paid > 0) m.tracker.income(workerIdx, paid, m.workers.cell[workerIdx]);
		this.wages += paid;
		const owed = bill - paid;
		if (owed > eps) {
			owners.owed[o] += owed;
			this.addWageClaim(o, m.workers.id[workerIdx], owed);
		}
		return paid;
	}

	addWageClaim(o, workerId, amount) {
		for (let k = 0; k < this.claimCount; k++) {
			if (this.claimOwner[k] !== o || this.claimWorkerId[k] !== workerId) continue;
			this.claimAmount[k] += amount;
			return;
		}
		if (this.claimCount >= this.claimCap) this.growClaims();
		const k = this.claimCount++;
		this.claimOwner[k] = o;
		this.claimWorkerId[k] = workerId;
		this.claimAmount[k] = amount;
	}

	unpaidWages(workerId) {
		let total = 0;
		for (let k = 0; k < this.claimCount; k++) if (this.claimWorkerId[k] === workerId) total += this.claimAmount[k];
		return total;
	}

	// Pays an owner's wage claims FIFO to the original hires; despawned workers' shares go to custody.
	payWageClaims(o, budget) {
		const workers = this.model.workers, eps = this.eps() * 1e-3;
		let left = budget;
		for (let k = 0; k < this.claimCount && left > eps;) {
			if (this.claimOwner[k] !== o) { k++; continue; }
			const pay = Math.min(left, this.claimAmount[k]);
			const w = workers.indexOfId(this.claimWorkerId[k]);
			if (w >= 0) {
				workers.gold[w] += pay;
				this.model.tracker.income(w, pay, workers.cell[w]);
			} else this.custody += pay;
			this.claimAmount[k] -= pay;
			left -= pay;
			if (this.claimAmount[k] <= eps) this.dropClaim(k);
			else k++;
		}
		// The owner already debited the whole budget; unclaimable fp dust keeps the books exact via custody.
		if (left > 0) this.custody += left;
	}

	payTransport(amount) {
		if (amount <= 0) return;
		this.transport += amount;
		this.transportEarned += amount;
	}

	payTown(townCell, amount) {
		if (amount <= 0) return;
		this.purse[townCell] += amount;
		this.taxes += amount;
		this.model.towns.recordRevenue(townCell, amount);
	}

	// Overlay holdings: a facility shows its budget share, so owner cash is never counted once per site.
	held(i) {
		return (this.isTown(i) ? this.purse[i] : this.model.owners.budgetAt(i)) + this.model.workerGold[i];
	}

	townTotal() {
		let sum = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) sum += this.purse[i];
		return sum;
	}

	total() {
		const m = this.model;
		return this.townTotal() + m.owners.totalCash() + m.bank.reserve + this.transport + this.custody + m.workers.totalGold();
	}

	step() {
		const { actors, owners } = this.model;
		const mined = this.mined, wages = this.wages, taxes = this.taxes;
		owners.reserve.fill(0);
		owners.extracts.fill(0);
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			const a = actors[i], o = owners.ownerAt(i);
			if (!o || a === ECONOMY_TOWN || a === ECONOMY_GARDEN) continue;
			owners.reserve[o] += this.costRate(i, a) * RESERVE_SECONDS;
			if (a === ECONOMY_GOLD) owners.extracts[o] = 1;
		}
		for (let o = 1; o < owners.count; o++) this.settleOwner(o);
		this.dripToTowns();
		this.mineRate = (this.mined - mined) / ECONOMY_DT;
		this.wageRate = (this.wages - wages) / ECONOMY_DT;
		this.taxRate = (this.taxes - taxes) / ECONOMY_DT;
	}

	// T0 redistributes transport fees to towns by population; T1 retains them. Custody always escheats to towns.
	dripToTowns() {
		const { actors, pop } = this.model;
		let townWeight = 0;
		for (let i = 0; i < ECONOMY_SIZE; i++) if (actors[i] === ECONOMY_TOWN) townWeight += Math.max(1, pop[i]);
		if (townWeight <= 0) return;
		const fromTransport = this.transportPreset === 'T0' ? this.transport * this.dripShare : 0;
		const fromCustody = this.custody * this.dripShare;
		const drip = fromTransport + fromCustody;
		if (drip <= this.eps()) return;
		this.transport -= fromTransport;
		this.custody -= fromCustody;
		this.redistributed += drip;
		for (let i = 0; i < ECONOMY_SIZE; i++) {
			if (actors[i] === ECONOMY_TOWN) this.purse[i] += drip * (Math.max(1, pop[i]) / townWeight);
		}
	}

	costRate(i, actor) {
		const { priceCoal, priceLabor, priceWood, scale } = this.model;
		if (actor === ECONOMY_FARM) return priceLabor[i] * this.model.farms.crewTarget(i) * WORK_RATE;
		if (actor === ECONOMY_SAWMILL) return priceLabor[i] * SAWMILL_RATE * SAWMILL_LABOR * (scale[i] || 1);
		if (actor === ECONOMY_FACTORY) return (priceCoal[i] / FACTORY_YIELD + priceLabor[i] * FACTORY_LABOR) * FACTORY_RATE * (scale[i] || 1);
		if (actor === ECONOMY_GOLD) return (priceWood[i] * GOLD_WOOD + priceLabor[i] * GOLD_LABOR) * SOURCE_RATE * (scale[i] || 1);
		return priceLabor[i] * SOURCE_RATE * MINE_LABOR * (scale[i] || 1);
	}

	// Waterfall (plan M.1): due wage claims, a loan when short of the next-shift reserve (extracting owners self-fund),
	// debt service from cash above the reserve, then batched bonuses to workers who earned the shifts.
	// Bonuses come only from earnings: never while a loan is open and never out of paid-in working capital,
	// otherwise a cold-start reserve near zero pays the scenario capital straight out as bonuses.
	settleOwner(o) {
		const m = this.model, owners = m.owners, eps = this.eps();
		if (owners.owed[o] > eps && owners.cash[o] > eps) {
			const pay = Math.min(owners.cash[o], owners.owed[o]);
			owners.cash[o] -= pay;
			owners.owed[o] -= pay;
			this.payWageClaims(o, pay);
			this.wages += pay;
		}
		const reserve = owners.reserve[o];
		if (!owners.extracts[o] && reserve > eps && owners.cash[o] < reserve) m.bank.request(o, reserve / RESERVE_SECONDS);
		m.bank.service(o, owners.cash[o] - reserve);
		if (m.bank.principal[o] > eps) return;
		const surplus = owners.cash[o] - Math.max(owners.capital[o], reserve * (RESERVE_HORIZON_SECONDS / RESERVE_SECONDS));
		const batch = BONUS_BATCH * this.unitScale();
		if (surplus <= eps || surplus < batch) return;
		const paid = m.workers.payCredited(o, surplus);
		owners.cash[o] -= paid;
		this.wages += paid;
		this.bonuses += paid;
	}
}

if (typeof module === 'object') module.exports = { GoldMoney, START_GOLD_PER_WORKER, START_SHARES, WALLET_REFERENCE };
