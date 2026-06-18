// Orderbook depth heatmap — a GpuOverlay specialization.
//
// All the Pixi/WebGL instanced-quad plumbing now lives in GpuOverlay; this
// file only does the orderbook-specific work: per-exchange color palettes and
// turning [timestamp, {a, b}] depth snapshots into colored cells.

import GpuOverlay from './gpuOverlay.js';

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
    'bit-f': 'BITGET_FUTURES',
    'ast-s': 'ASTERDEX_SPOT',
    'ast-f': 'ASTERDEX_FUTURES',
    'hyp-s': 'HYPERLIQUID_SPOT',
    'hyp-f': 'HYPERLIQUID_FUTURES',
    'kuc-s': 'KUCOIN_SPOT',
    'kuc-f': 'KUCOIN_FUTURES'
};

export default class Heatmap extends GpuOverlay {

    // Backward-compat aliases: navy scripts (heatmap.navy, ht.navy) reach into
    // `meta.heatmap.heatmapApp.stage` and code referenced `.instancedMesh`.
    get heatmapApp() { return this.app; }
    get instancedMesh() { return this.mesh; }

    constructor(id) {
        super(id, { maxInstances: 300000, className: 'orderbook-heatmap' });

        this.PALETTE_SIZE = 256;
        this.palettes = { asks: {}, bids: {} };
        this.maxVolumes = new Map();
        this.lastScales = { asks: '', bids: '' };

        this.events.on(`heatmap-layer:layout-update`, this.layoutUpdate.bind(this));
        this.meta.heatmap = this;
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
        if (!this.mesh || !data?.length) return;

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
                const maxIdx = this.MAX_INSTANCES * this.STRIDE;

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

                    idx += this.STRIDE;
                }
            };

            if (levels.a) renderSide(levels.a, 'asks');
            if (levels.b) renderSide(levels.b, 'bids');
        }

        this.commit(idx / this.STRIDE);
    }

    layoutUpdate({layout, props}) {
        if (!layout.main || !this.app) return;
        this.resetTransform();
    }

    destroy() {
        this.events.off('heatmap-layer');
        super.destroy();
    }
}
