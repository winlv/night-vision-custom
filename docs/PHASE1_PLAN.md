# Phase 1 — Performance Foundation (detailed plan)

> Goal: make the Canvas-2D engine behave like a modern chart **without changing
> the rendering backend**. Target 5–10× on interaction-heavy paths. A GPU/Pixi
> rendering migration was considered but has been CANCELLED by the user — it is
> out of scope and will not be done.
>
> Status legend: ⬜ todo · 🟦 in progress · ✅ done. Update inline as we go.
> See `ARCHITECTURE.md` for the verified render-pipeline facts this builds on.

## Target metrics (acceptance for the whole phase)

Measured via the smoke-harness probes + a small perf script (Playwright + the
browser Performance API / `__nvProbes`):

1. **Mouse move does not repaint the main canvas.** On `mousemove` the candles/
   indicators canvas `draw()` is NOT called; only the crosshair canvas redraws.
   (Verified by a draw-counter probe per renderer.)
2. **No `new Layout` on cursor-only changes.** Layout is rebuilt on range/data/
   size changes, not on crosshair movement.
3. **Pan/zoom of ~100k candles holds ~60 FPS** (frame time < ~16 ms; report
   1%-low, not just average).
4. **Steady-state mouse move allocates ~0 arrays** in the hot path (no per-frame
   `slice()`); checked via allocation profile / no growth.
5. No regression in the harness: leaks = 0, console errors = 0, all 27
   indicators clean, log scale still correct.

---

## Phase 1.0 ✅ — Upgrade the manual test surface (App.svelte toolbar)

> Done. See `PHASE1_NOTES.md` for what shipped + the pre-1.1 baseline
> (1 main-canvas repaint per mouse move on 100k candles).

Prerequisite so every later change is visually testable by the user. (Standing
directive: keep App.svelte useful for manual testing.)

**Build in `src/App.svelte`:**
- A real left toolbar grouped into sections:
  - **Drawing tools** (wire to existing `tool-selected` event): cursor, trend
    line/segment, ray, rectangle, circle, brush, Fib retracement, long/short
    position, measure (RangeTool), text, remove, magnet toggle.
  - **Scale**: linear / log / (later: %, indexed) — sets
    `pane.settings.scales.A` and `fullReset`.
  - **Data**: load small / medium / large (100k) dataset, toggle real-time
    append on/off (drives FPS tests), index-based toggle.
  - **Indicators**: quick-add a few (SMA/EMA/RSI/MACD/BB) onto the chart.
  - **Perf HUD** (top-right overlay): live FPS, last frame time, main-canvas
    draw count, crosshair-canvas draw count — reads the same probe counters so
    the user can SEE the layer-split working.
- Keep the existing `redraw` (destroy/recreate) button for leak spot-checks.

**Docs:** note the toolbar wiring in `ARCHITECTURE.md` (test surfaces section).

> This phase has no engine risk; it's tooling. Do it first.

---

## Phase 1.1 ✅ — Split static vs dynamic layers; decouple the cursor path

> Done. Hover repaints of the main canvas: 30→0 on 100k candles. See
> `PHASE1_NOTES.md` (1.1).

**The single biggest win.** Today a mouse move rebuilds `Layout` and repaints
the whole pane (see `ARCHITECTURE.md` → "hot path").

### 1.1a — Separate the crosshair onto its own top canvas
- Give the cursor-driven primitive(s) a distinct `ctxType`, e.g.
  `Crosshair.ctxType = 'Overlay'` (keep `Grid`/`Trackers`/overlays as
  `'Canvas'`). Because Crosshair has the highest `zIndex`, after the sort it is
  the last layer, so `mergeByCtx` (`Grid.svelte:156`) naturally yields a second
  renderer stacked on top — no merge-logic rewrite needed.
- Teach the Grid template (`Grid.svelte:226`) to mount a `Canvas` for the
  `'Overlay'` ctxType too (transparent background; it already supports
  `layout.main ? transparent`). Ensure z-stacking via CSS (`z-index`) so the
  overlay canvas sits above the static one.
- Decide on Trackers: price lines depend on range/data, not cursor → keep them
  on the **static** canvas. Only the crosshair (and its cursor read-out)
  belongs on the dynamic canvas.

