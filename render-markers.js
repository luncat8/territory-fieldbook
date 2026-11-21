// owns: settlement/industry markers and cached actor labels
// edit for: marker shapes, visibility and field label placement

const FACTORY_KIND_CSS = ['#e0a458', '#60c89a', '#777f91', '#b58bd4', '#d8b13f'];
const FARM_FIELD_CSS = '#8a6b2f';
const FARM_FIELD_EDGE = '#d8b13f';
const renderMarkers = { towns: [], mines: [], workshops: [], factories: [] };

function renderMarkersInit() {
	for (let k = 0; k < world.n; k++) renderMarkers.towns[k] = 'C' + (k + 1);
	for (let k = 0; k < MAPE_MINE_CAP; k++) renderMarkers.mines[k] = 'S' + (k + 1);
	for (let k = 0; k < MAPE_WORKSHOP_CAP; k++) renderMarkers.workshops[k] = 'W' + (k + 1);
	for (let k = 0; k < MAPE_FACTORY_CAP; k++) renderMarkers.factories[k] = 'F' + (k + 1);
}

function renderSettlementRing() {
	if (render.fieldStyle === RENDER_STYLE.A) return mapScene.id ? 0.9 : 0.55;
	return mapScene.id ? 0.55 : 0.34;
}

function renderSettlements(ctx, field) {
	const count = mape.settleCount;
	if (count === 0) return;
	const fancy = field && render.fieldStyle === RENDER_STYLE.B;
	const ring = renderSettlementRing();
	ctx.beginPath();
	for (let k = 0; k < count; k++) {
		const idx = mape.settleCells[k];
		const cx = ((idx % world.size) + 0.5) * CELL_PX;
		const cy = (((idx / world.size) | 0) + 0.5) * CELL_PX;
		const ratio = mape.pop[idx] / MAPE_POP_CAP;
		const radius = CELL_PX * (field ? ring : 0.12 + 0.18 * Math.min(1, ratio));
		ctx.moveTo(cx + radius, cy);
		ctx.arc(cx, cy, radius, 0, TAU);
	}
	if (!field || fancy) {
		ctx.fillStyle = fancy ? '#514065' : SETTLE_CSS;
		ctx.fill();
	}
	if (!field) return;
	ctx.strokeStyle = '#1c2733';
	ctx.lineWidth = 4;
	ctx.stroke();
	ctx.strokeStyle = fancy ? '#e6d3ff' : '#ffffff';
	ctx.lineWidth = fancy ? 1.7 : 1.4;
	ctx.stroke();
	if (!fancy) return;
	ctx.beginPath();
	for (let k = 0; k < count; k++) {
		const idx = mape.settleCells[k];
		const cx = ((idx % world.size) + 0.5) * CELL_PX;
		const cy = (((idx / world.size) | 0) + 0.5) * CELL_PX;
		ctx.moveTo(cx + 1.6, cy);
		ctx.arc(cx, cy, 1.6, 0, TAU);
	}
	ctx.fillStyle = '#e6d3ff';
	ctx.fill();
}

