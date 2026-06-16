# Night Vision — Architecture Notes

> Living document. Captures how the chart actually works (verified against
> source), so future work doesn't have to re-derive it. Update as the code
> changes.

## TL;DR — what the engine really is

Despite the README/CLAUDE.md calling this a "GPU-accelerated Pixi.js" library,
**the main chart is rendered with plain Canvas 2D** in immediate mode. Pixi.js /
WebGL is used **only** for the orderbook heatmap (`src/core/primitives/heatmap.js`).

- Renderer: `src/components/renderers/Canvas.svelte` — `getContext('2d')`,
  `ctx.clearRect(...)` + full redraw of every layer on each update
  (`Canvas.svelte:93-109`).
- No requestAnimationFrame loop in the renderer; updates are **event-driven**
  via the internal event bus + Svelte reactivity.

## Component tree

```
NightVision (interface.js, vanilla JS wrapper)
  └─ NightVision.svelte  (getChart() → Chart)
       └─ Chart.svelte           ← owns range, cursor, Layout; update loop
            ├─ Pane.svelte  (one per pane)
            │    └─ Grid.svelte  ← builds layers + renderers for the pane
            │         └─ Canvas.svelte (one per renderer; one <canvas>)
            ├─ Botbar.svelte      ← time axis (own Hammer manager)
            └─ Sidebar.svelte     ← price axis (own Hammer manager)
```

## Layers and renderers (Grid.svelte)

`Grid.makeLayers()` builds, per pane:
- one `Layer` per overlay (`l.ctxType = prefab.ctx`, usually `'Canvas'`),
- plus three built-in primitive layers, each with `ctxType = 'Canvas'`:
  - `Grid`     `zIndex = -1000000` (bottom)
  - `Trackers` `zIndex =  500000`  (price lines)
  - `Crosshair``zIndex =  1000000` (top)

Layers are sorted by `zIndex`, then `Grid.mergeByCtx()` groups **consecutive
layers with the same `ctxType`** into a "renderer" descriptor `{ctxType, layers,
id, ref}`. Each `'Canvas'` renderer maps to one `Canvas.svelte` → one `<canvas>`.

> **Consequence:** since every layer is `ctxType === 'Canvas'`, `mergeByCtx`
> produces **a single renderer (one canvas) per pane** containing candles +
> indicators + grid + trackers + crosshair. Any redraw repaints all of them.

A new `Pointer` (input) is attached to the **last** renderer of each grid
(`Grid.svelte:77-86`, inside a `setTimeout`).

## The update loop (the hot path)

Range/cursor/layout changes funnel through `Chart.svelte`:

- `onCursorChanged` (mousemove) → `cursor.xSync(...)` → **`update()`**
- `onRangeChanged` (pan/zoom) → `hub.updateRange` → `cursor.*Values` → **`update()`**
- `update()` (`Chart.svelte:132`):
  1. `layout = new Layout(chartProps, hub, meta)` — **rebuilds the whole layout
     every time** (grid geometry + per-scale y-range min/max scan over data).
  2. `events.emit('update-pane', layout)` → every `Pane`/`Grid`.
  3. `Grid.update()` (`Grid.svelte:180`) → for each layer `env.update()` +
     `layer.update()`, then `emitSpec('rr-<grid>-<rr>', 'update-rr')` to **every
     renderer**.
  4. `Canvas.update()` → `clearRect` + redraw **all** layers.

> **Consequence:** a bare mouse move rebuilds `Layout` (incl. y-range scans) and
> repaints candles+indicators, even though only the crosshair moved.

## Data flow

- `DataHub` (`dataHub.js`) owns panes/overlays; `calcSubset(range)` →
  per-overlay `DataView` (`dataView.js`) whose `makeSubset()` does `src.slice()`
  — a **fresh array allocation** on each range change.
- `MetaHub` (`metaHub.js`) stores per-(grid,scale) y-transforms; y-range is
  recomputed by scanning data (`gridScale.js`).
- Heavy indicator math runs in a web worker (`se/seClient.js` + `se/webWork.js`
  + `se/worker.js`); rendering/layout/interaction stay on the main thread.

## Coordinate transforms

`layoutFn.js` attaches to each scale: `time2x`/`ti2x`, `value2y`, `x2time`,
`y2value`. Log scale uses the **symmetrical** `math.log`/`math.exp` from
`stuff/math.js` (NOT `Math.log`/`Math.exp`) — forward and inverse must use the
same pair. `cursor.js` keeps a hand-copied `value2y`/`y2value` that **must stay
in sync** with `layoutFn.js` (Phase 0 fixed a drift here).

## Input / lifecycle gotchas (fixed in Phase 0)

- `Pointer.setup()` is async (dynamic `import('hammerjs')`). If the grid is
  destroyed mid-await, guards (`this.destroyed`) prevent binding orphaned
  listeners.
- `Botbar`/`Sidebar` each create their own `Hammer.Manager` and **must** call
  `mc.destroy()` in `onDestroy` (Botbar previously didn't → leak).
- `interface.destroy()` disconnects the ResizeObserver and nulls `this.comp` so
  the `this.comp?.getChart()` guards short-circuit.

## Test surfaces

- `src/App.svelte` — manual dev page (toolbar + chart). The user's hands-on
  testing surface.
- `src/Harness.svelte` + `src/harness/probes.js` — automated smoke harness
  (leaks / NaN / scale). Open `http://localhost:8085/harness.html`.
