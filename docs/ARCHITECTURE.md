# Night Vision — Architecture Notes

> Living document. Captures how the chart actually works (verified against
> source), so future work doesn't have to re-derive it. Update as the code
> changes.

## TL;DR — what the engine really is

Despite the README/CLAUDE.md calling this a "GPU-accelerated Pixi.js" library,
**the main chart is rendered with plain Canvas 2D** in immediate mode. Pixi.js /
WebGL is used **only** for instanced-quad overlays drawn on a transparent canvas
*above* the Canvas-2D chart — currently the orderbook heatmap. These now share a
reusable base, `GpuOverlay` (see "GPU overlay base" below).

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

## Pane resizing (2026-06-16 rewrite)

The drag handle is `Resizer.svelte`, rendered as the last (in-flow) child of each
non-main `.nvjs-grid`, so it sits at the pane's TOP boundary. It emits
`hub:pane-resize {paneId, deltaPx}` (and `cursor-locked` to suppress panning while
dragging). `DataHub.onPaneResize` resizes the boundary between `pane[paneId]` and
`pane[paneId-1]` (the pane directly above) — NOT the main pane. At the START of every drag gesture (`hub:pane-resize-start`, fired on mousedown)
it re-seeds EVERY pane's `settings.height` to its current pixel height (read from
the cached full layout via `hub:update-pane`). This is the critical bit:
`settings.height` is a relative WEIGHT for `layout.js weightedHs`, so a dataset
that ships small weights (`height: 1/2/3`) would otherwise make the pixel-based
drag math jump on the first move. Re-seeding to pixels each gesture is
render-neutral (weightedHs is proportional) and makes the boundary track the
cursor 1:1 regardless of prior values. Deltas are clamped so neither adjacent
pane drops below 28 px (no "sticking"). Heights stay relative weights, so window
resizes keep proportions, and a pane keeps its size when reordered.

Test datasets: `data/data-3panes.json` (Candles + RSI + MACD, weights 3/1/1) and
`data/data-4panes.json` (+ Stoch) — multi-pane fixtures with pre-set weights,
loadable from the App toolbar ("3 panes" / "4 panes").

**Reordering:** `Legend.svelte` shows ▲/▼ buttons (when >1 pane) that emit
`hub:move-pane {paneId, dir}`. `DataHub.onMovePane` swaps the two entries in
`data.panes`; the order change flips the panes-hash (`dataScanner.calcPanesHash`
is order-sensitive), so `Chart.update()` routes to `fullUpdate` → re-index +
remake-grid in the new order. `settings.height` rides with each pane, so sizes
travel when a pane moves. Up is disabled on the top pane, down on the bottom.
**The main (chart) pane is pinned on top:** `DataHub.onMovePane` rejects any swap
that involves the main pane (so sub-panes can never be placed above it — doing so
glitched the layout), and `Legend.svelte` disables the arrows accordingly (both on
the main pane, and "up" on the pane directly below it). Enforced centrally in
DataHub, so any UI that emits `hub:move-pane` is covered.

## GPU overlay base (`GpuOverlay`)

`src/core/primitives/gpuOverlay.js` is the reusable WebGL instanced-quad base,
extracted from the orderbook heatmap. It owns all the Pixi plumbing so a new
GPU overlay only has to turn its data into colored rectangles:

- a transparent `PIXI.Application` (`resizeTo: window`, `pointerEvents: none`)
  laid over the Canvas-2D chart and appended to `chart.root`;
- one instanced unit-quad `PIXI.Mesh` + a `Float32Array` instance buffer, with a
  fixed per-instance layout of **STRIDE = 8 floats**: `[x, y, w, h, r, g, b, a]`
  (position, size, straight-alpha color 0..1). Same generic colored-quad shader
  for every overlay.

API for subclasses:
- write quads incrementally — `beginFrame()` → `addQuad(x,y,w,h,r,g,b,a)` (returns
  `false` when the buffer is full) → `endFrame()`; **or** for hot paths fill
  `this.instanceBuffer` directly and call `commit(instanceCount)` (what the
  heatmap does);
