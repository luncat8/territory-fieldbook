# Prototype plan — territory fieldbook

Standalone design of the minimal playable prototype. It covers one minimal version of every
draft2 topic: map, time, movement, investigation, sites, party, skills, competition, economy,
land condition and victory, plus the gameplay-oriented screen. All numbers below are the
shipped values; they live in the owning source file.

## Scope

Playable loop: move the party over a seeded 64×64 map, investigate around it, find and claim
sites, work finite deposits, sell at towns, improve skills until emergent capabilities unlock,
watch two rivals claim and extract on their own, keep the map's land and biosphere in shape,
then declare victory.

Deferred, low priority: multi-cell industry, learning ability changes, difficulty tuning,
Contracts, reputation, access. the draft has no details for them and they are unlikely to be interesting unless
thought through well before implementation.

## Runtime and architecture

- Classic `<script>` tags, no modules, no build, works from `file://`.
- `index.html` owns load order. `main.js` is the only composer: `$`, shared `clock`, boot and
  the fixed-step tick order. It implements no feature.
- Plain top-level globals. No per-file IIFE, no definition-time cross-file reads.
- Feature files own their state: typed arrays, struct-of-arrays, linear cell index
  `i = y * 64 + x`, sequential loops for the map-wide passes.
- Canvas 2D. Cells are painted into a 64×64 `ImageData` and scaled up with smoothing off, so a
  frame allocates nothing; markers and rings are drawn on top with paths.
- `actions.js` owns the player verbs that span several features (move, work, sell, hire,
  restore, declare). This is the only place where features touch each other for player intent.

File map:

| file | owns |
|---|---|
| `random.js` | seeded LCG streams shared by generation, sites and rivals |
| `world.js` | terrain grid, heightmap generation, map queries |
| `events.js` | the event feed and the transient status line |
| `land.js` | disturbed fraction, productivity, recovery, restoration |
| `economy.js` | resources, town stocks, prices, recipes, biosphere, ledger |
| `sites.js` | site pool, discovery, claims, extraction, site payouts |
| `investigate.js` | investigation progress and distance falloff |
| `party.js` | members, shared values, skills, movement, camping, hiring |
| `territory.js` | influence fields per faction, control, share, contest |
| `rivals.js` | rival agents: target choice, travel, claims, extraction |
| `victory.js` | victory conditions and declaration feedback |
| `render.js` | canvas painting, view modes, markers |
| `input.js` | clicks, hover target, keyboard bindings |
| `hud.js` | side panel: clock, stats, skills, site, actions, feed |
| `actions.js` | player verbs and their gates, costs and rewards |
| `main.js` | boot, wiring, shared clock, tick order |

## Time

One tick is one game minute. Speeds are 0, 6, 12 and 24 ticks per real second (1 game hour per
10 s at 1×). A frame accumulates real time and runs whole ticks with a 64-tick catch-up guard.
The party's action is instantaneous (click to jump); everything else advances per tick.

Tick order: `party → investigation → sites → rivals → territory → land → economy → events`.
Territory runs after party and rivals because both mark their influence sources as maintained
for this tick; territory decays the rest.

## Map

- 64×64 cells, linear index, five terrain effects tables keyed by terrain id.
- Deterministic from seed: value-noise fbm, 4 octaves at frequency 0.05 for height and 3
  octaves at 0.07 for moisture, integer hash per lattice point.
- Terrain rule, first match wins: water `height < water`; hills `height > hills`; desert
  `moisture < desert`; forest `moisture > forest`; swamp `moisture > swamp`; else meadow.
  Thresholds are tuned so all six types occupy a visible share of the map.
- Water is impassable to the party and to rivals.
- Party spawns at the walkable cell nearest the centre, preferring meadow.

Terrain table (ids: meadow 0, forest 1, water 2, swamp 3, hills 4, desert 5):

| terrain | investigation rate, fraction/h | travel effort | land recovery, d/h |
|---|---|---|---|
| meadow | 0.50 | 1.0 | 0.0020 |
| forest | 0.30 | 1.4 | 0.0028 |
| water | 0 | — | 0 |
| swamp | 0.26 | 1.8 | 0.0014 |
| hills | 0.40 | 1.6 | 0.0008 |
| desert | 0.20 | 1.3 | 0.0006 |

