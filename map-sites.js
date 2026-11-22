// owns: site engine step — distance-priced orders, SoA shipment pool, stock metabolism, margin siting
// edit for: price law, hold horizon, order batching, shipment pool, margin weights

const MAPE_TRANSPORT_COST = 0.08;   // price added per cell distance
const MAPE_TRANSPORT_SPEED = 2.0;   // transit speed in cells/s (~10 s across 20 cells)
const MAPE_SHIPMENT_CAP = 512;      // fixed SoA transit pool slots
const MAPE_SITE_HOLD_SEC = 10;      // seconds of forward need a cell keeps unsold
const MAPE_SITE_ORDER_MIN = 0.5;    // smallest batch worth a shipment

const mapeSites = {
	shipRes: null,
	shipFrom: null,
	shipTo: null,
	shipQty: null,
	shipDist: null,
	shipEta: null,
	shipCount: 0,
	incoming: null,
	holds: null,
	haul: null,
	sellers: null,
	sellables: null,
	sellerCount: null
};

function mapeSitesPrepare() {
	const n = world.n;
	const s = mapeSites;
	if (s.incoming && s.incoming.length === MAPE_R * n) return;
	s.shipRes = new Uint8Array(MAPE_SHIPMENT_CAP);
	s.shipFrom = new Uint16Array(MAPE_SHIPMENT_CAP);
	s.shipTo = new Uint16Array(MAPE_SHIPMENT_CAP);
	s.shipQty = new Float64Array(MAPE_SHIPMENT_CAP);
	s.shipDist = new Float32Array(MAPE_SHIPMENT_CAP);
	s.shipEta = new Float32Array(MAPE_SHIPMENT_CAP);
	s.incoming = new Float64Array(MAPE_R * n);
	s.holds = new Float32Array(n);
	s.haul = new Float32Array(n);
	s.sellers = [];
	s.sellables = [];
	for (let r = 0; r < MAPE_R; r++) {
		s.sellers[r] = new Uint16Array(n);
		s.sellables[r] = new Float32Array(n);
	}
	s.sellerCount = new Uint32Array(MAPE_R);
	s.shipCount = 0;
}

function mapeSitesReset() {
	mapeSites.shipCount = 0;
	if (mapeSites.incoming) mapeSites.incoming.fill(0);
	if (mapeSites.haul) mapeSites.haul.fill(0);
	if (mapeSites.sellerCount) mapeSites.sellerCount.fill(0);
}

// One law for every trade: the counterparty's stock sets the ask, distance adds haulage.
function mapeSiteRes(r) {
	if (r === MAPE_RES.COAL) return RES.FUEL;
	if (r === MAPE_RES.IRON) return RES.ORE;
	if (r === MAPE_RES.GOODS) return RES.GOODS;
	if (r === MAPE_RES.FOOD) return RES.FOOD;
	return RES.TIMBER;
}

function mapeSitePrice(r, stock, dist) {
	const res = mapeSiteRes(r);
	return RES_BASE_VALUE[res] * RES_REF_STOCK[res] / (stock + 1) + dist * MAPE_TRANSPORT_COST;
}

function mapeSitesHouseholdHold(r, i) {
	const p = mape.pop[i];
	if (p <= 0 || mapeIsIndustry(i)) return 0;
	if (r === MAPE_RES.GOODS) return p * MAPE_MARKET_GOODS_USE * MAPE_SITE_HOLD_SEC + MAPE_MARKET_RESERVE;
	if (r === MAPE_RES.COAL) return p * MAPE_MARKET_COAL_USE * MAPE_SITE_HOLD_SEC;
	if (r === MAPE_RES.FOOD) return p * MAPE_MARKET_FOOD_USE * MAPE_SITE_HOLD_SEC;
	if (r === MAPE_RES.LOGS) return p * MAPE_NEED_LOGS * MAPE_SITE_HOLD_SEC;
	return 0;
}

