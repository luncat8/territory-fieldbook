
prototype/price-model-b

## implemented
we move in direction to make all companies: factories, settlements, etc to be universal:
they set buy and sell price to be in profit.
price (demand) diffuse by map and fade by time to emulate transportation cost. this is how items in each cell know where (in what direction) to move items amount.

if company (factory, town, etc) has profit it want to increase product: set high demand price on hire workforce or increase population (set low tax for live in town).
if loose or cant fit population needs - then decrease payment to workers and increase tax for live in city so depleted workforces will move somewhere else.
company should adopt sell/buy price to stay in profit. (and better to not sell already stock resources->product with loose)
need to review and improve if need.

town prices demand. example: town should not need unlimited coal even if it is price 0.
factory pay workers.
workers pay for live in town.
town set buy prices (as any fab do) to optimize it function.
sawmill optimize to get more profit, town optimize in same way - make more profit by attract more population to live and pay taxes. 


## 1

i think we maybe have some gap in economy model_b
workers  should pay to towns to live and rest here. and workers move by town tax gradient to cheapest location (and nearest because price field fade over time far from town, also ensure this works properly).
but do workers actually have money?
i did not dig into current implementation and dont know how it works and what approaches implemented (may be this already solve problem), but
i see 4 solutions: 
- emulate worker's money with same fresh-deplete mechanics. this looks promising: more money - more fresh , worker pay some part of fresh before exit town - so spawn in cell as different conditions based on money. But problem to keep state.
- some field (i dont know how better do it)
- worker has associated object with properties and somehow linked to cell-value. looks straightforward, but not canonical TRUE cell-approach.
- workers and items are particles, looks straightforward. particle engine based economy price_model_p is planned later, so this is out of scope, but keep in mind.
along with this review draft-price_model_p-population-items-particles.md , think what should be improved, ask if something not clear.

map already should has end price of item by design as price fade during time. who receive this money? this is open question. lets make some transport company single on whole map who live in towns and facilities and receive cost. we will work on it later

## 2

factories (fabs, sawmill, etc) should lower workforce payment (demand) if there are overflow of fresh workers. maybe some pool of fresh workers above current work shift capacity will be good - so hire prices demand emits according to pool occupancy level.
similar to towns - increase taxes for life if a lot in the wait pool to live.
pool size good to be more or less balanced according to real occupancy to smooth time after workers move home or move to factory, to keep it works