## Investigation

- One float radius `INV_RADIUS = 3.5` cells (hills +1, forest −1, never below 2). There is no
  3×3 / 5×5 mode: the radius is Euclidean distance from the party's cell centre to each cell
  centre. Nearby cells are interpolated by that distance; the grid is never the operator.
- Multiplier: 1 while `dist ≤ INV_INNER` (1.2); then smoothstep
  `t = (reach − dist) / (reach − inner)`, `m = t²(3−2t)`, 0 at `dist ≥ reach`. Never above 1.
- Progress is a `Float32Array` in 0…1, capped at 1. Per tick:
  `progress += rate[terrain] * m * party.investigateFactor() * contest * hours`.
- A cell at 1 means the ground is fully recorded. A visible site on a fully recorded cell is
  claimed for the party automatically: recording is the claim. Cells within 1.6 of spawn start
  at 0.5 so the camp reads on screen immediately.
- `party.investigateFactor()` is `0.45 + condition/220 + morale/500`, halved while working a
  deposit. `contest` is 1, or 0.25 when a rival's influence is higher in that cell.
- **Survey** is the player's deliberate verb: one immediate pass worth 2.5 h of the standing
  sweep, costs 2 condition, trains observation 0.2, then a 6 h cooldown. It reuses
  `investigationSweep` with no multiplier of its own, so the radius, falloff and contest rules
  are the same in both paths. 2.5 h finishes the core cells and leaves the outer ring partial:
  a survey claims what the party already worked on and marks sites out to roughly 3 cells, it
  does not clear the whole disk in one press.
- Unexplored cells are painted dark; investigation level drives the fog brightness and the
  investigation view.

## Sites

Pool of 96 slots in struct-of-arrays: position, kind, state, resource, stock, claim, lifetime,
discovery rate, town id, trust flag.

States: hidden (not on screen) → marked (presence known, "?" indicator) → visible (actionable)
→ done (spent). Gone slots are reused by timed sites.

A hidden site becomes marked once its cell's investigation reaches 0.20. A marked site becomes
visible with probability `discover * progress * hours` per tick, so investigation is the only
way to identify it. Timed sites lose lifetime in game hours and disappear when it runs out.

Visibility at placement: 35 % immediately visible, 35 % marked, 30 % hidden; towns always
visible and permanent.

Placement per map: 3 towns, 12 deposits, 10 gather sites, 5 items, 4 skill sites, 5 tasks, plus
timed one-shot sites that spawn with 0.35/h probability, live 36–96 h and use the same
hidden/marked discovery rules. Four starter sites are placed within five cells of the party so
the first minute has a decision.

Site kinds and payouts:

| kind | payout |
|---|---|
| gather | resource quantity once, into the party inventory |
| item | one abstract item, sold later at a town, small morale gain |
| skill | training in one skill domain |
| task | skill check against the stored domain; reward in funds, morale on success, setback on failure; some tasks require local trust |
| deposit | extraction while worked, finite stock, depletes and leaves disturbance |
| town | market: sells resources and items, buys supplies, hires members, influence-free |

Claim rule: the first party to fully record a site's cell, complete the site or work it sets the
claim. A claimed site feeds an influence source. A player can work a claimed deposit only while
holding at least equal influence in its cell; otherwise it is blocked (the rival's claim holds).

Extraction: `min(stock, rate[resource] * workFactor * productivity * hours)`; 60 % of the mass
goes to the claimer's inventory (player only), the rest is left in the cell as disturbance, and
both are recorded in the ledger. A deposit is done at zero stock.

## Party

Shared values: condition 0…100, morale 0…100, funds, supplies, items, members.

Per hour: supplies `−0.09 × members`; wages `−0.30 × members` (morale falls while unpaid);
condition recovers while camped with supplies (`Σ recovery × 0.18/h`), otherwise drains
`0.18 + 0.12 × travel effort` plus `0.5` when out of supplies. Condition 0 loses the party.
Morale pulls toward 50 at 2 %/h and moves on events. Supplies are provisioned from food
(5 food → 5 supplies, anywhere) or bought at a town for 5 funds per unit, which also consumes
0.5 town food per unit. Low supplies and low condition each raise one warning event.

Members carry base characteristics set at hiring — learning 0.7…1.4, physical 0.7…1.3,
recovery 0.7…1.3, growth potential 1.0…1.6 — and six skill values capped at
`2 + potential × 6`. Party skill is the sum over members.

Six domains: navigation, fieldcraft, observation, knowledge, communication, logistics.
Training is distributed per member scaled by learning ability; travel trains navigation,
investigating observation, extraction knowledge and logistics, tasks communication.

Emergent party skills at threshold 7 on a pair:

| pair | capability |
|---|---|
| observation + navigation | route charting: vision and fog radius +2 |
| knowledge + logistics | field assay: deposit stock is shown before working |
| communication + fieldcraft | local trust: trust-gated tasks become available |

Hiring costs `50 + 25 × members`; dismissal removes the last member's skills (never below one
member) and costs 3 morale.

