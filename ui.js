// owns: canvas rendering, controls and expedition panels
// edit for: map views, player interaction and displayed feedback
'use strict';

let fieldGame;
let selectedCell = 8 * WORLD_SIZE + 8;
let currentView = 'terrain';
let frameTime = 0;
let tickAccumulator = 0;
const canvasNode = document.getElementById('map-canvas');
const mapContext = canvasNode.getContext('2d');

function htmlText(value) {
	return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function numberText(value, digits = 1) { return Number(value).toFixed(digits); }
function uiButton(action, label, disabled, title = '', extra = '') {
	return `<button class="outline" data-action="${action}" ${extra} ${disabled ? 'disabled' : ''} title="${htmlText(title)}">${label}</button>`;
}

function drawMap() {
	const world = fieldGame.world, party = fieldGame.parties[0], size = canvasNode.width / WORLD_SIZE;
	for (let i = 0; i < CELL_COUNT; i++) {
		const x = i % WORLD_SIZE, y = Math.floor(i / WORLD_SIZE);
		let color = TERRAINS[world.terrain[i]].color;
		if (currentView === 'survey') {
			const n = Math.round(party.search[i] / 100 * 160);
			color = `rgb(${232 - Math.round(n * 0.9)},${238 - Math.round(n * 0.35)},${225 - Math.round(n * 0.75)})`;
		} else if (currentView === 'influence') {
			const owner = world.control[i];
			color = owner === 0 ? '#79ad87' : owner === 1 ? '#c98d76' : '#e2e8d9';
		} else if (currentView === 'land') {
			const n = world.disturbance[i];
			color = `rgb(${Math.round(208 - n * 85)},${Math.round(222 - n * 115)},${Math.round(193 - n * 105)})`;
		}
		mapContext.fillStyle = color;
		mapContext.fillRect(x * size, y * size, size + 0.2, size + 0.2);
	}
	const radius = observationRadius(world.terrain[Math.floor(party.y) * WORLD_SIZE + Math.floor(party.x)]);
	mapContext.strokeStyle = 'rgba(255,255,255,.75)'; mapContext.lineWidth = 1.5;
	mapContext.setLineDash([3, 3]); mapContext.beginPath(); mapContext.arc(party.x * size, party.y * size, radius * size, 0, Math.PI * 2); mapContext.stroke(); mapContext.setLineDash([]);
	for (const site of fieldGame.sites) {
		if (!site.present || (!site.discovered[0] && site.visibility !== 1)) continue;
		mapContext.fillStyle = site.owner === 0 ? '#fff' : site.owner === 1 ? '#b26049' : '#f8d887';
		mapContext.strokeStyle = '#415a46'; mapContext.lineWidth = 1;
		mapContext.beginPath(); mapContext.rect((site.x + 0.28) * size, (site.y + 0.28) * size, size * 0.44, size * 0.44); mapContext.fill(); mapContext.stroke();
	}
	for (const unit of fieldGame.parties) {
		mapContext.beginPath(); mapContext.arc(unit.x * size, unit.y * size, Math.max(4, size * 0.43), 0, Math.PI * 2);
		mapContext.fillStyle = unit.id ? '#bd7158' : '#f9fff5'; mapContext.fill(); mapContext.lineWidth = 2; mapContext.strokeStyle = unit.id ? '#fff8eb' : '#27593c'; mapContext.stroke();
	}
	mapContext.strokeStyle = '#ffffff'; mapContext.lineWidth = 2;
	mapContext.strokeRect((selectedCell % WORLD_SIZE) * size + 1, Math.floor(selectedCell / WORLD_SIZE) * size + 1, size - 2, size - 2);
}

function renderSummary() {
	const party = fieldGame.parties[0];
	document.getElementById('summary-panel').innerHTML = `<div class="stats"><div class="stat"><small>CONDITION</small><strong>${numberText(party.condition, 0)}<small>/ 100</small></strong></div><div class="stat"><small>MORALE</small><strong>${numberText(party.morale, 0)}<small>/ 100</small></strong></div><div class="stat"><small>TERRITORY</small><strong>${numberText(fieldGame.territory[0] / CELL_COUNT * 100)}<small>%</small></strong></div></div>`;
	const status = document.getElementById('status-label');
	status.textContent = party.failed ? '● EXPEDITION LOST' : fieldGame.running ? '● IN PROGRESS' : fieldGame.won ? '● VICTORY' : '● PAUSED';
	status.className = fieldGame.running ? 'status running' : 'status';
	document.getElementById('run-button').textContent = fieldGame.running ? '❚❚  Pause' : '▶  Resume';
	document.getElementById('run-button').disabled = party.failed;
	document.getElementById('tick-label').textContent = String(fieldGame.tick).padStart(4, '0');
	document.getElementById('world-label').textContent = `WORLD ${fieldGame.seed}`;
}

function renderCell() {
	const game = fieldGame, party = game.parties[0], world = game.world, x = selectedCell % WORLD_SIZE, y = Math.floor(selectedCell / WORLD_SIZE);
	const terrain = TERRAINS[world.terrain[selectedCell]], progress = party.search[selectedCell], control = world.control[selectedCell];
	const site = game.sites.find(item => siteIndex(item) === selectedCell && item.present && (item.discovered[0] || item.visibility === 1));
	document.getElementById('coordinates').textContent = `${String(x).padStart(2, '0')} / ${String(y).padStart(2, '0')}`;
	let content = `<div class="cell-name"><span class="swatch" style="background:${terrain.color}"></span>${terrain.name}</div><div class="row"><span>Investigation</span><strong>${numberText(progress, 0)}%</strong></div><div class="progress"><i style="width:${progress}%"></i></div><div class="row"><span>Control</span><strong>${control === 0 ? 'Yours' : control === 1 ? 'Rival' : 'Neutral'}</strong></div><div class="row"><span>Disturbed area</span><strong>${numberText(world.disturbance[selectedCell] * 100)}%</strong></div>`;
	if (site) {
		const known = site.discovered[0], name = known ? SITE_TYPES[site.type] : 'Interesting place';
		content += `<div class="site-box"><strong>◇ ${name}</strong><div class="muted">${!known ? 'Investigate to identify this place.' : site.owner === -1 ? 'Unrecorded opportunity' : site.owner === 0 ? 'Recorded by your party' : 'Recorded by the rival'}${site.expires && site.owner < 0 ? ` · expires at tick ${site.expires}` : ''}</div>`;
		if (known && site.owner === -1) {
			const reason = control === 1 ? 'Rival controls this cell' : Math.floor(party.x) !== x || Math.floor(party.y) !== y ? 'Travel to this site first' : progress < 100 ? 'Reach 100% investigation first' : site.type === 3 && !capability(party, 'trust') ? 'Local trust required (Communication + Fieldcraft ≥ 10)' : '';
			content += `<div class="action-row">${uiButton('record', 'Record site', !!reason, reason)}</div>${reason ? `<div class="muted">${reason}</div>` : ''}`;
		}
		if (known && site.type === 4 && site.owner === 0) {
			content += `<div class="row"><span>Deposit stock</span><strong>${capability(party, 'assay') ? numberText(site.stock) : 'Assay locked'}</strong></div><div class="muted">Extraction ${numberText(miningRate(game, site, party), 2)}/tick; affected by terrain population, supplies, oxygen, knowledge and nearby claims.</div><div class="action-row">${uiButton('mine', site.mining ? 'Stop extraction' : 'Start extraction', site.stock <= 0 || control !== 0, site.stock <= 0 ? 'Deposit depleted' : 'Requires control of this cell')}</div>`;
		}
		if (known && site.owner === 0) content += `<div class="action-row">${uiButton('release', 'Release claim', false, 'Stops extraction; influence decays over time')}</div>`;
		content += '</div>';
	} else {
		const possible = game.sites.some(item => item.present && !item.discovered[0] && Math.hypot(item.x + 0.5 - party.x, item.y + 0.5 - party.y) < observationRadius(world.terrain[Math.floor(party.y) * WORLD_SIZE + Math.floor(party.x)]));
		content += `<div class="muted" style="margin-top:12px">${possible ? '◌ A discovery may be possible nearby.' : 'No known site in this cell.'}</div>`;
	}
	content += `<div class="action-row">${uiButton('rest', party.rest ? 'Resume fieldwork' : 'Rest party', party.failed, 'Rest recovers condition while time runs')}${uiButton('restore', 'Restore land', control !== 0 || world.disturbance[selectedCell] <= 0 || party.energy < (Math.floor(party.y) * WORLD_SIZE + Math.floor(party.x) === selectedCell ? 1 : 2) || party.ore < 0.5, 'Requires controlled disturbed land, 0.5 ore and 1 energy (2 remotely)')}</div>`;
	document.getElementById('cell-panel').innerHTML = content;
}

function renderParty() {
	const party = fieldGame.parties[0];
	let html = `<div class="muted">Training costs 3 funds per skill. Hiring costs 5 funds; wages are paid every tick.</div>`;
	party.members.forEach((member, index) => {
		html += `<div class="member"><div class="member-head"><span>${member.name} <span class="muted">· wage ${numberText(member.wage, 2)}/tick</span></span>${uiButton('dismiss', 'Dismiss', party.members.length <= 1, 'At least one member must remain', `data-index="${index}"`)}</div><div class="muted">Learning ${member.learning} · physical ${numberText(member.physical)} / ${member.potential} · recovery ${member.recovery}</div><div class="skills">`;
		member.skills.forEach((skill, skillIndex) => { html += `<button data-action="train" data-index="${index}" data-skill="${skillIndex}" ${party.funds < 3 ? 'disabled' : ''} title="Train ${SKILLS[skillIndex]} for 3 funds">${SKILLS[skillIndex]} ${numberText(skill, 1)} +</button>`; });
		html += '</div></div>';
	});
	for (let i = 0; i < RECRUITS.length; i++) if (!party.members.some(member => member.name === RECRUITS[i].name)) html += uiButton('hire', `Hire ${RECRUITS[i].name} · 5`, party.funds < 5, `Wage ${RECRUITS[i].wage}/tick`, `data-index="${i}"`) + ' ';
	html += `<div class="muted" style="margin-top:12px">Capabilities (combined skills ≥ 10):<br>Route charting ${capability(party, 'chart') ? '✓' : '○'} · Field assay ${capability(party, 'assay') ? '✓' : '○'} · Local trust ${capability(party, 'trust') ? '✓' : '○'}</div>`;
	document.getElementById('party-panel').innerHTML = html;
}

function renderEconomy() {
	const game = fieldGame, party = game.parties[0], eco = game.economy;
	const i = Math.floor(party.y) * WORLD_SIZE + Math.floor(party.x), terrain = game.world.terrain[i];
	const price = orePrice(game), supplyCost = supplyPrice(game, party);
	const eligible = (terrain === 1 || terrain === 2 || terrain === 3) && game.world.disturbance[i] < 0.2;
	document.getElementById('economy-panel').innerHTML = `<div class="ledger"><div class="row"><span>Funds / supplies</span><strong>${numberText(party.funds)} / ${numberText(party.supplies)}</strong></div><div class="row"><span>Ore / items</span><strong>${numberText(party.ore)} / ${party.items}</strong></div><div class="row"><span>Energy / oxygen</span><strong>${numberText(party.energy)} / ${numberText(eco.oxygen)}</strong></div><div class="row"><span>Carbon / biomass / residue</span><strong>${numberText(eco.carbon)} / ${numberText(eco.biomass)} / ${numberText(eco.rubble)}</strong></div><div class="row"><span>Last tick · energy / mined</span><strong>${numberText(party.flows.energy, 2)} / ${numberText(party.flows.mined, 2)}</strong></div></div><div class="muted">Renewables need productive meadow, forest or swamp. Shortage: ${party.shortage}/120 ticks · supplies exhausted: ${party.hunger}/60 ticks.</div><div class="action-row">${uiButton('renew', eco.renewable[0] ? 'Renewables on' : 'Enable renewables', false, eligible ? 'Uses sunlight, carbon and oxygen' : 'Move to productive meadow, forest or swamp')}${uiButton('recycle', 'Recycle residue', eco.rubble <= 0 || party.energy < 0.5, 'Costs 0.5 energy')}${uiButton('sell', `Sell 5 ore · +${price} funds`, party.ore < 5 || game.townFunds < price, 'Price falls as town ore stock rises')}${uiButton('buy', `Buy supplies · ${supplyCost} funds`, party.funds < supplyCost, 'Buy 15 supplies; price rises when your supplies are low')}</div><div class="muted">Conserved mass: ${numberText(totalMass(game), 2)} · energy + stored energy + heat: ${numberText(totalEnergy(game), 2)} · sunlight received: ${numberText(eco.sunlight, 2)}<br>Rival territory: ${fieldGame.territory[1]} cells · supplies: ${numberText(fieldGame.parties[1].supplies)}</div>`;
}

function renderPanels() {
	renderSummary(); renderCell(); renderParty(); renderEconomy();
	document.getElementById('event-panel').innerHTML = fieldGame.events.slice(0, 6).map(event => `<div>${htmlText(event)}</div>`).join('');
	document.getElementById('victory-panel').innerHTML = victoryChecks(fieldGame).map(check => `<div class="check ${check.ok ? 'ok' : ''}"><b>${check.ok ? '✓' : '○'}</b><div>${check.label}<small>${htmlText(check.detail)}</small></div></div>`).join('');
	document.getElementById('map-caption').textContent = `${currentView.toUpperCase()} VIEW · CLICK A CELL TO TRAVEL`;
}

function refreshUI() { drawMap(); renderPanels(); }

function handleAction(button) {
	const game = fieldGame, party = game.parties[0], action = button.dataset.action;
	if (party.failed) return;
	const site = game.sites.find(item => siteIndex(item) === selectedCell && item.present);
	if (action === 'record' && recordSite(game, party, site)) updateInfluence(game, false);
	if (action === 'release' && site && site.owner === 0) { site.owner = -1; site.mining = false; addEvent(game, `Claim released at ${site.x}, ${site.y}.`); }
	if (action === 'mine' && site && site.owner === 0 && site.stock > 0 && game.world.control[selectedCell] === 0) site.mining = !site.mining;
	if (action === 'rest') party.rest = !party.rest;
	if (action === 'restore' && !restoreCell(game, party, selectedCell)) addEvent(game, 'Restoration requires control, disturbance and energy.');
	if (action === 'hire') { const before = party.funds; hireMember(party, Number(button.dataset.index)); game.townFunds += before - party.funds; }
	if (action === 'dismiss' && party.members.length > 1) party.members.splice(Number(button.dataset.index), 1);
	if (action === 'train') { const before = party.funds; trainMember(party, Number(button.dataset.index), Number(button.dataset.skill)); game.townFunds += before - party.funds; }
	if (action === 'renew') game.economy.renewable[0] = !game.economy.renewable[0];
	if (action === 'recycle') recycle(game, party);
	if (action === 'sell' && party.ore >= 5 && game.townFunds >= orePrice(game)) { const price = orePrice(game); party.ore -= 5; game.townOre += 5; party.funds += price; game.townFunds -= price; }
	if (action === 'buy' && party.funds >= supplyPrice(game, party)) { const price = supplyPrice(game, party); party.funds -= price; game.townFunds += price; party.supplies += 15; }
	refreshUI();
}

function animationFrame(time) {
	if (!frameTime) frameTime = time;
	const elapsed = (time - frameTime) / 1000;
	frameTime = time;
	if (fieldGame.running) {
		tickAccumulator += elapsed * Number(document.getElementById('speed-input').value);
		let processed = 0;
		while (tickAccumulator >= 1 && processed < 50 && fieldGame.running) { tickGame(fieldGame); tickAccumulator--; processed++; }
		if (processed) refreshUI();
	}
	requestAnimationFrame(animationFrame);
}

function setupUI() {
	fieldGame = newGame(42);
	canvasNode.addEventListener('click', event => {
		const bounds = canvasNode.getBoundingClientRect();
		const x = Math.max(0, Math.min(63, Math.floor((event.clientX - bounds.left) / bounds.width * WORLD_SIZE)));
		const y = Math.max(0, Math.min(63, Math.floor((event.clientY - bounds.top) / bounds.height * WORLD_SIZE)));
		selectedCell = y * WORLD_SIZE + x;
		if (!event.shiftKey && !moveParty(fieldGame.parties[0], x, y)) addEvent(fieldGame, 'Not enough supplies to travel.');
		refreshUI();
	});
	document.addEventListener('click', event => {
		const button = event.target.closest('button[data-action]');
		if (button && !button.disabled) handleAction(button);
	});
	document.getElementById('view-buttons').addEventListener('click', event => {
		const button = event.target.closest('button[data-view]');
		if (!button) return;
		currentView = button.dataset.view;
		for (const item of document.querySelectorAll('#view-buttons button')) item.classList.toggle('active', item === button);
		refreshUI();
	});
	document.getElementById('new-button').addEventListener('click', () => { fieldGame = newGame(document.getElementById('seed-input').value); selectedCell = 8 * WORLD_SIZE + 8; tickAccumulator = 0; refreshUI(); });
	document.getElementById('run-button').addEventListener('click', () => { fieldGame.running = !fieldGame.running; tickAccumulator = 0; frameTime = 0; refreshUI(); });
	document.getElementById('declare-button').addEventListener('click', () => { declareVictory(fieldGame); refreshUI(); });
	refreshUI();
	requestAnimationFrame(animationFrame);
}
