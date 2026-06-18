import {Utils} from "../../../index.js";

export default class Brush {
    constructor(core, point) {
        this.core = core;
        this.data = point;
        this.hover = false;
        this.selected = false;
        this.state = 'tracking';
        this.drag = {t: undefined, v: undefined};
        this.onSelect = () => {
        }

        this.curve = new core.lib.Curve(core);
    }

    draw(ctx) {
        if (this.data && this.data.hidden) return
        this.curve.update(this.data);

        ctx.beginPath();
        ctx.lineWidth = this.data.lineWidth ?? 1;
        ctx.strokeStyle = this.data.color ?? '#dc9800';
        this.curve.draw(ctx);
        ctx.setLineDash([0])
        if (this.data.lineType === 'dashed') {
            ctx.setLineDash([8])
        }
        if (this.data.lineType === 'dotted') {
            ctx.setLineDash([3])
        }
        ctx.stroke();
        ctx.closePath();

        ctx.beginPath();
        ctx.setLineDash([0])
        if (this.hover || this.selected) {
            const pin1Data = this.data.points[0];
            const pin2Data = this.data.points[this.data.points.length - 1];

            this.drawPin(ctx, pin1Data.x, pin1Data.y);
            this.drawPin(ctx, pin2Data.x, pin2Data.y);
        }
    }

    drawPin(ctx, x, y) {
        const r = 5.5;
        const lw = this.selected ? 1.5 : 1;

        ctx.lineWidth = lw;
        ctx.strokeStyle = this.data.color ?? '#dc9800';
        ctx.fillStyle = this.core.colors.back
        ctx.beginPath()
        ctx.arc(
            this.x = this.core.layout.time2x(x),
            this.y = this.core.layout.value2y(y),
            r + 0.5, 0, Math.PI * 2, true)
        ctx.fill()
        ctx.setLineDash([0])
        ctx.stroke()
    }

    collision() {
        const mouse = this.core.mouse;
        let [x, y] = [mouse.x, mouse.y];
        return this.curve.collision(x, y);
    }

    recordPoint() {
        if (this.state !== 'dragging') return;
        this.data.points.push({
            x: this.core.layout.x2time(this.core.cursor.x),
            y: this.core.layout.y2value(this.core.cursor.y)
        })
    }

    mousedown(event) {
        if (this.data && (this.data.hidden || this.data.locked)) return
        if (this.collision()) {
            if (this.core.meta.tool !== 'Cursor') {
                return void 0;
            }

            this.core.events.emit('scroll-lock', true);

            const layout = this.core.layout;
            this.onSelect(this.data.uuid);
            this.drag = {
                t: layout.x2time(event.layerX),
                v: layout.y2value(event.layerY)
            }
        }
    }

    mouseup(event) {
        if (this.data && (this.data.hidden || this.data.locked)) return
        this.state = 'settled';
        this.drag = {t: undefined, v: undefined};
        this.hover = false;
    }

    mouseout(event) {
        // console.log('mouseout');
    }

    mousemove(event) {
        if (this.data && (this.data.hidden || this.data.locked)) return
        if (this.core.meta.selectedTool && this.core.meta.selectedTool !== this.data.uuid) {
            return void 0;
        }

        if (this.state !== 'dragging' && this.core.meta.tool !== 'Cursor') {
            return void 0;
        }

        if (this.collision() && this.state === 'settled' && !Utils.isMobile) {
            event.target.style.cursor = 'move';
        }

        if (!this.collision() && this.hover && !Utils.isMobile) {
            event.target.style.cursor = 'default';
        }

        this.hover = this.collision();
        this.recordPoint();

        if (this.selected && this.state === 'settled') {
            if (!this.drag.t || !this.drag.v) {
                return void 0;
            }

            const layout = this.core.layout;
            const dt = layout.x2time(event.layerX) - this.drag.t;
            const dy = layout.y2value(event.layerY) - this.drag.v;

            const newPoints = this.data.points.map(({x, y}) => {
                const newX = x + dt;
                const newY = y + dy;
                return {x: newX, y: newY};
            });

            this.drag.t = layout.x2time(event.layerX);
            this.drag.v = layout.y2value(event.layerY);

            this.data.points = newPoints;
        }
    }
}