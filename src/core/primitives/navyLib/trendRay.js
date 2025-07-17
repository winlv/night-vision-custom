import Math2 from "../../../stuff/math.js";

export default class TrendRay {

    constructor(core) {
        this.T = core.props.config.TOOL_COLL
        this.core = core
    }

    update(p1, p2) {
        const layout = this.core.layout

        this.x1 = layout.time2x(p1[0])
        this.y1 = layout.value2y(p1[1])

        const dx = layout.time2x(p2[0]) - this.x1
        const dy = layout.value2y(p2[1]) - this.y1
        const angle = Math.atan2(dy, dx)

        const xRight = layout.width

        const distX = xRight - this.x1
        const distY = Math.tan(angle) * distX

        this.x2 = xRight
        this.y2 = this.y1 + distY
    }

    draw(ctx) {
        ctx.moveTo(this.x1, this.y1);
        ctx.lineTo(this.x2, this.y2);
    }

    collision(x, y) {
        return Math2.point2seg(
            [x, y],
            [this.x1, this.y1],
            [this.x2, this.y2]
        ) < this.T
    }
}