# prototype/shared — shared lab GUI

Code shared by the B2 labs (`particle-transfer-b2`, `price-model-b2`). The labs are
file://-friendly classic `<script>` pages with plain top-level globals, so every shared
file mounts a global and is loaded by each lab's `index.html` **before** that lab's `app.js`.

## Files

- `lab.css` — common visual rules extracted from both labs (layout shell, panels, buttons,
  the sparkline/material cards, the economy-panel and tracked-panel components). Each lab's
  own `styles.css` loads **after** it and overrides only what differs. The shared sheet is
  byte-safe to cascade: the unique rules in each lab file are disjoint from the shared set,
  so common-first then lab-second never clobbers a lab-specific rule.
- `lab-ui.js` — `$(id)` DOM lookup, `ICON_PATHS` / `labIcon(name)` inline-SVG helpers, and the
  ⧉ copy helpers: `labCopyHtml(title)` markup plus `labBindCopy(button, read)`, which copies `read()`
  as plain text (textarea fallback on file://) and flashes ✓. Per-lab data that legitimately differs —
  `RESOURCE_TITLES`, `TOOL_KINDS` — stays in each `app.js` and is **not** hoisted.
- `economy-panel.js` — `EconomyPanel`, the shared Economy Inspector shell. Constructor
  `(diagnostics, rows, watched)`; `refresh()` renders the grouped stat rows + stall-flag
  list; its ⧉ button copies `diagnostics.text(watched())`. Row definitions and the snapshot come from each lab's `diagnostics.js`, so the
  panel is a pure view over the diagnostics contract.

## The diagnostics contract

Each lab ships its own `diagnostics.js` exposing:

- `snapshot()` — plain numbers/flags the inspector and tests read.
- `rows` — count of recorded strides.
- `text(watched?)` — the copyable report (`## flags`, `## actors`, `## history`, …).
- `record()` — capture one stride (called from the lab tick, ~10 s stride).
- `PANEL_ROWS` — the `[{title, keys}]` groups the inspector renders.

`EconomyPanel` depends only on that surface, so adding a third lab means writing a
`diagnostics.js` that honours it and linking the three shared scripts.

## Load order (per lab index.html)

```
fields/engine scripts …
diagnostics.js
../shared/lab-ui.js
../shared/economy-panel.js
app.js
```

`lab-ui.js` must precede `economy-panel.js` and `app.js` (both call `$` / `labIcon`).
