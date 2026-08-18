// Crosshair layer. Extends Layer class,
// TODO: can be replaced by overlay script
// TODO: generalize show/hide to any layer

import Layer from '../layer.js'
import Const from '../../stuff/constants.js'
import Events from "../events.js";
import MetaHub from "../metaHub.js";
import DataHub from "../dataHub.js";

const HPX = Const.HPX

export default class Crosshair extends Layer {

    constructor(id, nvId) {
        super(id, '__$Crosshair__', nvId)

        this.events = Events.instance(this.nvId)
        this.events.on(`crosshair:show-crosshair`, this.onShowHide.bind(this))

        this.id = id
        this.zIndex = 1000000
        // Phase 1.1: the crosshair lives on its OWN top canvas ('Overlay')
        // so a mouse move repaints only it, not the candles/indicators below.
        // It has the highest zIndex, so after sorting it is the last layer and
        // mergeByCtx() naturally puts it in a separate, top-most renderer.
        this.ctxType = 'Overlay';
        this.show = true;
        this.signalLevelActionHover = false;
        this.actionSize = 22;
        this.meta = MetaHub.instance(nvId)
        this.hub = DataHub.instance(nvId)

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

        if (this.layout.main && cursor.gridId === this.layout.id && this.props.config.DRAW_SIGNAL_LEVEL_BUTTON) {
            this.drawAddSignalLevelButton(ctx, cursor);
        }

        this.drawCursorDistance(ctx, cursor)

        ctx.restore()
    }

    // Distance (%) between the cursor price and the last price of the
    // main overlay, drawn as bare text next to the crosshair.
    // Toggled by config.SHOW_CURSOR_DISTANCE (on by default).
    drawCursorDistance(ctx, cursor) {

        if (this.props.config.SHOW_CURSOR_DISTANCE === false) return

        // Only meaningful on the main grid: other panes hold indicator
        // values, not prices, so a % distance to the last price is noise
        if (!this.layout.main || cursor.gridId !== this.layout.id) return

        const last = this.lastValue()
        if (last === undefined || !isFinite(last) || Math.abs(last) < 1e-12) return

        const $ = this.layout.y2value(cursor.y)
        if (!isFinite($)) return

        const dist = ($ - last) / last * 100
        const lbl = `${dist > 0 ? '+' : ''}${dist.toFixed(2)}%`

        ctx.save()
        ctx.setLineDash([])
        ctx.font = this.props.config.FONT
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'

        // Bare text, no plate behind it. The color follows the crosshair,
        // so recoloring the crosshair recolors the readout with it.
        const h = 12
        const gap = 8
        const w = Math.ceil(ctx.measureText(lbl).width)

        // Default spot: right of the vertical line, above the horizontal one
        let x = cursor.x + gap
        let y = cursor.y - gap - h / 2

        // Flip to the left of the cursor when the text would run into the
        // right edge (or into the add-signal-level button that lives there)
        const rightPad = this.props.config.DRAW_SIGNAL_LEVEL_BUTTON ?
            this.actionSize + 4 : 2
        if (x + w > this.layout.width - rightPad) x = cursor.x - gap - w
        if (x < 2) x = 2

        // Flip below the cursor when there is no room above
        if (y - h / 2 < 2) y = cursor.y + gap + h / 2
        if (y + h / 2 > this.layout.height - 2) y = this.layout.height - 2 - h / 2

        ctx.fillStyle = this.props.colors.cross
        ctx.fillText(lbl, x, y)

        ctx.restore()
    }

    // Last value of the main overlay (the one the price line tracks)
    lastValue() {

        const chart = this.hub.chart
        const mainOv = this.hub.mainOv
        if (!chart || !mainOv) return undefined

        const data = mainOv.data
        if (!data || !data.length) return undefined

        const point = data[data.length - 1]
        if (!point) return undefined

        // Prefer the overlay's own value tracker: it is what draws the
        // price line, so the chip always agrees with what's on screen
        const ovId = chart.overlays.indexOf(mainOv)
        const vt = (this.meta.valueTrackers[this.hub.mainPaneId] || [])[ovId]
        if (typeof vt === 'function') {
            try {
                let t = vt(point)
                if (Array.isArray(t)) {
                    t = t.find(x => x && x.show && x.value !== undefined)
                }
                if (t && t.value !== undefined) return t.value
            } catch (e) {
                // Fall back to the raw data point below
            }
        }

        // Candles => close, plain series => value
        return point.length >= 5 ? point[4] : point[1]
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
