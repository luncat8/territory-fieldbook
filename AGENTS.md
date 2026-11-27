# AGENTS.md

## style

- use a single tab indentation. LF end.
const $ = id => document.getElementById(id);

- avoid deep nesting of braces { } and long if-else.
- flatten with early returns, helper functions, or flat data tables.

- avoid duplication of code.

- avoid allocations in the hot path (per-frame loop, sim, render).
- no new {}, [], object literals, closures, or string concat in the frame loop.
- reuse preallocated buffers / typed arrays / scratch objects.
- allocate once at setup, mutate in place per frame.
- these are not strict rules, use best.

- comments say why and decisions only. what-code-does belongs in names.
- 0-2 comments per function is normal. 3+ usually means names or structure are wrong — rename or restructure, don't comment.
- no banners, no commented-out code, no TODOs in code — that goes to plan or findings instead.

good: `// 2x step: halves samples, still >60fps (plan 0.3, log 11-02)`
not good: `// increment i`, `// loop over items`

- no legacy support, no old versions, no outdated browsers, no leftovers and no over protecting from unreal edge cases. we need clean architecture.

good: obj.data.action() / obj.action(obj.data) · not good: getObj().data().action()

## runtime

- file:// friendly, classic <script> tags, no modules, no build.
- guard module.exports so files also run under node.
- no internet links: vendor any lib as a local js file.

## architecture

- index.html defines script load order. plain top-level globals, no per-file IIFE, no modules.
- one composer file owns root, $, shared objects and the boot tail. it implements nothing.
- feature files own their state and DOM refs. never reach into another file's internals.
- shared code gets a named owner. no junk drawers: no state.js, utils.js, misc.js, common.js.
- no definition-time cross-file reads: other files' code is called from inside functions only.
- top-level names must not collide with index.html ids (window[id] binding). check before adding any global. on collision: rename the newer binding; collision patterns -> findings.

## files

- every source file starts with a 1-2 line header (`// owns: ...` / `// edit for: ...`); `head -12` decides relevance — never read a full file just to learn what it is.

- keep this map updated when ownership changes:
	main.js — boot, shared clock, tick order, speeds.
	random.js — seeded LCG streams for generation, sites, rivals.
	tuning.js — live playtest multipliers: knob table, group × kind products, shareable `tune:` text.
	world.js — 64x64 terrain grid, seeded generation, soil baseline and map queries.
	hydrology.js — survey water cycle, terrain adapter and root-zone moisture. Shares prototype/water-humidity/{terrain,simulation}.js with the lab.
	events.js — event feed and status line.
	land.js — disturbed fraction, productivity, waste spreading, recovery, restoration.
	economy.js — resources, recipes, biosphere, conservation ledger.
	sites.js — site pool, discovery, claims, extraction, payouts.
	map-economy.js — shared fields, settlement and market state, engine selection and ledgers.
	map-seed.js — survey seeding: settlement placement, starter town, initial atmosphere.
	map-trade.js — player trade at settlement markets: prices, selling, supplies, hiring.
	map-transport.js — per-cell transport speed and edge conductance.
	map-industry.js — mine/factory pools, deposit locks, workshops and forestry production.
	map-factory-scan.js — engine factory placement scan: region need, site choice and kind selection.
	map-farm.js — farm fields: clearing to farmland, one worker per cell, batch harvest and food.
	map-kernels.js — single-pass kernels: conductance Jacobi, CO2 pairwise pass, bounded transfer, gradient push.
	map-diffusion.js — shared field tick, demand injection, haul and worker flow using the kernels.
	map-sites.js — discrete Site engine: delivered-price orders, SoA shipment pool, margin siting.
	map-market-flow.js — land stencil, catchment reach and joint intake admission.
	map-market-demand.js — bounded A/B pull, stock feedback and household use.
	map-population.js — settlement intake, satisfaction, population dynamics and waste.
	map-money.js — shared money interface: the mapeMoney container, price-slot layout, and the read/access helpers the HUD, trade, industry and render use. The default engine is map-money-gold.js; the old minted-money engine is separated in archive/map-money-legacy.js.
	map-money-gold.js — default money economy (price-model-b gold engine): conserved gold, town/firm/mine bids, price diffusion + gradient transport, wages, taxes, payment flow. Dispatched by map-economy.js's mapeStepMoney when mape.moneyEngine === 'gold'.
	map-fluid.js — optional fluid workforce model: fresh/depleted pools, settlement rest, hamlet spawn.
	map-scenes.js — seeded coal scenes and actor edits.
	investigate.js — investigation progress, float radius, Euclidean falloff, survey push, nearby list.
	party.js — members, shared values, skills, movement, camping, hiring.
	territory.js — per-faction influence fields, control, share, contest.
	rivals.js — rival agents: targets, travel, claims, extraction, scouting.
	victory.js — victory conditions, declaration, feedback.
	render.js — shared canvas painting, view modes, markers.
	render-economy.js — display presets, palettes, grid, contours and accepted flow.
	render-markers.js — settlement/industry markers and cached actor labels.
	input.js — clicks, hover mark, keyboard bindings.
	hud.js — side panel, view switch, around-list, context actions, feed.
	hud-economy.js — economy picker, simulation feedback, both legends and inspector.
	hud-display.js — look radios, overlay controls and paired-map layout.
	hud-scenes.js — scene controls, readouts and actor tools.
	hud-tune.js — left tuning panel: sliders, copy/apply settings text, saved knobs.
	actions.js — player verbs spanning features (move, work, sell, hire, restore, declare).
	experiments/ — smoke (sim), dom_smoke + dom_fixture (boot/UI), map_views (display),
	mape_compare (engines), mape_sites (site engine), mape_scenes (scenes), mape_population (settlements), mape_fluid (workforce), mape_fluid_migration (capacity and migration), mape_forestry (logs and forest production), mape_factory (placement scan), mape_farm (farms), mape_diffusion_speed (single-pass mix budget audit and reach), mape_co2 (CO2 sources, demand band, flow trails and ledger), mape_money (money ledger, minting, payment flows, purses); never loaded by the page.