- `parseColor("#rgb" | "rgb()/rgba()")` → `{r,g,b,a}` in 0..1;
- `resetTransform()` resets the stage to screen space; `clear()`; `destroy()`.

`Heatmap` (`heatmap.js`) now `extends GpuOverlay` and only implements the
orderbook specifics (per-exchange palettes + depth-snapshot → cells in
`updateData`). **Backward-compat:** navy scripts (`heatmap.navy`, `ht.navy`) and
`Grid.svelte` reach into `meta.heatmap.heatmapApp.stage` / `.instancedMesh`, so
`Heatmap` keeps those as getters aliasing the base's `app` / `mesh`. The
`heatmap-layer:layout-update` event wiring and `meta.heatmap = this` stay in the
subclass.

To build a new GPU overlay (e.g. footprint grid, predictive-liquidation
heatmap): `class Foo extends GpuOverlay`, push quads, wire your own layout
event. `ht.js` is an older near-duplicate of the same machinery and is a
candidate to fold onto `GpuOverlay` later.

### GpuCandles — prototype candle renderer (A/B)

`src/core/primitives/gpuCandles.js` is the first non-heatmap consumer of the
base: a WebGL candle renderer. A candle is just rectangles, so each one becomes
up to 3 quads (volume bar, 1px wick, body); `render(core, showVolume)` mirrors
`layoutCnvFast.js` geometry (`price * A + B`, `ti2x`, `CANDLEW`, `VOLSCALE`,
log-scale via `math.log`) so positions match the Canvas-2D candles exactly, then
`beginFrame()/addQuad()/endFrame()`. Color strings are parsed once and cached.

