export default class Curve {

    constructor(core) {
        this.T = core.props.config.TOOL_COLL
        this.core = core
    }

    update(data) {
        const layout = this.core.layout;
        this.data = data;
    }

    draw(ctx) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const layout = this.core.layout;
        const points = this.data.points;

        if (!points) {
            return void 0;
        }

        ctx.moveTo(layout.time2x(points[0].x), layout.value2y(points[0].y));

        for (let i = 1; i < points.length - 1; i++) {
            const x_mid = (layout.time2x(points[i].x) + layout.time2x(points[i + 1].x)) / 2;
            const y_mid = (layout.value2y(points[i].y) + layout.value2y(points[i + 1].y)) / 2;
            const cp_x = layout.time2x(points[i].x);
            const cp_y = layout.value2y(points[i].y);
            ctx.quadraticCurveTo(cp_x, cp_y, x_mid, y_mid);
        }

        // For the last point
        ctx.lineTo(layout.time2x(points[points.length - 1].x), layout.value2y(points[points.length - 1].y));
    }

    collision(x, y) {
        const layout = this.core.layout;
        const points = this.data.points;
        if (!points || points.length < 2) return false;

        const THRESHOLD_SQ = 7 * 7;
        const SAMPLES = 8;
        const dist2 = (ax, ay) => (ax - x) ** 2 + (ay - y) ** 2;

        // Mirror the exact draw algorithm to sample the rendered bezier curve
        let prevX = layout.time2x(points[0].x);
        let prevY = layout.value2y(points[0].y);

        for (let i = 1; i < points.length - 1; i++) {
            const x_mid = (layout.time2x(points[i].x) + layout.time2x(points[i + 1].x)) / 2;
            const y_mid = (layout.value2y(points[i].y) + layout.value2y(points[i + 1].y)) / 2;
            const cp_x = layout.time2x(points[i].x);
            const cp_y = layout.value2y(points[i].y);

            for (let j = 1; j <= SAMPLES; j++) {
                const t = j / SAMPLES;
                const bx = (1-t)*(1-t)*prevX + 2*(1-t)*t*cp_x + t*t*x_mid;
                const by = (1-t)*(1-t)*prevY + 2*(1-t)*t*cp_y + t*t*y_mid;
                if (dist2(bx, by) < THRESHOLD_SQ) return true;
            }

            prevX = x_mid;
            prevY = y_mid;
        }

        // Last lineTo segment
        const lastX = layout.time2x(points[points.length - 1].x);
        const lastY = layout.value2y(points[points.length - 1].y);
        for (let j = 1; j <= SAMPLES; j++) {
            const t = j / SAMPLES;
            const bx = prevX + t * (lastX - prevX);
            const by = prevY + t * (lastY - prevY);
            if (dist2(bx, by) < THRESHOLD_SQ) return true;
        }

        return false;
    }
}