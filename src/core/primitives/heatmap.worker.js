// heatmap.worker.js

const EXCHANGES_CONFIG = {
    'bi-s': 'BINANCE_SPOT', 'bi-f': 'BINANCE_FUTURES',
    'by-s': 'BYBIT_SPOT',   'by-f': 'BYBIT_FUTURES',
    'okx-s': 'OKX_SPOT',    'okx-f': 'OKX_FUTURES',
    'mexc-s': 'MEXC_SPOT',  'mexc-f': 'MEXC_FUTURES',
    'gate-s': 'GATE_SPOT',  'gate-f': 'GATE_FUTURES',
    'bit-s': 'BITGET_SPOT', 'bit-f': 'BITGET_FUTURES'
};

self.onmessage = function (e) {

    const {
        data,
        view,
        palettes,
        maxVolumesMap,
        cellWidth,
        cellHeight,
        step,
        MAX_INSTANCES,
        layout
    } = e.data;

    const {
        width,
        minVisiblePrice,
        maxVisiblePrice,
        k_t,
        b_t,
        k_y,
        b_y
    } = layout;

    // Worker создаёт собственный буфер
    const instanceBuffer = new Float32Array(MAX_INSTANCES * 8);
    let idx = 0;

    const maxStride = MAX_INSTANCES * 8;

    for (let i = view.i1; i <= view.i2; i++) {

        const item = data[i];
        if (!item) continue;

        const timestamp = item[0];
        const levels = item[1];

        // X через линейное преобразование
        const x = timestamp * k_t + b_t - cellWidth / 2;

        if (x + cellWidth < 0 || x > width) continue;

        const renderSide = (orders, type) => {

            const currentPalettes = palettes[type];
            const len = orders.length;

            for (let j = 0; j < len; j += 3) {

                const price = orders[j];

                if (price < minVisiblePrice || price > maxVisiblePrice + step)
                    continue;

                const qty = orders[j + 1];
                const exId = orders[j + 2];

                const exName = EXCHANGES_CONFIG[exId];
                if (!exName) continue;

                const palette = currentPalettes[exName];
                if (!palette) continue;

                const val = price * qty;
                const maxVol = maxVolumesMap[exName] || 100000;

                const intensity = val / maxVol;
                const clamped = intensity > 1 ? 1 : intensity;

                const pIdx = (clamped * 255) | 0;
                const pOff = pIdx << 2;

                // Y через линейное преобразование
                const y = (price + step) * k_y + b_y;

                const offset = idx;

                instanceBuffer[offset]     = x;
                instanceBuffer[offset + 1] = y;
                instanceBuffer[offset + 2] = cellWidth;
                instanceBuffer[offset + 3] = cellHeight;
                instanceBuffer[offset + 4] = palette[pOff];
                instanceBuffer[offset + 5] = palette[pOff + 1];
                instanceBuffer[offset + 6] = palette[pOff + 2];
                instanceBuffer[offset + 7] = palette[pOff + 3];

                idx += 8;

                if (idx >= maxStride) return;
            }
        };

        if (levels.a) renderSide(levels.a, 'asks');
        if (levels.b) renderSide(levels.b, 'bids');

        if (idx >= maxStride) break;
    }

    self.postMessage({
        buffer: instanceBuffer.buffer,
        count: idx / 8
    }, [instanceBuffer.buffer]);
};