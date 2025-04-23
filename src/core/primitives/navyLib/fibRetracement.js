export default class FibRetracement {

    constructor(core, line, nw = false) {
        this.core = core
        this.data = line
        this.hover = false
        this.selected = false
        this.onSelect = () => {
        }
        this.fibRetracement = new core.lib.FibRetracementShape(core);
        this.drag = {t: undefined, v: undefined};
        this.pins = [
            new core.lib.Pin(core, this, 'p1'),
            new core.lib.Pin(core, this, 'p2')
        ]
        if (nw) {
            this.pins[1].state = 'tracking';
            this.state = 'tracking';
        }
    }

    draw(ctx) {
        this.fibRetracement.update(this.data.p1, this.data.p2);
        this.fibRetracement.draw(ctx);

        if (this.hover || this.selected) {
            for (const pin of this.pins) {
                pin.draw(ctx)
            }
        }
    }

    collision() {
        const mouse = this.core.mouse;
        let [x, y] = [mouse.x, mouse.y];
        const pinsActive = this.pins.some(pin => pin.state === 'dragging');
        return this.fibRetracement.collision(x, y) || pinsActive;
    }

    propagate(name, data) {
        for (const pin of this.pins) {
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
    }

    mouseup(event) {
        this.state = this.pins.some(pin => pin.state === 'tracking') ? 'tracking' : 'settled';
        this.propagate('mouseup', event)
        this.drag.t = null;
        this.drag.v = null;
    }

    mousemove(event) {
        this.hover = this.collision()
        this.propagate('mousemove', event)

        if (this.selected && this.state === 'settled') {

            if (!this.drag.t || !this.drag.v) {
                return;
            }

            if (this.pins.some(pin => pin.state === 'tracking' || pin.state === 'dragging')) {
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

            this.drag.t = layout.x2time(event.layerX);
            this.drag.v = layout.y2value(event.layerY);

            this.data.p1 = newP1;
            this.data.p2 = newP2;
        }
    }
}