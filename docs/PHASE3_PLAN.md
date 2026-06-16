# Phase 3 — Chart types + tools (plan)

> Goal: close the most-missed feature gaps vs TradingView. Each item is
> self-contained, testable from the App.svelte toolbar, and documented here.
> Status: ⬜ todo · 🟦 in progress · ✅ done.

## Order (most value / least risk first)

### 3.1 ✅ Heikin Ashi (chart type)  — DONE
Verified: toolbar "Chart type → heikin ashi" swaps the main overlay to type
`HeikinAshi`, renders without errors, toggles back to candles; harness Δlisteners=0,
build ok. Files: `layoutCnvFast.js` (+`dataOverride` param), `src/scripts/HeikinAshi.navy`,
App.svelte "Chart type" toolbar group. Known v1 simplifications: yRange uses raw
high/low (HA stays ~within range); price line tracks the real close.

(original plan kept below)
Derived-OHLC transform that reuses the candle renderer.
- `layoutCnvFast.js`: add an optional `dataOverride` param (default `core.data`)
  so a candle-style overlay can render a transformed series. Backward-compatible.
- `src/scripts/HeikinAshi.navy`: compute the HA series from `$core.data`
  (sequential: HAclose=(o+h+l+c)/4, HAopen=(prevHAopen+prevHAclose)/2, HAhigh/low
  = max/min(raw, HAo, HAc)), cache by (len,lastT,lastC) so pan doesn't recompute,
  render via `$lib.layoutCnv(..., haData)`. yRange/legend reuse raw (HA stays ~in
  raw range; refine later).
- App toolbar: "Chart type" group → Candles / Heikin Ashi (swaps main overlay
  `type` + fullReset).

### 3.2 ✅ Measure tool — SKIPPED (RangeTool already good, per user)

### 3.3 ✅ Renko / Range bars (price-based types) — DONE
Library builders `Utils.renko(data, brick)` and `Utils.rangeBars(data, range)`
(in `utils.js`) produce wickless OHLCV brick/bar series from candles. App toolbar
"Chart type → renko / range bars" swaps the main overlay's data to the bricks and
goes index-based (bricks are evenly spaced; time non-uniform), preserving tools;
switching back to candles/HA restores `rawOHLC` + the dataset's natural index mode
(`baseIndexBased`). Brick size auto = avg |Δclose| × 5.
Verified: 1000 candles → 47 bricks (valid OHLC boxes), index-based on, round-trips
back to 1000 candles, no errors, build ok.

### 3.4 ✅ Object tree (drawings/indicators panel) — DONE
Right-side collapsible panel in App.svelte. `buildTree()` scans every overlay +
each drawing-tool overlay's `data`/`dataExt` for items with `uuid`; shows
price/indicator overlays always and tool overlays only when they have objects.
Per-overlay show/hide toggles `settings.display` + `chart.update('layout')`;
per-object delete calls `chart.meta.removeTool(uuid)`; object click emits
`object-selected` (best-effort highlight). Refreshes off the HUD's 0.5s tick.
Verified: lists overlays (2→3 after +SMA), drawing a rectangle adds an object,
delete removes it, hide toggles display→false; harness Δlisteners=0, build ok.
Note: the default dataset ships 1 saved drawing (shows as 1 object on load).

### 3.5 ✅ Channels + Fib extensions — DONE
- **Fib extensions:** already present — `FibRetracement.navy` ships extension levels
  (1.618 / 2.618 / 4.236) toggleable via each level's `active` flag. No new tool needed.
- **Parallel Channel:** new tool `src/scripts/tools/ParallelChannel.navy` (multi-shape
  pattern like Rectangle — channels stored in `dataExt.channels`, integrates with the
  object tree + `meta.removeTool`). 3-click create: base line p1→p2, then width p3;
  renders two parallel lines + fill; per-pin drag, whole-channel move, hover/select,
  delete. App: added to the tools list + a ParallelChannel overlay pushed on init
  (it isn't in the dataset's pre-loaded tools).
  Verified: 3-click create yields 1 channel with distinct p1/p2/p3, shows in the
  object tree, tool resets to Cursor, harness Δlisteners=0, build ok. Interaction
  polish (drag/move) to confirm visually.

## Phase 3 status: 3.1✅ 3.2(skip) 3.3✅ 3.4✅ 3.5✅ — feature set substantially closed.

### 3.4 follow-up ✅ — per-object hide / lock
Object data carries `hidden` / `locked` flags. Shape classes
(`rectangle.js`, `circleDrawing.js`, `fibRetracement.js`, `shortLongPosition.js`,
`trendLine.js`) skip `draw()` when hidden and early-return from `mousedown`/
`mousemove` when hidden-or-locked; `ParallelChannel.navy` does the same inline.
Object tree shows per-object **H** (hide) and **L** (lock) toggles next to delete.
Verified: locking a rectangle makes a click no longer select it; hide sets the
flag + skips render; harness Δlisteners=0, build ok. The flag is the shared shape
data ref, so toggles apply immediately.

Possible follow-ups: Renko/Range as a first-class library API (currently App-level),
regression channel. (Note: GPU rendering phase is cancelled — not an option.)

## Conventions
- Every new chart type/tool gets a toolbar affordance in App.svelte.
- Verify each with Playwright (mount, no errors, feature works) + harness clean +
  build. Record in this file.