function mapeSitesFactoryHold(r, f) {
	const st = mape.factoryState[f];
	if (st === MAPE_FACTORY_STATE.GONE) return 0;
	const kind = mape.factoryKind[f];
	if (st === MAPE_FACTORY_STATE.BUILDING) {
		if (kind === MAPE_FACTORY_KIND.SAWMILL || r !== MAPE_RES.LOGS) return 0;
		return MAPE_BUILD_WOOD_RATE * MAPE_FACTORY_BUILD_WORKERS * MAPE_SITE_HOLD_SEC;
	}
	if (kind === MAPE_FACTORY_KIND.GENERAL) {
		if (r === MAPE_RES.COAL) return MAPE_FACTORY_COAL * MAPE_SITE_HOLD_SEC;
		if (r === MAPE_RES.IRON) return MAPE_FACTORY_IRON * MAPE_SITE_HOLD_SEC;
		return 0;
	}
	if ((kind === MAPE_FACTORY_KIND.CHARCOAL || kind === MAPE_FACTORY_KIND.WOOD) && r === MAPE_RES.LOGS) {
		return MAPE_FORESTRY_INPUT * MAPE_SITE_HOLD_SEC;
	}
	return 0;
}

// A cell sells only what its own forward need leaves over, so one stock pile can
// never be promised twice and a town's granary stays home.
function mapeSitesSellableList(r) {
	const n = world.n;
	const off = r * n;
	const holds = mapeSites.holds;
	holds.fill(0);
	for (let f = 0; f < mape.factoryCount; f++) {
		const h = mapeSitesFactoryHold(r, f);
		if (h > 0) holds[mape.factoryY[f] * world.size + mape.factoryX[f]] = h;
	}
	const list = mapeSites.sellers[r];
	const qty = mapeSites.sellables[r];
	const goods = mape.goods;
	let count = 0;
	for (let i = 0; i < n; i++) {
		const stock = goods[off + i];
		if (stock <= MAPE_EPS) continue;
		let hold = holds[i];
		if (hold === 0) hold = mapeSitesHouseholdHold(r, i);
		const sell = stock - hold;
		if (sell <= MAPE_EPS) continue;
		list[count] = i;
		qty[count] = sell;
		count++;
	}
	mapeSites.sellerCount[r] = count;
}

function mapeSitesShip(r, from, to, qty, dist, dx, dy) {
	if (mapeSites.shipCount >= MAPE_SHIPMENT_CAP) return;
	const off = r * world.n;
	const before = mape.goods[off + from];
	if (qty > before) qty = before;
	// Reject dust before the debit: a shipment dropped after it leaks from the ledger.
	if (qty <= MAPE_EPS) return;
	mape.goods[off + from] = before - qty;
	const shipped = before - mape.goods[off + from];
	if (shipped <= 0) return;
	const c = mapeSites.shipCount;
	mapeSites.shipRes[c] = r;
	mapeSites.shipFrom[c] = from;
	mapeSites.shipTo[c] = to;
	mapeSites.shipQty[c] = shipped;
	mapeSites.shipDist[c] = dist;
	mapeSites.shipEta[c] = dist / MAPE_TRANSPORT_SPEED;
	mapeSites.shipCount = c + 1;
	mape.transit += shipped;
	const effort = shipped * dist * MAPE_WORKFORCE_PER_UNIT;
	mape.transportWork += effort;
	// Split across both endpoints: a whole charge at the origin drained buying
	// towns toward their supplier, and each end keeps its own pull local.
	mapeSites.haul[from] += effort / 2;
	mapeSites.haul[to] += effort / 2;
	mape.flowX[off + from] += shipped * dx / dist;
	mape.flowY[off + from] += shipped * dy / dist;
}