- new code goes to its owner, never appended "because the file is already there". no owner exists -> new file + header + map entry.
- moves are pure moves: contiguous ranges, snap to enclosing declarations, no behavior change.
- refactor or dedup mixed into a move = defect. separate plan, record the idea as a finding.

- findings-pitfalls-skills.md — notes and pitfalls for LLM agents. write here if found a good way to do something.
- units-and-scales.md — field units, rate budgets and the single-pass stability rule; read before touching diffusion rates or the tick.
- archive/ — implemented plans, worklogs, and the archived B1 prototype labs (economy-demand-product-diffusion, price-model-b, water-humidity).

## prototype labs (B2 ports)

- prototype/shared/lab.css — common visual rules shared by both B2 labs; each lab's styles.css loads after and overrides only what differs.
- prototype/shared/lab-ui.js — `$` DOM lookup + `ICON_PATHS`/`labIcon(name)` SVG helpers; loaded before each lab's app.js. Per-lab `RESOURCE_TITLES`/`TOOL_KINDS` stay in app.js.
- prototype/shared/economy-panel.js — `EconomyPanel(diagnostics, rows, watched)` inspector shell (row groups + stall-flag list + clipboard copy); pure view over each lab's `diagnostics.js` contract.
- prototype/particle-transfer-b2/ — port of the d198120 reference lab: torus wrap, wage-claims + cost relaxation, particle/triangle/gold-flux rendering, Watched Workers audit (track.js/tracked.js), economy diagnostics. Tests: 38.
- prototype/price-model-b2/ — cell-lab B2 port + economy inspector adapter (diagnostics.js). Tests: 72.

## drafts = human input

- drafts/ — source of truth, concise human's ideas about goals and design. user prompts and anvers may be stored as drafts to keep a reference of the approved global task. keep with minimal changes unless strong reason.

draft -> ask if something not clear. update draft with user's answers -> plan

## plans = LLM roadmap

- *-plan.md is NOT the implementation log. final plan = standalone design artifact, written as if implemented today: no references to chat, to what was tried, or to what was done. usable for a fork or reimplementation.
- plan numbers (0.1, gui.1) identify subjects, not version or execution order. ok to continue old numbers by subject and implement in any useful order.


## worklogs