## Competition and territory

Three factions: player, Ash Company, Salt Guild. Influence is a continuous field per faction,
a `Float32Array` of 64×64 per faction, recomputed every tick from sources with a smooth
quadratic falloff `1 − d²/r²` (no square roots), summed per faction.

Sources: camp (strength 1.0, radius 4.5), claimed site (0.8, radius 3.5). A source is
maintained when its owner's party is within 6 cells; otherwise its strength decays (camp
0.03/h, site 0.004/h) down to zero. Fields are rebuilt from current strengths each tick, so a
neglected claim visibly fades.

Control: the faction with the highest field above 0.05 owns the cell. Share is controlled cells
over all cells. Contest factor for investigation and deposit work is 0.25 when any rival field
is higher than the player's in that cell.

Rival agents work one home region each (18 cells around their camp) so competition is
territorial rather than map-wide. They move at 6 cells/h, greedy along the axes with water
avoidance and a sidestep escape, pick the nearest unclaimed visible non-town site inside that
region, claim it on arrival, and work deposits at 70 % of the normal rate. They identify one
marked site per hour with 25 % probability, mirroring investigation, and maintain their own
sources by standing near them. With no target they wander back toward home.

## Economy

Resources are data: id, name, base value, reference stock, town opening stock, deposit rate.

| resource | base value | reference stock | town opens with | deposit rate/h |
|---|---|---|---|---|
| food | 3 | 40 | 40 | 3.0 |
| timber | 4 | 30 | 25 | 3.0 |
| ore | 7 | 15 | 8 | 2.2 |
| crystal | 12 | 6 | 2 | 1.4 |
| fuel | 5 | 12 | 10 | 2.4 |
| goods | 18 | 8 | 5 | — |

Price at a town, per unit:
`base × ref/(stock+1) × (1 + demand)`, clamped to 0.35…3 × base. Selling raises the town's
stock and lowers the price; town consumption raises demand and the price. Each town holds a
money stock (380, regen 1.5/h) and can only buy what it can pay for — money exists as long as
someone accepts it. Towns consume food and fuel per hour and restock 2 %/h toward their
reference stock, so dumping a whole deposit has a visible price cost.

Supplies cost 5 funds per unit and consume 0.5 town food per unit. An item sells for 14 funds.

One recipe is the product layer, defined as data (inputs, outputs, oxygen, energy):
`1 ore + 1 fuel + 1 oxygen → 2 goods + 1 carbon`, available anywhere. Goods sell at the base
price with a higher value than their inputs.

Biosphere: per-cell biomass `Float32Array` initialised from terrain (forest 0.85, swamp 0.55,
meadow 0.35, hills/desert 0, water ​0), growing with productivity `(1 − d)` toward 1. Mature
biomass fixes carbon at `biomass × rate[terrain] × productivity × hours`; half becomes oxygen,
half stays as biomass. Towns burn 0.04 oxygen per hour each and recipes consume one oxygen per
craft; both release carbon. Sun energy and fuel energy are recorded for display.

Conservation ledger, checked on every transformation: mining records removed mass in and
`ore + left behind` out; processing records `ore + fuel + oxygen` in and `goods + carbon` out;
sunlight and fuel are recorded separately as energy. Mass in must equal mass out within 1e-6.
The stored energy counters are shown in the victory panel as evidence.

## Land condition

