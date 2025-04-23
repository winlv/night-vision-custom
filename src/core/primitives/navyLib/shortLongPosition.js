export default class ShortLongPosition {
    constructor(core, point, opposite=false) {
        this.core = core;
        this.data = point;
        this.hover = false;
        this.selected = false;
        this.state = 'tracking';
        this.drag = {t: undefined, v: undefined};
        this.opposite = opposite;
        this.onSelect = () => {
        }

        this.shortLongPosition = new core.lib.ShortLongPositionShape(core, this.opposite);
        this.pins = [
            new core.lib.Pin(core, this, 'upSizePin'),
            new core.lib.Pin(core, this, 'commonSizePin'),
            new core.lib.Pin(core, this, 'bottomSizePin'),
            new core.lib.Pin(core, this, 'widthSizePin'),
        ]
    }

    draw(ctx) {
        this.shortLongPosition.update(this.data, this.selected);
        this.shortLongPosition.draw(ctx);

        if (this.hover || this.selected) {
            for (const pin of this.pins) {
                pin.draw(ctx)
            }
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
        this.hover = this.collision();
        this.propagate('mousemove', event);
        this.shortLongPosition.handleHover(this.hover);

        if (this.selected && this.state === 'settled') {
            if (!this.drag.t || !this.drag.v) {
                return;
            }

            if (this.pins.some(pin => pin.state === 'tracking')) {
                return void 0;
            }

            const layout = this.core.layout;

            const activePin = this.pins.find(pin => pin.state === 'dragging');

            if (!activePin) {
                const dt = layout.x2time(event.layerX) - this.drag.t;
                const dy = layout.y2value(event.layerY) - this.drag.v;

                const upSizePin = [
                    this.data['upSizePin'][0] + dt,
                    this.data['upSizePin'][1] + dy
                ];
                const commonSizePin = [
                    this.data['commonSizePin'][0] + dt,
                    this.data['commonSizePin'][1] + dy
                ];
                const bottomSizePin = [
                    this.data['bottomSizePin'][0] + dt,
                    this.data['bottomSizePin'][1] + dy
                ];
                const widthSizePin = [
                    this.data['widthSizePin'][0] + dt,
                    this.data['widthSizePin'][1] + dy
                ];

                this.drag.t = layout.x2time(event.layerX);
                this.drag.v = layout.y2value(event.layerY);

                this.data['upSizePin'] = upSizePin;
                this.data['commonSizePin'] = commonSizePin;
                this.data['bottomSizePin'] = bottomSizePin;
                this.data['widthSizePin'] = widthSizePin;

                return void 0;
            }

            if (activePin?.name === 'commonSizePin') {
                const t = this.data['commonSizePin'][0];
                const y$ = this.data['commonSizePin'][1];

                this.data['commonSizePin'][0] = t;
                let y = y$;
                if (y >= this.data['upSizePin'][1]) {
                    y = this.data['upSizePin'][1];
                }
                if (y <= this.data['bottomSizePin'][1]) {
                    y = this.data['bottomSizePin'][1];
                }
                this.data['commonSizePin'][1] = y;

                this.data['upSizePin'][0] = t;
                this.data['bottomSizePin'][0] = t;
                this.data['widthSizePin'][1] = y;
            }

            if (activePin?.name === 'bottomSizePin') {
                const y$ = this.data['bottomSizePin'][1];

                this.data['bottomSizePin'][0] = this.drag.t;
                this.data['bottomSizePin'][1] = Math.min(y$, this.data['commonSizePin'][1]);

                this.data['commonSizePin'][0] = this.drag.t;
                this.data['upSizePin'][0] = this.drag.t;
            }

            if (activePin?.name === 'upSizePin') {
                const y$ = this.data['upSizePin'][1];

                this.data['upSizePin'][0] = this.drag.t;
                this.data['upSizePin'][1] = Math.max(y$, this.data['commonSizePin'][1]);

                this.data['bottomSizePin'][0] = this.drag.t;
                this.data['commonSizePin'][0] = this.drag.t;
            }

            if (activePin?.name === 'widthSizePin') {
                this.data['widthSizePin'][1] = this.drag.v;
            }
        }
    }

    collision() {
        const mouse = this.core.mouse;
        let [x, y] = [mouse.x, mouse.y];
        const pinsActive = this.pins.some(pin => pin.state === 'dragging');
        return this.shortLongPosition.collision(x, y) || pinsActive;
    }

    propagate(name, data) {
        for (let pin of this.pins) {
            pin[name](data)
        }
    }
}