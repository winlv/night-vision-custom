# Phase 1 — implementation notes & measurements

Running log of what was done and the numbers measured after each step.
Baselines here are the "before" for the optimizations that follow.

## 1.0 — Test surface + Perf HUD ✅ (done)

**Changed**
- `src/stuff/perf.js` (new) — render counters; `perf.countDraw(ctxType)` called
  in `Canvas.svelte` update(); exposed as `window.__nvPerf` ({draws, byCtx}).
- `src/components/renderers/Canvas.svelte` — one `perf.countDraw(rr.ctxType)`
  per renderer draw.
- `src/App.svelte` — rewritten dev page: grouped left toolbar (drawing tools,
  scale linear/log, datasets small/medium/large-synthetic + realtime, quick-add
  indicators, destroy+reload) + a Perf HUD (FPS, main paints/0.5s, overlay
  paints/0.5s, dataset label). Active tool/magnet highlight via `meta:tool-changed`.

**Verified (Playwright, headless):** chart mounts (5 canvases), 27 toolbar
buttons, HUD ticks, +SMA (on-chart) / +RSI (off-chart, adds pane) work, log
scale applies, tool selection sets `meta.tool`, synthetic 100k candles load. 0
console/page errors.

**BASELINE (pre-1.1), 100k candles:** a 30-step pure mouse-move sweep caused
**30 main-canvas repaints** — i.e. **1 full candle repaint per mouse move**.
This is the number Phase 1.1 must drive toward ~0.

> How to reproduce: open the dev page, click "large 100k", read the HUD's
> "main paints /0.5s" while moving the mouse (no drag). Or read
> `window.__nvPerf.byCtx['Canvas']` before/after.

## 1.1 — Static/dynamic layer split + cursor decouple ✅ (done)

**Changed**
- `core/primitives/crosshair.js` — `ctxType = 'Overlay'` (was `'Canvas'`). Highest
  zIndex → sorts last → `mergeByCtx()` puts it in its own top renderer.
- `components/renderers/Canvas.svelte` — mount also renders `'Overlay'` ctx;
  transparent background for Overlay; pane separator (`upperBorder`) only on the
  static canvas.
