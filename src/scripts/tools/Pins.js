export class Pins {
    constructor() {
    }

    draw(ctx) {
        // Draw Pins
        const r = 5;

        // First Pin
        ctx.beginPath();
        ctx.fillStyle = $core.props.colors.back;
        ctx.arc(x1, y1, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.closePath();

        // Second Pin
        ctx.beginPath();
        ctx.fillStyle = $core.props.colors.back;
        ctx.arc(x2, y2, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.closePath();
    }
}