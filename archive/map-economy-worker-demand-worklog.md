# Map economy · workforce demand layers, rest pull and the population ramp

plan: `plan-map-economy.md` V1 (worker items) + 4.1a (fluid workforce)
review: the demand side drew the fresh/depleted *pools* on both sides, so the worker chips never
showed movement, and `workforce` was an unlabelled fade that mixed transport haul into job pull;
population used the navy stock ramp, which buried 8–20 person dots at the dark end.
changed: `map-economy.js` — `MAPE_VIEW_ITEM.JOBS` replaces WORKFORCE, `MAPE_VIEW_ITEM_LABEL` (`workforce · fresh/depleted`), display refs POP_MAX 40 / JOB_MAX 8 / PULL_REF 0.25 / POOL_MAX 20, `wfRestPull` + scratch, compact reset list
changed: `map-fluid.js` — settlement rest pull with diffusion, depleted advection up it, spawn skips populated cells
changed: `map-diffusion.js` — `jobNeed` stays factual slots; transport haul joins the pull only in Residents
changed: `render-economy.js` — warm population ramp in every look, per-side worker fields, soft pull norm
changed: `hud-economy.js`, `hud-display.js`, `experiments/map_views.js` — worker legends, `workforce ·` captions, inspector `jobs/pull/rest`, 60 checks
validation: smoke (residuals 0), dom_smoke 0, map_views 60, mape_fluid 0, mape_compare, mape_scenes, mape_population, mape_spread 1.5 ms/tick, survey_spread pass; files ≤ 500 lines
validation: 7-panel field render — population dots L 190–210 on L 16 ground, fresh pull 202 at an active mine, rest pull 86–119 at towns vs L 31 map mean
decision: demand side reads movement — `jobs` = slots that seed the pull, `fresh` = pull to those slots, `depleted` = rest pull home; the rest pull is real, so depleted advects up it
decision: pulls use `v / (v + ref)` because a job cell peaks at ~4 while its halo is ~0.03; rest decay 0.20 keeps towns compact instead of a map-wide wash
pitfall: rest advection pooled depleted on settlement cells, which the spawn scan then overwrote (`pop_residual` −1248) — spawn now requires `pop = 0`
next: manual pass at 4× — pop dots at 2% density, a mine glowing on `jobs`/`fresh`, a full town dark on `depleted`; then Phase 3 placement scan
