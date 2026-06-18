import {Utils} from "../../../index.js";

export default class VolumeProfileRange {
    constructor(core, data, nw = false) {
        this.core = core;
        this.data = data;
        this.hover = false;
        this.pinHover = false;
        this.selected = false;
        this.drag = {t: null, v: null};
        this.onSelect = () => {};
        this.state = 'settled';

        this._barRects = [];

        this.shape = new core.lib.RectangleShape(core);
        this.pins = [
            new core.lib.Pin(core, this, 'p1', {cursor: 'nwse-resize'}),
            new core.lib.Pin(core, this, 'p2', {cursor: 'nwse-resize'}),
        ];

        if (nw) {
            this.pins[1].state = 'tracking';
            this.state = 'tracking';
        }
    }

    draw(ctx) {
        if (this.data && this.data.hidden) return
        this.shape.update(this.data.p1, this.data.p2);

        const layout = this.core.layout;
        const {x1, y1, x2, y2} = this.shape;

        const left   = Math.min(x1, x2);
        const right  = Math.max(x1, x2);
        const top    = Math.min(y1, y2);
        const bottom = Math.max(y1, y2);
        const width  = right - left;
        const height = bottom - top;

        const borderColor = this.data.borderColor || '#cccccc';

        // Transparent background showing the tool's viewport
        ctx.save();
        ctx.fillStyle = borderColor + '18';
        ctx.fillRect(left, top, width, height);
        ctx.restore();

        if (width > 2 && height > 2) {
            this._drawBars(ctx, layout, left, right, top, bottom, width);
        }

        // Left and right edge lines — only while actively drawing
        if (this.state === 'tracking') {
            ctx.save();
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = this.data.lineWidth || 1;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(left,  top); ctx.lineTo(left,  bottom);
            ctx.moveTo(right, top); ctx.lineTo(right, bottom);
            ctx.stroke();
            ctx.restore();
        }

        // Pins
        if (this.hover || this.selected) {
            ctx.beginPath();
            ctx.setLineDash([0]);
            for (const pin of this.pins) {
                pin.draw(ctx, borderColor);
            }
        }
    }

    _drawBars(ctx, layout, left, right, top, bottom, width) {
        const p1 = this.data.p1;
        const p2 = this.data.p2;

        const tMin = Math.min(p1[0], p2[0]);
        const tMax = Math.max(p1[0], p2[0]);
        const vMin = Math.min(p1[1], p2[1]);
        const vMax = Math.max(p1[1], p2[1]);

        const allCandles = this.core.hub.mainOv.data || [];
        const candles = allCandles.filter(c => c[0] >= tMin && c[0] <= tMax);

        const bins = this.data.bins || 60;
        const binSize = (vMax - vMin) / bins;

        if (binSize <= 0 || candles.length === 0) return;

        const buyVolumes  = new Array(bins).fill(0);
        const sellVolumes = new Array(bins).fill(0);

        for (const c of candles) {
            const low  = Math.max(c[3], vMin);
            const high = Math.min(c[2], vMax);
            if (high <= low) continue;

            const buyVol  = c[6] ?? c[5] * 0.5;
            const sellVol = c[7] ?? c[5] * 0.5;

            const startBin = Math.max(0,        Math.floor((low  - vMin) / binSize));
            const endBin   = Math.min(bins - 1, Math.floor((high - vMin) / binSize));
            const span     = endBin - startBin + 1;

            for (let i = startBin; i <= endBin; i++) {
                buyVolumes[i]  += buyVol  / span;
                sellVolumes[i] += sellVol / span;
            }
        }

        const totalVolumes = buyVolumes.map((b, i) => b + sellVolumes[i]);
        const maxVol = Math.max(...totalVolumes);
        if (maxVol <= 0) return;

        const pocIndex = totalVolumes.indexOf(maxVol);
        const buyColor  = this.data.buyColor  || '#466BE4';
        const sellColor = this.data.sellColor || '#E81F58';

        this._barRects = [];

        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, right - left, bottom - top);
        ctx.clip();

