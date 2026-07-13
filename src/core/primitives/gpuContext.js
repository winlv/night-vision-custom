// GpuContext — ONE shared WebGL context (Pixi Application) per chart.
//
// Previously every GPU overlay (heatmap, candles, clusters) owned its own
// PIXI.Application, i.e. its own WebGL context and its own window-sized
// canvas with a 60fps render loop. With 3 overlays per chart and grid pages
// showing 9-16 charts this blew past the browser's ~16 live-context limit
// ("Too many active WebGL contexts"), lost contexts at random and burned
// CPU/GPU on idle re-renders.
//
// This module fixes that structurally:
//   - one refcounted Pixi app (== one WebGL context, one canvas) per nvId;
//     overlays are PIXI.Containers stacked inside its stage
//   - the canvas is sized to the chart root, not the window
//   - rendering is on-demand: overlays call requestRender() after uploading
//     data; nothing renders while the chart is idle
//   - a global budget keeps the page under the browser context limit; when
//     it is exhausted acquire() returns null and the caller falls back to
//     Canvas-2D rendering
//   - the chart root is validated BEFORE any GPU allocation, so a failed
//     acquire never leaks a context

import * as PIXI from 'pixi.js';

// Stay well under the browser's ~16-context cap, leaving headroom for
// other tabs-in-page consumers (maps, video effects, devtools).
const MAX_CONTEXTS = 12;

let contexts = {}; // nvId -> GpuContext

class GpuContext {

    constructor(nvId, root) {
        this.nvId = nvId;
        this.refs = 0;
        this._renderQueued = false;
        this._root = root;
        this._rootId = root.id || null;

        this.app = new PIXI.Application({
            backgroundAlpha: 0,
            antialias: true,
            autoDensity: true,
            resizeTo: root,               // chart-sized, NOT window-sized
            resolution: window.devicePixelRatio || 1,
            autoStart: false,             // render on demand only
            sharedTicker: false,
        });

        try {
            this.app.ticker.stop();

            const view = this.app.view;
            view.style.position = 'absolute';
            view.style.top = '0';
            view.style.left = '0';
            view.style.pointerEvents = 'none';
            view.classList.add('nvjs-gpu-layer');
            root.appendChild(view);

            // Some navy heatmap shaders reach into window.PIXI; keep it exposed.
            window.PIXI = PIXI;
        } catch (e) {
            // The WebGL context exists at this point — release it, or a DOM
            // failure here would leak a context per init attempt.
            this._destroy();
            throw e;
        }
    }

    get stage() { return this.app ? this.app.stage : null; }

    // Coalesced, on-demand render: one app.render() per synchronous update
    // pass, and only when an overlay actually committed new data.
    //
    // Uses a MICROTASK, not requestAnimationFrame: the chart's own updates
    // (wheel zoom / drag) already run inside a rAF callback (see
    // pointer.js changeRange), so a nested rAF would land in the NEXT
    // frame — the Canvas-2D candles would repaint this frame while the GPU
    // heatmap trails one frame behind, visibly jumping on the x axis while
    // zooming. A microtask runs right after the current callback, still
    // before this frame is painted.
    requestRender() {
        if (this._renderQueued || !this.app) return;
        this._renderQueued = true;
        queueMicrotask(() => {
            this._renderQueued = false;
            const app = this.app;
            if (!app) return;
            this.ensureAttached();
            // Pick up chart-root size changes (split panes etc.) — but only
            // when the size actually changed: renderer.resize() clears the
            // canvas and app.resize() would even trigger an extra render.
            const root = this._root;
            const r = app.renderer;
            if (root && root.isConnected) {
                const w = root.clientWidth;
                const h = root.clientHeight;
                if (w > 0 && h > 0 && (r.screen.width !== w || r.screen.height !== h)) {
                    r.resize(w, h);
                }
            }
            const gl = r.gl;
            if (gl && gl.isContextLost && gl.isContextLost()) return;
            app.render();
        });
    }

    // Re-attach the canvas to the LIVE chart root after a DOM rebuild
    // (open-close-open, innerHTML reset) detached it.
    ensureAttached() {
        const view = this.app && this.app.view;
        if (!view) return;
        const root = (this._rootId && document.getElementById(this._rootId)) || this._root;
        if (!root || !root.isConnected) return;
        this._root = root;
        // Keep the resize plugin pointed at the LIVE root — after a DOM
        // rebuild it would otherwise measure the detached element (0x0).
        if (this.app.resizeTo !== root) this.app.resizeTo = root;
        if (view.parentNode !== root) root.appendChild(view);
    }

    _destroy() {
        if (this.app) {
            try {
                // Do NOT destroy stage children: the layers belong to the
                // overlays. Keeping them intact lets an overlay re-attach to
                // a fresh context (see GpuOverlay.ensureContext) after an
                // orphan sweep reclaimed this one. GL resources are freed
                // with the context anyway.
                this.app.stage.removeChildren();
                this.app.destroy(true, { texture: true, baseTexture: true });
            } catch (e) { /* context may already be lost */ }
            this.app = null;
        }
        this._root = null;
    }
}

// Reclaim contexts whose chart root left the DOM. Hosts are SUPPOSED to
// destroy their GPU overlays, but a single component that just drops its
// chart reference would otherwise permanently burn a budget slot — after a
// dozen chart switches nothing (including the bookmap heatmap) could get a
// context anymore. Only sweeps clearly-dead charts: a live root merely
// hidden (display:none) stays connected and is never touched.
function sweepOrphans() {
    for (const id in contexts) {
        const ctx = contexts[id];
        const root = (ctx._rootId && document.getElementById(ctx._rootId)) || ctx._root;
        if (!root || !root.isConnected) {
            ctx._destroy();
            delete contexts[id];
        }
    }
}

// Returns the shared context for the chart, or null when the root isn't
// ready / the budget is exhausted / WebGL is unavailable. Never throws and
// never leaks a context on failure.
function acquire(nvId, root) {
    let ctx = contexts[nvId];
    if (ctx && ctx.app) {
        ctx.refs++;
        return ctx;
    }
    // Validate the DOM before ANY GPU allocation. This ordering is the whole
    // point: allocating first and failing on appendChild leaked one WebGL
    // context per attempt.
    if (!root || !root.isConnected) return null;
    if (Object.keys(contexts).length >= MAX_CONTEXTS) {
        sweepOrphans(); // free slots held by silently-dropped charts
        if (Object.keys(contexts).length >= MAX_CONTEXTS) return null;
    }
    try {
        ctx = new GpuContext(nvId, root);
    } catch (e) {
        // WebGL creation itself failed (driver, headless, context limit
        // reached by other consumers). Caller falls back to Canvas-2D.
        console.warn('nvjs: GPU context unavailable, falling back to canvas:', e.message || e);
        return null;
    }
    contexts[nvId] = ctx;
    ctx.refs = 1;
    return ctx;
}

// `held` (optional) is the context the caller actually holds: after an
// orphan sweep an overlay can still point at a dead context while the
// registry already has a fresh one under the same id — releasing that
// fresh one would corrupt its refcount.
function release(nvId, held) {
    const ctx = contexts[nvId];
    if (!ctx || (held && held !== ctx)) return;
    if (--ctx.refs <= 0) {
        ctx._destroy();
        delete contexts[nvId];
    }
}

export default { acquire, release, MAX_CONTEXTS };