function renderIndustry(ctx, field, view) {
	const cell = CELL_PX;
	const item = view === VIEW.DEMAND ? mape.viewItemDemand : mape.viewItem;
	ctx.fillStyle = STORAGE_CSS;
	const box = cell * 0.22;
	for (let k = 0; k < mape.storageCount; k++) {
		const slot = mape.storageSite[k];
		if (field && slot < 255) continue;
		if (slot < 255 && sites.state[slot] !== SITE_STATE.VISIBLE) continue;
		ctx.fillRect((mape.storageX[k] + 0.5) * cell - box * 0.5, (mape.storageY[k] + 0.5) * cell - box * 0.5, box, box);
	}
	const hideMines = field && view === VIEW.DEMAND && render.fieldStyle === RENDER_STYLE.A;
	for (let m = 0; m < mape.mineCount; m++) {
		if (hideMines || (field && item <= MAPE_RES.CO2 && mape.mineRes[m] !== item)) continue;
		const slot = mape.mineSite[m];
		if (sites.state[slot] !== SITE_STATE.VISIBLE) continue;
		renderMineMarker(ctx, m, field);
	}
	if (!field || item === MAPE_RES.GOODS) renderWorkshops(ctx, field);
	const fsize = cell * 0.56;
	for (let f = 0; f < mape.factoryCount; f++) {
		const st = mape.factoryState[f];
		if (st === MAPE_FACTORY_STATE.GONE) continue;
		const cx = (mape.factoryX[f] + 0.5) * cell - fsize * 0.5;
		const cy = (mape.factoryY[f] + 0.5) * cell - fsize * 0.5;
		if (st === MAPE_FACTORY_STATE.BUILDING) {
			ctx.strokeStyle = FACTORY_CSS[st];
			ctx.lineWidth = 2;
			ctx.strokeRect(cx, cy, fsize, fsize);
		} else {
			ctx.fillStyle = FACTORY_KIND_CSS[mape.factoryKind[f]];
			ctx.fillRect(cx, cy, fsize, fsize);
		}
		if (mape.factoryKind[f] === MAPE_FACTORY_KIND.FARM) renderFarmField(ctx, f);
	}
}

// The farm outlines its 5×5 field and fills owned farmland by season progress, so field growth
// and the batch harvest read at a glance.
function renderFarmField(ctx, f) {
	const cell = CELL_PX;
	const reach = MAPE_FARM_RADIUS;
	const size = reach * 2 + 1;
	const owner = f + 1;
	const left = (mape.factoryX[f] - reach) * cell;
	const top = (mape.factoryY[f] - reach) * cell;
	ctx.globalAlpha = 0.3 + 0.4 * Math.min(1, mape.factoryClock[f] / MAPE_FARM_SEASON_SEC);
	ctx.fillStyle = FARM_FIELD_CSS;
	ctx.beginPath();
	for (let dy = -reach; dy <= reach; dy++) {
		const y = mape.factoryY[f] + dy;
		if (y < 0 || y >= world.size) continue;
		for (let dx = -reach; dx <= reach; dx++) {
			const x = mape.factoryX[f] + dx;
			if (x < 0 || x >= world.size) continue;
			if (mape.farmOwner[y * world.size + x] !== owner) continue;
			ctx.rect(x * cell, y * cell, cell, cell);
		}
	}
	ctx.fill();
	ctx.globalAlpha = 1;
	ctx.strokeStyle = FARM_FIELD_EDGE;
	ctx.lineWidth = 1.2;
	ctx.strokeRect(left, top, size * cell, size * cell);
}

function renderMineMarker(ctx, mine, field) {
	const cx = (mape.mineX[mine] + 0.5) * CELL_PX;
	const cy = (mape.mineY[mine] + 0.5) * CELL_PX;
	const open = mape.mineUnlocked[mine] === 1;
	const size = CELL_PX * (mapScene.id ? 1.5 : 1);
	const style = field ? render.fieldStyle : RENDER_STYLE.FIELDBOOK;
	ctx.fillStyle = open ? field ? '#58e187' : RES_CSS[sites.res[mape.mineSite[mine]]] : MINE_LOCK_FILL;
	if (style === RENDER_STYLE.A) {
		ctx.fillRect(cx - size * 0.5, cy - size * 0.5, size, size);
		if (!open) {
			ctx.strokeStyle = MINE_LOCK_STROKE;
			ctx.lineWidth = 1.4;
			ctx.strokeRect(cx - size * 0.5, cy - size * 0.5, size, size);
		}
		return;
	}
	ctx.beginPath();
	ctx.moveTo(cx, cy - size * 0.36);
	if (style === RENDER_STYLE.B) {
		ctx.lineTo(cx + size * 0.36, cy);
		ctx.lineTo(cx, cy + size * 0.36);
		ctx.lineTo(cx - size * 0.36, cy);
		if (open) ctx.fillStyle = '#77512c';
	} else {
		ctx.lineTo(cx + size * 0.30, cy + size * 0.26);
		ctx.lineTo(cx - size * 0.30, cy + size * 0.26);
	}
	ctx.closePath();
	ctx.fill();
	ctx.strokeStyle = open ? style === RENDER_STYLE.B ? '#ffdb9f' : '#213b33' : MINE_LOCK_STROKE;
	ctx.lineWidth = style === RENDER_STYLE.B ? 1.7 : 1;
	ctx.stroke();
	if (style !== RENDER_STYLE.B) return;
	ctx.beginPath();
	ctx.arc(cx, cy, 1.5, 0, TAU);
	ctx.fillStyle = ctx.strokeStyle;
	ctx.fill();
}

