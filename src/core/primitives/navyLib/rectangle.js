import {Utils} from "../../../index.js";

export default class Rectangle {
    constructor(core, rectangle, nw = false) {
        this.core = core
        this.data = rectangle
        this.hover = false
        this.pinHover = false;
        this.selected = false
        this.drag = {t: null, v: null};  // Drag tracking state
        this.onSelect = () => {
        }

        this.state = 'settled';
        this.rectangle = new core.lib.RectangleShape(core);
        this.pins = [
            new core.lib.Pin(core, this, 'p1', {cursor: 'nwse-resize'}),
            new core.lib.Pin(core, this, 'p2', {cursor: 'nwse-resize'}),
            // new core.lib.Pin(core, this, 'p3'),
            // new core.lib.Pin(core, this, 'p4')
        ]
        if (nw) {
            this.pins[1].state = 'tracking';
            this.state = 'tracking';
        }
    }

    draw(ctx) {
        const strokeStyle = this.data.color ?? '#dc9800';

        this.rectangle.update(this.data.p1, this.data.p2)
        ctx.lineWidth = this.data.lineWidth ?? 1;
        ctx.strokeStyle = strokeStyle;
        ctx.fillStyle = (this.data.fillColor ?? '#dc9800') + '20'

        ctx.beginPath()
        this.rectangle.draw(ctx);
        if (this.data.lineType === 'dashed') {
            ctx.setLineDash([8])
        }
        if (this.data.lineType === 'dotted') {
            ctx.setLineDash([2])
        }
        ctx.stroke();
        ctx.fill();
        ctx.closePath();

        ctx.beginPath();
        ctx.setLineDash([0]);
        if (this.hover || this.selected) {
            for (var pin of this.pins) {
                pin.draw(ctx, strokeStyle)
            }
        }

        if (this.data.text) {
            const { x1, y1, x2, y2 } = this.rectangle;
            const color = this.data.textColor ?? '#dc9800';

            ctx.save();

            ctx.font = "bold " + this.data.textSize + "px sans-serif";
            ctx.fillStyle = color;

            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            const centerX = (x1 + x2) / 2;
            const centerY = (y1 + y2) / 2;

            const left = Math.min(x1, x2);
            const top = Math.min(y1, y2);
            const width = Math.abs(x2 - x1);
            const height = Math.abs(y2 - y1);

            ctx.beginPath();
            ctx.rect(left, top, width, height);
            ctx.clip();

            ctx.fillText(this.data.text, centerX, centerY);

            ctx.restore();
        }
    }

    collision() {
        const mouse = this.core.mouse
        let [x, y] = [mouse.x, mouse.y]
        return this.rectangle.collision(x, y);
    }

    propagate(name, data) {
        for (var pin of this.pins) {
            pin[name](data)
        }
    }

    mousedown(event) {
        this.propagate('mousedown', event)

        if (this.collision()) {
            this.onSelect(this.data.uuid)
            this.core.events.emit('scroll-lock', true);

            const layout = this.core.layout;
            this.drag.t = layout.x2time(event.layerX);
            this.drag.v = layout.y2value(event.layerY);
        }
        this.hover = false;
    }

    mouseup(event) {
        this.state = this.pins.some(pin => pin.state === 'tracking') ? 'tracking' : 'settled';
        this.propagate('mouseup', event)
        this.drag.t = null;
        this.drag.v = null;
    }

    mousemove(event) {
        if (this.core.meta.selectedTool && this.core.meta.selectedTool !== this.data.uuid) {
            return void 0;
        }

        if (this.state !== 'tracking' && this.core.meta.tool !== 'Cursor') {
            return void 0;
        }

        const pin = this.pins.find(pin => pin.hover() || pin.state === 'tracking');
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

        this.propagate('mousemove', event)

        if (this.selected && this.state === 'settled') {
            if (!this.drag.t || !this.drag.v) {
                return;
            }

            if (this.pins.some(pin => pin.state === 'tracking')) {
                return void 0;
            }

            const layout = this.core.layout;

            const dt = layout.x2time(event.layerX) - this.drag.t;
            const dy = layout.y2value(event.layerY) - this.drag.v;

            const newP1 = [
                this.data.p1[0] + dt,
                this.data.p1[1] + dy
            ];
            const newP2 = [
                this.data.p2[0] + dt,
                this.data.p2[1] + dy
            ];
            const newP3 = [
                this.data.p3[0] + dt,
                this.data.p3[1] + dy
            ];
            const newP4 = [
                this.data.p4[0] + dt,
                this.data.p4[1] + dy
            ];

            this.drag.t = layout.x2time(event.layerX);
            this.drag.v = layout.y2value(event.layerY);

            this.data.p1 = newP1;
            this.data.p2 = newP2;
            this.data.p3 = newP3;
            this.data.p4 = newP4;
        }
    }
}
