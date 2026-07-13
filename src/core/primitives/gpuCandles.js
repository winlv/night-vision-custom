// GpuCandles — prototype WebGL candle renderer built on GpuOverlay.
//
// A candle is just rectangles, so it maps 1:1 onto the instanced-quad base:
//   wick   -> 1px-wide quad   (high..low)
//   body   -> CANDLEW quad    (open..close)
//   volume -> bottom-anchored quad
//
// This is an A/B prototype that runs ALONGSIDE the Canvas-2D `candles.navy`
// (toggle in App.svelte). It mirrors layoutCnvFast.js geometry so positions
// match the Canvas-2D candles exactly. The GPU canvas sits *behind* the
// Canvas-2D layers (same as the heatmap), so grid/indicators/tools still draw
// on top.

import GpuOverlay from './gpuOverlay.js';
import math from '../../stuff/math.js';

export default class GpuCandles extends GpuOverlay {

    constructor(id) {
        // ~3 quads per candle; 150k instances covers ~50k on-screen candles
        // (already sub-pixel at that zoom). Kept moderate because the CPU-side
        // Float32Array is allocated per chart and grid pages show many charts.
        super(id, { maxInstances: 150000, className: 'nvjs-gpu-candles' });
        this.meta.gpuCandles = this;
        this._colorCache = {};
    }

    // Cache color parsing (only a handful of distinct color strings).
    color(str) {
        let c = this._colorCache[str];
        if (!c) c = this._colorCache[str] = this.parseColor(str);
        return c;
    }

    // Rebuild the whole instance buffer from the current view and upload it.
    // Called from a candle overlay's draw() on every layout update.
    // `colors` (optional) overrides core.colors so an overlay can pass its own
    // props palette: { candleUp, candleDw, wickUp, wickDw, volUp, volDw }.
    render(core, showVolume = true, colors) {
        const layout = core.layout;
        const view = core.view;
        const data = core.data;
        if (!this.mesh || !data?.length || !layout || !view) { this.clear(); return; }

        const config = core.props.config;
        colors = colors || core.colors;
        const { A, B, pxStep } = layout;
        const ls = layout.scaleSpecs?.log;

        const w = Math.max(pxStep * config.CANDLEW, 1);
        const halfW = w / 2;

        const cbU = this.color(colors.candleUp);
        const cbD = this.color(colors.candleDw);
        const cwU = this.color(colors.wickUp);
        const cwD = this.color(colors.wickDw);
        const cvU = this.color(colors.volUp);
        const cvD = this.color(colors.volDw);

        // Volume scale: VOLSCALE * paneHeight / maxVolume (over the data subset).
        let vs = 0;
        if (showVolume) {
            const sub = core.dataSubset || data;
            let maxv = 0;
            for (let i = 0; i < sub.length; i++) {
                const v = sub[i][5];
                if (v > maxv) maxv = v;
            }
            vs = maxv ? (config.VOLSCALE * layout.height / maxv) : 0;
        }
        const y0 = layout.height;

        const px = (price) => Math.floor((ls ? math.log(price) : price) * A + B);

        this.beginFrame();

        // Grid first, so it renders UNDER the candles. The 2D Grid layer skips
        // its own draw on this pane while GPU candles are active — the whole
        // WebGL canvas sits below the Canvas-2D layers, so a 2D grid would
        // otherwise land on top of the candle bodies.
        const gc = this.color(core.props.colors.grid);
        if (gc.a > 0 && this.meta.gridShown !== false) {
            for (let k = 0; k < layout.xs.length; k++) {
                this.addQuad(layout.xs[k][0], 0, 1, layout.height, gc.r, gc.g, gc.b, gc.a);
            }
            for (let k = 0; k < layout.ys.length; k++) {
                this.addQuad(0, layout.ys[k][0], layout.width, 1, gc.r, gc.g, gc.b, gc.a);
            }
        }

        for (let i = view.i1, n = view.i2; i <= n; i++) {
            const p = data[i];
            if (!p) continue;

            const mid = layout.ti2x(p[0], i) + 1;
            const x = mid - halfW;
            const green = p[4] >= p[1];

            // Volume bar (behind body/wick).
            if (vs) {
                const vh = p[5] * vs;
                if (vh > 0) {
                    const vc = green ? cvU : cvD;
                    this.addQuad(x, y0 - vh, w, vh, vc.r, vc.g, vc.b, vc.a);
                }
            }

            const oY = px(p[1]);
            const hY = px(p[2]);
            const lY = px(p[3]);
            const cY = px(p[4]);

            // Wick (1px, centered). min(y) is the higher price (A is negative).
            const wc = green ? cwU : cwD;
            const wTop = Math.min(hY, lY);
            const wH = Math.max(Math.abs(lY - hY), 1);
            this.addQuad(mid - 0.5, wTop, 1, wH, wc.r, wc.g, wc.b, wc.a);

            // Body.
            const bc = green ? cbU : cbD;
            const bTop = Math.min(oY, cY);
            const bH = Math.max(Math.abs(cY - oY), 1);
            this.addQuad(x, bTop, w, bH, bc.r, bc.g, bc.b, bc.a);
        }
        this.endFrame();
    }

    destroy() {
        if (this.meta.gpuCandles === this) this.meta.gpuCandles = undefined;
        super.destroy();
    }
}
