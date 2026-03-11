import Math2 from "../../../stuff/math.js";

export default class TrendRay {
    constructor(core) {
        this.T = core.props.config.TOOL_COLL;
        this.core = core;
    }

    update(p1, p2) {
        const layout = this.core.layout;

        this.x1 = layout.time2x(p1[0]);
        this.y1 = layout.value2y(p1[1]);

        const x2_raw = layout.time2x(p2[0]);
        const y2_raw = layout.value2y(p2[1]);

        const dx = x2_raw - this.x1;
        const dy = y2_raw - this.y1;

        if (dx === 0 && dy === 0) {
            this.x2 = this.x1;
            this.y2 = this.y1;
            return;
        }

        const width = layout.width;
        const height = layout.height;

        let t = 1e6;

        if (dx > 0) t = Math.min(t, (width - this.x1) / dx);
        else if (dx < 0) t = Math.min(t, (0 - this.x1) / dx);

        if (dy > 0) t = Math.min(t, (height - this.y1) / dy);
        else if (dy < 0) t = Math.min(t, (0 - this.y1) / dy);

        this.x2 = this.x1 + dx * t;
        this.y2 = this.y1 + dy * t;
    }

    draw(ctx) {
        if (isNaN(this.x1) || isNaN(this.x2)) return;

        ctx.moveTo(this.x1, this.y1);
        ctx.lineTo(this.x2, this.y2);
    }

    collision(x, y) {
        return Math2.point2seg(
            [x, y],
            [this.x1, this.y1],
            [this.x2, this.y2]
        ) < this.T;
    }
}