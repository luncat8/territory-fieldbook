# findings, pitfalls, skills

## loading the page in node for tests

Classic scripts in one `vm` context share top-level `const`/`let` as lexical globals, but they
are not properties of the context object: `ctx.main` is undefined. Read them with
`vm.runInContext('main.setup()', ctx)`. Deriving the script list from `index.html` keeps the
test honest about load order.

## stub DOM needs ImageData

`render.js` paints a 64×64 `ImageData` and scales it with `drawImage`. A stub canvas context
must provide `createImageData(w, h)` returning `{data: new Uint8ClampedArray(w*h*4)}`, plus
`putImageData`, `drawImage` and the path methods, or boot throws before any check runs.

## forbidden spawn heuristics

"farthest walkable cell" put a rival on a corner island with two water neighbours: it never
moved and never claimed. Score spawn cells by walkable neighbours (≥6 of 8) as well as
distance, and give movers a sidestep escape instead of a straight-line greedy step.

## per-frame allocations hide in ctx calls

`ctx.setLineDash([4, 5])` allocates a fresh array every frame. Keep dash patterns, palettes and
CSS colour strings as module constants; only cell values may vary per frame.

## territory pacing

Rival claims are cheap (arrive and claim), player claims need fully investigated cells. With a
map-wide rival search the map is exhausted by AI claims before the player can compete; giving
each rival a home region (18 cells) keeps the race territorial and winnable. Claim decay
(0.004/h) is what makes maintenance matter — tune it together with the source radius.
