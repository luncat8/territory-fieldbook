# Minimal playable prototype plan

## Goal and boundaries

Build one locally runnable, single-player simulation that exercises the map, investigation, sites, party, competition, economy, land condition, survival and victory together. Prefer one working example of a system to comprehensive content or balance. This is a prototype: numeric rates and thresholds below are starting values, not final rules. The player must be able to see why a result occurred and try a different strategy.

Run by opening `index.html` with `file://`: plain HTML, CSS, classic JavaScript scripts and Canvas 2D, with no build step, server, external assets or dependencies. A new game takes a seed; the same seed and the same actions at the same ticks produce the same result. The existing page is only a canvas skeleton, not an implemented game.

## Player loop

1. Start a seeded map, inspect terrain, party, stocks and rival territory. Pause initially.
2. Click a cell to move the party instantly, then run time to investigate nearby cells. Select a site to inspect it; claim or complete it when eligible.
3. Extract a claimed deposit, collect a reward, hire or dismiss a member, and establish an influence source. Watch supplies, land condition and the rival's progress.
4. Stop depletion, restore damage and use a renewable energy cycle. Inspect the victory checks and declare when ready, or continue playing.

Keep the map visible throughout. A compact side panel shows the selected cell/site, context-sensitive actions and the party/economy summaries in that order; a top bar provides seed/new game, pause/run and view mode. Use an event feed for discoveries, claims, depletion, hardship and failed declarations. Disable unavailable actions with a short reason. Labels and numeric values accompany colours.

## Shared simulation conventions

- Use a fixed one-second simulation tick, accumulated from real time while running, with a modest default speed (for example one tick per real second). Pausing stops all simulation, including rivals. Cap catch-up work per animation frame without silently advancing unprocessed simulation time.
- Use a seeded PRNG for generation and simulation; never use `Math.random` for gameplay. Process cells and actors in a stable order. Actions happen between ticks and are recorded in tick order for reproducible tests.
- Store cell fields in typed arrays indexed `y * 64 + x`: terrain, investigation, disturbance, influence per party, deposits and site references. Keep sparse sites and members in small records with stable IDs. Reuse buffers for simulation and rendering; avoid per-frame allocations where practical.
- One player party and one deterministic non-combat rival share the map. The player can click any in-bounds cell, including water; no pathfinding or travel duration. Movement changes position but does not reveal the whole map. For the first prototype, party positions are cell centres; distance calculations still use floating-point Euclidean distance to cell centres.
- Keep one authoritative simulation state. UI reads derived values and sends commands; rendering does not modify game state. Define resources, processes, terrain rates and skill thresholds as data, not branches scattered across the UI.

## Minimum rules

### World and investigation

- Generate a deterministic 64 × 64 heightmap using seeded smooth 2D value noise. Derive forest, meadow, water, swamp, hills and desert from height and a second seeded moisture field. Assign terrain search and recovery rates in a table. Guarantee a usable starting area and at least one accessible example of each site type; guarantees must also be seed-deterministic.
- Display all terrain initially, but hide hidden sites. Each party tracks its own per-cell investigation from 0 to 100. Each tick, use continuous Euclidean distance from the party position to each nearby cell centre. Apply a smooth, clamped falloff within a configurable floating-point observation radius; cells outside it receive no progress. Forest reduces that radius; hills increase it and raise the multiplier toward 1 without exceeding 1. Clamp progress to 100 and use terrain and party observation capability to set the rate. The radius is continuous; cell coordinates only determine which centres are sampled.
- Map modes: terrain, investigation percentage, influence/control and disturbance. Show exact values for the selected cell. Show the party's actual search footprint and an indicator when an active hidden site can be discovered, without revealing its exact identity or cell prematurely.

### Sites and claims

- Seed a small fixed number of sites: visible, interesting (visible marker but identity hidden) and hidden. Give each a stable location, type, presence window and state. Some are permanent; at least one is time-limited. Presence and discovery are separate: sample a presence roll at generation, and while present use a separate seeded discovery roll each tick once investigation is positive. Discovery probability increases monotonically with investigation. Display time remaining for a discovered temporary site; expiration removes unclaimed opportunity without awarding it.
- Include one each of: a one-time resource cache, abstract item, party experience, task, and finite deposit. A discovered site is fully recorded by an explicit action at its cell after reaching 100% investigation there. The first party to record it claims its primary value; competing claims fail with feedback. Immediate sites are visible from the start but still require recording for ownership. One-time rewards cannot be collected twice. A task has a simple skill threshold and reward; an item is an inventory entry, not a complex equipment system. Experience raises a relevant member skill.
- A claimed deposit has finite stock and an on/off extraction action. Each tick transfers stock through the mining recipe only if inputs are available. Stop at depletion, mark it depleted and emit an event. Extraction adds disturbance to the deposit cell. A claimed site can also serve as a maintained influence source; neither claims nor inventories are silently transferred.

