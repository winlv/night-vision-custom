// HeatmapTexture — texture-based renderer for the orderbook depth heatmap.
//
// Instead of one instanced quad per cell (the legacy path in heatmap.js),
// the whole heatmap lives in a single 2D texture:
//
//   u axis  = time (one texel column per candle/snapshot column)
//   v axis  = price buckets (top row = highest price)
//   texel   = RGBA8: R = intensity index (1..255, 0 = empty),
//                    G = palette row (exchange * 2 + side), B/A unused.
//             (RGBA over a 2-channel format on purpose: LUMINANCE_ALPHA
//             texSubImage2D uploads hit "invalid format/type/internalFormat"
//             on ANGLE/WebGL2; RGBA+UNSIGNED_BYTE is valid everywhere.)
//
// One screen-space quad is drawn with a fragment shader that maps
// intensity -> color through a palette LUT texture (256 x paletteRows).
//
// Why: pan/zoom now only moves the quad (a vec4 uniform) — no CPU cell
// loop, no buffer re-upload, perfectly smooth at any history size. Data
// uploads happen only when the DATA changes (full pass) or when the last
// column ticks in realtime (a single-column texSubImage2D).
//
// Price/time coverage is windowed: if the whole dataset fits the texture
// (usual case) it is covered entirely and pan/zoom NEVER rebuilds; otherwise
// the window tracks the viewport with generous margins and rebuilds only on
// margin exits / zoom-resolution drift.
//
// Limitations: assumes a linear price scale and a uniform time grid — the
// caller (heatmap.js) falls back to the instanced-quad path on log scale.

import * as PIXI from 'pixi.js';

export const TEX_COLS = 2048;
export const TEX_ROWS = 2048;
const CHANNELS = 4; // RGBA8
const INTENSITY_LEVELS = 256;

const VERTEX = `
    attribute vec2 aVertexPosition;

    uniform mat3 translationMatrix;
    uniform mat3 projectionMatrix;
    uniform vec4 uRect;      // x, y, w, h of the heatmap window in screen space

    varying vec2 vUv;

    void main() {
        vUv = aVertexPosition;
        vec2 pos = uRect.xy + aVertexPosition * uRect.zw;
        gl_Position = vec4((projectionMatrix * translationMatrix * vec3(pos, 1.0)).xy, 0.0, 1.0);
    }
`;

const FRAGMENT = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif

    varying vec2 vUv;

    uniform sampler2D uData;
    uniform sampler2D uLut;
    uniform vec2 uUvScale;   // used cols/rows fraction of the fixed-size texture
    uniform float uLutRows;

    void main() {
        vec4 t = texture2D(uData, vUv * uUvScale);
        // R channel: 0 = empty cell, 1..255 = intensity index
        if (t.r <= 0.0) discard;
        float row = floor(t.g * 255.0 + 0.5);
        // map intensity byte to the center of its LUT texel
        float u = t.r * (255.0 / 256.0) + (0.5 / 256.0);
        vec4 c = texture2D(uLut, vec2(u, (row + 0.5) / uLutRows));
        // premultiply so straight-alpha palette colors blend with NORMAL blend
        gl_FragColor = vec4(c.rgb * c.a, c.a);
    }