- `components/Grid.svelte` — template mounts Canvas for `'Canvas' || 'Overlay'`;
  new `update-grid-cursor` → `updateCursor()` repaints ONLY Overlay renderer(s)
  and crucially does NOT touch the `layout` prop (reassigning it would invalidate
  Canvas's reactive width/height and force a full static redraw via resizeWatch).
- `components/Pane.svelte` — `update-pane-cursor` → forwards `update-grid-cursor`
  + sidebar `update-sb` (cursor price label) WITHOUT reassigning `layout`.
- `components/Chart.svelte` — `onCursorChanged` now routes to a light
  `cursorUpdate()` (reuses current layout, `cursor = cursor` to refresh legend/
  sidebar reactively, repaints only crosshair canvas + botbar). Falls back to the
  full `update()` while drawing/dragging — gated by `pointerDown` (tracked in
  `onCursorLocked`, before the scrollLock filter) or `meta.drawingMode`.
  Escape hatch: `config.FAST_CURSOR = false` restores the old always-full path.

**Verified (Playwright, 100k synthetic candles):**
- Renderers now `['Canvas','Overlay']`.
- **HOVER 30 mouse steps → main-canvas (Canvas) paints = 0** (baseline was 30),
  Overlay paints = 30. **100% elimination of candle repaints on hover.**
- Legend OHLC still updates live on cursor move (no regression).
- Drawing a rectangle (button held) → main-canvas paints = 17 (full path kicks in
  correctly).
- Smoke harness: Δlisteners = 0, uncaught = 0, console.error = 0; log-scale toggle
  clean. `npm run build` exit 0.

### 1.1 follow-up — drawing-tools regression FIX

**Symptom:** after 1.1, drawing tools (Rectangle, RangeTool, …) stopped stretching
during the click-MOVE-click pattern. Root cause (confirmed empirically): a tool's
`mousemove` only `propagate()`s (no `update-layout`); the redraw used to come from
the global cursor→full-update. After the first `mouseup`, `drawing-mode-off` resets
`meta.tool='Cursor'`/`drawingMode=false` while the shape is still *tracking*, so all
gate signals were false → light path → static canvas (where tools lived) didn't repaint.
Click-DRAG still worked (pointerDown=true → full path).

**Fix (architectural, the right one):** drawing-tool overlays (`ov.drawingTool`) now
render on the **dynamic 'Overlay' canvas** alongside the crosshair, not the static
canvas. `Grid.makeLayers` sets their `ctxType='Overlay'` and lifts `zIndex` into
`[600000, 1e6)` (above static layers incl. trackers@500k, below crosshair@1e6) so
`mergeByCtx` groups them with the crosshair into one top renderer. The light cursor
path already repaints all 'Overlay' renderers → tools track/hover/drag on mouse-move
WITHOUT repainting candles.

**Verified:** click-move rectangle → Canvas paints 0, Overlay paints >0, p2 tracks ✓;
drag still works; pure hover still 0 candle repaints; harness Δlisteners=0, build ok.
Bonus: hover-highlight on existing drawings now works via the light path too.

## 1.2 — rAF batching + dirty flags ✅ (done)

**Changed** `components/renderers/Canvas.svelte`: split the renderer's `update()`
into a scheduler + paint. `update($layout)` now just sets `dirty=true`, stashes
`pendingLayout`, and schedules a single `requestAnimationFrame(flush)`; `flush()`
calls `draw()` once. Multiple `update-rr` events within a frame coalesce into ONE
paint per renderer. `resizeWatch()` calls `draw()` synchronously (avoids a blank
frame after the canvas is cleared on resize). `rafId` cancelled in `onDestroy`.

**Verified (Playwright, 100k candles):**
- 20 synchronous `cursor-changed` in one tick → **0 paints in-tick, 1 paint after
  one frame** (was 20 paints pre-1.2). Coalescing confirmed.
- Isolated click-move rectangle ×3 runs: Canvas paints 0, Overlay paints 12, rect
  created + p2 tracks — drawing still correct, candles not repainted.
- Hover: Canvas 0. Harness Δlisteners=0, errors=0. Build exit 0.
- Note: a combined test (hover→then→draw) showed flaky drawing once due to the
  tool's `mouseMoved()` heuristic reacting to the prior hover position; isolated
  runs are stable. Not an engine bug.

## 1.3 — Memoize Layout — ❌ DROPPED (measured as a non-bottleneck)

**Measurements (100k candles) invalidated the plan's premise:**
- `new Layout()` at normal zoom (~250 visible) = **0.24 ms**. The y-range min/max
  scan in `gridScale.calc$Range()` iterates `ov.dataSubset` (the VISIBLE window),
  NOT the full dataset — so it was never O(total). Earlier audit claim was wrong.
- Pan at normal zoom already holds **60 FPS**.
→ Memoizing a 0.24 ms construction is busywork. Dropped.

**The REAL bottleneck (measured):** zoomed fully OUT (all 100k candles visible):
- sync `update()` = **36 ms** (now the scan really is over 100k rows)
- pan = **~8 FPS** (scan ~36 ms + drawing 100k candles each frame)

**Why the fix is non-trivial:** the proper fix is decimation (downsample visible
points to ~screen width), which reduces BOTH the scan and the draw to O(target).
But it CANNOT be a simple data swap: `gridMaker.js:101` sets candle width from
`pxStep = spacex / (dt/interval)` — i.e. width is tied to the time interval, not
the visible count. Decimated rows would render as thin candles with gaps, and
`indexBased` mode maps x by row index (decimation changes indices). So decimation
needs renderer-aware changes (render-time column aggregation + scan over the
aggregated set). That's a focused medium-risk effort — see decision below.

## Next perf step — DECISION: Phase 1 done; GPU phase CANCELLED

User decision (2026-06-16): Phase 1 is considered DONE (the big wins — 1.1 cursor
decouple, 1.2 rAF batching — shipped). The only remaining bottleneck is the rare
full-zoom-out case (100k candles visible → 8 FPS). A GPU rendering phase was
considered for it but has been **cancelled by the user — we will not do GPU/Pixi
rendering.** So the zoom-out case is an accepted known limitation; if it ever
matters, the fix is render-time decimation ON THE EXISTING CANVAS (aggregate
visible candles per pixel column; note candle width is interval-based in
gridMaker.js:101, so it needs renderer-aware changes). 1.4 (text-metric cache)
skipped — not measured as a bottleneck (no busywork). Moved on to Phase 3.

### Phase 1 — DONE summary
- 1.0 ✅ test toolbar + Perf HUD
- 1.1 ✅ static/dynamic layer split + cursor decouple (hover candle-repaints 30→0)
  + drawing-tools-on-Overlay regression fix
- 1.2 ✅ rAF batching (20 events/tick → 1 paint/frame)
- 1.3 ❌ dropped (Layout already 0.24 ms — non-bottleneck)
- decimation / GPU → CANCELLED (no GPU phase; zoom-out is an accepted limitation)
