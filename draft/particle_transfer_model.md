particle_transfer_model:
fields remain for prices demand. actual objects are particles with properties: amount, owner, actual price at this moment (factories output self price + transportation cost)


make this settings as default engine:

all items (goods, population) are particles.
particles move by price (demand) gradient (smoothed heading, terrain-weighted speed).
particles has own actual price (resources+work cost from factory), than price rise as particle move on map with transportation cost and small deplete with time (food faster deplete, ore dont deplete).
finally item come to buyer storage, difference of item.price with what buyer pay is profit for factory (transport company takes transport cost, owner takes rest).

### workers and items are particle objects

workers carry gold, fresh/depleted state and other variables. keep cache and GPU friendly for possible optimizations in future.

whether particles should have fixed discrete or variable amount is open question.

! town is not active workforce router. workers move outside when gradient is enough.

## suggested to have common base with model-b2 engine, but for prototype feel free to experiment

## picked from B2 (prototype/price-model-b2 works smooth, 51/51 tests)

B2 already proves the rules work on a pure cell field, so the particle engine does **not** re-derive them:
`workforce.js` (WorkerPolicy), `land.js` (Land) and `settlement.js` (Settlements) are engine-neutral and reused unchanged,
applied per particle instead of per cell. The particle engine is a **transport-substrate swap** —
Eulerian field advection becomes Lagrangian SoA particles — over the same pricing, pool, rest and tax rules.
Only the particle pool, spawn accumulators, per-particle cost/spoilage/transport accrual, arrival split and
particle render are new code.

- **Town wealth class** (cheap/med/rich, deterministic per cell): cheap drops living tax to fill vacant slots
  and keeps its built size; med buys needs then grows; rich holds a cozy occupancy (queue ≈ 0) and cuts size
  first when it cannot meet resident needs. Replaces the old "town wants to shrink" premise.
- **Resident target shrink guards**: cheap/med never shed residents just for being poor (tax is the lever that
  keeps them full); they shrink slowly only when long-vacant or broke. Full housing still offers a rest floor.
- **Free-space comfort**: an uncrowded town rests workers better (space lift on rest comfort).
- **Buyer room admission**: a buyer cell accepts incoming particles only up to `cap - stock`, normalized across
  competing requests (mirrors B2 `receiving`/`room`), so a full town never over-accepts.
- **Still-particle measure**: a worker's stillness comes from the local price slope (B2 `still` field); still
  depleted particles rest slowly for free (shelter floor) and are the pool that founds settlements.

## firms and workforce pool

firms pay wages directly into carrier at work cell, workers pay living/rest tax in town from pocket. living appeal = shelter * refTax / goldTax (no popRoom; crowding via gold tax).
firms keep fresh-worker pool, towns keep wait pool; hire demand cools to zero on pool overflow.
wages level on the moment of sit to pool, so overflow will not cause zero wage for existing workers in pool queue. to optimize we can just pay in advance in time of come to firm.

a town rests (and taxes) only workers for whom it is the best home around: if a neighbor cell has higher home appeal, the worker keeps walking instead of being caught by the first town on its path.
a worker that stands still (no town reaches it, or it cannot move) rests very slowly where it stands for free - shelter floor, so nobody strands forever. many such still workers in one area become a settlement (below).

### penniless workers and town construction

penniless workers by design should build new low-tier settlement with cheap tax and this cheap town just cant set high price for items and workers rest took longer.
to do this, count **still depleted worker particles** gathered in a small radius where no town home field
reaches (B2: radius 2, still sum above 0.35, home+rest below 0.25 reach).

#### spawn town:

possible to have some variable in worker to track state when he want to establish new settlement and write to some grid to have automatic count without re-scan (B2 done: settle `intent` + gather grid). Previous agent suggested:
Scan every ~5 s, not every tick, so a
new settlement's home field spreads before the next scan. The gathered workers become residents (converted with
the migrant rate, capped at the tier pop cap) and bring their savings — no vault gold is minted, so the young
town starts broke and lives on tax.

a young town builds its first tier from its own forest (idle residents fell nearby wood) before bought comfort
lifts it higher; tier floors scale rest, tax, bids and housing.

important: worker moves not just by price gradient to cheapest town but to pareto optimal price & rest

settlement construction procedure is similar to other construction sites.

## render

in this mode map view items render actual particles with item.price ~ color, amount ~ light.
do not move particles < some minimal amount but combine at spawn. i suggest use cell to store float until amount for particle spawn. choose some good amount of items in 1 particle according to performance and settings


## notes

typical low-tier LLM hallucinations:
"towns release their whole stock of fresh workers"
this is wrong. town can't keep or release. town is not worker router and not a workforce manager. it only provide rest and get tax. workers move by gradient.

"Workers only exist as particles while walking"
this also not good for particle engine, because worker should keep money and probably some other variables in future plans.
we just not draw it, but object should exist and count until rest and then go to map if any workforce gradient significant.
if no gradient - this is case for count unemployment workers and spawn some facility.

## summary and check

ensure it works properly as draft say:
you give worker1 50cr
he moved to job.  he tired and got wage*time. for example 50+5=55
depleted tired worker move to optimal town to rest
if town full but space in pool he can wait in pool.
once free rooms available he paid tax, for example 55-6=49cr
he rest.
he go out from town
if gradient for job available he moved by gradient to next job
if movement is slow he rest in place even not being 100% depleted.
if movement is slow and he is fresh - he count as subject to free work force to found new firm to produce something useful with big price and resources available 
numbers are just example, not rebalance.


Town population in the particle engine: what is a 'resident'?
Every person is a worker object (recommended for first prototype)

Particle amount (open question in the draft):
Workers fixed, goods variable (recommended for first prototype)

A rested FRESH worker in town when there is no job gradient strong enough:
Leaves the room right after rest. this is need to count him as fee force to spawn new factories

