// Interactive trend line (line, ray or segment)
// Combining line primitive and pins

import TrendRay from "./trendRay.js";

export default class TrendLine {

    constructor(core, line, nw = false) {
        this.core = core
        this.data = line
        this.hover = false
        this.selected = false
        this.onSelect = () => {
        }
        switch (line.type) {
            case 'segment':
                this.line = new core.lib.Segment(core);
                this.pins = [
                    new core.lib.Pin(core, this, 'p1'),
                    new core.lib.Pin(core, this, 'p2')
                ]
                break;
            case 'ray':
                this.line = new core.lib.Ray(core);
                this.pins = [new core.lib.Pin(core, this, 'p1')]
                break;
            case 'trendRay':
                this.line = new core.lib.TrendRay(core);
                this.pins = [
                    new core.lib.Pin(core, this, 'p1'),
                    new core.lib.Pin(core, this, 'p2')
                ]
                break;
        }
        if (nw && (line.type === 'segment' || line.type === 'trendRay')) this.pins[1].state = 'tracking'
    }

    draw(ctx) {
        const color = this.data.color ?? '#dc9800';
        this.line.update(this.data.p1, this.data.p2);
        ctx.lineWidth = this.data.lineWidth ?? 1;
        ctx.strokeStyle = this.data.color ?? '#dc9800';
        ctx.beginPath();
        this.line.draw(ctx);
        if (this.data.lineType === 'dashed') {
            ctx.setLineDash([8])
        }
        if (this.data.lineType === 'dotted') {
            ctx.setLineDash([2])
        }

        if (this.data.crossed) {
            ctx.setLineDash([8])
        }

        ctx.stroke();
        ctx.closePath();

        ctx.beginPath();
        ctx.setLineDash([0]);
        if (this.hover || this.selected) {
            for (var pin of this.pins) {
                pin.draw(ctx, color)
            }
        }

        if (this.data.alert) {
            const { x1, y1, x2, y2 } = this.line;
            let iconPosX;
            let iconPosY;

            if (!window.isDigash) {
                const y = y2 < this.core.layout.height ? Math.max(30, y2) : this.core.layout.height;
                let x = x2;

                if (y2 < 0 || y2 > this.core.layout.height) {
                    const angle = Math.atan2(y2 - y1, x2 - x1);
                    x = x1 + (y - y1) / Math.tan(angle) + 30;
                }

                iconPosX = x - 30;
                iconPosY = y - 10;
            } else {
                const lastCandle = this.core.hub.mainOv.data[this.core.hub.mainOv.data.length - 1];
                iconPosX = this.core.layout.time2x(lastCandle[0], lastCandle[1]);

                if (x2 !== x1) {
                    const slope = (y2 - y1) / (x2 - x1);
                    iconPosY = y1 + (iconPosX - x1) * slope - 10;
                } else {
                    iconPosY = y2 - 10;
                }
            }

            const alertIcon = new Path2D(
                "M8.622-1.476q-1.332 0-2.511-.504t-2.052-1.377q-.873-.873-1.386-2.052T2.16-7.9332q0-1.3452.513-2.52T4.059-12.51q.873-.882 2.052-1.386T8.622-14.4q1.332 0 2.511.504T13.194-12.51q.882.882 1.386 2.0568t.504 2.52Q15.084-6.588 14.58-5.409t-1.386 2.052Q12.312-2.484 11.133-1.98T8.622-1.476Zm0-6.426Zm2.178 2.898.756-.756-2.34-2.34v-3.42h-1.08v3.852l2.664 2.664ZM3.852-15.606l.756.756L1.656-12.006l-.756-.756 2.952-2.844Zm9.54 0 2.952 2.844-.756.756-2.952-2.844.756-.756ZM8.6228-2.556Q10.872-2.556 12.438-4.1228t1.566-3.816Q14.004-10.188 12.4372-11.754t-3.816-1.566Q6.372-13.32 4.806-11.7532t-1.566 3.816Q3.24-5.688 4.8068-4.122t3.816 1.566Z"
            );

            ctx.lineWidth = 0.5;
            ctx.strokeStyle = this.data.color ?? '#dc9800';
            const translatedPath = new Path2D();
            translatedPath.addPath(alertIcon, new DOMMatrix().translate(iconPosX, iconPosY));
            ctx.stroke(translatedPath);
        }
    }

    collision() {
        const mouse = this.core.mouse
        let [x, y] = [mouse.x, mouse.y]
        return this.line.collision(x, y)
    }

    propagate(name, data) {
        for (var pin of this.pins) {
            pin[name](data)
        }
    }

    mousedown(event) {
        this.propagate('mousedown', event)
        if (this.collision()) {
            if (this.core.meta.tool !== 'Cursor') {
                return void 0;
            }

            this.onSelect(this.data.uuid)
        }
        this.hover = false;
    }

    mouseup(event) {
        this.propagate('mouseup', event)
    }

    mousemove(event) {
        if (this.core.meta.selectedTool && this.core.meta.selectedTool !== this.data.uuid) {
            return void 0;
        }

        if (this.core.meta.tool !== 'Cursor') {
            return void 0;
        }

        this.hover = this.collision()
        this.propagate('mousemove', event)
    }
}