It runs as a drop-in overlay type: `src/scripts/GpuCandles.navy` (`ctx=Canvas`,
same `yRange/ohlc/valueTracker/legendHtml` as `candles.navy`) whose `draw()`
paints nothing on the 2D ctx and instead calls `meta.gpuCandles.render($core)`.
Lifecycle is host-owned: `MetaHub.initGpuCandles(id)` / `destroyGpuCandles()`
(the navy `draw()` no-ops when `meta.gpuCandles` is absent, so a stale draw
during a type-switch can't resurrect the instance). **App toggle:**
`App.svelte` "GPU (proto)" button swaps the main overlay between `Candles` and
`GpuCandles` for 1:1 A/B comparison (target: the 100k full-zoom-out case).

Prototype caveats: GPU canvas sits *behind* the Canvas-2D layers (like the
heatmap), so grid/indicators draw over the candles; thin wicks aren't
pixel-snapped (mild AA blur); re-uploads the whole buffer on every range change
(no stage-transform pan yet).

`render(core, showVolume, colors)` takes an optional `colors` override
(`{candleUp, candleDw, wickUp, wickDw, volUp, volDw}`) so a consumer overlay can
pass its own props palette instead of `core.colors`. The instance is torn down
in `Chart.svelte` onDestroy (`meta.destroyGpuCandles()`), alongside the heatmap.

**Consumed in tradehive-ui** (`CandlesPlus`, `CandlesCustom` navy scripts): a
`gpuRender` prop (def true) routes draw() to `meta.gpuCandles.render(...)` with
a safe Canvas-2D fallback when the library build lacks the API; OFF clears the
GPU buffer. ⚠️ **Each GPU-rendered chart creates one Pixi WebGL context** —
browsers cap live contexts (~16), so pages that mount many CandlesPlus charts
(watchlist grid, per-exchange arbitrage) must pass `gpuRender:false` in those
overlays' props. Single charts (main terminal, bookmap) are fine.

### GPU overlay lifecycle on reset

`NightVision.fullReset()` calls `meta.destroyGpuCandles()` + `meta.destroyGpuClusters()`
before the `update('full')`. Reason: these overlays cache a Pixi context + a
canvas appended to the chart root; a symbol switch (host does `data.panes = ...;
fullReset()`) can rebuild the chart DOM/layout and leave the cached canvas blank
or detached → candles/clusters render nothing after switching coin. Tearing them
down on reset means the candle/cluster scripts lazily recreate a fresh,
correctly-attached instance on their next draw (verified: after a simulated
switch the instance is recreated, attached, rendering, and there's exactly one
canvas — no accumulation). The heatmap is exempt (the host destroys/reinits it
itself). All GPU-candle/cluster scripts therefore use lazy init
(`if (!meta.gpuX) meta.initGpuX($core.props.id)`).

### gpuClusters — footprint / TPO cells

`meta.gpuClusters` is a plain `GpuOverlay` instance (`initGpuClusters(id)` /
`destroyGpuClusters()`, torn down in Chart.svelte) used as a generic colored-cell
layer. The bookmap `CandlesFootprints` and `CandlesTPO` navy scripts route their
cell **fills** to it: each `draw()` does `gpu.beginFrame()` → `gpu.addQuad(x,y,w,h,
r,g,b,a)` per cell (color via `gpu.parseColor(cssColor)`, the d3 gradient string)
→ `gpu.endFrame()`. The begin/end bracket the whole draw (not behind the
`view.length<=80` / timeframe guards) so the buffer is always committed — a
zoomed-out frame clears stale cells. **Text labels, cell borders and the TPO POC
outline stay on Canvas-2D** (GPU base has no text/stroke). Same `gpuRender` prop +
fallback (a `fillLut()`/`fillEmpty()` helper fills a GPU quad or a `ctx.fillRect`).
Caveat: cells sit on the GPU canvas behind Canvas-2D, so grid lines draw over them.

**Perf note (footprint):** for cell-heavy overlays the cost is the per-frame
**processing**, not GPU rasterization. Two traps fixed in `CandlesFootprints.navy`:
(1) the global-max scan must not walk all `$core.data` every frame — cache it and
rescan only when the candle count changes (fold the in-progress last candle in
cheaply); (2) never build a d3 color scale per cell — build a 256-entry color LUT
(RGBA for GPU + css for Canvas-2D) once per draw and index it. Measured ~45×
faster (29.6 → 0.65 ms/frame at 4000 candles × 120 levels, 60 visible).

## Cursor-aware overlays & the heatmap (Phase 1.1 follow-up)

The cursor decouple (1.1) repaints only the dynamic 'Overlay' canvas on hover:

- **Cursor-driven Canvas overlays** (e.g. `HeatmapZoom`, which draws a magnifier /
  info window from `$core.cursor` in its `draw()`) stopped updating on hover,
  because they sit on the static 'Canvas' renderer. Fix: `Grid` flags a renderer
  `cursorAware` if any of its overlays has a `mousemove` handler, and
  `updateCursor` repaints `'Overlay'` **and** `cursorAware` renderers. Only
  HeatmapZoom/ht define `mousemove` among overlays (grid uses `mousedown`,
  trackers only `draw`, candles none), so normal charts keep the hover perf win;
  heatmap charts repaint their Canvas on hover (their prior behavior — needed for
  the magnifier). `$core.cursor` is the live cursor ref, so no env update needed.
- Heatmap `layoutUpdate` runs synchronously in `Grid.update`, in lockstep with the
  (now synchronous) candle canvas. (A rAF-batching/defer experiment was reverted —
  it added input latency to wheel zoom.)

## Zoom note (reverted experiment)

A wheel-zoom animation (X ease + Y `smoothY` lerp) and rAF render batching were
tried and **reverted**: the rAF batching added a frame of input latency, and the
wheel path already coalesces upstream (changeRange's rAF), so discrete wheel zoom
felt laggy. `Canvas.update` is now synchronous again, and the heatmap
`layoutUpdate` runs synchronously in lockstep. The residual vertical "jump" on
wheel zoom is inherent to discrete-step zoom + price auto-scale (present in the
original too); continuous gestures (pan, axis drag) don't show it.

## Test surfaces

- `src/App.svelte` — manual dev page (toolbar + chart). The user's hands-on
  testing surface.
- `src/Harness.svelte` + `src/harness/probes.js` — automated smoke harness
  (leaks / NaN / scale). Open `http://localhost:8085/harness.html`.