### Party, skills and competition

- Start with two members and a small hiring pool. A member has learning, physical condition, recovery, growth potential, six domain skills and a recurring wage. Party condition and morale are shared 0–100 values; supplies and funds are shared stocks. Show the member contributions and ongoing costs before hiring or dismissal. Prevent dismissal of the last member.
- Sum member skills to calculate party capability. Include all six domains with one small observable effect each: Navigation reduces movement supply cost; Fieldcraft reduces condition loss; Observation improves investigation/discovery; Knowledge improves deposit output; Communication enables a task; Logistics reduces supply use. Use bounded rates so every effect remains understandable. Skill use grants experience scaled by learning; a simple paid training action raises a selected skill. Rest recovers condition based on member recovery, costs time and supplies, and training can improve physical condition only up to growth potential. Morale reacts to rewards, unpaid wages and rest.
- Demonstrate emergent skills with the draft's three combinations: route charting reveals an additional observation ring, field assay displays remaining deposit stock, and local trust permits a corresponding task. Show thresholds, locked/unlocked state and the resulting effect; avoid hidden prerequisites. Extra observed cells may reveal sites but do not expand the investigation footprint.
- Recompute influence from maintained claimed-site sources for both parties using a bounded smooth distance falloff; decay remaining influence each tick when a source is no longer maintained. Higher influence controls a cell; ties are neutral. Investigation, claiming, extraction and restoration are allowed in neutral or own-controlled cells, not rival-controlled cells. Explain blocked actions in the panel. Display territory as shares of all 4096 cells, including neutral, and count control consistently for victory.
- The rival follows a deterministic simple policy: investigate and record a reachable neutral site, maintain claims, then extract its deposit while inputs last. It obeys the same discovery, claims, stocks and control rules, affects the same land and cannot fight. Show its position, claims and aggregate stocks; no elaborate AI, access rights, contracts or reputation.

### Economy, land and survival

- Implement a small data-defined mass/energy ledger rather than a full industrial simulation. Track stocks in consistent abstract mass units and energy units separately; do not add mass and energy into a single total. Deposits, inventory, atmosphere and disturbed material are included in mass accounting; sunlight is external energy input and heat is energy leaving the model. Money is a separate accounting token, not physical mass. Work and food/supplies must either be represented as ledger stocks or explicitly excluded consistently from the physical ledger.
- Provide one finite mining recipe (deposit plus energy becomes ore plus disturbed material), one recycling recipe (disturbed material plus energy becomes recovered ore plus residue), and one renewable biosphere/energy recipe. For a minimal closed carbon/oxygen cycle, use abstract carbon, oxygen and biomass mass units: photosynthesis consumes carbon and sunlight to produce equal total mass of biomass plus oxygen; biomass use consumes biomass and oxygen, returns equal total mass of carbon, and releases stored energy plus heat. Record stored chemical energy as a stock so each process balances energy as well as mass. Use the coefficients in `RECIPES`: mining sends 80% of removed stock to ore and 20% to residue; recycling recovers half of its input; photosynthesis turns each carbon unit into half biomass and half oxygen, with one sunlight unit split equally into stored energy and heat. Burning that biomass with its oxygen returns one carbon and transfers stored energy to the party. Energy spent by mining, recycling and restoration becomes heat. Validate available stocks before applying a process. Stop a process rather than allowing negative stocks.
- Apply photosynthesis only on productive forest, meadow and swamp cells; energy and carbon/oxygen availability constrain flows. Give the player a finite starting energy reserve, so extracting a deposit is possible before the renewable cycle is established. Track per-tick flows and recent totals so a player can see inputs, outputs and shortages. A simple local population/material/food/oxygen and nearby claimed-site factor affects mine throughput, bounded and displayed; omit buildings and full industrial chains for now.
- For each cell track disturbed fraction `d` in [0, 1] separately from disturbed material mass: it is land coverage, not another material stock. Mining increases `d`; productivity is `base * (1 - d)` and farming/renewable production requiring farming is disabled at `d >= 0.2`. Blend terrain toward a degraded colour. Natural recovery reduces `d` slowly by terrain; an explicit restoration action costs ledger-tracked energy and material, reduces `d` faster and works remotely only with an additional transport cost. Recovery changes area condition, not material mass; residue remains in the ledger. Rival damage persists and recovers under the same rules.
- Use one abstract town trade action: exchange ore or recovered ore for funds and buy supplies at displayed rates that respond in a simple bounded way to current stock/demand. Wages and trade transfer money between parties and a town account; no full market, currency issuance or price history. Show funds, supply consumption and wages. Party condition falls when working or lacking supplies, recovers by resting, and morale falls after setbacks or unpaid wages. If condition reaches zero, or supplies are exhausted for a defined grace period without recovery, the party fails. A sustained regional oxygen/energy shortage also causes hardship and eventually failure; display the timer and reason. Failure stops the player's simulation and offers restart.