// Cheapest delivered ask wins, whoever holds the stock; price, not geography, picks the seller.
function mapeSitesOrderItem(r, buyer, hold) {
	const n = world.n;
	const off = r * n;
	const want = hold - (mape.goods[off + buyer] + mapeSites.incoming[off + buyer]);
	if (want < MAPE_SITE_ORDER_MIN) return;
	const list = mapeSites.sellers[r];
	const batch = mapeSites.sellables[r];
	const count = mapeSites.sellerCount[r];
	if (count === 0) return;
	const size = world.size;
	const bx = buyer % size;
	const by = (buyer / size) | 0;
	let best = -1;
	let bestJ = 0;
	let bestDist = 0;
	let bestPrice = Infinity;
	for (let j = 0; j < count; j++) {
		const s = list[j];
		if (s === buyer) continue;
		const dx = (s % size) - bx;
		const dy = ((s / size) | 0) - by;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist <= 0) continue;
		const price = mapeSitePrice(r, mape.goods[off + s], dist);
		if (price >= bestPrice) continue;
		bestPrice = price;
		best = s;
		bestJ = j;
		bestDist = dist;
	}
	if (best < 0) return;
	const sdx = (best % size) - bx;
	const sdy = ((best / size) | 0) - by;
	mapeSitesShip(r, best, buyer, Math.min(want, batch[bestJ]), bestDist, sdx, sdy);
}

function mapeSitesOrders() {
	const n = world.n;
	const size = world.size;
	const incoming = mapeSites.incoming;
	incoming.fill(0);
	for (let k = 0; k < mapeSites.shipCount; k++) {
		incoming[mapeSites.shipRes[k] * n + mapeSites.shipTo[k]] += mapeSites.shipQty[k];
	}
	for (let r = 0; r < MAPE_RES.CO2; r++) mapeSitesSellableList(r);
	for (let k = 0; k < mape.settleCount; k++) {
		const i = mape.settleCells[k];
		mapeSitesOrderItem(MAPE_RES.GOODS, i, mapeSitesHouseholdHold(MAPE_RES.GOODS, i));
		mapeSitesOrderItem(MAPE_RES.COAL, i, mapeSitesHouseholdHold(MAPE_RES.COAL, i));
		mapeSitesOrderItem(MAPE_RES.FOOD, i, mapeSitesHouseholdHold(MAPE_RES.FOOD, i));
		mapeSitesOrderItem(MAPE_RES.LOGS, i, mapeSitesHouseholdHold(MAPE_RES.LOGS, i));
	}
	for (let f = 0; f < mape.factoryCount; f++) {
		const st = mape.factoryState[f];
		if (st === MAPE_FACTORY_STATE.GONE) continue;
		const i = mape.factoryY[f] * size + mape.factoryX[f];
		const kind = mape.factoryKind[f];
		if (st === MAPE_FACTORY_STATE.BUILDING) {
			if (kind !== MAPE_FACTORY_KIND.SAWMILL) mapeSitesOrderItem(MAPE_RES.LOGS, i, mapeSitesFactoryHold(MAPE_RES.LOGS, f));
			continue;
		}
		if (kind === MAPE_FACTORY_KIND.GENERAL) {
			mapeSitesOrderItem(MAPE_RES.COAL, i, mapeSitesFactoryHold(MAPE_RES.COAL, f));
			mapeSitesOrderItem(MAPE_RES.IRON, i, mapeSitesFactoryHold(MAPE_RES.IRON, f));
			continue;
		}
		if (kind === MAPE_FACTORY_KIND.CHARCOAL || kind === MAPE_FACTORY_KIND.WOOD) {
			mapeSitesOrderItem(MAPE_RES.LOGS, i, mapeSitesFactoryHold(MAPE_RES.LOGS, f));
		}
	}
}

function mapeSitesArrive(dt) {
	const n = world.n;
	const s = mapeSites;
	for (let k = 0; k < s.shipCount;) {
		s.shipEta[k] -= dt * tune.haul;
		if (s.shipEta[k] > 0) {
			k++;
			continue;
		}
		mape.goods[s.shipRes[k] * n + s.shipTo[k]] += s.shipQty[k];
		mape.transit -= s.shipQty[k];
		const last = --s.shipCount;
		if (k === last) continue;
		s.shipRes[k] = s.shipRes[last];
		s.shipFrom[k] = s.shipFrom[last];
		s.shipTo[k] = s.shipTo[last];
		s.shipQty[k] = s.shipQty[last];
		s.shipDist[k] = s.shipDist[last];
		s.shipEta[k] = s.shipEta[last];
	}
}

