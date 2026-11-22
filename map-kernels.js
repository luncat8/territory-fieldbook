// owns: single-pass field kernels — conductance-weighted Jacobi passes, CO2 pairwise pass,
// bounded transfer and the gradient push shared by every field engine and the workforce pools

// Symmetric edge fluxes give exact zero-flux bounds at water and map borders. With
// conductance each edge flux is weighted by c (harmonic-mean speed), so pull bends
// along fast ground and its reach over slow ground shrinks by about sqrt(c). A null
// conductance is the all-1 map (c = 1 on land edges) and reproduces the old pass.
function mapeDiffuseLandPass(src, dst, off, size, terrain, edgeMix, keep, condR, condD) {
	const water = TERRAIN.WATER;
	const decay = 1 - keep;
	const end = size - 1;
	let loss = 0;
	for (let y = 0; y < size; y++) {
		const row = y * size;
		const innerY = y > 0 && y < end;
		for (let x = 0; x < size; x++) {
			const i = row + x;
			const p = off + i;
			if (terrain[i] === water) {
				dst[p] = 0;
				continue;
			}
			const cur = src[p];
			let delta = 0;
			if (innerY && x > 0 && x < end) {
				if (condR) {
					delta = condR[i - 1] * (src[p - 1] - cur) + condR[i] * (src[p + 1] - cur) + condD[i - size] * (src[p - size] - cur) + condD[i] * (src[p + size] - cur);
				} else {
					if (terrain[i - 1] !== water) delta += src[p - 1] - cur;
					if (terrain[i + 1] !== water) delta += src[p + 1] - cur;
					if (terrain[i - size] !== water) delta += src[p - size] - cur;
					if (terrain[i + size] !== water) delta += src[p + size] - cur;
				}
			} else if (condR) {
				if (x > 0) delta += condR[i - 1] * (src[p - 1] - cur);
				if (x < end) delta += condR[i] * (src[p + 1] - cur);
				if (y > 0) delta += condD[i - size] * (src[p - size] - cur);
				if (y < end) delta += condD[i] * (src[p + size] - cur);
			} else {
				if (x > 0 && terrain[i - 1] !== water) delta += src[p - 1] - cur;
				if (x < end && terrain[i + 1] !== water) delta += src[p + 1] - cur;
				if (y > 0 && terrain[i - size] !== water) delta += src[p - size] - cur;
				if (y < end && terrain[i + size] !== water) delta += src[p + size] - cur;
			}
			const mixed = cur + edgeMix * delta;
			if (decay > 0) loss += mixed < 0 ? -mixed : mixed;
			const next = mixed * keep;
			dst[p] = next > -MAPE_DENORM_FLOOR && next < MAPE_DENORM_FLOOR ? 0 : next;
		}
	}
	return loss * decay;
}

function mapeDiffuseAllPass(src, dst, off, size, edgeMix, keep) {
	const decay = 1 - keep;
	const end = size - 1;
	let loss = 0;
	for (let y = 0; y < size; y++) {
		const row = y * size;
		const innerY = y > 0 && y < end;
		for (let x = 0; x < size; x++) {
			const p = off + row + x;
			const cur = src[p];
			let delta = 0;
			if (innerY && x > 0 && x < end) {
				delta = src[p - 1] + src[p + 1] + src[p - size] + src[p + size] - 4 * cur;
			} else {
				if (x > 0) delta += src[p - 1] - cur;
				if (x < end) delta += src[p + 1] - cur;
				if (y > 0) delta += src[p - size] - cur;
				if (y < end) delta += src[p + size] - cur;
			}
			const mixed = cur + edgeMix * delta;
			if (decay > 0) loss += mixed < 0 ? -mixed : mixed;
			const next = mixed * keep;
			dst[p] = next > -MAPE_DENORM_FLOOR && next < MAPE_DENORM_FLOOR ? 0 : next;
		}
	}
	return loss * decay;
}

// One Jacobi pass per tick. mix = rate · dt must sit at or below MAPE_MIX_MAX by construction
// (units-and-scales.md): rates are scaled so a single pass is always stable — no pass count, no
// substeps. With conductance the budget is D · max(c) · dt; max stays 1.0 by normalization.
// The pass reads field and writes scratch, then the slice is copied back so callers
// keep their buffer identities (demandView subarrays point into mape.demand).
function mapeDiffuseSlice(field, scratch, off, size, terrain, landOnly, rate, decayRate, dt, cond) {
	if (rate <= 0 || dt <= 0) return 0;
	const edgeMix = rate * dt;
	const keep = decayRate > 0 ? Math.exp(-decayRate * dt) : 1;
	const loss = landOnly
		? mapeDiffuseLandPass(field, scratch, off, size, terrain, edgeMix, keep, cond ? cond.condR : null, cond ? cond.condD : null)
		: mapeDiffuseAllPass(field, scratch, off, size, edgeMix, keep);
	const end = off + size * size;
	for (let p = off; p < end; p++) field[p] = scratch[p];
	return loss;
}

