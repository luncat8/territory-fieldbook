
## map border numeric issue without wrap-XY

### not solved, deferred

to avoid this we use wrap-XY torus map by default. i afraid do fade to borders because it may cause strange price effects like - spawn some factories in zero price area, etc. so wrap XY looks like most robust way.
 
### issue

sometimes prices fields go high in left bottom corner of the map and items start to move there. no any real facilities that could create such demand.


### Diagnosis:

the corner price spike is real and reproducible (no bug in your edits)
I reproduced it headless on the default reference map, zero user edits: over 15 sim-minutes, the goods price field's global max sits on the empty corner cell (0,27) for 19s (peak 3.03, t=498s), and food does it for 88s (peak 2.56 at (0,27), t=572s) — always in the bottom-left, always a true local max, so uphill-following stock genuinely flows there. Demo: 3.6 units of goods dropped near (4,25) at t=600 stampeded into the corner zone (x≤2, y≥23: 0.00 → 2.78 in 15s) while the town's price crashed, then flowed back on the next boom.

### Root cause: two stacked numeric properties of the price field

1. The diffusion boundary reflects — corners are mirror amplifiers (structural).
diffuse() (simulation.js:575) skips out-of-grid neighbors, i.e. a no-flux boundary = mirror sources. Isolated check with a single constant 10.0 source at the town (9,20): the corner at distance 11.4 holds 38.6% of source price, an interior cell at the same distance holds 19.8% — and along the left edge the price rises with distance from the town (3.72 at (0,20) → 3.87 at (0,25)). The far-field maximum of the whole map rests against the bottom-left corner because town (9,20) is the nearest big bidder to it, with λ = √(15/0.08) ≈ 14 cells of reach.

2. Bid collapse is 25× faster than the field can drain (dynamic trigger).
When a town goes sated (stock ≥ target → optimalBid need = 0) or broke (townCool → ∞ → bid 0), stepBid's relaxed path pulls the town cell down at NEED_RESPONSE = 2/s, while the ambient field's slowest decay mode is PRICE_DECAY = 0.08/s. The source drops below its own far field within seconds, the gradient inverts, and for ~30–60s the argmax — and every item following planOutflow's uphill pull — points into the corner. Hence "sometimes": it appears on every sated/broke phase of the goods/food/wood/coal cycle (home/rest bids never collapse to 0, which is why workers aren't lured there).