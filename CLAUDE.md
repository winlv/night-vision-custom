# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server (http://localhost:8085)
npm run build        # Build ES module library + copy TypeScript definitions to dist/
npm run build-cdn    # Build minified UMD bundle for CDN (outputs dist/night-vision.min.js)
npm run preview      # Preview production build
```

There are no test commands — the project has no test suite.

## Architecture

Night Vision Charts is a GPU-accelerated financial charting library targeting professional traders. It wraps a Svelte component tree behind a vanilla JS public API.

### Public API layer

`src/interface.js` exports the `NightVision` class — a plain JS wrapper that mounts the Svelte root component. This is what consumers interact with. `src/index.js` re-exports `NightVision` plus core singletons (`DataHub`, `MetaHub`, `DataScan`, `Scripts`, `Events`, `Const`, `Utils`).

### Core singletons (src/core/)

These are instantiated once per chart and passed through Svelte context:

- **dataHub.js** — owns panes, overlays, and data subsets; mutations here drive re-renders
- **metaHub.js** — computes scales, price ranges, and OHLC index maps from DataHub state
- **layout.js** — grid geometry (pane heights, axis widths, pixel mappings)
- **cursor.js** — crosshair position and state
- **events.js** — internal event bus; key events: `update-layout`, `full-update`, `remake-grid`, `update-legend`
- **dataScanner.js** — detects candle intervals, parses timeframes, infers default ranges

### Script engine (src/core/se/)

Implements **Navy Lang**, a custom DSL for writing indicators. `script_engine.js` parses and evaluates Navy scripts. Heavy computation runs in a web worker via `SeClient`/`WebWork`. Built-in indicator scripts live in `src/scripts/indicators/*.navy` and are bundled as JS strings by `vite-raw-plugin.js` at build time.

### Component tree (src/components/)

```
NightVision.svelte          ← mounts Chart, passes context
  Chart.svelte              ← orchestrates all panes, handles resize
    Pane.svelte             ← one instance per chart pane
      Canvas.svelte         ← Pixi.js WebGL renderer per pane
    Legend.svelte
    Botbar.svelte           ← time axis
    Sidebar.svelte          ← price axis
```

Rendering is done via **Pixi.js 7** (WebGL/Canvas2D). Each `Canvas.svelte` owns a Pixi application.

### Primitives (src/core/primitives/)

Low-level renderers called from within Pixi render loops: `grid.js`, `crosshair.js`, `botbar.js`, `sidebar.js`, `priceLine.js`, `heatmap.js` (offloads to `heatmap.worker.js`).

### Build outputs

- **ES module** (`dist/night-vision.es.js`) — for bundlers; produced by `vite.config.js`
- **UMD** (`dist/night-vision.umd.js`) — for direct script tags; same config
- **CDN bundle** (`dist/night-vision.min.js`) — standalone minified; produced by `vite.cdn.config.js`

TypeScript definitions are in `types/` and copied to `dist/` by `types/build-script.cjs` after the Vite build.

### Navy Lang `.navy` files

Indicator scripts use a custom DSL (`*.navy`). The `vite-raw-plugin.js` Vite plugin transforms these files into JS string exports so they can be loaded and interpreted at runtime by the script engine. When adding or editing indicators, edit the `.navy` file — do not manually inline the string.

### Key constants and defaults

`src/stuff/constants.js` holds all default chart config values, colors, and layout constants. Override these via the `config` prop on the `NightVision` constructor.
