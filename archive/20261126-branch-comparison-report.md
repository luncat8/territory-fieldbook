
# task

fetch old outdated main branch d1981200cf3cd1511c93377fedc96238ebb66c3fthat was maid on some old drafts and have some missing or wrong understanding on design of workers behavior in particle engine. they mainly works on cell based price-model-b2 as i understand and they have good view panels that inform about issues visually, but current branch work most on particle engine and updated draft.

compare with current active implementation in current branch (implemented wrap xy, and some logic fixes) and against updated drafts.

is anything worth to pick?

i recommend if some models big diverge - pick as new prototypes to keep both. 

else if some prototypes similar but outdated - pick good changes or ideas and implement in current branch.


Fetched `d1981200cf3cd1511c93377fedc96238ebb66c3f` (`origin/main`) and compared it against the current branch (`arena/2b7bbe26-territory-fieldbook` at `4e67047`, from `particle-transfer-b2b`) and the updated `draft/` files. Both branches diverge from the same merge-base `73dc6d4` (`drafts: combine particle-transfer model and draft2 edits`).

---

# report by agent


## 1. Ground-Truth Comparison (`d198120` vs Current Branch vs Updated Drafts)

First, two important structural clarifications from inspecting the git history:
1. **Where the visual issue panels in `d198120` actually live:** They are inside **`d198120:prototype/particle-transfer/`** (`diagnostics.js`, `economy-panel.js`, `track.js`, `tracked.js`, plus `fields.js` heading-triangle rendering) — **not** in `price-model-b2`.
2. **Where `price-model-b2` and `wrap-XY` actually stand:**
   - **Current branch (`HEAD`) is far ahead on BOTH `price-model-b2` and `particle-transfer-b2`**, whereas `d198120` only pasted the updated `draft/*` files in its final commit *after* building its code against older drafts.
   - **Important gap found inside current branch (`HEAD`):** Commit `87559dc` (`map border fix with wrap XY`) implemented `MAP_WRAP` / `wrapCell` in **`prototype/price-model-b2/` only** — **`prototype/particle-transfer-b2/` is still hard-bounded** and does not have `wrap-XY` yet.

### Model-by-Model Verdict

| Area | Old `main` (`d198120`) | Current branch (`4e67047`) | Verdict vs Updated Drafts |
| :--- | :--- | :--- | :--- |
| **Particle lab** | `prototype/particle-transfer/` (37 tests) — hybrid docked cell stocks (`labor[i]`/`depleted[i]`) + walkers; "residents as a measure"; **deleted town wait pool**; town famine deaths; no personal food bag, `FORAGE`, gardens, bazaar food, or farms. Collapses at ~4 min (2048/2048 stalled workers, 99% gold in wallets). **Has great visual inspector & watched-worker audit panels.** | `prototype/particle-transfer-b2/` (26 tests) — every person is a persistent SoA worker particle; towns sell room rest & bazaar food only (never spawn/despawn/route); keeps both firm pool & town wait pool; dedicated `FORAGE` over half-res 4-tick gradient + Monastery gardens; commercial `farms.js`; worker-owned 45s splits & 120s empty-bag starvation. **Missing `wrap-XY` and visual diagnostic panels.** | **Same target engine, outdated predecessor — do NOT keep `prototype/particle-transfer/` as a second prototype.** Keep `particle-transfer-b2` and **port the visual panels, worker audit, rendering, and per-worker wage claims** from `d198120`, plus **port `wrap-XY`** from `price-model-b2`. |
| **Cell lab B2 (`prototype/price-model-b2/`)** | Outdated step-10 base + demography patch (51 tests): **removed `townWaitPool`** (`poolTarget(town) === 0`) and added 30s town famine thinning on minted cell labor. Lacks `towns.js`, `harvest.js`, `farms.js`, sawmills, resident workers, litter/CO2, and `wrap-XY`. | Full steps 11–14 (70 tests): `towns.js`, land build ladder, `harvest.js`, `farms.js` (sawmills + 7s farms + plot-clearing wood conservation `6e9d149`), conserved resident workers (`fresh`/`away`/`rooms` + ring eviction `ca4f686`), CO2/litter, and **`wrap-XY` torus (`87559dc`)**. | **Current branch strictly supersedes `d198120`.** `d198120`'s B2 changes contradict `draft/workers-food.md` (deleted town wait pool + town-famine deaths). Keep current B2; only pick `16×` speed (and optional inspector panel if desired). |
| **Cell lab B (`prototype/price-model-b/`)** | Replaced `goalPop` formula shedding with savings-gated births + 30s town famine clock; `16×` speed. | Untouched historical Model B baseline. | **Skip engine changes** (Model B is an archived pre-wallet baseline and town-famine deaths conflict with `draft/workers-food.md`); optionally pick `16×` speed in UI. |
| **Docs / Findings / Scratch** | `findings-pitfalls-skills.md` (+59 lines), `experiments/diag8..11.js`, `16×` speed in `water-humidity` & `diffusion/{a,b}`. | Updated `plan-particle-transfer.md`, `plan-price-echo-fix.md`, B2/particle findings. | **Pick valid engine-general findings** + `16×` speed options; **skip** `diag8..11.js` (scratch scripts tied to old API) and obsolete "particles only while walking" finding. |

