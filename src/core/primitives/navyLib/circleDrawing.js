import {Utils} from "../../../index.js";
import CircleShape from "./circleShape.js";

export default class CircleDrawing {
    constructor(core, circle, nw = false) {
        this.core = core
        this.data = circle
        this.hover = false
        this.pinHover = false
        this.selected = false
        this.pressedShift = false
        this.drag = {t: null, v: null}
        this.onSelect = () => {}

        this.state = 'settled'
        this.circle = new CircleShape(core)
        this.pins = [
            new core.lib.Pin(core, this, 'p1', {cursor: 'move'}),
            new core.lib.Pin(core, this, 'p2', {cursor: 'nwse-resize'}),
        ]
        if (nw) {
            this.pins[1].state = 'tracking'
            this.state = 'tracking'
        }
    }

    draw(ctx) {
        if (this.data && this.data.hidden) return
        const strokeStyle = this.data.color ?? '#dc9800'

        this.circle.update(this.data.p1, this.data.p2)
        ctx.lineWidth = this.data.lineWidth ?? 1
        ctx.strokeStyle = strokeStyle
        ctx.fillStyle = (this.data.fillColor ?? '#dc9800') + '20'

        ctx.beginPath()
        this.circle.draw(ctx)
        if (this.data.lineType === 'dashed') ctx.setLineDash([8])
        if (this.data.lineType === 'dotted') ctx.setLineDash([2])
        ctx.stroke()
        ctx.fill()
        ctx.closePath()

        ctx.beginPath()
        ctx.setLineDash([0])
        if (this.hover || this.selected) {
            for (const pin of this.pins) {
                pin.draw(ctx, strokeStyle)
            }
        }
    }

    collision() {
        const mouse = this.core.mouse
        return this.circle.collision(mouse.x, mouse.y)
    }

    propagate(name, data) {
        for (const pin of this.pins) {
            pin[name](data)
        }
    }

    mousedown(event) {
        if (this.data && (this.data.hidden || this.data.locked)) return
        this.propagate('mousedown', event)

        if (this.collision()) {
            this.onSelect(this.data.uuid)
            this.core.events.emit('scroll-lock', true)

            const layout = this.core.layout
            this.drag.t = layout.x2time(event.layerX)
            this.drag.v = layout.y2value(event.layerY)
        }
        this.hover = false
    }

    mouseup(event) {
        this.state = this.pins.some(p => p.state === 'tracking') ? 'tracking' : 'settled'
        this.propagate('mouseup', event)
        this.drag.t = null
        this.drag.v = null
    }

    mousemove(event) {
        if (this.data && (this.data.hidden || this.data.locked)) return
        if (this.core.meta.selectedTool && this.core.meta.selectedTool !== this.data.uuid) {
            return void 0
        }

        if (this.state !== 'tracking' && this.core.meta.tool !== 'Cursor') {
            return void 0
        }

        const pin = this.pins.find(p => p.hover() || p.state === 'tracking')
        if (pin?.cursor && this.state === 'settled' && !Utils.isMobile) {
            event.target.style.cursor = pin.cursor
        }
        if (!pin && this.pinHover && !Utils.isMobile) {
            event.target.style.cursor = 'default'
        }
        this.pinHover = !!pin
        this.pressedShift = event.shiftKey

        if (this.collision() && this.state === 'settled' && !Utils.isMobile) {
            event.target.style.cursor = 'move'
        }
        if (!this.collision() && this.hover && !Utils.isMobile) {
            event.target.style.cursor = 'default'
        }
        this.hover = this.collision()

        this.propagate('mousemove', event)

        if (this.selected && this.state === 'settled') {
            if (!this.drag.t || !this.drag.v) return
            if (this.pins.some(p => p.state === 'tracking')) return void 0

            const layout = this.core.layout
            const dt = layout.x2time(event.layerX) - this.drag.t
            const dy = layout.y2value(event.layerY) - this.drag.v

            this.data.p1 = [this.data.p1[0] + dt, this.data.p1[1] + dy]
            this.data.p2 = [this.data.p2[0] + dt, this.data.p2[1] + dy]

            this.drag.t = layout.x2time(event.layerX)
            this.drag.v = layout.y2value(event.layerY)
        }
    }
}
