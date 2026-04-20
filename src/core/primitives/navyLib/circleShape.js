
export default class CircleShape {

    constructor(core) {
        this.T = core.props.config.TOOL_COLL
        this.core = core
        this.cx = 0
        this.cy = 0
        this.r = 0
    }

    update(p1, p2) {
        const layout = this.core.layout
        this.cx = layout.time2x(p1[0])
        this.cy = layout.value2y(p1[1])
        const ex = layout.time2x(p2[0])
        const ey = layout.value2y(p2[1])
        this.r = Math.sqrt((ex - this.cx) ** 2 + (ey - this.cy) ** 2)
    }

    draw(ctx) {
        ctx.arc(this.cx, this.cy, Math.max(this.r, 1), 0, Math.PI * 2)
    }

    collision(x, y) {
        const dist = Math.sqrt((x - this.cx) ** 2 + (y - this.cy) ** 2)
        return Math.abs(dist - this.r) <= this.T || dist <= this.T
    }
}
