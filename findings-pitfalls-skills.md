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

## hover preview versus a periodic refresh

A view switch painted from `hudRefresh` every 0.2 s must not write `radio.checked`. Rewriting
checked state from the render path erases a hover preview between pointer moves and makes the
preview flicker. Keep the checked state written only where the mode is actually applied, and let
hover check the radio (`radio.click()`) so the browser's `change` event stays the single writer.
Gate the preview on `matchMedia('(hover: hover) and (pointer: fine)')` read per event, not cached
at boot: hybrid laptops can swap pointer classes while the page is open.

## hidden radio still needs its label to look focusable

`opacity: 0` on the input keeps it focusable, but the visible `span` must carry every state —
`:checked`, `:hover`, `:focus-visible`, `:disabled` — or keyboard users see nothing. Use
`input:focus-visible + span { outline: …; outline-offset: -2px }` so the ring sits inside the
joined group instead of overlapping the neighbour.

## a radius reads as a plate, not a gradient, when the effect saturates

A sweep whose centre gain is above 1 gets clamped, so every cell inside the clamp radius renders
at 100 % and the falloff shows only in the last ring — the disk looks like a plate and the
falloff you tuned is invisible. Judge a radial effect by the mean per distance band, not by the
centre cell: a 3.5-cell reach with centre gain 1.33 recorded every meadow cell within 2.3 cells
in one press. Keep the centre gain near 1.0 so the core completes and the ring keeps a gradient.
Hours and effort multiply, so tune their product and drop the spare factor.