---

## 2. Is Anything Worth Picking from `d198120`? — **Yes, 5 Concrete Picks**

None of `d198120`'s *simulation rules* diverge in a worth-keeping model direction (its worker/town rules were based on the old misunderstood drafts and self-stall after ~4 minutes), so **no new separate prototype folder is needed**. However, **5 items from `d198120:prototype/particle-transfer/` are high-value and directly fit `prototype/particle-transfer-b2/`**:

1. **Visual Economy Inspector Panel + Stall Flags + `Copy all stats` (`diagnostics.js` + `economy-panel.js`):**
   - Live grouped panel (`Workers`, `Gold`, `Wages & taxes`, `Prices`) with **red `.off` alarm highlights** and plain-English **stall flags** (`#economy-flags`: pool at cap, stopped/stalled walkers, excessive `FORAGE` / empty bazaar stocks, gold trapped in wallets vs broke towns, underwater in-flight asks `ask > bestBuyer` for coal/goods/food, unpaid firm wage debt > cash).
   - **Plain-English `workerReason(w)` ("Why" line)** explaining why any worker is doing what it's doing or why it stopped (e.g. slope vs `DOCK_SLOPE`, room/wait occupancy, forage target).
   - Zero-alloc 10s strided history table + one-click **`Copy all stats`** button (with `file://` clipboard fallback) exporting flags, worker/gold/price breakdowns, watched workers, all actors, and history as plain text.
2. **Named Watched-Workers Audit Panel (`track.js` + `tracked.js`):**
   - Upgrades `particle-transfer-b2`'s minimal 2-line `#watched-worker` box into a full audit panel: auto-watches worker #1 from boot (`watchFirst`), supports clicking workers on the map or spawning/granting test gold (`Worker` tool, e.g. the draft's `50g` cycle check), plots **purse over time**, shows `Where` + **`Why`**, and checks the per-worker conservation identity (`funded + earned − spent − splitShared == wallet`) to `< 1e-9` (`exact` badge).
3. **Per-Worker Unpaid Wage Claims (`gold.js`):**
   - Bug/design fix worth picking: in current `particle-transfer-b2/gold.js`, when a newly founded zero-purse firm books `owedWage[firm]` at entry and later earns revenue, `settleFirm` pays `workers.payOnSite(firm, pay)` — paying *whoever happens to be at the firm later* instead of the worker who worked on credit and walked home. Porting `d198120`'s per-worker `(firm, workerId, amount)` FIFO wage claims (implemented as a fixed-size **SoA typed-array table** so there are zero hot-path allocations per `AGENTS.md`) pays back the original worker ID anywhere on the map and keeps personal worker ledgers exact.
