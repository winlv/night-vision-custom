export default class FibRetracementShape {
    constructor(core) {
        this.core = core;
    }

    update(p1, p2, settings) {
        const layout = this.core.layout;
        this.x1 = layout.time2x(p1[0]);
        this.y1 = layout.value2y(p1[1]);
        this.x2 = layout.time2x(p2[0]);
        this.y2 = layout.value2y(p2[1]);
        this.settings = settings;
    }

    draw(ctx) {
        if (!this.settings || this.x1 === undefined) return;

        const { levels, lineWidth, backOpacity } = this.settings;
        const activeLevels = levels.filter(l => l.active).sort((a, b) => a.val - b.val);

        const isDown = this.y2 > this.y1;
        const minY = Math.min(this.y1, this.y2);
        const maxY = Math.max(this.y1, this.y2);

        ctx.save();
        ctx.font = '12px sans-serif';
        ctx.lineWidth = lineWidth;

        for (let i = 0; i < activeLevels.length; i++) {
            const level = activeLevels[i];

            let y = this.y1 + (this.y2 - this.y1) * level.val;

            if (i < activeLevels.length - 1 && backOpacity > 0) {
                const nextLevel = activeLevels[i + 1];
                let yNext = this.y1 + (this.y2 - this.y1) * nextLevel.val;

                ctx.beginPath();
                ctx.fillStyle = level.color + Math.floor(backOpacity * 255).toString(16).padStart(2, '0');
                ctx.fillRect(this.x1, y, this.x2 - this.x1, yNext - y);
            }

            ctx.beginPath();
            ctx.strokeStyle = level.color;
            ctx.moveTo(this.x1, y);
            ctx.lineTo(this.x2, y);
            ctx.stroke();

            ctx.fillStyle = level.color;
            const price = this.core.layout.y2value(y).toFixed(this.core.props.precision || 2);
            const percent = (level.val * 100).toFixed(1) + '%';

            ctx.fillText(`${percent} (${price})`, Math.max(this.x1, this.x2) + 5, y + 4);
        }

        ctx.restore();
    }

    collision(x, y) {
        if (!this.settings) return false;

        const hitbox = 5;
        const activeLevels = this.settings.levels.filter(l => l.active);

        for (const level of activeLevels) {
            let lineY = this.y1 + (this.y2 - this.y1) * level.val;

            if (y >= lineY - hitbox && y <= lineY + hitbox &&
                x >= Math.min(this.x1, this.x2) && x <= Math.max(this.x1, this.x2)) {
                return true;
            }
        }
        return false;
    }
}