`;

export default class HeatmapTexture {

    // `layer` is the overlay's PIXI.Container inside the shared GpuContext.
    // `lutRows` is the number of palette rows (exchanges * 2 sides).
    constructor(layer, lutRows) {
        this.lutRows = lutRows;

        // CPU mirror of the data texture. Row-major, row 0 = TOP price row,
        // matching texture v=0 and the quad's top edge.
        this.buffer = new Uint8Array(TEX_COLS * TEX_ROWS * CHANNELS);
        this.dataBase = PIXI.BaseTexture.fromBuffer(this.buffer, TEX_COLS, TEX_ROWS, {
            scaleMode: PIXI.SCALE_MODES.NEAREST,
            mipmap: PIXI.MIPMAP_MODES.OFF,
            wrapMode: PIXI.WRAP_MODES.CLAMP,
            alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA,
        });

        this.lutBytes = new Uint8Array(INTENSITY_LEVELS * lutRows * 4);
        this.lutBase = PIXI.BaseTexture.fromBuffer(this.lutBytes, INTENSITY_LEVELS, lutRows, {
            format: PIXI.FORMATS.RGBA,
            scaleMode: PIXI.SCALE_MODES.LINEAR,
            mipmap: PIXI.MIPMAP_MODES.OFF,
            wrapMode: PIXI.WRAP_MODES.CLAMP,
            alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA,
        });

        const geometry = new PIXI.Geometry()
            .addAttribute('aVertexPosition', [0, 0, 1, 0, 1, 1, 0, 1], 2)
            .addIndex([0, 1, 2, 0, 2, 3]);

        const shader = PIXI.Shader.from(VERTEX, FRAGMENT, {
            uData: new PIXI.Texture(this.dataBase),
            uLut: new PIXI.Texture(this.lutBase),
            uRect: [0, 0, 0, 0],
            uUvScale: [1, 1],
            uLutRows: lutRows,
        });

        this.mesh = new PIXI.Mesh(geometry, shader, null, PIXI.DRAW_MODES.TRIANGLES);
        this.mesh.state.blendMode = PIXI.BLEND_MODES.NORMAL;
        this.mesh.visible = false;
        layer.addChild(this.mesh);

        this._ready = false;         // a window has been computed & uploaded
        this._uploaded = false;      // full GPU upload happened at least once
        this._dataRef = null;
        this._lastColRef = null;
        this._extentRef = null;      // dataRef the cached price extent belongs to

        // Intensity curve exponent (set by heatmap.js before update()).
        this.gamma = 1;
        // Per-column accumulation scratch: data arrives at TICK granularity
        // and several tick levels can share one texel row when the visual
        // bucket (stepTex) is coarser — notionals are SUMMED per texel, the
        // palette row comes from the largest single contribution.
        this._accSum = new Float32Array(TEX_ROWS);
        this._accDom = new Float32Array(TEX_ROWS);
        this._accRow = new Uint8Array(TEX_ROWS);
    }

    hide() {
        if (this.mesh) this.mesh.visible = false;
    }

    // Rebuild the palette LUT. `fill(bytes)` writes RGBA8 rows into the
    // provided Uint8Array (256 * lutRows * 4). Called by heatmap.js whenever
    // its palettes are rebuilt (theme / maxVolumes change).
    setLut(fill) {
        fill(this.lutBytes);
        this.lutBase.update();
    }

    // Main entry, called on EVERY layout update by heatmap.js.
    //   data:   [[timestamp, {a: [p,q,ex...], b: [...]}], ...]
    //   step:   price bucket size the data is aggregated to
    //   maxVolOf(exId) -> normalization volume for the exchange
    //   rowOf(exId, isBid) -> LUT row index (or -1 to skip)
    //   volKey: identity of maxVolumesMap — intensities are normalized by it,
    //           so a change forces a data re-encode
    // Returns true when it rendered; false = caller should fall back to the
    // instanced-quad path for this frame.
    update(gpu, data, layout, step, maxVolOf, rowOf, volKey) {
        if (!this.mesh || !data?.length || !(step > 0)) { this.hide(); return false; }

        // More visible columns than the texture can hold (extreme zoom-out on
        // a long history) — quads handle that better than a blank window.
        if (data.length > TEX_COLS) {
            const {first, last} = this._visibleCols(data, layout);
            if (last - first + 1 > TEX_COLS * 0.9) {
                this.hide();
                this._ready = false;
                return false;
            }
        }

        const dataChanged = this._dataRef !== data
            || this._aggStep !== step
            || this._volKey !== volKey;

        let rebuild = dataChanged || !this._ready;

        if (!rebuild && this._windowStale(data, layout)) rebuild = true;

        if (rebuild) {
            if (!this._computeWindow(data, layout, step)) {
                // degenerate dataset (no levels at all)
                this.hide();
                this._ready = false;
                return false;
            }
            this._fill(data, maxVolOf, rowOf);
            this.dataBase.update(); // full upload (only on data/window change)
            this._uploaded = true;
            this._dataRef = data;
            this._aggStep = step;
            this._volKey = volKey;
            this._lastColRef = data[data.length - 1];
            this._ready = true;
        } else if (data[data.length - 1] !== this._lastColRef) {
            // Realtime tick: the navy mutates only the last column in place
            // (a fresh [ts, levels] entry in the same array).
            this._lastColRef = data[data.length - 1];
            this._updateLastColumn(gpu, data, maxVolOf, rowOf);
        }

        this._reposition(layout);
        return true;
    }

    // ------------------------------------------------------------------
    // Window management

    // Cached min/max price over all levels of the dataset (one scan per
    // dataset identity — rescanning on every view-triggered rebuild would
    // defeat the purpose).
    _priceExtent(data) {
        if (this._extentRef === data && this._extent) return this._extent;
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < data.length; i++) {
            const levels = data[i][1];
            for (const side of [levels.a, levels.b]) {
                if (!side) continue;
                for (let j = 0; j < side.length; j += 3) {
                    const p = side[j];
                    if (p < min) min = p;
                    if (p > max) max = p;
                }
            }
        }
        this._extentRef = data;
        this._extent = {min, max};
        return this._extent;
    }

    _viewRange(layout) {
        const hi = layout.$hi;
        const lo = layout.$lo ?? layout.$low;
        return {lo: Math.min(lo, hi), hi: Math.max(lo, hi)};
    }

    // First data column whose x >= 0 (binary search — ti2x is monotonic).
    _visibleCols(data, layout) {
        const x = (i) => layout.ti2xWithoutRound(data[i][0]);
        let a = 0, b = data.length - 1;
        while (a < b) { const m = (a + b) >> 1; if (x(m) < 0) a = m + 1; else b = m; }
        const first = a;
        a = 0; b = data.length - 1;
        const w = layout.width;
        while (a < b) { const m = (a + b + 1) >> 1; if (x(m) > w) b = m - 1; else a = m; }
        return {first, last: Math.max(a, first)};
    }

    // Does the current window still fit the viewport? Every check is
    // exempted at the DATA boundary (a window that already touches the edge
    // of the dataset can't be extended — retrying would rebuild every frame).
    _windowStale(data, layout) {
        const view = this._viewRange(layout);
        const span = Math.max(view.hi - view.lo, 1e-12);

        if (!this._fullSpan) {
            // 10% guard bands inside the covered price window
            const guard = (this._pTop - this._p0) * 0.1;
            if (view.lo < this._p0 + guard && this._p0 > this._extMin - this._stepTex) return true;
            if (view.hi > this._pTop - guard && this._pTop < this._extMax + this._stepTex) return true;
            // zoomed in enough that our buckets look coarse -> re-bucket.
            // Compare against the SNAPPED ideal step (multiple of aggStep) —
            // the raw ideal can be almost 2x smaller right after a rebuild.
            const idealSnapped = Math.ceil(
                Math.max(this._aggStep, (span * 3) / TEX_ROWS) / this._aggStep
            ) * this._aggStep;
            if (this._stepTex > idealSnapped * 1.9) return true;
        }
        if (!this._fullTime) {
            const {first, last} = this._visibleCols(data, layout);
            const margin = 8; // fresh windows get >=16 columns of padding
            if (first < this._c0 + margin && this._c0 > 0) return true;
            if (last > this._c1 - margin && this._c1 < data.length - 1) return true;
        }
        return false;
    }

    _computeWindow(data, layout, step) {
        this._aggStep = step;

        // ---- price axis
        const {min, max} = this._priceExtent(data);
        if (!isFinite(min) || !isFinite(max)) return false; // no levels at all
        this._extMin = min;
        this._extMax = max;
        const fullRows = Math.ceil((max - min) / step) + 2;
        if (fullRows <= TEX_ROWS) {
            // whole dataset fits at data resolution — never rebuild on pan/zoom
            this._stepTex = step;
            this._p0 = Math.floor(min / step) * step - step;
            this._rows = fullRows;
            this._fullSpan = true;
        } else {
            const view = this._viewRange(layout);
            const span = Math.max(view.hi - view.lo, step);
            // cover 3x the viewport (1x above + 1x below), never coarser than
            // needed, never finer than the data
            let stepTex = Math.max(step, (span * 3) / TEX_ROWS);
            stepTex = Math.ceil(stepTex / step) * step; // multiple of the data step
            const p0 = Math.floor((view.lo - span) / stepTex) * stepTex;
            const pTopWanted = view.hi + span;
            this._stepTex = stepTex;
            this._p0 = Math.max(p0, Math.floor(min / stepTex) * stepTex);
            this._rows = Math.max(1, Math.min(TEX_ROWS, Math.ceil((pTopWanted - this._p0) / stepTex)));
            this._fullSpan = false;
        }
        this._pTop = this._p0 + this._rows * this._stepTex;

        // ---- time axis
        if (data.length <= TEX_COLS) {
            this._c0 = 0;
            this._c1 = data.length - 1;
            this._fullTime = true;
        } else {
            // Split the spare capacity evenly around the viewport (update()
            // guarantees visible <= 0.9 * TEX_COLS here, so pad >= ~100).
            const {first, last} = this._visibleCols(data, layout);
            const visible = last - first + 1;
            const pad = Math.max(16, (TEX_COLS - visible) >> 1);
            let c0 = first - pad;
            if (c0 < 0) c0 = 0;
            if (c0 + TEX_COLS > data.length) c0 = data.length - TEX_COLS;
            this._c0 = c0;
            this._c1 = Math.min(data.length - 1, c0 + TEX_COLS - 1);
            this._fullTime = false;
        }
        this._cols = this._c1 - this._c0 + 1;
        this._t0 = data[this._c0][0];
        this._tLast = data[this._c1][0];
        return true;
    }

    // ------------------------------------------------------------------
    // Data writing

    _writeColumn(data, col, texCol, maxVolOf, rowOf) {
        const buf = this.buffer;
        const rows = this._rows;
        const p0 = this._p0;
        const stepTex = this._stepTex;
        const levels = data[col][1];

        const sum = this._accSum;
        const dom = this._accDom;
        const rowS = this._accRow;
        sum.fill(0, 0, rows);
        dom.fill(0, 0, rows);

        const writeSide = (side, isBid) => {
            if (!side) return;
            for (let j = 0; j < side.length; j += 3) {
                const price = side[j];
                // 1e-6 (a millionth of a row) absorbs the double rounding of
                // bucketed prices on high-price/small-tick symbols; bucket
                // values sit exactly on row starts, so it can't flip rows.
                const rFromBottom = Math.floor((price - p0) / stepTex + 1e-6);
                if (rFromBottom < 0 || rFromBottom >= rows) continue;
                const r = rows - 1 - rFromBottom;

                const exId = side[j + 2];
                const lutRow = rowOf(exId, isBid);
                if (lutRow < 0) continue;

                // Normalized contribution of this tick level; tick levels
                // sharing a coarser visual bucket SUM up (HD aggregation
                // happens right here, not in the data pipeline).
                const c = (price * side[j + 1]) / maxVolOf(exId);
                sum[r] += c;
                if (c > dom[r]) {
                    dom[r] = c;
                    rowS[r] = lutRow;
                }
            }
        };

        writeSide(levels.a, false);
        writeSide(levels.b, true);

        const gamma = this.gamma;
        for (let r = 0; r < rows; r++) {
            const off = (r * TEX_COLS + texCol) * CHANNELS;
            let v = sum[r];
            if (v <= 0) {
                buf[off] = 0;
                buf[off + 1] = 0;
                buf[off + 2] = 0;
                buf[off + 3] = 0;
                continue;
            }
            if (v > 1) v = 1;
            if (gamma !== 1) v = Math.pow(v, gamma);
            let idx = (v * 255) | 0;
            if (idx < 1) idx = 1; // 0 is reserved for "empty"
            buf[off] = idx;
            buf[off + 1] = rowS[r];
            buf[off + 2] = 0;
            buf[off + 3] = 255;
        }
    }

    _fill(data, maxVolOf, rowOf) {
        this.buffer.fill(0);
        for (let c = this._c0; c <= this._c1; c++) {
            this._writeColumn(data, c, c - this._c0, maxVolOf, rowOf);
        }
    }

    // Realtime fast path: rewrite one texel column in the CPU mirror and
    // upload just that column with a raw texSubImage2D — the full texture
    // upload is megabytes, the column is a few KB.
    _updateLastColumn(gpu, data, maxVolOf, rowOf) {
        const col = data.length - 1;
        if (col < this._c0 || col > this._c1) return; // outside the window
        const texCol = col - this._c0;
        this._writeColumn(data, col, texCol, maxVolOf, rowOf);

        const renderer = gpu && gpu.app && gpu.app.renderer;
        const gl = renderer && renderer.gl;
        if (!gl || !this._uploaded || (gl.isContextLost && gl.isContextLost())) {
            // no GL yet (or lost) — fall back to a full dirty upload; the CPU
            // mirror is already correct so Pixi re-uploads everything
            this.dataBase.update();
            return;
        }

        // gather the column (CPU mirror is row-major, stride TEX_COLS)
        const rows = this._rows;
        const colBytes = this._colScratch && this._colScratch.length >= rows * CHANNELS
            ? this._colScratch.subarray(0, rows * CHANNELS)
            : (this._colScratch = new Uint8Array(TEX_ROWS * CHANNELS)).subarray(0, rows * CHANNELS);
        for (let r = 0; r < rows; r++) {
            const src = (r * TEX_COLS + texCol) * CHANNELS;
            for (let k = 0; k < CHANNELS; k++) {
                colBytes[r * CHANNELS + k] = this.buffer[src + k];
            }
        }

        try {
            renderer.texture.bind(this.dataBase, 0);
            // Pixi sets the premultiply flag per upload and never restores it —
            // a leftover `true` from an image/text upload would multiply our
            // intensity by the palette-row byte.
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, texCol, 0, 1, rows,
                gl.RGBA, gl.UNSIGNED_BYTE, colBytes);
        } catch (e) {
            this.dataBase.update(); // safety net: schedule a full re-upload
        }
    }

    // ------------------------------------------------------------------
    // Geometry — the only thing that changes on pan/zoom

    _reposition(layout) {
        const halfCell = layout.pxStep / 2;
        const x0 = layout.ti2xWithoutRound(this._t0) - halfCell;
        const x1 = layout.ti2xWithoutRound(this._tLast) + halfCell;
        const yTop = layout.value2y(this._pTop, false);
        const yBot = layout.value2y(this._p0, false);

        const u = this.mesh.shader.uniforms;
        u.uRect = [x0, yTop, x1 - x0, yBot - yTop];
        u.uUvScale = [this._cols / TEX_COLS, this._rows / TEX_ROWS];
        this.mesh.visible = true;
    }

    destroy() {
        if (this.mesh) {
            const geometry = this.mesh.geometry;
            if (this.mesh.parent) this.mesh.parent.removeChild(this.mesh);
            try { this.mesh.destroy(); } catch (e) {}
            try { geometry.destroy(); } catch (e) {}
            this.mesh = null;
        }
        try { this.dataBase.destroy(); } catch (e) {}
        try { this.lutBase.destroy(); } catch (e) {}
        this.buffer = null;
        this.lutBytes = null;
    }
}
