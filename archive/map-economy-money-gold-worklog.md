# money-gold engine — worklog

plan: price-model-b as the default money economy (prototype/price-model-b reviewed, ported to the game).

changed:
- map-money-gold.js — new file: gold money engine (price-model-b port). conserved gold, town/firm/mine bids, price diffusion + gradient transport, wages, taxes, payment flow.
- map-economy.js — mape.moneyEngine = 'gold' default; mapeStepMoney dispatch; prepare/reset/finish call the gold engine alongside the shared interface.
- map-diffusion.js, map-sites.js — tick calls mapeStepMoney (was mapeMoneyStep) at the money slot.
- map-money.js — slimmed to the shared money interface (container, price slots, accessors, ledger reads); mapeMoneyStep is a no-op stub.
- archive/map-money-legacy.js — the old minted-money engine, preserved verbatim and separated (not loaded).
- index.html — loads map-money-gold.js after map-money.js.
- AGENTS.md — file map updated for the new ownership.

validation:
- L0 node --check on all touched files: pass.
- L1 node experiments/smoke.js → smoke_failures=0; node experiments/dom_smoke.js → dom_smoke_failures=0.
- L2 24000-tick stress (mainStep 0.05): no NaN; gold total conserved (ledger residual ~2.5e-11); prices settle (coal ~1.6, goods ~4.3, labour ~0.25).

decisions and why:
- Bids are driven by marginal value + cash (the cool term), NOT by local stock. The prototype's stock suppression is safe there because price drives its own transport; in the game goods/coal transport is demand-driven and separate, so stock suppression zeroed the goods bid and froze priceGoods/priceLabor at 0. Removed suppression from the game port.
- Old engine kept but separated into archive/map-money-legacy.js so it no longer costs context; the shared mapeMoney container + accessors stay in map-money.js because HUD/trade/industry/render read them.
- Gold is seeded once and conserved; the only external flow is player trade (mapeMoneyPlayer), matching the prototype's no-mint design.

pitfalls:
- price-model-b's stock-suppression bid must not be ported verbatim into a game with separate resource transport — it silently zeroes the price. See findings-pitfalls-skills.md.

next step suggestion:
- add a money-economy display overlay (gold purse / price contours) if the HUD money readout needs a visual; otherwise the engine is complete and the legacy path can be removed on a later clean-up plan.
