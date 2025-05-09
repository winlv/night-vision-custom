// Interactive trend line (line, ray or segment)
// Combining line primitive and pins

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
        }
        if (nw && line.type === 'segment') this.pins[1].state = 'tracking'
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
        ctx.stroke();
        ctx.closePath();

        ctx.beginPath();
        ctx.setLineDash([0]);
        if (this.hover || this.selected) {
            for (var pin of this.pins) {
                pin.draw(ctx, color)
            }
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
            this.onSelect(this.data.uuid)
        }
    }

    mouseup(event) {
        this.propagate('mouseup', event)
    }

    mousemove(event) {
        this.hover = this.collision()
        this.propagate('mousemove', event)
    }
}