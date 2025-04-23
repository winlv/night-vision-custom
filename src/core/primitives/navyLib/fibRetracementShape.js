export default class FibRetracementShape {

    constructor(core) {
        this.T = core.props.config.TOOL_COLL;
        this.core = core;
        this.selected = false;
        this.hover = false;
    }

    update(p1, p2) {
        const layout = this.core.layout;

        this.x1 = layout.time2x(p1[0])
        this.y1 = layout.value2y(p1[1])
        this.x2 = layout.time2x(p2[0])
        this.y2 = layout.value2y(p2[1])
    }

    handleHover(hover) {
        this.hover = hover;
    }

    draw(ctx) {
        if (this.x1 === undefined || this.y1 === undefined || this.x2 === undefined || this.y2 === undefined) {
            return;
        }

        const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236];
        const isDown = this.y2 > this.y1;
        const minY = Math.min(this.y1, this.y2);
        const maxY = Math.max(this.y1, this.y2);

        const levelColors = {
            0: '#9e9e9e',
            0.236: '#f44336',
            0.382: '#ffc400',
            0.5: '#00ff0a',
            0.618: '#249a27',
            0.786: '#13e4d3',
            1: '#9e9e9e',
            1.618: '#1f5cff',
            2.618: '#ff4e00',
            3.618: '#a010c5',
            4.236: '#ff00c3'
        };

        ctx.save();
        ctx.lineWidth = 2;
        ctx.font = '12px sans-serif';

        for (let i = 0; i < levels.length; i++) {
            const level = levels[i];
            const nextLevel = levels[i + 1];

            let y = isDown
                ? maxY + (minY - maxY) * level
                : minY + (maxY - minY) * level;

            if (nextLevel !== undefined) {
                let yNext = isDown
                    ? maxY + (minY - maxY) * nextLevel
                    : minY + (maxY - minY) * nextLevel;

                ctx.beginPath();
                ctx.fillStyle = levelColors[nextLevel] + 20;
                ctx.fillRect(this.x1, y, this.x2 - this.x1, yNext - y);
            }

            ctx.beginPath();
            ctx.strokeStyle = levelColors[level];
            ctx.fillStyle = ctx.strokeStyle;
            ctx.moveTo(this.x1, y);
            ctx.lineTo(this.x2, y);
            ctx.stroke();

            const price = this.core.layout.y2value(y).toFixed(2);
            const percent = (level * 100).toFixed(1) + '%';
            ctx.fillText(`${percent} (${price})`, this.x2 + 5, y - 2);
        }

        ctx.restore();
    }

    collision(x, y) {
        if (this.x1 === undefined || this.y1 === undefined || this.x2 === undefined || this.y2 === undefined) {
            return false;
        }

        const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236];
        const isDown = this.y2 > this.y1;
        const minY = Math.min(this.y1, this.y2);
        const maxY = Math.max(this.y1, this.y2);
        const hitbox = 4;

        for (let i = 0; i < levels.length; i++) {
            const level = levels[i];

            let lineY = isDown
                ? maxY + (minY - maxY) * level
                : minY + (maxY - minY) * level;

            if (y >= lineY - hitbox && y <= lineY + hitbox && x >= Math.min(this.x1, this.x2) && x <= Math.max(this.x1, this.x2)) {
                return true;
            }
        }

        return false;
    }
}