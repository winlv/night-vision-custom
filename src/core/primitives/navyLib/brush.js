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
        this.curve.update(this.data);

        ctx.beginPath();
        ctx.lineWidth = this.data.lineWidth ?? 1;
        ctx.strokeStyle = this.data.color ?? '#dc9800';
        this.curve.draw(ctx);
        console.log(this.data.lineType);
        ctx.setLineDash([0])
        if (this.data.lineType === 'dashed') {
            ctx.setLineDash([8])
        }
        if (this.data.lineType === 'dotted') {
            ctx.setLineDash([3])
        }
        ctx.stroke();
        ctx.closePath();

        if (this.hover || this.selected) {
            const pin1Data = this.data.points[0];
            const pin2Data = this.data.points[this.data.points.length - 1];

            this.drawPin(ctx, pin1Data.x, pin1Data.y);
            this.drawPin(ctx, pin2Data.x, pin2Data.y);
        }
    }

    drawPin(ctx, x, y) {
        const r = 5.5;

        ctx.lineWidth = 1
        ctx.strokeStyle = this.core.colors.text
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

    propagate(name, data) {
        if (this.state !== 'dragging') {
            return void 0;
        }

        this.data.points.push({
            x: this.core.layout.x2time(this.core.cursor.x),
            y: this.core.layout.y2value(this.core.cursor.y)
        })
    }

    mousedown(event) {
        this.propagate('mousedown', event)
        if (this.collision()) {
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
        this.state = 'settled';
        this.propagate('mouseup', event);
        this.drag = {t: undefined, v: undefined};
    }

    mousemove(event) {
        this.hover = this.collision();
        this.propagate('mousemove', event);

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