// Stock-based satisfaction: households spend the stock deliveries actually left
// behind, so sat = delivered / need and growth reads it through mapePopulationStep.
function mapeSitesMetabolism(dt) {
	const pop = mape.pop;
	const goodsRate = mapePopulationRate(MAPE_RES.GOODS);
	const coalRate = mapePopulationRate(MAPE_RES.COAL);
	const foodRate = mapePopulationRate(MAPE_RES.FOOD);
	for (let i = 0; i < world.n; i++) {
		const p = pop[i];
		if (p <= 0 || mapeIsIndustry(i)) continue;
		mapeUseLocalStock(MAPE_RES.GOODS, i, p * goodsRate * dt);
		mapeUseLocalStock(MAPE_RES.COAL, i, p * coalRate * dt);
		mapeUseLocalStock(MAPE_RES.FOOD, i, p * foodRate * dt);
		mapeUseLocalStock(MAPE_RES.LOGS, i, p * MAPE_NEED_LOGS * dt);
	}
}

// Engine switch without loss: everything in flight lands on its buyer.
function mapeSitesSettle() {
	const n = world.n;
	for (let k = 0; k < mapeSites.shipCount; k++) {
		mape.goods[mapeSites.shipRes[k] * n + mapeSites.shipTo[k]] += mapeSites.shipQty[k];
	}
	mape.transit = 0;
	mapeSites.shipCount = 0;
	mapeSites.incoming.fill(0);
}

function mapeSitesSubstep(dt) {
	const n = world.n;
	mapePopulationBeginStep();
	mapeSyncLocks();
	mapeSyncCells();
	mapeInjectDemand(dt);
	mapeDiffuseFields(dt);
	mape.flowX.fill(0);
	mape.flowY.fill(0);
	mape.flowDt = dt;
	mapeSitesArrive(dt);
	mapeSitesMetabolism(dt);
	mapeStepMines(dt);
	mapeStepFactories(dt);
	mapeStepWorkshops(dt);
	mapeSitesOrders();
	mapeEmitWasteCo2(dt);
	mape.goodsNext.set(mape.goods);
	mapeDiffuseCo2Stock(mape.goods, mape.goodsNext, MAPE_RES.CO2 * n, world.size, dt, mape.flowX, mape.flowY);
	mape.goods.set(mape.goodsNext);
	mapeStepWorkforce(dt, mapeSites.haul);
	mapeSites.haul.fill(0);
	if (mape.workforceMode === MAPE_WORKFORCE_MODE.FLUID) mapeFluidStep(dt);
	else if (!mape.fixedResidents) mapeTransportWorkers(dt);
	mapePopulationStep(dt);
	economyStep(dt);
	mapeMoneyStep(dt);
}

// Whole canonical ticks, same runner shape as mapeStepDiffusion (units-and-scales.md).
function mapeStepSites(seconds) {
	let left = seconds;
	while (left > 1e-9) {
		const dt = Math.min(SIM_STEP_SEC, left);
		mapeSitesSubstep(dt);
		left -= dt;
	}
}

function mapeSitesProduct(kind) {
	if (kind === MAPE_FACTORY_KIND.SAWMILL) return MAPE_RES.LOGS;
	if (kind === MAPE_FACTORY_KIND.CHARCOAL) return MAPE_RES.COAL;
	if (kind === MAPE_FACTORY_KIND.FARM) return MAPE_RES.FOOD;
	return MAPE_RES.GOODS;
}

function mapeSitesInputCount(kind) {
	if (kind === MAPE_FACTORY_KIND.GENERAL) return 2;
	return kind === MAPE_FACTORY_KIND.SAWMILL || kind === MAPE_FACTORY_KIND.FARM ? 0 : 1;
}

function mapeSitesInput(kind, k) {
	if (kind === MAPE_FACTORY_KIND.GENERAL) return k === 0 ? MAPE_RES.COAL : MAPE_RES.IRON;
	return MAPE_RES.LOGS;
}

