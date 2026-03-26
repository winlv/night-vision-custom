
export default class RectangleShape {

    constructor(core) {
        this.T = core.props.config.TOOL_COLL
        this.core = core
    }

    update(p1, p2) {
        const layout = this.core.layout

        this.x1 = layout.time2x(p1[0])
        this.y1 = layout.value2y(p1[1])
        this.x2 = layout.time2x(p2[0])
        this.y2 = layout.value2y(p2[1])

        this.topLeft = [Math.min(this.x1, this.x2), Math.min(this.y1, this.y2)]
        this.topRight = [Math.max(this.x1, this.x2), Math.min(this.y1, this.y2)]
        this.bottomRight = [Math.max(this.x1, this.x2), Math.max(this.y1, this.y2)]
        this.bottomLeft = [Math.min(this.x1, this.x2), Math.max(this.y1, this.y2)]
    }

    draw(ctx) {
        ctx.moveTo(this.topLeft[0], this.topLeft[1])
        ctx.lineTo(this.topRight[0], this.topRight[1])
        ctx.lineTo(this.bottomRight[0], this.bottomRight[1])
        ctx.lineTo(this.bottomLeft[0], this.bottomLeft[1])
        ctx.lineTo(this.topLeft[0], this.topLeft[1])
    }

    collision(x, y) {
        return (
            x >= Math.min(this.x1, this.x2) &&
            x <= Math.max(this.x1, this.x2) &&
            y >= Math.min(this.y1, this.y2) &&
            y <= Math.max(this.y1, this.y2)
        )
    }
}