- worklog = index + evidence, not a diary. it has two future readers: the agent bisecting a regression into this change, and whoever forks or reimplements.
- worklog is named after its plan: archive/0.1.0-plan.md -> archive/0.1.0-worklog.md.
- entry <= 15 lines:
	plan id
	changed: file + nature (move/feature/fix), one line each
	validation: what ran, result, key numbers
	decisions and why — the only part anyone rereads
	pitfalls: one line here, full note in findings
	next step suggestion
- never record: plan restatement, attempt narrative, code walkthrough. git already has the diff.
- placement of process text:
	archive/ — how it was done
	findings — reusable lessons
	README — how to run only, <=10 lines, changes only when run instructions change
	in-game help / tooltips — written as if the product shipped today
- dev-process text anywhere else (README, in-game help, UI, tooltips) = defect.
- "we added a button to sum a and b" never exists outside archive/.

## experiments

- experiments/ — node measurement scripts, never loaded by the page.
- logs are machine format: fixed keys, fixed units, one line per metric.
	fps_pre=58 fps_post=61 step=2x plan=0.3
- comparison = a ~15-line node script diffing two logs by key, |delta| > 5% flagged; conclusion -> findings.
- keep only runs that produced a decision. prune the rest when the plan closes.

## validation

- scope = blast radius of the change. never "run everything to be safe".
	L0	node --check on touched files. every edit batch. seconds.
	L1	targeted smoke of the touched area (dom_smoke etc.). after a behavior change or a code move.
	L2	full suite + manual pass list. plan completion, handoff, or shared/boot files touched (index.html, load order, composer).
- leaf file touched -> L1 max. shared/boot touched -> L2.
- previous stage's validation stands until something it covers changes. no reruns to feel safe.
- batch checks at checkpoints, never per file inside one move. full tests after every work = CPU defect.
- manual pass list (what to verify by hand: look, sound, feel) lives in the plan.
- one file per commit (bisectable).

## workflow

Before all topics has minimal implementation Do not try to implement 100% of some draft topic at once: the 1st goal is implement each as simplest minimal to view how all works in real whole minimal game. for example you can implement only 1 resource cycle or one of person's skill.

- start work with review of the previous task: it was done by another agent and you can find a better way or real issues.
- same review polices compliance — comment budget, worklog format, placement. fix in place, one line in your own worklog. no test reruns: previous stage already validated it, rerun only what your fix itself touches.
- review the next step plan. improve it only with a concrete reason, then implement.
- record steps and validation in `archive/*-worklog.md` per `## worklogs`.
- end the job with a next step suggestion.

## sandbox

- git push returns "Invalid username or token" is ok, no need to investigate or report - i will apply manually

## current workstream

- plan-prototype.md, plan-map-economy.md and plan-particle-transfer.md are the standing designs;
  change their numbers with the owning file in the same edit. plan-particle-transfer.md is the design
  for the default particle money engine (`prototype/particle-transfer-b2/`, port target
  map-money-particle.js); its rules lift from prototype/price-model-b2 plus worker-owned splitting and prolonged starvation, commercial food farms,
  coarse food-gradient foraging and Monastery gardens. Towns never manage worker lifecycle.
  Particle lab owners: worker-life.js (splits/starvation), farms.js (fields/harvest), towns.js (services/bazaar).
- experiment files cover the loop: smoke (sim), dom_smoke (boot + UI), survey_spread. run
  smoke + dom_smoke after touching main.js, index.html or load order.
- keep files under ~600 lines where practical; go beyond that only with a reason; a new feature gets a new file, header and map entry.
- economy playtest: Diffusion owns demographic growth; A/B hold growth and
  satisfaction-led migration while shared job staffing remains active. Two
  selectable workforce models: Residents (default) and Fluid field (map-fluid.js
  pools; tire/rest/spawn constants are the balance subjects). Factory
  build/recipe runtime, sawmill → logs → charcoal/wood works supply and the
  generic factory placement scan + idle rule exist (Phase 3). Site engine
  (map-sites.js: orders, shipments, margin siting) runs as `SITES` and its HUD
  switch is live (Phase 5); victory stability checks (population steady, industry under control) are in.

## housekeeping

- this file is editable law: a rule that produced a bad outcome gets fixed in place, never worked around.
- prune dead rules when a plan closes. target < 150 lines — the "don't waste context" rule applies to this file itself.
