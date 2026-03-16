import * as PIXI from 'pixi.js';
import Events from "../events.js";
import MetaHub from "../metaHub.js";

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
        gl_FragColor = vec4(vColor.rgb * vColor.a, vColor.a);
    }
`;

const EXCHANGES_CONFIG = {
    'bi-s': 'BINANCE_SPOT',
    'bi-f': 'BINANCE_FUTURES',
    'by-s': 'BYBIT_SPOT',
    'by-f': 'BYBIT_FUTURES',
    'okx-s': 'OKX_SPOT',
    'okx-f': 'OKX_FUTURES',
    'mexc-s': 'MEXC_SPOT',
    'mexc-f': 'MEXC_FUTURES',
    'gate-s': 'GATE_SPOT',
    'gate-f': 'GATE_FUTURES',
    'bit-s': 'BITGET_SPOT',
    'bit-f': 'BITGET_FUTURES'
};

export default class Heatmap {
    heatmapApp = undefined;
    instancedMesh = undefined;
    instanceBuffer = undefined;

    MAX_INSTANCES = 300000;
    STRIDE = 8;

    constructor(id) {
        this.nvId = id;
        this.events = Events.instance(this.nvId);
        this.meta = MetaHub.instance(this.nvId);

        this.events.on(`heatmap-layer:layout-update`, this.layoutUpdate.bind(this));

        this.heatmapApp = new PIXI.Application({
            backgroundAlpha: 0,
            antialias: true,
            autoDensity: true,
            resizeTo: window,
            resolution: window.devicePixelRatio || 1,
        });

        this.heatmapApp.view.style.position = 'absolute';
        this.heatmapApp.view.style.top = '0';
        this.heatmapApp.view.style.left = '0';
        this.heatmapApp.view.style.pointerEvents = 'none';
        this.heatmapApp.view.classList.add('orderbook-heatmap');

        this.PALETTE_SIZE = 256;
        this.askPalette = new Float32Array(this.PALETTE_SIZE * 4);
        this.bidPalette = new Float32Array(this.PALETTE_SIZE * 4);
        this.palettes = {
            asks: new Map(),
            bids: new Map()
        };
        this.maxVolumes = new Map();
        this.lastScales = { asks: '', bids: '' };

        window.PIXI = PIXI;

        this.initInstancedMesh();

        // hz
        this.meta.hub.se.chart.root.appendChild(this.heatmapApp.view);
        this.meta.heatmap = this;
    }

    initInstancedMesh() {
        const geometry = new PIXI.Geometry()
            .addAttribute('aVertexPosition', [0,0, 1,0, 1,1, 0,1], 2)
            .addIndex([0, 1, 2, 0, 2, 3]);

        this.instanceBuffer = new Float32Array(this.MAX_INSTANCES * this.STRIDE);

        this.gpuBuffer = new PIXI.Buffer(this.instanceBuffer, false, false);

        geometry.addAttribute('aInstancePos', this.gpuBuffer, 2, false, PIXI.TYPES.FLOAT, 32, 0, true);
        geometry.addAttribute('aInstanceSize', this.gpuBuffer, 2, false, PIXI.TYPES.FLOAT, 32, 8, true);
        geometry.addAttribute('aInstanceColor', this.gpuBuffer, 4, false, PIXI.TYPES.FLOAT, 32, 16, true);

        const shader = PIXI.Shader.from(VERTEX_SHADER, FRAGMENT_SHADER);
        this.instancedMesh = new PIXI.Mesh(geometry, shader, null, PIXI.DRAW_MODES.TRIANGLES);

        this.instancedMesh.state.blendMode = PIXI.BLEND_MODES.NORMAL;
        // hz
        this.instancedMesh.geometry.instanceCount = 0;

        this.heatmapApp.stage.addChild(this.instancedMesh);
    }

    updatePalettes(colorScaleAsks, colorScaleBids, maxVolumesMap) {
        const cacheKey = JSON.stringify(maxVolumesMap);
        if (this.lastScales.asks === cacheKey) return;

        this.palettes = { asks: {}, bids: {} };

        for (const [exName, maxVol] of Object.entries(maxVolumesMap)) {
            const askPal = new Float32Array(this.PALETTE_SIZE * 4);
            const bidPal = new Float32Array(this.PALETTE_SIZE * 4);

            for (let i = 0; i < this.PALETTE_SIZE; i++) {
                const val = i * (maxVol / (this.PALETTE_SIZE - 1));

                const askCol = this.parseColor(colorScaleAsks[exName](val));
                const bidCol = this.parseColor(colorScaleBids[exName](val));

                const off = i * 4;
                askPal[off] = askCol.r; askPal[off+1] = askCol.g;
                askPal[off+2] = askCol.b; askPal[off+3] = askCol.a;

                bidPal[off] = bidCol.r; bidPal[off+1] = bidCol.g;
                bidPal[off+2] = bidCol.b; bidPal[off+3] = bidCol.a;
            }

            this.palettes.asks[exName] = askPal;
            this.palettes.bids[exName] = bidPal;
        }

        this.lastScales.asks = cacheKey;
    }

    updateData(data, layout, props, colorScaleAsks, colorScaleBids, aggStep, exchange, maxVolumesMap, fullRedraw = false) {
        if (!this.instancedMesh || !data.length) return;

        this.updatePalettes(colorScaleAsks, colorScaleBids, maxVolumesMap);

        let idx = 0;
        const cellWidth = layout.pxStep;
        const step = aggStep || (1 / Math.pow(10, layout.prec));
        const y1 = layout.value2y(0, false);
        const y2 = layout.value2y(step, false);
        const yStepRange = y1 - y2;
        const yOffset = step * Math.pow(10, layout.prec);
        const cellHeight = Math.max(yStepRange / yOffset, 1);

        for (let i = 0; i < data.length; i++) {
            const [timestamp, levels] = data[i];
            const x = layout.ti2xWithoutRound(timestamp) - cellWidth / 2;
            if (x + cellWidth < 0 || x > layout.width) continue;

            const minVisiblePrice = layout.y2value(layout.height);
            const maxVisiblePrice = layout.y2value(0);

            const renderSide = (orders, type) => {
                const len = orders.length;
                const currentPalettes = this.palettes[type];

                const paletteMap = [];
                for (let id in EXCHANGES_CONFIG) {
                    paletteMap[id] = currentPalettes[EXCHANGES_CONFIG[id]];
                }

                const v2y = layout.value2y;

                const buffer = this.instanceBuffer;
                const maxIdx = this.MAX_INSTANCES * 8;

                for (let j = 0; j < len && idx < maxIdx; j += 3) {
                    const price = orders[j];

                    if (price > maxVisiblePrice + step) break;

                    const qty = orders[j + 1];
                    const exId = orders[j + 2];
                    const palette = paletteMap[exId];
                    if (!palette) continue;

                    const maxVol = maxVolumesMap[EXCHANGES_CONFIG[exId]] || 100000;
                    const intensity = (price * qty) / maxVol;

                    let pIdx = (intensity * 255) | 0;
                    if (pIdx > 255) pIdx = 255;
                    const pOff = pIdx << 2;

                    const y = v2y.call(layout, price + step, false);

                    buffer[idx]     = x;
                    buffer[idx + 1] = y;
                    buffer[idx + 2] = cellWidth;
                    buffer[idx + 3] = cellHeight;

                    buffer[idx + 4] = palette[pOff];
                    buffer[idx + 5] = palette[pOff + 1];
                    buffer[idx + 6] = palette[pOff + 2];
                    buffer[idx + 7] = palette[pOff + 3];

                    idx += 8;
                }
            };

            if (levels.a) renderSide(levels.a, 'asks');
            if (levels.b) renderSide(levels.b, 'bids');
        }

        this.instancedMesh.geometry.instanceCount = idx / 8;
        this.gpuBuffer.update(this.instanceBuffer);
    }

    // hz
    layoutUpdate({layout, props}) {
        if (!layout.main || !this.heatmapApp) return;
        this.heatmapApp.stage.position.set(0, 0);
        this.heatmapApp.stage.scale.set(1, 1);
    }

    // get rid of this shit
    parseColor(colorStr) {
        if (colorStr[0] === '#') {
            const hex = parseInt(colorStr.substring(1), 16);
            return { r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255, a: 1 };
        }
        const m = colorStr.match(/[\d\.]+/g);
        if (m) return { r: m[0]/255, g: m[1]/255, b: m[2]/255, a: parseFloat(m[3] || 1) };
        return { r: 1, g: 1, b: 1, a: 1 };
    }

    // hz
    destroy() {
        this.events.off('heatmap-layer');
        if (this.heatmapApp) {
            this.heatmapApp.destroy(true, { children: true, texture: true, baseTexture: true });
        }
    }
}