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

        return this.data.points.some(({x: pointX, y: pointY}) => {
            const x1 = layout.time2x(pointX);
            const y1 = layout.value2y(pointY);

            const withinXRange = Math.abs(x1 - x) <= 7;
            const withinYRange = Math.abs(y1 - y) <= 7;

            return withinXRange && withinYRange;
        });
    }
}