function renderWorkshops(ctx, field) {
	ctx.strokeStyle = field && render.fieldStyle === RENDER_STYLE.B ? '#ffdb9f' : '#80eabc';
	ctx.lineWidth = 1.4;
	ctx.beginPath();
	for (let k = 0; k < mape.workshopCount; k++) {
		const i = mape.workshopCells[k];
		const cx = (i % world.size + 0.5) * CELL_PX;
		const cy = (((i / world.size) | 0) + 0.5) * CELL_PX;
		const d = CELL_PX * 0.36;
		ctx.moveTo(cx, cy - d);
		ctx.lineTo(cx + d, cy);
		ctx.lineTo(cx, cy + d);
		ctx.lineTo(cx - d, cy);
		ctx.closePath();
	}
	ctx.stroke();
}

function renderActorLabels(ctx, view) {
	const item = view === VIEW.DEMAND ? mape.viewItemDemand : mape.viewItem;
	ctx.font = '500 14px ui-monospace, monospace';
	ctx.textBaseline = 'middle';
	ctx.textAlign = 'left';
	if (render.showSettlements && renderSettlementIcons(view)) {
		for (let k = 0; k < mape.settleCount; k++) renderActorLabel(ctx, mape.settleCells[k], renderMarkers.towns[k], false);
	}
	if (!render.showSources) return;
	const hideMines = view === VIEW.DEMAND && render.fieldStyle === RENDER_STYLE.A;
	for (let k = 0; k < mape.mineCount; k++) {
		if (hideMines || item > MAPE_RES.CO2 || mape.mineRes[k] !== item || sites.state[mape.mineSite[k]] !== SITE_STATE.VISIBLE) continue;
		renderActorLabel(ctx, mape.mineY[k] * world.size + mape.mineX[k], renderMarkers.mines[k], true);
	}
	if (item === MAPE_RES.GOODS) {
		for (let k = 0; k < mape.workshopCount; k++) renderActorLabel(ctx, mape.workshopCells[k], renderMarkers.workshops[k], true);
	}
	for (let k = 0; k < mape.factoryCount; k++) {
		if (mape.factoryState[k] === MAPE_FACTORY_STATE.GONE) continue;
		renderActorLabel(ctx, mape.factoryY[k] * world.size + mape.factoryX[k], renderMarkers.factories[k], true);
	}
}

function renderActorLabel(ctx, idx, label, source) {
	const cx = (idx % world.size + 0.5) * CELL_PX;
	const cy = (((idx / world.size) | 0) + 0.5) * CELL_PX;
	const width = label.length * 8.5 + 7;
	const gap = CELL_PX * 0.8;
	const left = cx + gap + width < render.size ? cx + gap : cx - gap - width;
	ctx.fillStyle = 'rgba(18, 18, 25, 0.9)';
	ctx.fillRect(left, cy - 10, width, 20);
	ctx.fillStyle = render.fieldStyle === RENDER_STYLE.B ? source ? '#ffd69b' : '#e2cff4' : '#eaf4f8';
	ctx.fillText(label, left + 3, cy);
}
