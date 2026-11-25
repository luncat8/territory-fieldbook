
### factory

charcoal factory make coal from forest. charcoal surname for coal, not separate item.
wood factory make goods from forest

think how to better use workforces to achieve this

we can pick random cell around sawmill to cut forest according to workforce in sawmill.
place logs on map at cell where it was cut.
then move by demand.
to control how many logs really need - we can use same demand field: if gradient low - then no need to cut meany trees.



#### sawmill-like factories that work with map cells around

- Sawmills clear the selected cell: forest becomes logs; other cells remain untouched.

i suggest make it cut more forest in the selected cell in one tick. because we choose random cell, it is better to cut all available forest in SELECTED cell -> wood, and make in maybe not every tick to save performance. this is subject of balance industry. 



##### deferred: sawmill cut not all (but almost all to faster regrowth) in random cell, replant random cell

look how forest working and how it is regrowth itself.  think about speed of natural regrowth from zero,
- special case with low speed of forest spawn in cells without forest vs growth from some low level of existing forest.
we have fast forest growth because it is easy and fun to see and debug climate.
