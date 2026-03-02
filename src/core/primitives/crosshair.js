// Crosshair layer. Extends Layer class,
// TODO: can be replaced by overlay script
// TODO: generalize show/hide to any layer

import Layer from '../layer.js'
import Const from '../../stuff/constants.js'
import Events from "../events.js";
import MetaHub from "../metaHub.js";

const HPX = Const.HPX

export default class Crosshair extends Layer {

    constructor(id, nvId) {
        super(id, '__$Crosshair__', nvId)

        this.events = Events.instance(this.nvId)
        this.events.on(`crosshair:show-crosshair`, this.onShowHide.bind(this))

        this.id = id
        this.zIndex = 1000000
        this.ctxType = 'Canvas';
        this.show = true;
        this.signalLevelActionHover = false;
        this.actionSize = 22;
        this.meta = MetaHub.instance(nvId)

        this.overlay = {
            draw: this.draw.bind(this),
            mousemove: this.mousemove.bind(this),
            mouseout: this.mouseout.bind(this),
            click: this.click.bind(this),
            destroy: this.destroy.bind(this)
        }

        this.env = {
            update: this.envEpdate.bind(this),
            destroy: () => {
            }
        }
    }

    drawAddSignalLevelButton(ctx, cursor) {
        if (this.signalLevelActionHover) {
            ctx.fillStyle = this.props.colors.scale;
        } else {
            ctx.fillStyle = this.props.colors.panel;
        }
        ctx.roundRect(this.layout.width - this.actionSize - 1, cursor.y - this.actionSize / 2, this.actionSize, this.actionSize, [2, 0, 0, 2]);
        ctx.fill();

        ctx.beginPath();

        const actionButtonSize = 8;
        const offset = 3;

        ctx.setLineDash([0, 0]);
        ctx.moveTo(this.layout.width - this.actionSize / 2 - 1, cursor.y - actionButtonSize + offset);
        ctx.lineTo(this.layout.width - this.actionSize / 2 - 1, cursor.y + actionButtonSize - offset);
        ctx.stroke();

        ctx.moveTo(this.layout.width - this.actionSize / 2 - 1 + actionButtonSize - offset, cursor.y);
        ctx.lineTo(this.layout.width - this.actionSize / 2 - 1 - actionButtonSize + offset, cursor.y);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(this.layout.width - this.actionSize / 2 - 1, cursor.y, actionButtonSize, 0, 2 * Math.PI);
        ctx.stroke()
    }

    draw(ctx) {
        if (!this.layout) return

        const cursor = this.props.cursor

        if (!cursor.visible || !this.show) return

        //if (!this.visible && cursor.mode === 'explore') return

        ctx.save()
        ctx.strokeStyle = this.props.colors.cross
        ctx.beginPath()
        ctx.setLineDash([5])

        // H
        if (cursor.gridId === this.layout.id) {
            ctx.moveTo(0, cursor.y + HPX)
            ctx.lineTo(this.layout.width + HPX, cursor.y + HPX)
        }

        // V
        ctx.moveTo(cursor.x, 0);
        ctx.lineTo(cursor.x, this.layout.height);
        ctx.stroke();

        if (this.layout.main && cursor.gridId === this.layout.id) {
            this.drawAddSignalLevelButton(ctx, cursor);
        }

        ctx.restore()
    }

    mousemove(event) {
        this.signalLevelActionHover = this.actionButtonHovered(event);
        this.signalLevelActionHover ? document.body.classList.add('pointer') : document.body.classList.remove('pointer');
    }

    mouseout(event) {
        document.body.classList.remove('pointer');
    }

    click(event) {
        // if (this.meta.selectedTool) {
        //     return void 0;
        // }

        const actionButtonHovered = this.actionButtonHovered(event);
        if (actionButtonHovered) {
            const cursor = this.props.cursor;
            // const yValue = cursor.values[0][0][1];
            const yValue = this.layout.y2value(cursor.y);
            const events = this.events = Events.instance(this.props.id)
            events.emit('add-signal-level', {
                gridId: this.id,
                scaleId: this.layout.scaleSpecs.id,
                yValue
            });
        }
    }

    envEpdate(ovSrc, layout, props) {
        this.ovSrc = ovSrc
        this.layout = layout
        this.props = props
    }

    onCursor(update) {
        if (this.props) this.props.cursor = update
    }

    onShowHide(flag) {
        this.show = flag
    }

    destroy() {
        this.events.off('crosshair')
    }

    actionButtonHovered = (mouse) => {
        if (!this.props?.cursor) {
            return false;
        }

        const cursor = this.props.cursor;
        return this.cursorInRect(
            mouse.layerX,
            mouse.layerY,
            this.layout.width - this.actionSize - 2,
            cursor.y - this.actionSize / 2,
            this.actionSize,
            this.actionSize
        );
    }

    cursorInRect = (mouseX, mouseY, rectX, rectY, rectW, rectH) => {
        let xLine = mouseX > rectX && mouseX < rectX + rectW
        let yLine = mouseY > rectY && mouseY < rectY + rectH

        return xLine && yLine
    }
}
