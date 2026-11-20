# charcoal fix worklog

## decision
User: charcoal is not a separate item — it is coal everywhere except the
production factory's name, which stays "Charcoal works" for storyline
(source: draft2.txt:268 "charcoal surname for coal, not separate item").

## audit
Full-repo grep for charcoal: no charcoal resource exists in code
(MAPE_RES = COAL/IRON/GOODS/LOGS/CO2; boot-DOM text walk found charcoal only
in factory names). Behavior already correct: charcoal works consume logs and
produce MAPE_RES.COAL (0.8 yield) + CO2. All code identifiers tied to the
factory kind (enum CHARCOAL, MAPE_CHARCOAL_YIELD/CO2, tool label, inspector
branch) kept under the "name in production factory" exception.

## changes (docs only)
- plan-map-economy.md:29-30 — "charcoal turns logs into coal" → "charcoal works turn logs into coal"
- plan-map-economy.md:411 — supply chain `forest -> sawmill -> logs -> charcoal -> coal -> town` → `forest -> sawmill -> logs -> coal -> town`
- README.md:4 — "sawmills to charcoal and wood works" → "sawmills to charcoal works and wood works"
- AGENTS.md:161 — "sawmill → logs → charcoal/wood supply" → "charcoal/wood works supply"

## validation
Docs-only: no L0/L1 needed. One file per commit:
61a3006 docs(plan), bbe20a3 docs(readme), 748b1df docs(agents).

## next
Phase 3: placement scan (new file — map-industry.js near 500-line cap),
log-paid construction (MAPE_BUILD_WOOD_RATE replaces iron scheme),
idle-rule job-site fix (mapeFactoryWorkers IDLE still advertises slots),
experiments/mape_factory.js.
