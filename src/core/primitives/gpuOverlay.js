// GpuOverlay — reusable WebGL instanced-quad overlay base.
//
// This is the generalized core extracted from heatmap.js. It owns a
// transparent Pixi.js Application laid over the Canvas-2D chart and an
// instanced unit-quad mesh, and exposes a tiny API for subclasses to push
// colored rectangles to the GPU. Subclasses only implement data -> quads
// (and their own layout wiring); all GPU plumbing lives here.
//
// Instance buffer layout (STRIDE = 8 floats per quad):
//   [ x, y, w, h,  r, g, b, a ]
//     pos    size  color (0..1, straight alpha)
//
// Use it for any "lots of colored rectangles" overlay: orderbook heatmap,
// footprint grid, predictive-liquidation heatmap, etc.

import * as PIXI from 'pixi.js';
import Events from '../events.js';
import MetaHub from '../metaHub.js';

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

    app = undefined;          // PIXI.Application
    mesh = undefined;         // PIXI.Mesh (instanced quads)
    instanceBuffer = undefined; // Float32Array, the CPU-side instance data
    gpuBuffer = undefined;    // PIXI.Buffer wrapping instanceBuffer

    STRIDE = 8;               // floats per instance

    constructor(id, {
        maxInstances = 300000,
        className = 'nvjs-gpu-overlay',
        antialias = true,
        blendMode = PIXI.BLEND_MODES.NORMAL,
    } = {}) {

        this.nvId = id;
        this.events = Events.instance(this.nvId);
        this.meta = MetaHub.instance(this.nvId);

        this.MAX_INSTANCES = maxInstances;
        this._writeIdx = 0;   // float cursor for addQuad()/beginFrame()

        this.app = new PIXI.Application({
            backgroundAlpha: 0,
            antialias,
            autoDensity: true,
            resizeTo: window,
            resolution: window.devicePixelRatio || 1,
        });

        const view = this.app.view;
        view.style.position = 'absolute';
        view.style.top = '0';
        view.style.left = '0';
        view.style.pointerEvents = 'none';
        view.classList.add(className);

        // Heatmap shaders reach into window.PIXI; keep it exposed for parity.
        window.PIXI = PIXI;

        this.initMesh(blendMode);

        this.meta.hub.se.chart.root.appendChild(view);
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

        this.app.stage.addChild(this.mesh);
    }

    // --- Convenience write API (cursor-based) -----------------------------
    // For overlays that build their quad list incrementally:
    //   ov.beginFrame(); ov.addQuad(...); ...; ov.endFrame();
    // Hot paths may instead fill `this.instanceBuffer` directly and call
    // `this.commit(count)` (see Heatmap.updateData).

    beginFrame() {
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

    // Set how many instances to draw and upload the CPU buffer to the GPU.
    commit(instanceCount) {
        if (!this.mesh) return;
        this.mesh.geometry.instanceCount = instanceCount;
        this.gpuBuffer.update(this.instanceBuffer);
    }

    clear() {
        this.commit(0);
    }

    // Reset the stage transform (used by overlays that draw in screen space).
    resetTransform() {
        if (!this.app) return;
        this.app.stage.position.set(0, 0);
        this.app.stage.scale.set(1, 1);
    }

    // Parse "#rrggbb" or "rgb()/rgba()" into {r,g,b,a} in 0..1.
    parseColor(colorStr) {
        if (colorStr[0] === '#') {
            const hex = parseInt(colorStr.substring(1), 16);
            return {
                r: ((hex >> 16) & 255) / 255,
                g: ((hex >> 8) & 255) / 255,
                b: (hex & 255) / 255,
                a: 1,
            };
        }
        const m = colorStr.match(/[\d\.]+/g);
        if (m) return { r: m[0] / 255, g: m[1] / 255, b: m[2] / 255, a: parseFloat(m[3] ?? 1) };
        return { r: 1, g: 1, b: 1, a: 1 };
    }

    destroy() {
        if (this.app) {
            this.app.destroy(true, { children: true, texture: true, baseTexture: true });
            this.app = null;
        }
    }
}
