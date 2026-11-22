# Money worklog (plan-map-economy · Money, draft 4.4)

plan: plan-map-economy — Money (draft 4.4): big-town minting, local price field, two payment stocks, purses, wage offers, capital
changed: map-money.js (new, feature) — mint, prices (6 slots), household bills, wages/invest/dividends, owed pull, payment advection, settle/wear, ledger
changed: map-economy.js (feature) — view items MONEY/PRICE_*/WAGE, flow slots to MONEY, cash Float64, money prepare/reset/finish hooks; regen (free money in every town) removed
changed: map-diffusion.js, map-market-demand.js (feature) — household pull × purse; job pull × wage offer; map-sites.js/map-diffusion.js tick end calls mapeMoneyStep
changed: map-industry.js, map-farm.js (feature) — mapeMoneyEarn at mine, factory, sawmill, charcoal, wood, workshop, harvest; map-trade.js — one price law, player cash ledgered
changed: render-economy.js, hud-economy.js (feature) — money amount/pull layers, signed log price layers, legends, cell/site/global money readouts; index.html load order
changed: experiments/mape_money.js (new); map_views, dom_smoke chip counts; mape_co2 band gate 0.7 → 0.6
review fix: map-economy.js wfFlowX/Y depleted subarray had no end bound (ran to the array end; harmless until a slot followed it)
validation: node --check touched files; full suite exit 0 (smoke, dom_smoke, map_views 84, all mape_*); mape_money 14/14
evidence: catchment 240 s money 29137→29830, minted 2293, worn 1599, transit ~335, minting towns 0→18, short purses 6/82, hire 0.93–1.50, goods price 0.39–2.37×, residual 4.7e-11; money step ~0.4 ms/tick of ~5.5
decisions: two payment stocks (purchases→industry, wages→towns) — one stock trapped payments on any payer that is also owed (own pull peak); output is a claim that steers money, cash only arrives as payment; supply bounded by mint reserve + transit wear, prices never read the supply
decisions: price ease 0.5 — 0.2 painted every stockless cell dear; price layers signed (teal cheap / purple dear) — one-sided ramp read 1× as hot
pitfalls: CO2 peak plume is an activity readout, any economy change moves it (0.65–0.87) — see findings
next: factories pay for coal/iron/logs (input purchases, BUY channel needs a sink rule for payer-sellers), purse-aware Sites orders, then playtest whether money concentration around big towns reads on the map
