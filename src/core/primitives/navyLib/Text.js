import {Utils} from "../../../index.js";

export default class Text {

    constructor(core, line, nw = false) {
        this.core = core;
        this.data = line;
        this.data.collision = this.collision.bind(this);
        this.hover = false;
        this.selected = false;
        this.typing = false;
        this.onSelect = () => {
        }
        this.drag = {t: undefined, v: undefined};
    }

    draw(ctx) {
        const { x, y, text, predictedText } = this.data;
        const layout = this.core.layout;

        const canvasX = layout.time2x(x);
        const canvasY = layout.value2y(y);

        ctx.font = `${this.data.textSize}px Roboto, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = this.data.textColor;
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 3;

        const lines = text.split('\n');
        const predictedLines = predictedText.split('\n');

        const maxLineWidth = Math.max(...predictedLines.map(line => ctx.measureText(line).width));
        const lineHeight = this.data.textSize * 1.2;

        if (!this.typing) {
            lines.forEach((line, i) => {
                if (line) {
                    const lineY = canvasY + i * lineHeight;
                    ctx.strokeText(line, canvasX, lineY);
                    ctx.fillText(line, canvasX, lineY);
                }
            });
        }

        this.data.textWidth = maxLineWidth;

        if (this.selected) {
            const padding = 6;
            const totalHeight = lines.length * lineHeight;
            ctx.beginPath();
            ctx.roundRect(canvasX - padding, canvasY - padding, maxLineWidth + 2 * padding, totalHeight + 2 * padding, 2);
            ctx.strokeStyle = 'blue';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    collision() {
        if (!this.data?.text) {
            return false;
        }
        const mouse = this.core.mouse;
        const { x, y, text } = this.data;
        const layout = this.core.layout;

        const canvasX = layout.time2x(x);
        const canvasY = layout.value2y(y);

        const textWidth = this.data.textWidth;
        const textHeight = this.data.textSize;

        const padding = 6;
        const boxX = canvasX - padding;
        const boxY = canvasY - padding;
        const boxWidth = textWidth + 2 * padding;
        const boxHeight = textHeight + 2 * padding;

        return (
            mouse.x >= boxX && mouse.x <= boxX + boxWidth &&
            mouse.y >= boxY && mouse.y <= boxY + boxHeight
        );
    }

    propagate(name, data) {
    }

    mousedown(event) {
        this.propagate('mousedown', event)
        if (this.collision()) {
            if (this.core.meta.tool !== 'Cursor') {
                return void 0;
            }

            if (this.selected) {
                this.typing = true;
            }

            this.selected = true;

            this.onSelect(this.data.uuid)
            this.core.events.emit('scroll-lock', true);

            const layout = this.core.layout;
            this.drag.t = layout.x2time(event.layerX);
            this.drag.v = layout.y2value(event.layerY);
        } else {
            this.typing = false;
        }
    };

    mouseup(event) {
        // this.state = this.pins.some(pin => pin.state === 'tracking') ? 'tracking' : 'settled';
        this.propagate('mouseup', event)
        this.drag.t = null;
        this.drag.v = null;
    };

    mousemove(event) {
        if (this.core.meta.selectedTool && this.core.meta.selectedTool !== this.data.uuid) {
            return void 0;
        }

        if (this.core.meta.tool !== 'Cursor') {
            return void 0;
        }

        if (!this.collision() && this.hover && !Utils.isMobile) {
            event.target.style.cursor = 'default';
        }

        this.hover = this.collision();
        this.propagate('mousemove', event);

        if (this.selected) {
            if (this.hover && !this.typing && !Utils.isMobile) {
                event.target.style.cursor = 'text';
            }

            if (this.typing) {
                return void 0;
            }

            if (!this.drag.t || !this.drag.v) {
                return;
            }

            const layout = this.core.layout;

            const dt = layout.x2time(event.layerX) - this.drag.t;
            const dy = layout.y2value(event.layerY) - this.drag.v;

            this.data.x += dt;
            this.data.y += dy;

            this.drag.t = layout.x2time(event.layerX);
            this.drag.v = layout.y2value(event.layerY);

            this.core.events.emit('update-layout');
        }
    };
}