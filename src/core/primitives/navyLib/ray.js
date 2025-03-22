
// Draws a segment, adds corresponding collision f-n

import Math2 from '../../../stuff/math.js'

export default class Ray {

    // Overlay ref, canvas ctx
    constructor(core) {
        this.T = core.props.config.TOOL_COLL
        this.core = core
    }

    // Update line coordinates
    update(p1) {

        const layout = this.core.layout

        this.x1 = layout.time2x(p1[0])
        this.y1 = layout.value2y(p1[1])
        this.x2 = layout.width
        this.y2 = this.y1
    }

    // TODO: fix for index-based
    draw(ctx) {
        ctx.beginPath()
        ctx.moveTo(this.x1, this.y1);
        ctx.lineTo(this.x2, this.y2);
        ctx.closePath();
    }

    collision(x, y) {
        return Math2.point2ray(
            [x, y],
            [this.x1, this.y1],
            [this.x2, this.y1]
        ) < this.T
    }
}