        for (let i = 0; i < bins; i++) {
            const yBottom = layout.value2y(vMin + i * binSize);
            const yTop    = layout.value2y(vMin + (i + 1) * binSize);
            const barH    = yBottom - yTop;

            const buyW  = (buyVolumes[i]  / maxVol) * width * 0.5;
            const sellW = (sellVolumes[i] / maxVol) * width * 0.5;
            const totalW = buyW + sellW;

            if (totalW > 0) {
                this._barRects.push({
                    x1: left, x2: left + totalW,
                    y1: yTop, y2: yBottom
                });
            }

            ctx.fillStyle = buyColor + '60';
            ctx.fillRect(left, yTop, buyW, barH);

            ctx.fillStyle = sellColor + '60';
            ctx.fillRect(left + buyW, yTop, sellW, barH);
        }

        if (this.data.showPOC !== false) {
            const yBottom = layout.value2y(vMin + pocIndex * binSize);
            const yTop    = layout.value2y(vMin + (pocIndex + 1) * binSize);
            const pocY    = (yTop + yBottom) / 2;

            ctx.strokeStyle = this.data.pocColor || '#7EB8F7';
            ctx.lineWidth   = 1;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(left,  pocY);
            ctx.lineTo(right, pocY);
            ctx.stroke();
        }

        ctx.restore();
    }

    collision() {
        const mouse = this.core.mouse;
        const mx = mouse.x, my = mouse.y;

        // While drawing (no bars yet), fall back to full rectangle
        if (this.state === 'tracking' || this._barRects.length === 0) {
            return this.shape.collision(mx, my);
        }

        for (const r of this._barRects) {
            if (mx >= r.x1 && mx <= r.x2 && my >= r.y1 && my <= r.y2) return true;
        }
        return false;
    }

    propagate(name, event) {
        for (const pin of this.pins) {
            pin[name](event);
        }
    }

    mousedown(event) {
        if (this.data && (this.data.hidden || this.data.locked)) return
        this.propagate('mousedown', event);

        if (this.collision()) {
            this.onSelect(this.data.uuid);
            this.core.events.emit('scroll-lock', true);

            const layout = this.core.layout;
            this.drag.t = layout.x2time(event.layerX);
            this.drag.v = layout.y2value(event.layerY);
        }
        this.hover = false;
    }

    mouseup(event) {
        if (this.data && (this.data.hidden || this.data.locked)) return
        this.state = this.pins.some(p => p.state === 'tracking') ? 'tracking' : 'settled';
        this.propagate('mouseup', event);
        this.drag.t = null;
        this.drag.v = null;
    }

    mousemove(event) {
        if (this.data && (this.data.hidden || this.data.locked)) return
        if (this.core.meta.selectedTool && this.core.meta.selectedTool !== this.data.uuid) {
            return;
        }

        if (this.state !== 'tracking' && this.core.meta.tool !== 'Cursor') {
            return;
        }

        const pin = this.pins.find(p => p.hover() || p.state === 'tracking');

        if (pin?.cursor && this.state === 'settled' && !Utils.isMobile) {
            event.target.style.cursor = pin.cursor;
        }
        if (!pin && this.pinHover && !Utils.isMobile) {
            event.target.style.cursor = 'default';
        }
        this.pinHover = !!pin;

        if (this.collision() && this.state === 'settled' && !Utils.isMobile) {
            event.target.style.cursor = 'move';
        }
        if (!this.collision() && this.hover && !Utils.isMobile) {
            event.target.style.cursor = 'default';
        }

        this.hover = this.collision();
        this.propagate('mousemove', event);

        // Drag whole shape
        if (this.selected && this.state === 'settled') {
            if (!this.drag.t || !this.drag.v) return;
            if (this.pins.some(p => p.state === 'tracking')) return;

            const layout = this.core.layout;
            const dt = layout.x2time(event.layerX) - this.drag.t;
            const dv = layout.y2value(event.layerY) - this.drag.v;

            this.data.p1 = [this.data.p1[0] + dt, this.data.p1[1] + dv];
            this.data.p2 = [this.data.p2[0] + dt, this.data.p2[1] + dv];
            this.data.p3 = [this.data.p3[0] + dt, this.data.p3[1] + dv];
            this.data.p4 = [this.data.p4[0] + dt, this.data.p4[1] + dv];

            this.drag.t = layout.x2time(event.layerX);
            this.drag.v = layout.y2value(event.layerY);
        }
    }
}