// Margin = what the best nearby buyer's stock makes the product worth there,
// less what the inputs cost delivered here, less disturbance. Buyer price is
// discounted by haul (the plant keeps the local price, not the road), input
// cost carries haul to the candidate (delivered cost).
function mapeSitesMargin(x, y, kind) {
	const size = world.size;
	const n = world.n;
	const product = mapeSitesProduct(kind);
	const poff = product * n;
	let revenue = -Infinity;
	if (product !== MAPE_RES.LOGS) {
		for (let k = 0; k < mape.settleCount; k++) {
			const b = mape.settleCells[k];
			const dx = (b % size) - x;
			const dy = ((b / size) | 0) - y;
			const dist = Math.sqrt(dx * dx + dy * dy);
			const price = mapeSitePrice(product, mape.goods[poff + b], 0) - dist * MAPE_TRANSPORT_COST;
			if (price > revenue) revenue = price;
		}
	}
	for (let f = 0; f < mape.factoryCount; f++) {
		if (mapeSitesFactoryHold(product, f) <= 0) continue;
		const i = mape.factoryY[f] * size + mape.factoryX[f];
		const dx = (i % size) - x;
		const dy = ((i / size) | 0) - y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		const price = mapeSitePrice(product, mape.goods[poff + i], 0) - dist * MAPE_TRANSPORT_COST;
		if (price > revenue) revenue = price;
	}
	// No buyer yet: potential price at an empty buyer keeps the first sawmill placeable.
	if (revenue === -Infinity) revenue = mapeSitePrice(product, 0, 0);
	let cost = 0;
	const inputs = mapeSitesInputCount(kind);
	for (let k = 0; k < inputs; k++) {
		const r = mapeSitesInput(kind, k);
		const list = mapeSites.sellers[r];
		const count = mapeSites.sellerCount[r];
		if (count === 0) return -Infinity;
		const off = r * n;
		let best = Infinity;
		for (let j = 0; j < count; j++) {
			const s = list[j];
			const dx = (s % size) - x;
			const dy = ((s / size) | 0) - y;
			const dist = Math.sqrt(dx * dx + dy * dy);
			const price = mapeSitePrice(r, mape.goods[off + s], dist);
			if (price < best) best = price;
		}
		cost += best;
	}
	return revenue - cost - MAPE_DISTURB_PENALTY * land.disturbed[y * size + x];
}

function mapeSitesScanSite(anchor, kind) {
	mapeSitesSellableList(MAPE_RES.COAL);
	mapeSitesSellableList(MAPE_RES.IRON);
	mapeSitesSellableList(MAPE_RES.LOGS);
	const size = world.size;
	const ax = anchor % size;
	const ay = (anchor / size) | 0;
	let best = -1;
	let bestMargin = -Infinity;
	let bestD = Infinity;
	for (let dy = -MAPE_REGION_REACH; dy <= MAPE_REGION_REACH; dy++) {
		const y = ay + dy;
		if (y < 0 || y >= size) continue;
		for (let dx = -MAPE_REGION_REACH; dx <= MAPE_REGION_REACH; dx++) {
			const x = ax + dx;
			if (x < 0 || x >= size) continue;
			if (!mapeScanLegal(x, y, kind)) continue;
			const margin = mapeSitesMargin(x, y, kind);
			if (!Number.isFinite(margin)) continue;
			const d = dx * dx + dy * dy;
			if (margin > bestMargin || (margin === bestMargin && d < bestD)) {
				bestMargin = margin;
				bestD = d;
				best = y * size + x;
			}
		}
	}
	return best;
}

if (typeof module !== 'undefined') {
	module.exports = {
		mapeStepSites, mapeSitePrice, mapeSitesReset, mapeSitesPrepare, mapeSitesSettle, mapeSitesScanSite,
		MAPE_TRANSPORT_COST, MAPE_TRANSPORT_SPEED, MAPE_SHIPMENT_CAP, MAPE_SITE_HOLD_SEC, MAPE_SITE_ORDER_MIN
	};
}
