// Interactive trend line (line, ray or segment)
// Combining line primitive and pins

import TrendRay from "./trendRay.js";

export default class TrendLine {

    constructor(core, line, nw = false) {
        this.core = core;
        this.data = line;
        this.hover = false;
        this.selected = false;
        this.isDragging = false;
        this.lastMousePos = { t: 0, v: 0 };

        switch (line.type) {
            case 'segment':
                this.line = new core.lib.Segment(core);
                this.pins = [
                    new core.lib.Pin(core, this, 'p1'),
                    new core.lib.Pin(core, this, 'p2')
                ];
                break;
            case 'ray':
                this.line = new core.lib.Ray(core);
                this.pins = [new core.lib.Pin(core, this, 'p1')];
                break;
            case 'trendRay':
                this.line = new core.lib.TrendRay(core);
                this.pins = [
                    new core.lib.Pin(core, this, 'p1'),
                    new core.lib.Pin(core, this, 'p2')
                ];
                break;
        }

        if (nw && (line.type === 'segment' || line.type === 'trendRay')) {
            this.pins[1].state = 'tracking';
        }
    }

    draw(ctx) {
        const color = this.data.color ?? '#dc9800';
        this.line.update(this.data.p1, this.data.p2);

        ctx.save();
        ctx.lineWidth = this.data.lineWidth ?? 1;
        ctx.strokeStyle = color;

        if (this.data.lineType === 'dashed' || this.data.crossed) {
            ctx.setLineDash([8]);
        } else if (this.data.lineType === 'dotted') {
            ctx.setLineDash([2]);
        } else {
            ctx.setLineDash([]);
        }

        ctx.beginPath();
        this.line.draw(ctx);
        ctx.stroke();
        ctx.restore();

        if (this.data.text) {
            const { x1, y1, x2, y2 } = this.line;
            const color = this.data.color ?? '#dc9800';

            ctx.save();
            ctx.font = "bold " + this.data.textSize + "px sans-serif";
            ctx.fillStyle = color;

            // Рассчитываем угол наклона линии
            let angle = Math.atan2(y2 - y1, x2 - x1);

            if (this.data.type === 'ray') {
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";

                const textWidth = ctx.measureText(this.data.text).width;
                const textX = x2 - textWidth - 5;
                const textY = y2 - 10;

                ctx.translate(textX, textY);
                ctx.fillStyle = this.data.textColor;
                ctx.fillText(this.data.text, 0, 0);
            } else {
                ctx.textAlign = "center";
                ctx.textBaseline = "bottom";

                const midX = (x1 + x2) / 2;
                const midY = (y1 + y2) / 2;

                ctx.translate(midX, midY);

                if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
                    angle += Math.PI;
                }

                ctx.rotate(angle);

                ctx.fillStyle = this.data.textColor;
                ctx.fillText(this.data.text, 0, -5);
            }

            ctx.restore();
        }

        if (this.hover || this.selected || this.pins.some(p => p.state !== 'settled')) {
            for (let pin of this.pins) {
                pin.draw(ctx, color);
            }
        }

        if (this.data.alert) {
            this.drawAlertIcon(ctx);
        }
    }

    drawAlertIcon(ctx) {
        const { x1, y1, x2, y2 } = this.line;
        let iconPosX, iconPosY;

        if (!window.isDigash) {
            const y = y2 < this.core.layout.height ? Math.max(30, y2) : this.core.layout.height;
            let x = x2;
            if (y2 < 0 || y2 > this.core.layout.height) {
                const angle = Math.atan2(y2 - y1, x2 - x1);
                x = x1 + (y - y1) / Math.tan(angle) + 30;
            }
            iconPosX = x - 30; iconPosY = y - 10;
        } else {
            const lastCandle = this.core.hub.mainOv.data[this.core.hub.mainOv.data.length - 1];
            iconPosX = this.core.layout.time2x(lastCandle[0], lastCandle[1]);
            iconPosY = (x2 !== x1) ? y1 + (iconPosX - x1) * ((y2 - y1) / (x2 - x1)) - 10 : y2 - 10;
        }

        const alertPath = new Path2D("M8.622-1.476q-1.332 0-2.511-.504t-2.052-1.377q-.873-.873-1.386-2.052T2.16-7.9332q0-1.3452.513-2.52T4.059-12.51q.873-.882 2.052-1.386T8.622-14.4q1.332 0 2.511.504T13.194-12.51q.882.882 1.386 2.0568t.504 2.52Q15.084-6.588 14.58-5.409t-1.386 2.052Q12.312-2.484 11.133-1.98T8.622-1.476Zm0-6.426Zm2.178 2.898.756-.756-2.34-2.34v-3.42h-1.08v3.852l2.664 2.664ZM3.852-15.606l.756.756L1.656-12.006l-.756-.756 2.952-2.844Zm9.54 0 2.952 2.844-.756.756-2.952-2.844.756-.756ZM8.6228-2.556Q10.872-2.556 12.438-4.1228t1.566-3.816Q14.004-10.188 12.4372-11.754t-3.816-1.566Q6.372-13.32 4.806-11.7532t-1.566 3.816Q3.24-5.688 4.8068-4.122t3.816 1.566Z");
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = this.data.color ?? '#dc9800';
        const m = new DOMMatrix().translate(iconPosX, iconPosY);
        const translatedPath = new Path2D();
        translatedPath.addPath(alertPath, m);
        ctx.stroke(translatedPath);
    }

    collision() {
        return this.line.collision(this.core.mouse.x, this.core.mouse.y);
    }

    propagate(name, data) {
        for (let pin of this.pins) {
            if (pin[name]) pin[name](data);
        }
    }

    mousedown(event) {
        this.propagate('mousedown', event);
        const pinActive = this.pins.some(p => p.state === 'dragging' || p.state === 'tracking');

        if (!pinActive && this.collision()) {
            if (this.core.meta.tool !== 'Cursor') return;
            this.isDragging = true;
            this.lastMousePos = {
                t: this.core.cursor.time,
                v: this.core.layout.y2value(this.core.mouse.y)
            };
            this.core.events.emit('scroll-lock', true);
        }
    }

    mouseup(event) {
        this.propagate('mouseup', event);
        if (this.isDragging) {
            this.isDragging = false;
            this.core.events.emit('scroll-lock', false);
        }
    }

    mousemove(event) {
        if (this.isDragging) {
            const currentT = this.core.cursor.time;
            const currentV = this.core.layout.y2value(this.core.mouse.y);
            const dt = currentT - this.lastMousePos.t;
            const dv = currentV - this.lastMousePos.v;

            if (this.data.p1) { this.data.p1[0] += dt; this.data.p1[1] += dv; }
            if (this.data.p2) { this.data.p2[0] += dt; this.data.p2[1] += dv; }

            for (let pin of this.pins) pin.init();
            this.lastMousePos = { t: currentT, v: currentV };
            return;
        }

        const isDrawing = this.pins.some(p => p.state === 'tracking' || p.state === 'dragging');

        if (this.core.meta.tool !== 'Cursor' && !isDrawing) return;

        this.hover = this.collision();
        this.propagate('mousemove', event);
    }
}