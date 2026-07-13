// GpuOverlay — reusable WebGL instanced-quad overlay base.
//
// This is the generalized core extracted from heatmap.js. It renders through
// the chart's SHARED GpuContext (one WebGL context per chart — see
// gpuContext.js): each overlay owns a PIXI.Container layer inside the shared
// stage plus an instanced unit-quad mesh, and exposes a tiny API for
// subclasses to push colored rectangles to the GPU. Subclasses only implement
// data -> quads (and their own layout wiring); all GPU plumbing lives here.
//
// Instance buffer layout (STRIDE = 8 floats per quad):
//   [ x, y, w, h,  r, g, b, a ]
//     pos    size  color (0..1, straight alpha)
//
// Use it for any "lots of colored rectangles" overlay: orderbook heatmap,
// footprint grid, predictive-liquidation heatmap, etc.
//
// The constructor THROWS when the GPU is unavailable (no chart root yet,
// context budget exhausted, WebGL creation failed) — but only BEFORE any GPU
// allocation, so a failed construction never leaks a WebGL context. Callers
// (MetaHub.init*) catch and fall back to Canvas-2D.

import * as PIXI from 'pixi.js';
import Events from '../events.js';
import MetaHub from '../metaHub.js';
import GpuContext from './gpuContext.js';

const VERTEX_SHADER = `
    attribute vec2 aVertexPosition;
    attribute vec2 aInstancePos;
    attribute vec2 aInstanceSize;
    attribute vec4 aInstanceColor;

    uniform mat3 translationMatrix;
    uniform mat3 projectionMatrix;

    varying vec4 vColor;

    void main() {
        vColor = aInstanceColor;
        vec3 finalPos = translationMatrix * vec3(aVertexPosition * aInstanceSize + aInstancePos, 1.0);
        gl_Position = vec4((projectionMatrix * finalPos).xy, 0.0, 1.0);
    }
`;

const FRAGMENT_SHADER = `
    precision mediump float;
    varying vec4 vColor;
    void main() {
        // premultiply so straight-alpha colors blend correctly with NORMAL blend
        gl_FragColor = vec4(vColor.rgb * vColor.a, vColor.a);
    }
`;

export default class GpuOverlay {

    gpu = undefined;          // shared GpuContext (refcounted)
    layer = undefined;        // PIXI.Container — this overlay's slice of the stage
    mesh = undefined;         // PIXI.Mesh (instanced quads)
    instanceBuffer = undefined; // Float32Array, the CPU-side instance data
    gpuBuffer = undefined;    // PIXI.Buffer wrapping instanceBuffer

    STRIDE = 8;               // floats per instance

    constructor(id, {
        maxInstances = 300000,
        className = 'nvjs-gpu-overlay',
        blendMode = PIXI.BLEND_MODES.NORMAL,
    } = {}) {

        this.nvId = id;
        this.events = Events.instance(this.nvId);
        this.meta = MetaHub.instance(this.nvId);

        this.MAX_INSTANCES = maxInstances;
        this._writeIdx = 0;   // float cursor for addQuad()/beginFrame()

        const chart = this.meta.hub && this.meta.hub.se && this.meta.hub.se.chart;
        const root = chart && chart.root;

        this.gpu = GpuContext.acquire(this.nvId, root);
        if (!this.gpu) throw new Error('nvjs GpuOverlay: GPU unavailable (no root or context budget)');

        try {
            this.layer = new PIXI.Container();
            this.layer.name = className;
            this.gpu.stage.addChild(this.layer);
            this.initMesh(blendMode);
        } catch (e) {
            // Don't leak the acquired refcount on a partial construction —
            // otherwise the shared context can never be freed.
            GpuContext.release(this.nvId, this.gpu);
            this.gpu = null;
            throw e;
        }
    }

    // Backward-compat: overlays/hosts used to reach `.app.view` / `.app.resize()`.
    // They now get the SHARED per-chart Pixi application.
    get app() { return this.gpu ? this.gpu.app : undefined; }

    // (Re)acquire the shared context if ours was reclaimed — the orphan
    // sweep may free the context of a chart whose DOM was temporarily
    // detached. The layer survives context destruction (GpuContext keeps
    // stage children intact), so re-adding it to a fresh stage fully
    // revives the overlay; Pixi lazily rebuilds GL buffers per context.
    ensureContext() {
        if (this.gpu && this.gpu.app) return true;
        if (this._destroyed) return false;
        const chart = this.meta.hub && this.meta.hub.se && this.meta.hub.se.chart;
        const root = chart && chart.root;
        const gpu = GpuContext.acquire(this.nvId, root);
        if (!gpu) return false;
        this.gpu = gpu;
        if (this.layer) gpu.stage.addChild(this.layer);
        return true;
    }

    // Keep this overlay's layer stacked above the chart's other GPU layers
    // (e.g. candles above the orderbook heatmap) and the shared canvas
    // attached to the LIVE chart root. All GPU layers still render below the
    // Canvas-2D layers (which use z-index:1).
    ensureTop() {
        if (!this.layer || !this.ensureContext()) return;
        this.gpu.ensureAttached();
        const stage = this.gpu.stage;
        if (stage && stage.children[stage.children.length - 1] !== this.layer) {
            stage.addChild(this.layer); // re-adding moves it to the top
        }
    }

