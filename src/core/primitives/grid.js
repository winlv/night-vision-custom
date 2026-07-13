// Grid layer (actually # grid). Extends Layer class.
import Layer from '../layer.js'
import Const from '../../stuff/constants.js'
import Events from '../events.js'
import MetaHub from '../metaHub.js'

const HPX = Const.HPX;

export default class Grid extends Layer {

    constructor(id, nvId, mainPane = false) {
        super(id, '__$Grid__', nvId)

        this.events = Events.instance(this.nvId)
        this.meta = MetaHub.instance(this.nvId)
        this.events.on(`grid-layer:show-grid`, this.onShowHide.bind(this))

        this.id = id
        this.zIndex = -1000000
        this.ctxType = 'Canvas'
        this.show = true
        this.mainPane = mainPane

        this.doubleClickThreshold = 350;
        this.distThreshold = 15;
        this.lastTap = { time: 0, x: 0, y: 0 };

        this.overlay = {
            draw: this.draw.bind(this),
            destroy: this.destroy.bind(this),
            mousedown: this.mousedown.bind(this),
            mouseup: this.mouseup.bind(this),
        }

        this.env = {
            update: this.envUpdate.bind(this),
            destroy: () => {}
        }
    }

    draw(ctx) {
        let layout = this.layout
        if (!layout || !this.show) return

        // With GPU candles the whole WebGL canvas sits BELOW the Canvas-2D
        // layers, so a grid drawn here would land on top of the candle
        // bodies. GpuCandles draws the main-pane grid itself (under the
        // candles); skip the 2D grid for that pane only.
        if (this.mainPane && this.meta.gpuCandles) return

        ctx.strokeStyle = this.props.colors.grid
        ctx.beginPath()

        const ymax = layout.height
        for (var [x, p] of layout.xs) {
            ctx.moveTo(x + HPX, 0)
            ctx.lineTo(x + HPX, ymax)
        }

        for (var [y, y$] of layout.ys) {
            ctx.moveTo(0, y + HPX)
            ctx.lineTo(layout.width, y + HPX)
        }

        ctx.stroke()
    }

    envUpdate(ovSrc, layout, props) {
        this.ovSrc = ovSrc
        this.layout = layout
        this.props = props
    }

    onShowHide(flag) {
        this.show = flag
        // Mirror for GPU renderers (GpuCandles draws the main-pane grid).
        this.meta.gridShown = flag
    }

    destroy() {
        this.events.off(`grid-layer:show-grid`);
        this.lastTap = { time: 0, x: 0, y: 0 };
    }

    mousedown(event) {
    }

    mouseup(event) {
        if (!this.props.config.DOUBLE_CLICK_ALERT) {
            return;
        }

        const x = event.layerX || (event.changedTouches ? event.changedTouches[0].pageX : 0);
        const y = event.layerY || (event.changedTouches ? event.changedTouches[0].pageY : 0);

        const now = Date.now();
        const timeDiff = now - this.lastTap.time;

        const dist = Math.sqrt(
            Math.pow(x - this.lastTap.x, 2) +
            Math.pow(y - this.lastTap.y, 2)
        );

        if (timeDiff < this.doubleClickThreshold && dist < this.distThreshold) {
            this.onDoubleClick(event, x, y);
            this.lastTap = { time: 0, x: 0, y: 0 };
        } else {
            this.lastTap = { time: now, x, y };
        }
    }

    onDoubleClick(event, x, y) {
        const targetY = y || event.layerY;
        const yValue = this.layout.y2value(targetY);

        const data = {
            gridId: this.id,
            scaleId: this.layout.scaleSpecs.id,
            yValue: yValue
        };

        this.events.emit('add-signal-level', data);

        if (navigator.vibrate) {
            navigator.vibrate(15);
        }
    }
}