4. **Flock-Style Heading Triangles, Shape Selector & Flow Vectors (`fields.js` + `render.test.js`):**
   - Replaces plain circles with oriented **heading triangles** (`hx, hy`) by default, adds the **Particles** shape dropdown (`Triangles`, `Points` 1px, `Large ×⅛`), **Motion tails**, and **Gold flow vectors** (wallet velocity + goods value flux), while keeping `FORAGE` green styling and the watched-worker ring.
   - *(Optional small check from `d198120:particles.js`)*: evaluate whether `COST_RELAX` (book-cost markdown on unsellable post-spike spawn buffers, zero gold/mass impact) is needed or if `particle-transfer-b2` never wedges spawn buffers; include only if a founding-spike test shows wedged buffers.
5. **`16×` Playback Speed + Reusable Findings:**
   - Add `16×` speed option in `particle-transfer-b2` and `price-model-b2` (great for testing 45s splits, 120s starvation grace, and 7s harvests), and merge the valid non-obsolete pitfalls from `d198120:findings-pitfalls-skills.md`.

---

## 3. Implementation Plan

### Stage 1 — Bring `wrap-XY` Torus Topology into `prototype/particle-transfer-b2/`
Align `particle-transfer-b2` with `price-model-b2` (`87559dc`) and `draft/map-border.md` before layering new UI/diagnostics:
- **`simulation.js`**: Add `MAP_WRAP = true`, `wrapX`, `wrapY`, `wrapCell(x, y)`, and `setMapWrap(wrap)` rebuilding `NEIGHBORS`, `forage.coarseNeighbors`, `land.refresh()`, and `steering.rebuildConductance()`.
- **`steering.js`**: Wrap continuous particle coordinates `(x, y)` into `[0, W) × [0, H)` when `MAP_WRAP` is on; compute `ds` via torus shortest-delta `(dx, dy)` so crossing a seam never bills full-map haul cost!
- **`forage.js`**: Wrap `coarseNeighbors` on the `24×14` grid, wrap bilinear `x0/x1`, `y0/y1` indices in `scoreAtCell()`, and use `wrapCell` in garden plot scans.
- **`land.js`, `settlement.js`, `founding.js`, `farms.js`, `workers.js`**: Route radius/cone/ring scans (`stampCone`, `pledge`, `sumAround`, `fellAround`, `foundTown`, `stepConstruction`, `scanAndFound`, `canSite`, `clearVisit`, `harvest`, `pushWaste`, `pickNear`) through `wrapCell` and torus distances; ensure `farms.js` `clearVisit` preserves forest-to-wood conservation.
- **`index.html`, `app.js`, `styles.css`**: Add `Map edges: Wrap · torus | Bounded` toggle and grid badge (`48 × 28 · wrap`), plus torus unit tests (`conservation.test.js` / new `wrap.test.js`).

### Stage 2 — Per-Worker SoA Unpaid Wage Claims in `prototype/particle-transfer-b2/gold.js`
- Replace anonymous `owedWage` `payOnSite` settlement with a preallocated SoA FIFO claim table (`claimFirm`, `claimWorkerId`, `claimAmount`, cap `512`, zero object allocations).
- `payEntryWage` logs unpaid shortfall against `workers.id[w]`; `settleFirm` credits the original worker's wallet (or `vault` if despawned) and exposes `unpaidWages(workerId)`.
- Add unit test in `workers.test.js` verifying a sweat-equity / zero-purse firm pays back the original worker after he has walked away to rest.

### Stage 3 — Port & Adapt Visual Diagnostic Panels to `prototype/particle-transfer-b2/`
- **`track.js` + `tracked.js` (Watched Workers Audit Panel):**
  - Port named worker tracker (`watchFirst` on boot/reset, map click to watch, `Worker` tool + spawn/grant gold controls, purse-over-time chart, event feed).
  - Adapt personal ledger (`funded + earned - spent - splitOut == wallet`) to account for bazaar ration purchases (`towns.buyRation`), 50/50 wallet splits (`worker-life.split` — auto-adopting or logging the child), and 120s starvation vault transfer (`worker-life.remove`).
