particle_transfer_model:
fields remain for prices demand. actual objects are particles with properties: amount, owner, actual price at this moment (factories output self price + transportation cost)


make this settings as default engine:

all items (goods, population) are particles.
particles move by price (demand) gradient (smoothed heading, terrain-weighted speed).
particles has own actual price (resources+work cost from factory), than price rise as particle move on map with transportation cost and small deplete with time (food faster deplete, ore dont deplete).
finally item come to buyer storage, difference of item.price with what buyer pay is profit for factory (transport company takes transport cost, owner takes rest).

### workers and items are particle objects

workers carry gold, fresh/deflated related and other variables. keep cache and GPU friendly for possible optimizations in future.

whether particles should have fixed discrete or variable amount is open question.

! town is not active workforce router. workers move outside when gradient is enough.

## firms and workforce pool

firms pay wages directly into carrier at work cell, workers pay living/rest tax in town from pocket. living appeal = shelter * refTax / goldTax (no popRoom; crowding via gold tax).
firms keep fresh-worker pool, towns keep wait pool; hire demand cools to zero on pool overflow.
wages level on the moment of sit to pool, so overflow will not cause zero wage for existing workers in pool queue. to optimize we can just pay in advance in time of come to firm.

------- this addition by agent is not clear to me and probably need to be corrected
dominated towns release workers toward higher appeal; penniless workers get grace/shelter rest so they never strand.
-------

### penniless workers and town construction

penniless workers by design should build new low-tier settlement with cheap tax and this cheap town just cant set high price for items and workers rest took longer.
to do this we need to calculate workers particles who is not moving in area against some threshold

important: worker moves not just by price gradient to cheapest town but to pareto optimal price & rest

settlement construction procedure is similar to other construction sites.

## render

in this mode map view items render actual particles with item.price ~ color, amount ~ light.
do not move particles < some minimal amount but combine at spawn. i suggest use cell to store float until amount for particle spawn. choose some good amount of items in 1 particle according to performance and settings
