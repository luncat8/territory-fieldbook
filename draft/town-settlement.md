## settlements

demands, effect, purpose:
- wood. big amount need to growth and some constant use, this may push sawmill industry.
- food, keep population, 

settlement is a harvester

without farm, sawmill, fishery, etc. settlement work as harvester: using workforce to pick random cell around and harvest small amount slowly.
need to make list what possible to pick: food in forest, water, wood, all work same mechanics: harvested placed on map as amount.


for particle engine: depleted worker slow movement slowly rest anywhere - this emulate shelter. for cell engine - think what will work, because it is hard for me now.

so if tired worker very slow move (low gradient of settlement with acceptable taxes) - in some engines it is possible to mark it as rest mode. we call it like 'shelter' - he pay nothing and slowly rest (storyline: help himself to find food and bed) . Deferred: rest may be depends on map conditions: i.e. in the desert no rest possible.
every some time check areas in some radius or window and if there are meany shelters (slow moving tired workers) - found settlement (aka town) - it cut forest to get some initial construction, then try to up tax gradually if possible to buy resources for better rest workers and increase town size.

(hamlet): "young town" flag — marks a town still in construction that can gather resources itself (e.g. fell forest) without buying. 

### size from construction difficulty

map provide settlement location:
from good value (cheap construct -> easy to grow) to bad (costly to build -> hard to provide space):
- near water (edge cells) - best cells, except swamp edge
- in the edge of forest and meadow
- meadow
- hills
- forest
- swamp edge cells
- swamp

#### rest efficiency from needs, map, space

- population needs
- some free rooms available
- map bonuses to rest and decrement for desert, wasteland - towns should naturally avoid to be near other facilities and towns. this also apply for homeless workers on map who rest.

### town wealth class

towns for rich workers - should be implemented in more natural way. we can set 3 random strategies:
- cheap - if visitors pool is full - prefer grow size. if slots vacant - drop tax even if cant buy all resources
- med - balanced. buy most all resources to fit needs then growth.
- rich - if visitors pool is full - prefer rise tax without significant growth, fit all needs, if cant - firstly cut size.

Deferred for future: to make this better work need some upkeep cost and wearing items inside town's depot so keep big town almost empty will cause loss.

rich cuts size first. other keep built size and shrink slowly only if very low on money or vacant for a long time.

better also add some increment to comfort in case of free space in town. is this case rich town want keep queue pool 0 and few free slots to fit comfort level.
example (numbers are subject to balance, usually we operate with more workers to keep things smooth, float numbers also possible): 
5/10 poor : cut tax until minimal level of comfort then slowly shrink
5/10 rich : slowly shrink to 6/7, 
2/5 rich : if minimal workers then decrease tax. till 4/5
10/10 poor : ok, start to grow when pool queue increased, to get as most workers
9/10..10/10 rich : increase tax, grow after all needs fit, keep vacant room.