    // Build the instanced unit-quad mesh and its GPU buffer.
    initMesh(blendMode) {
        const geometry = new PIXI.Geometry()
            .addAttribute('aVertexPosition', [0, 0, 1, 0, 1, 1, 0, 1], 2)
            .addIndex([0, 1, 2, 0, 2, 3]);

        this.instanceBuffer = new Float32Array(this.MAX_INSTANCES * this.STRIDE);
        this.gpuBuffer = new PIXI.Buffer(this.instanceBuffer, false, false);

        const byteStride = this.STRIDE * 4;
        geometry.addAttribute('aInstancePos',   this.gpuBuffer, 2, false, PIXI.TYPES.FLOAT, byteStride, 0,  true);
        geometry.addAttribute('aInstanceSize',  this.gpuBuffer, 2, false, PIXI.TYPES.FLOAT, byteStride, 8,  true);
        geometry.addAttribute('aInstanceColor', this.gpuBuffer, 4, false, PIXI.TYPES.FLOAT, byteStride, 16, true);

        const shader = PIXI.Shader.from(VERTEX_SHADER, FRAGMENT_SHADER);
        this.mesh = new PIXI.Mesh(geometry, shader, null, PIXI.DRAW_MODES.TRIANGLES);
        this.mesh.state.blendMode = blendMode;
        this.mesh.geometry.instanceCount = 0;

        this.layer.addChild(this.mesh);
    }

    // --- Convenience write API (cursor-based) -----------------------------
    // For overlays that build their quad list incrementally:
    //   ov.beginFrame(); ov.addQuad(...); ...; ov.endFrame();
    // Hot paths may instead fill `this.instanceBuffer` directly and call
    // `this.commit(count)` (see Heatmap.updateData).

    beginFrame() {
        this.ensureTop();
        this._writeIdx = 0;
    }

    // Returns false if the buffer is full (quad dropped).
    addQuad(x, y, w, h, r, g, b, a) {
        const idx = this._writeIdx;
        if (idx >= this.instanceBuffer.length) return false;
        const buf = this.instanceBuffer;
        buf[idx]     = x;
        buf[idx + 1] = y;
        buf[idx + 2] = w;
        buf[idx + 3] = h;
        buf[idx + 4] = r;
        buf[idx + 5] = g;
        buf[idx + 6] = b;
        buf[idx + 7] = a;
        this._writeIdx = idx + this.STRIDE;
        return true;
    }

    endFrame() {
        this.commit(this._writeIdx / this.STRIDE);
    }

    // Set how many instances to draw, upload the used part of the CPU buffer
    // to the GPU and schedule a render. Uploading only the prefix matters:
    // the full buffer is ~10MB and used to be re-uploaded on EVERY commit,
    // even for a few hundred visible quads.
    commit(instanceCount) {
        if (!this.mesh || !this.ensureContext()) return;
        // Pixi's GeometrySystem draws `instanceCount || 1` — a bare count of 0
        // would still draw one (stale) quad, so hide the mesh instead.
        this.mesh.visible = instanceCount > 0;
        this.mesh.geometry.instanceCount = instanceCount;
        if (instanceCount > 0) {
            this.gpuBuffer.update(this.instanceBuffer.subarray(0, instanceCount * this.STRIDE));
        }
        if (this.gpu) this.gpu.requestRender();
    }

    clear() {
        this.commit(0);
    }

    // Reset this overlay's transform (used by overlays that draw in screen
    // space). Per-layer now — the stage is shared between overlays.
    resetTransform() {
        if (!this.layer) return;
        this.layer.position.set(0, 0);
        this.layer.scale.set(1, 1);
    }

    // Parse "#rgb[a]"/"#rrggbb[aa]" or "rgb()/rgba()" into {r,g,b,a} in 0..1.
    parseColor(colorStr) {
        // Missing palette entries must not crash the per-frame draw path.
        if (typeof colorStr !== 'string' || !colorStr) return { r: 1, g: 1, b: 1, a: 1 };
        if (colorStr === 'transparent' || colorStr === 'none') return { r: 0, g: 0, b: 0, a: 0 };
        if (colorStr[0] === '#') {
            let hex = colorStr.substring(1);
            if (hex.length === 3 || hex.length === 4) {
                hex = hex.split('').map(c => c + c).join('');
            }
            const n = parseInt(hex.substring(0, 6), 16);
            return {
                r: ((n >> 16) & 255) / 255,
                g: ((n >> 8) & 255) / 255,
                b: (n & 255) / 255,
                a: hex.length === 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1,
            };
        }
        const m = colorStr.match(/[\d\.]+/g);
        if (m) return { r: m[0] / 255, g: m[1] / 255, b: m[2] / 255, a: parseFloat(m[3] ?? 1) };
        return { r: 1, g: 1, b: 1, a: 1 };
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        const geometry = this.mesh && this.mesh.geometry;
        if (this.layer) {
            if (this.layer.parent) this.layer.parent.removeChild(this.layer);
            try { this.layer.destroy({ children: true }); } catch (e) {}
            this.layer = null;
        }
        // Container.destroy doesn't free geometry/GPU buffers — do it explicitly.
        if (geometry) { try { geometry.destroy(); } catch (e) {} }
        this.mesh = null;
        this.gpuBuffer = null;
        this.instanceBuffer = null;
        if (this.gpu) {
            const stillDirty = this.gpu; // schedule a repaint of the remaining layers
            GpuContext.release(this.nvId, this.gpu);
            this.gpu = null;
            if (stillDirty.app) stillDirty.requestRender();
        }
    }
}