`d` is a `Float32Array` per cell, 0 untouched … 1 fully disturbed. Mining adds
`units × 0.006` per extracted unit, so a fully worked deposit sits just above the 0.25
threshold. Productivity is `1 − d`; it scales deposit yield and biosphere growth. Natural
recovery runs at the terrain rate scaled by `(1 − d)`: the more disturbed a cell is, the
slower it recovers, and fully disturbed land (`d = 1`) does not recover on its own.
Active restoration costs 12 funds and 2 supplies and removes 0.25 `d` from the party's
cell immediately.

Appearance blends the terrain colour toward degraded brown by `d × 0.75`, and the disturbance
view shows `d` directly.

## Victory

There is no timer. Survival (the party is not lost) is a precondition. The player declares
victory from the panel; the check reports every failing condition:

1. territory lead — the player's control share is the largest by at least VICTORY_MARGIN (0 for the prototype, i.e. strict largest) and above 5 % of the map;
2. resource base — remaining deposit stock is at least 25 % of the starting stock;
3. disturbance under control — no cell with `d ≥ 0.25` outside player-controlled cells;
4. biosphere balance — cumulative oxygen produced is at least oxygen consumed.

A rejected declaration lists the failing items; a valid one flags the run as won. After a
valid declaration rivals stop competing and the declare button disables. If the party
is lost, the panel offers a new survey on a new seed instead of a dead end.

## Screen and controls

Layout: square map on the left with an around-list under it; one side panel on the right. No
tabs, modals or mode jumps.

Around-list (under the map): recording % in the party's cell, current float reach, then nearby
marked/visible/spent sites within 8 cells, each with Euclidean distance, name, state and that
cell's investigation %.

Under the map: the view switch, a joined five-mode group of real radios (`role="radiogroup"`,
labelled), then the around-list. Exactly one writer — the group's `change` handler — applies the
mode by setting `render.view`, refreshing the panel and redrawing; the `1`…`5` keys and the
pointer preview route through the same handler. On `(hover: hover) and (pointer: fine)` moving
over a mode selects it as a preview by checking its radio; touch and stylus stay click-only, and
a hover that resolves to no mode is ignored. The group is styled from the shared tokens in
`index.html` (`:root`), so the checked, hover, focus-visible and disabled states all come from
the palette rather than literals.

Side panel, top to bottom: clock and speeds (pause/1×/2×/4×); condition, morale, funds, supplies,
items, members; skills with unlock marks; member rows; current-cell site details and market
prices of carried goods; the action list for the current context; victory declaration and its
feedback; status line; event feed.

Actions are context-driven from the party's cell: camp, survey, work/stop
deposit, gather, take item, train, attempt task, sell all, sell item, buy supplies, provision
supplies from food, process goods, restore land, hire, dismiss, declare victory. Buttons that
cannot run are disabled.

View modes: terrain, investigation, influence, disturbance, biosphere. The map always shows
markers — towns, deposits, one-shot sites, the party, rivals, claims in faction colour, a "?"
for marked sites, an amber dot when a site can be discovered right now — and a dashed ring for
the investigation reach.

Input: left click jumps the party to a cell; space pauses; `1`…`5` switch views; `i` surveys;
`c` camps; `w` works the deposit under the party. The clicked cell keeps a mark so the jump
target is visible.

## Validation

- L0: `node --check` on touched files.
- L1: `node experiments/smoke.js` derives the script list from `index.html`, runs every script in
  one VM context, then drives `main.setup()` and `main.step()` and prints machine format
  metrics: terrain shares, investigation reach, site discovery and claims, deposit depletion,
  disturbance, territory share, ledger residual, victory failures.
- L2: `node experiments/dom_smoke.js` boots the page against a stub DOM — frames, canvas paint,
  clicks, keys and every enabled action button — and fails on any page exception.
- L2 (shared/boot touched): full smoke plus the manual pass list — look, feel, sequence:
  - map reads as six distinct terrains; fog lifts as cells are investigated;
  - the five view modes change the picture without hiding markers;
  - click-jump cost shows in condition; camping recovers it;
  - a hidden site turns into "?", then into a named site, and its actions appear;
  - working a deposit raises inventory and disturbance, and the terrain fades there;
  - selling at a town moves funds and the price falls; buying supplies restores them;
  - hiring raises wages and skills; unlocks appear after training;
  - rivals claim and degrade a patch on their own;
  - declare victory early lists the missing conditions instead of going silent.