// Debit what the receiver actually got, including rounding in Float32 population fields.
function mapeApplyTransfer(next, srcIdx, dstIdx, amount, dstMax) {
	if (amount <= 0) return 0;
	const dstBefore = next[dstIdx];
	if (dstMax > 0) {
		const room = dstMax - dstBefore;
		if (room <= 0) return 0;
		if (amount > room) amount = room;
	}
	const srcBefore = next[srcIdx];
	next[srcIdx] = srcBefore - amount;
	const taken = srcBefore - next[srcIdx];
	if (taken <= 0) {
		next[srcIdx] = srcBefore;
		return 0;
	}
	next[dstIdx] = dstBefore + taken;
	const moved = next[dstIdx] - dstBefore;
	if (moved <= 0 || moved > srcBefore) {
		next[dstIdx] = dstBefore;
		next[srcIdx] = srcBefore;
		return 0;
	}
	next[srcIdx] = srcBefore - moved;
	return moved;
}

// Pairwise stock transfer in one pass: mix = D · dt ≤ MAPE_MIX_MAX by the units rule. Transfers
// stay conservative and are bounded by what each cell holds.
function mapeDiffuseCo2Stock(goods, next, off, size, dt) {
	if (dt <= 0) return;
	mapeCo2Pass(goods, next, off, size, MAPE_CO2_DIFFUSE * dt);
}

function mapeCo2Pass(src, next, off, size, edgeMix) {
	const end = size - 1;
	for (let y = 0; y < size; y++) {
		const row = off + y * size;
		for (let x = 0; x < size; x++) {
			const p = row + x;
			const cur = src[p];
			if (x < end) {
				const d = cur - src[p + 1];
				if (d > MAPE_EPS) mapeApplyTransfer(next, p, p + 1, d * edgeMix, 0);
				else if (d < -MAPE_EPS) mapeApplyTransfer(next, p + 1, p, -d * edgeMix, 0);
			}
			if (y < end) {
				const d = cur - src[p + size];
				if (d > MAPE_EPS) mapeApplyTransfer(next, p, p + size, d * edgeMix, 0);
				else if (d < -MAPE_EPS) mapeApplyTransfer(next, p + size, p, -d * edgeMix, 0);
			}
		}
	}
}

// Share g_k·c_k / (Σg + ref): the unweighted denominator keeps speeds absolute (meadow at
// half a road) — a weighted one cancels c on uniformly slow ground. Returns the transport
// effort (moved / c · per-unit), so slow ground costs more labour.
function mapePushUpGradient(x, y, i, p, size, terrain, field, next, budget, gradRef, cap, disturbed, flowX, flowY, workforceBalance, cond) {
	const water = TERRAIN.WATER;
	const end = size - 1;
	const cur = field[p];
	const cL = cond ? (x > 0 ? cond.condR[i - 1] : 0) : (x > 0 && terrain[i - 1] !== water ? 1 : 0);
	const cR = cond ? (x < end ? cond.condR[i] : 0) : (x < end && terrain[i + 1] !== water ? 1 : 0);
	const cU = cond ? (y > 0 ? cond.condD[i - size] : 0) : (y > 0 && terrain[i - size] !== water ? 1 : 0);
	const cD = cond ? (y < end ? cond.condD[i] : 0) : (y < end && terrain[i + size] !== water ? 1 : 0);
	const gL = x > 0 && cL > 0 && field[p - 1] > cur ? field[p - 1] - cur : 0;
	const gR = x < end && cR > 0 && field[p + 1] > cur ? field[p + 1] - cur : 0;
	const gU = y > 0 && cU > 0 && field[p - size] > cur ? field[p - size] - cur : 0;
	const gD = y < end && cD > 0 && field[p + size] > cur ? field[p + size] - cur : 0;
	const wL = gL * cL;
	const wR = gR * cR;
	const wU = gU * cU;
	const wD = gD * cD;
	if (wL + wR + wU + wD <= 0) return 0;
	const scale = budget / (gL + gR + gU + gD + gradRef);
	const left = wL > 0 ? mapeApplyTransfer(next, p, p - 1, wL * scale, cap > 0 ? cap * (1 - disturbed[i - 1]) : 0) : 0;
	const right = wR > 0 ? mapeApplyTransfer(next, p, p + 1, wR * scale, cap > 0 ? cap * (1 - disturbed[i + 1]) : 0) : 0;
	const up = wU > 0 ? mapeApplyTransfer(next, p, p - size, wU * scale, cap > 0 ? cap * (1 - disturbed[i - size]) : 0) : 0;
	const down = wD > 0 ? mapeApplyTransfer(next, p, p + size, wD * scale, cap > 0 ? cap * (1 - disturbed[i + size]) : 0) : 0;
	if (workforceBalance) {
		mapeFluidRecordMove(i, i - 1, left);
		mapeFluidRecordMove(i, i + 1, right);
		mapeFluidRecordMove(i, i - size, up);
		mapeFluidRecordMove(i, i + size, down);
	}
	if (flowX) {
		flowX[p] = right - left;
		flowY[p] = down - up;
	}
	return ((cL > 0 ? left / cL : 0) + (cR > 0 ? right / cR : 0) + (cU > 0 ? up / cU : 0) + (cD > 0 ? down / cD : 0)) * MAPE_WORKFORCE_PER_UNIT;
}

if (typeof module !== 'undefined') {
	module.exports = { mapeDiffuseSlice, mapeApplyTransfer, mapeDiffuseCo2Stock, mapePushUpGradient };
}