### Declaration

No time limit. A button evaluates and explains every condition, without ending the game on failure. For a minimal explicit stability rule, require all of:

1. The player controls strictly more cells than the rival (neutral cells do not count for either party).
2. During the last 30 ticks, no player-controlled process consumed finite deposit stock; renewable production is active and total player energy stock did not decrease.
3. During the same window, total disturbance in player-controlled cells did not increase and no active player process is adding disturbance. Recompute the area at each tick so changes in controlled cells are visible rather than hidden.
4. The player is alive and has positive supplies, oxygen and energy.

Show progress or the failing condition for each check, including insufficient history. A successful declaration records the result and pauses the game; the player may continue, with rivals still active. These definitions are deliberate prototype answers to the draft's open questions, not claims of final balance.

## Ownership and delivery slices

Keep script load order in `index.html`. A `main.js` composer owns boot/wiring and shared roots only; feature files own their state and APIs. Avoid definition-time cross-file reads and global names that collide with HTML IDs. Guard `module.exports` where Node tests need direct access. Update the ownership map in `AGENTS.md` as files are introduced; split files before they grow beyond roughly 500 lines.

1. **Playable shell and world:** page layout, canvas sizing/input, seeded terrain generation, fixed-tick pause/run, selection and instant movement. Verify same seed gives identical cells, edge clicks stay in bounds and pause freezes ticks.
2. **Investigation and sites:** terrain rates, smooth footprint, progress view, presence/discovery, site states and one-time actions. Verify monotonic capped progress, deterministic independent rolls, temporary expiry and no duplicate rewards.
3. **Party and capabilities:** members, hiring/pay, condition, supplies, all six small skill effects, training and emergent thresholds. Verify costs, bounds, skill contribution changes on dismissal and visible unlocks.
4. **Rival and territory:** rival policy, first-record claims, sources, falloff/decay, control and map overlay. Verify deterministic ties, competing claims, denied actions and shared impact; pause freezes both actors.
5. **Economy and land:** data-defined balanced recipes, finite deposits, stock/flow view, disturbance/recovery, trade and hardship. Verify no negative stocks, finite depletion, mass/energy conservation per recipe and across ticks, restoration costs and rival damage.
6. **Survival and declaration:** failure/restart and explicit stability history/checks. Exercise both a rejected and a successful declaration, and continuing after success.

Slices are implementation checkpoints, not an invitation to polish one subsystem before all are represented. A later slice may introduce a small temporary stub in an earlier one, but replace it before handoff. Keep implementation decisions and test evidence in the corresponding `archive/*-worklog.md`; this plan remains the standalone design.

## Validation and manual pass

- Add dependency-free Node tests for seeded generation, fixed ticks, search geometry and rates, site lifecycle/claims, party changes, influence, ledger conservation, disturbance, survival and declaration. Test process inputs and outputs in isolation and in a short integrated deterministic scenario. Use floating-point tolerances for ledger and progress comparisons; assert non-negative stocks and bounds every tick.
- On each code batch run `node --check` for touched JavaScript; run the relevant targeted tests after behavioural changes. At integration/handoff run the full suite and perform the manual pass. Document commands and results in the worklog.
- Open `index.html` directly in a browser: start two games with the same seed; inspect every terrain and overlay; click map edges; pause/run and move; discover and claim sites, including an expiry and rival contest; hire, train and dismiss; extract, observe depletion and land damage, then restore; inspect a ledger shortage and recovery; trigger hardship; check failed and successful victory feedback and continue after success. Confirm canvas and panel remain usable at a narrow viewport and labels do not rely on colour alone.

## Later work, not required for this prototype

Balance and richer site content; more realistic population, buildings, processing and pricing; dispersed-resource recovery; detailed ecological/climate modelling; dynamic learning ability; access, contracts and reputation; sophisticated rival planning; final victory definitions. Use playtest observations to revise the draft and plan the fuller implementation after the whole minimal loop works.