- **`diagnostics.js` + `economy-panel.js` (Economy Inspector, Stall Flags & Copy Stats):**
  - Port `EconomyDiagnostics` and `EconomyPanel` adapted to `particle-transfer-b2`'s full model:
    - All 8 worker states (`WALK_JOB`, `FIRM_POOL`, `SHIFT`, `WALK_HOME`, `TOWN_WAIT`, `ROOM`, `STILL`, `FORAGE`), splits/starved, low-food count;
    - Exact gold partition (`townPurse + firmPurse + workerWallets + vault == goldTotal`), unpaid wage claims, wallet median/mean/share;
    - Town room occupancy (`roomCount / rooms`), `waitCount`, bazaar food stock, Garden/Wild forage totals;
    - Price vs in-flight `ask` (`book + haul`) and consignment/spoilage stats for **Coal, Goods, and Food**;
    - Adapted **stall flags** + **`workerReason(w)`** covering all 8 worker states + **`Copy all stats`** button & 10s strided history.
  - Add `diagnostics.test.js` verifying exact gold/worker partitions, exact from-start watched-worker ledger across splits/foraging/work/rest, and `Copy all stats` output sections.

### Stage 4 — Port Particle Shape Rendering & Speed Controls
- **`prototype/particle-transfer-b2/{fields.js,index.html,app.js,styles.css}`**:
  - Port heading-triangle particle rendering (`hx, hy`), `Particles` shape selector (`Triangles`, `Points`, `Large ×⅛`), motion tails, and gold flow vectors (`buildGoldFlows`), keeping `FORAGE` green coloring, `Food` particles, and watched-worker highlight ring; add `render.test.js` + update `ui.test.js`.
  - Add `16×` speed option to `particle-transfer-b2/index.html` and `price-model-b2/index.html` (keeping `1×` default so automated/manual baselines don't jump unexpectedly).

### Stage 5 — Findings, File Map & Validation
- Merge the valid general lessons from `d198120:findings-pitfalls-skills.md` (excluding obsolete hybrid-dock notes).
- Update `AGENTS.md` ownership entries, `plan-particle-transfer.md`, `prototype/particle-transfer-b2/README.md`, and `archive/particle-transfer-b2-worklog.md`.
- Run L0 (`node --check`), L1/L2 (`node --test` in `prototype/particle-transfer-b2/` and `prototype/price-model-b2/`), and start a live server preview so you can inspect the panels directly in the browser.

---

### Quick Confirmation Before Implementation
1. **Confirm dropping `d198120:prototype/particle-transfer/` as a separate folder** and putting all picked panels/rendering/fixes directly into `prototype/particle-transfer-b2/`?
2. Do you want the **Economy Inspector + Stall Flags + Copy all stats** panel only in **`prototype/particle-transfer-b2/`**, or also a cell-adapted version in **`prototype/price-model-b2/`**?

---

## Follow-up review — 2026-11-27

Compared the fetched `origin/main` (`d1981200cf3cd1511c93377fedc96238ebb66c3f`, unchanged remotely) with current snapshot `8263b084c4cbd0047aae58edbe8e1ea358e3bf4a`. The report above is the **original proposal**, not a current completion checklist. This checkout is shallow; historical ancestry/merge-base claims above were not independently revalidated.

**Verdict: most valuable features were ported, but not everything useful is carried over correctly. Do not treat the port as fully complete yet.** No obsolete simulation engine needs restoring as an active prototype.

### Confirmed present

- Torus/bounded topology and seam tests in the particle lab.
- Worker-ID wage claims, including settlement after removal and firm-release handling; however, see the correctness findings below.
- Economy Inspector, stall flags, copyable stats, named watched workers, wallet chart, reason text, split/removal ledger hooks. Inspector shell is shared, with a separate cell-lab adapter.
- Heading triangles, point/large shape modes, motion tails under the Flow toggle, and gold-value flow vectors.
- Spawn-buffer cost relaxation (`COST_RELAX = 0.06`) in `goods.js`.
- `16×` speed in the cell B2 lab. Historical cell/diffusion/water labs are retained under `prototype/archive/`.

### Findings, highest priority first

1. **P1 — claim-table overflow silently loses a worker's entitlement.**
   `prototype/particle-transfer-b2/gold.js:98–112` increases `owedWage` before `addWageClaim` can silently return at its global 128-entry cap. Later settlement debits the firm's full debt, but `payWageClaims` sends the unrepresented share to the vault (`:146–147`). This conserves total gold while paying the wrong recipient. Old main used a growable claim list and did not have this fixed-cap loss.
   A direct, zero-tick probe with 129 workers owed 1g each produced debt=129, claims=128, last-worker claim=0; after funding/settlement, workers received 128g, vault received 1g, and debt became zero.
   **Required:** capacity-safe booking/admission or another lossless storage policy; merely increasing the cap postpones the bug. Add a focused overflow regression test.

2. **P2 — wage claims are not FIFO as documented.**
   `gold.js:139–143` swap-removes a paid claim, moving the newest claim ahead of older unpaid claims. With three 1g claims A/B/C and only 2g available, a direct probe paid `[1, 0, 1]`, not `[1, 1, 0]`. `release()` also reorders surviving claims through swap-removal. Old main's `splice` preserved order.
   **Required:** preserve claim ordering, including after another firm's removal, or explicitly approve a different settlement policy. Existing three gold tests do not cover this case or overflow.

3. **P2 — reusable findings were not merged.**
   Comparing `main:findings-pitfalls-skills.md` with the current file shows entire useful sections missing: mass-weighted per-worker cell state, write-time founding aggregation, placement-time actor cones, neutral-land fixtures, shallow-gradient/symmetric-saddle traps, admission versus queue cooling, wallet ownership, and batched conservation counters. Skipping the obsolete “particles only while walking” rule and old town-minting prescriptions is correct; dropping all the general lessons is not.
   **Required for the original pick list:** merge the still-applicable lessons with explicit cell/particle scope, not the obsolete engine assumptions or unqualified historical collapse prescriptions.

4. **P2 — food diagnostics adaptation is incomplete.**
   `prototype/particle-transfer-b2/diagnostics.js:185–239` computes food totals/spoilage, but price/particle breakdowns only handle coal and goods. Food has no corresponding in-flight ask/book/haul, best-buyer price, stopped-particle breakdown, or underwater-price flag; the copy export also iterates only `['coal', 'goods']`. The original Stage 3 explicitly requested all three commodities. This is unfinished adaptation to the new engine, not code missing from old main (which had no food commodity).
   **Required for the proposed scope:** add the food diagnostics counterpart, or explicitly defer it rather than marking the adaptation complete.

5. **P3 — particle `16×` control was missed.**
   `prototype/particle-transfer-b2/index.html:31` stops at `4×`; `price-model-b2/index.html:31` includes `16×`. Old main's particle lab had the option. Restore the particle option while preserving the current `1×` default.
   The archived diffusion A/B, Model B and water labs also omit old main's `16×` choices; these were optional picks, not blockers for the active engine. Defaults were also changed, so archive moves are not all byte-identical to main.

### Documentation caveats

`prototype/notes.md` records prior suites as 38/38 and 72/72; those results were not rerun. Its “over 40 s with split” ledger claim is stronger than the cited test: `diagnostics.test.js` checks the ledger for 40s, requires one tracked worker, and does not assert a split. That is not evidence of split coverage. Neither existing gold tests nor global gold conservation disprove findings 1–2.

### Before replacing old main

- Finish the missing picks and claim fixes above, or consciously defer noncritical items.
- Preserve old `d198120` through a durable archive tag/ref or verified backup **before** removing its branch. This shallow checkout cannot establish whether that history is reachable from the replacement. A hash written in a report is not a durable Git reference. Removed scratch scripts, obsolete engine code and historical worklogs can stay out of the active tree if the old snapshot is retained.
- Default-branch migration/deletion is a separate user-authorized step; no branch/default setting, tag, commit or push was changed during this review.

Validation: fetched remote refs, inspected tree/blob diffs and port source/tests, ran two direct wage-booking/settlement probes (no simulation steps; combined under one second). **No test suites or long simulations rerun.**

Next: correct claim overflow/order first; finish findings/speed carryover, then decide whether to complete or explicitly defer food diagnostics before the branch migration.