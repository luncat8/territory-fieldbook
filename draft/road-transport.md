## road system

- for long transportation between maps or planets
- for unique items or items with specific target and other cases when bulk cell or particle engine is not suitable
example: knowledge tech, money transfer
tier1: direct line between start-end positions, slow transport, calculate and cache time and cost
tier2: connect sites with roads using path find on map, node with town and other firms has low cost and preferred to connect throw them.

### road construction and animation

i recommend to not animate on cells (not as typical objects on pathfinded map), but use lines (straight or curved) and move objects on lines. construction is smooth grow of line length. map cells used only at road planning phase before construction to find path.

## transportation company

get profit from transported
spend money to buy materials and workforces
big workforce speedup transport in region and road construction