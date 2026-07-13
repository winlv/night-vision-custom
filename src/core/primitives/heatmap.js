// Orderbook depth heatmap — a GpuOverlay specialization.
//
// All the Pixi/WebGL instanced-quad plumbing now lives in GpuOverlay; this
// file only does the orderbook-specific work: per-exchange color palettes and
// turning [timestamp, {a, b}] depth snapshots into colored cells.

import GpuOverlay from './gpuOverlay.js';
import HeatmapTexture from './heatmapTexture.js';

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
        // Cache signal for the palette: the scale FUNCTIONS (by reference — the host
        // rebuilds them on theme/exponent/opacity change) + the maxVolumes key.
        this.lastScales = { asks: null, bids: null, key: '' };

        // Texture renderer (heatmapTexture.js): pan/zoom becomes a uniform
        // update instead of a full cell rebuild. The instanced-quad path
        // stays as the fallback (log scale, explicit opt-out via
        // `heatmap.textureMode = false` or window.NVJS_HEATMAP_TEXTURE=false).
        this.textureMode = true;
        // Intensity curve exponent for the texture renderer (host-settable).
        this.intensityGamma = 1;
        // Stable LUT row per (exchange, side): asks = idx*2, bids = idx*2+1.
        this._exRow = {};
        const exIds = Object.keys(EXCHANGES_CONFIG);
        for (let i = 0; i < exIds.length; i++) this._exRow[exIds[i]] = i * 2;
        try {
            this.tex = new HeatmapTexture(this.layer, exIds.length * 2);
        } catch (e) {
            console.warn('nvjs: heatmap texture renderer unavailable, using quads:', e.message || e);
            this.tex = null;
        }

        this.events.on(`heatmap-layer:layout-update`, this.layoutUpdate.bind(this));
        this.meta.heatmap = this;
    }

    updatePalettes(colorScaleAsks, colorScaleBids, maxVolumesMap) {
        const cacheKey = JSON.stringify(maxVolumesMap);
        // Rebuild when maxVolumes OR the color scales change. The old code keyed
        // only on maxVolumesMap, so a theme/exponent/opacity change wouldn't take
        // effect until volumes happened to change. The host hands us fresh scale
        // objects on every settings change, so a reference check catches it.
        if (this.lastScales.key === cacheKey
            && this.lastScales.asks === colorScaleAsks
            && this.lastScales.bids === colorScaleBids) return;

        this.palettes = { asks: {}, bids: {} };

        for (const [exName, maxVol] of Object.entries(maxVolumesMap)) {
            const askPal = new Float32Array(this.PALETTE_SIZE * 4);
            const bidPal = new Float32Array(this.PALETTE_SIZE * 4);

            for (let i = 0; i < this.PALETTE_SIZE; i++) {
                // The host scales use a NORMALIZED [0..1] domain; the absolute
                // scale lives entirely in maxVolumesMap (p95 of visual-step
                // bucket notionals), which normalizes intensities before the
                // LUT lookup. maxVol deliberately does not shape the colors.
                const val = i / (this.PALETTE_SIZE - 1);

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

        this.lastScales = { asks: colorScaleAsks, bids: colorScaleBids, key: cacheKey };
        // The LUT texture is updated in place — a theme-only change (same
        // maxVolumes) recolors instantly without re-encoding the data texture.
        this._refreshLut();
    }

    // Mirror the CPU palettes into the texture renderer's LUT (256 x rows
    // RGBA8). Exchanges without a palette stay fully transparent — same
    // effect as the quad path skipping them.
    _refreshLut() {
        if (!this.tex) return;
        const exIds = Object.keys(EXCHANGES_CONFIG);
        this.tex.setLut((bytes) => {
            bytes.fill(0);
            for (let i = 0; i < exIds.length; i++) {
                const exName = EXCHANGES_CONFIG[exIds[i]];
                const askPal = this.palettes.asks[exName];
                const bidPal = this.palettes.bids[exName];
                for (const [pal, row] of [[askPal, i * 2], [bidPal, i * 2 + 1]]) {
                    if (!pal) continue;
                    const base = row * this.PALETTE_SIZE * 4;
                    for (let k = 0; k < this.PALETTE_SIZE * 4; k++) {
                        bytes[base + k] = Math.min(255, Math.max(0, Math.round(pal[k] * 255)));
                    }
                }
            }
        });
    }

    // Current per-exchange normalization (short exchange id -> p95). Exposed
    // so companion overlays (e.g. the magnifier) can convert a notional into
    // the same [0..1] scale position the heatmap uses.
    normFor(exId) {
        return (this.norms && this.norms[EXCHANGES_CONFIG[exId]]) || 100000;
    }

    updateData(data, layout, props, colorScaleAsks, colorScaleBids, aggStep, exchange, maxVolumesMap, fullRedraw = false) {
        if (!this.mesh || !data?.length) return;

        this.norms = maxVolumesMap;
        this.updatePalettes(colorScaleAsks, colorScaleBids, maxVolumesMap);

        const step = aggStep || (1 / Math.pow(10, layout.prec));

        // --- texture path: data lives in a 2D texture, pan/zoom only moves
        // a quad. Falls back to instanced quads on log scale (rows are
        // uniform in PRICE, which maps non-linearly to pixels there).
        const useTexture = this.tex
            && this.textureMode !== false
            && !layout.scaleSpecs?.log
            && (typeof window === 'undefined' || window.NVJS_HEATMAP_TEXTURE !== false);

        // ensureContext also revives the layer after an orphan sweep — the
        // quad path gets that via commit(), the texture path needs it here.
        if (useTexture && this.ensureContext()) {
            const maxVolOf = (exId) => maxVolumesMap[EXCHANGES_CONFIG[exId]] || 100000;
            const rowOf = (exId, isBid) => {
                const base = this._exRow[exId];
                return base === undefined ? -1 : base + (isBid ? 1 : 0);
            };
            // gamma participates in the data key: intensities are encoded
            // into the texture with it, so a change must re-encode.
            this.tex.gamma = this.intensityGamma || 1;
            const volKey = this.lastScales.key + '|g' + this.tex.gamma;
            // update() returns false when the texture can't represent the
            // current view (extreme zoom-out / empty data) — fall through to
            // the instanced-quad path for this frame.
            if (this.tex.update(this.gpu, data, layout, step, maxVolOf, rowOf, volKey)) {
                if (this._mode !== 'tex') { this._mode = 'tex'; this.clear(); }
                this.gpu.requestRender();
                return;
            }
        }
        if (this._mode !== 'quad') { this._mode = 'quad'; if (this.tex) this.tex.hide(); }

        let idx = 0;
        const cellWidth = layout.pxStep;
        const y1 = layout.value2y(0, false);
        const y2 = layout.value2y(step, false);
        // Cell must fill the full aggregation bucket (`step`) in pixels. Dividing by
        // step*10^prec collapsed it back to one tick, so HD (step = tick*factor) only
        // shifted cells instead of growing them. Use the full step height.
        const cellHeight = Math.max(y1 - y2, 1);

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
        if (this.tex) {
            this.tex.destroy();
            this.tex = null;
        }
        super.destroy();
    }
}