### 1.1b — A cursor-only update that skips Layout + main redraw
- In `Chart.svelte`, split `onCursorChanged`: when only the cursor moved (no
  range/size change) call a new `cursorUpdate()` that:
  - runs `cursor.xSync(...)` (reusing the **existing** `layout`, no `new
    Layout`),
  - emits a new lightweight event (e.g. `update-overlay-rr`) that Grid forwards
    **only** to the crosshair renderer,
  - updates the sidebar/botbar cursor panels (already separate draws).
- Keep the heavy `update()` for range/data/layout/size changes.
- The input attach point (`Pointer` on the last renderer) still emits
  `cursor-changed`; only Chart's handling changes.

**Risk:** medium — touches the core update routing. Mitigate by keeping the old
`update()` path intact and adding the light path beside it; feature-flag via a
config (`FAST_CURSOR`) during bring-up.

**Verify:** Perf HUD shows main-canvas draw count frozen while moving the mouse;
crosshair count increments. Harness stays green.

---

## Phase 1.2 ✅ — requestAnimationFrame batching + dirty flags

> Done. 20 synchronous paint events/tick now coalesce to 1 paint/frame. See
> `PHASE1_NOTES.md` (1.2). Also includes the 1.1 drawing-tools regression fix
> (tools moved to the 'Overlay' canvas).

Today each event triggers a synchronous draw (`Canvas.svelte:87`), and multiple
events per frame cause multiple repaints.

- Add a per-renderer `dirty` flag. `update-rr` sets `dirty = true` and schedules
  a single `requestAnimationFrame` that draws once per frame, then clears the
  flag (coalesces N events/frame → 1 paint).
- Coalesce at the Chart level too: multiple `update()` calls within a frame
  rebuild Layout at most once per frame.
- Keep an escape hatch for synchronous draw where needed (e.g. export/snapshot).

**Risk:** low–medium (ordering of crosshair vs main paint). Verify visual
correctness during fast pan + cursor.

---

## Phase 1.3 ⬜ — Memoize Layout + incremental y-range

`Chart.update()` does `new Layout(...)` every call (`Chart.svelte:141`), and
`gridScale.js` scans all points for min/max each time.

- Make Layout reuse cached geometry when only the cursor changed (covered by 1.1
  skipping Layout entirely; this item covers range/zoom where geometry DOES
  change but most sub-results can be reused).
- Replace the full-data min/max scan with a windowed scan over the visible
  `[i1,i2]` plus a small cache keyed by `(i1,i2,scaleId)`; invalidate on data
  append. (Auto-scale only needs the visible window.)
- Avoid rebuilding transform closures (`layoutFn.js`) when range is unchanged.

**Risk:** medium (correctness of auto-scale at edges). Verify y-axis matches the
pre-change rendering on a fixed dataset (pixel-diff a screenshot).

---

## Phase 1.4 ⬜ — Text-metric cache

`ctx.measureText()` is called per label per frame (`sidebar.js`, `botbar.js`,
`gridScale.js` sidebar-width calc).

- Add a small `Map<font+string, width>` cache (module-level, bounded). Sidebar
  width and axis labels change rarely; cache hits dominate.

**Risk:** low. Verify axis label widths unchanged.

---

## Phase 1.5 ⬜ — Data decimation for large datasets

`DataView.makeSubset()` always `slice()`s the visible window; at high zoom-out
that is far more points than pixels.

- When visible points ≫ canvas width:
  - **candles/bars:** min/max-per-pixel-column (preserve wick extremes),
  - **lines/area:** LTTB (Largest-Triangle-Three-Buckets).
- Cache decimated buffers per zoom bucket; reuse arrays to cut GC.
- `log()` when decimation is active so it never silently hides data.

**Risk:** medium (must not distort OHLC). Verify against undecimated render at a
few zoom levels.

---

## Sequencing & rollback

1. 1.0 toolbar (no engine risk) →
2. 1.1 layer split + cursor decouple (biggest win) →
3. 1.2 rAF batching →
4. 1.3 layout/y-range →
5. 1.4 text cache →
6. 1.5 decimation.

Each item is independently revertable. After each, run the harness leak/NaN/
scale checks + the Perf HUD and record numbers in `docs/PHASE1_NOTES.md`
(created during implementation).

## Out of scope

- GPU/Pixi rendering of candles/lines, OffscreenCanvas-in-worker → **CANCELLED**
  (user decision — no GPU phase). Any future large-data-zoom-out fix stays on the
  existing Canvas (render-time decimation).
- New chart types, drawing tools, object tree → **Phase 3** (done).
