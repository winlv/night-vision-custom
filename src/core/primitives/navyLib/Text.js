export default class Text {
    constructor(core, data) {
        this.core = core;
        this.data = data;
        this.selected = false;
        this.hover = false;
        this.typing = false;
        this.drag = { t: null, v: null, mStartT: null, mStartV: null };
        this.box = { w: 0, h: 0 };
        this.padding = 8;
    }

    updateBox(ctx) {
        const { text, textSize } = this.data;
        ctx.font = `${textSize}px Roboto, Arial, sans-serif`;
        const lines = (text || "").split('\n');
        const lineHeight = textSize * 1.2;

        let maxW = 0;
        lines.forEach(line => {
            const w = ctx.measureText(line).width;
            if (w > maxW) maxW = w;
        });

        this.box.w = Math.max(maxW, 20);
        this.box.h = Math.max(lines.length * lineHeight, textSize);
    }

    draw(ctx) {
        if (this.data && this.data.hidden) return
        if (this.typing) return;

        const { x, y, text, textSize, textColor } = this.data;
        const layout = this.core.layout;
        const canvasX = layout.time2x(x);
        const canvasY = layout.value2y(y);

        this.updateBox(ctx);

        const lines = (text || "").split('\n');
        const lineHeight = textSize * 1.2;

        ctx.save();

        if (this.selected || this.hover) {
            ctx.beginPath();
            ctx.setLineDash(this.selected ? [] : [5, 5]);
            ctx.strokeStyle = this.selected ? '#3399ff' : 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1;
            ctx.roundRect(
                canvasX - this.padding,
                canvasY - this.padding,
                this.box.w + this.padding * 2,
                this.box.h + this.padding * 2,
                4
            );
            ctx.stroke();

            if (this.selected) {
                ctx.fillStyle = 'rgba(51, 153, 255, 0.05)';
                ctx.fill();
            }
        }

        ctx.font = `${textSize}px Roboto, Arial, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = textColor;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = this.selected ? 0 : 2;

        lines.forEach((line, i) => {
            ctx.fillText(line, canvasX, canvasY + i * lineHeight);
        });

        ctx.restore();
    }

    collision() {
        const mouse = this.core.mouse;
        const layout = this.core.layout;
        const cx = layout.time2x(this.data.x);
        const cy = layout.value2y(this.data.y);
        const p = this.padding;

        return (
            mouse.x >= cx - p &&
            mouse.x <= cx + this.box.w + p &&
            mouse.y >= cy - p &&
            mouse.y <= cy + this.box.h + p
        );
    }

    mousedown(event) {
        if (this.data && (this.data.hidden || this.data.locked)) return
        if (this.collision() && this.core.meta.tool === 'Cursor') {
            const layout = this.core.layout;
            this.drag.t = this.data.x;
            this.drag.v = this.data.y;
            this.drag.mStartT = layout.x2time(event.layerX);
            this.drag.mStartV = layout.y2value(event.layerY);
            this.core.events.emit('scroll-lock', true);
            return true;
        }
        return false;
    }

    mousemove(event) {
        if (this.data && (this.data.hidden || this.data.locked)) return
        this.hover = this.collision();

        if (this.drag.mStartT !== null) {
            const layout = this.core.layout;
            const currentT = layout.x2time(event.layerX);
            const currentV = layout.y2value(event.layerY);

            const dTime = currentT - this.drag.mStartT;
            const dValue = currentV - this.drag.mStartV;

            this.data.x = this.drag.t + dTime;
            this.data.y = this.drag.v + dValue;
            this.core.events.emit('update-layout');
        }
    }

    mouseup() {
        if (this.data && (this.data.hidden || this.data.locked)) return
        this.drag.mStartT = null;
        this.drag.mStartV = null;
        this.core.events.emit('scroll-lock', false);
    }
}