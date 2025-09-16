import Layer from "../layer.js";
import * as PIXI from 'pixi.js';
import Events from "../events.js";
import MetaHub from "../metaHub.js";

export default class Heatmap {
    heatmapApp = undefined;
    prevYRange = undefined;
    prevChartRange = undefined;
    prevXScale = 1;
    prevYScale = 1;
    xInitialScale = undefined;
    yInitialScale = undefined;
    initialWidth = 0;
    initialHeight = 0;
    props = undefined;

    constructor(id) {
        this.nvId = id;

        this.events = Events.instance(this.nvId);
        this.meta = MetaHub.instance(this.nvId);

        this.events.on(`heatmap-layer:layout-update`, this.layoutUpdate.bind(this));

        this.zIndex = 1000000;
        this.ctxType = 'Canvas';

        this.heatmapApp = new PIXI.Application({
            backgroundAlpha: 0,
            clearBeforeRender: true,
            antialias: true,
            autoDensity: true,
            resizeTo: window,
            resolution: window.devicePixelRatio || 1,
        });

        this.heatmapApp.view.style.position = 'absolute';
        this.heatmapApp.view.style.top = 0;
        this.heatmapApp.view.style.left = 0;
        this.heatmapApp.view.style.pointerEvents = 'none';
        this.heatmapApp.view.classList.add('orderbook-heatmap');

        window.PIXI = PIXI;

        this.meta.hub.se.chart.root.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });

        this.meta.hub.se.chart.root.appendChild(this.heatmapApp.view);
    }

    layoutUpdate({layout, props} = data) {
        if (!layout.main) {
            return void 0;
        }

        if (!this.heatmapApp) {
            return void 0;
        }

        if (!this.layout) {
            this.layout = layout;
        }

        if (!this.props) {
            this.props = props;
        }

        if (!this.prevYRange) {
            this.prevYRange = [this.layout.$hi, this.layout.$lo];
            this.prevChartRange = [...this.props.range];
            return void 0;
        }

        if (!this.xInitialScale) {
            this.xInitialScale = 1 / (this.props.range[1] - this.props.range[0]);
        }

        if (!this.yInitialScale) {
            this.yInitialScale = 1 / (this.layout.$hi - this.layout.$lo);
        }

        if (!this.initialWidth) {
            this.initialWidth = this.layout.width;
        }

        if (!this.initialHeight) {
            this.initialHeight = this.layout.height;
        }

        // Calculate x
        const prevPosX = this.layout.ti2xWithoutRound(this.prevChartRange[0]);
        const crntPosX = this.layout.ti2xWithoutRound(props.range[0]);
        const offsetX = prevPosX - crntPosX;
        let x = this.heatmapApp.stage.position.x + offsetX;

        // Calculate y
        let offsetY = 0;
        let scaleId = this.layout.scaleIndex
        const gridId = this.layout.main ? this.layout.id : this.layout.mainGrid.id;
        let yTransform = this.meta.getYtransform(gridId, scaleId);
        if (yTransform?.range) {
            const prevPosY = this.layout.value2y(this.prevYRange[0], false);
            const crntPosY = this.layout.value2y(yTransform.range[0], false);
            offsetY = prevPosY - crntPosY;
        }
        let y = this.heatmapApp.stage.position.y + offsetY;

        // Calculate x scale
        let zoomX = 1 / (this.xInitialScale * (props.range[1] - props.range[0]));
        if (this.initialWidth !== this.layout.width) {
            zoomX = zoomX * (this.layout.width / this.initialWidth);
        }
        x = x * (zoomX / this.prevXScale);

        // Calculate y scale
        let zoomY = yTransform?.zoom ?? 1;
        if (this.initialHeight !== this.layout.height) {
            zoomY = zoomY * (this.layout.height / this.initialHeight);
        }
        y = y * (zoomY / this.prevYScale);
        if (zoomY === 1) {
            y = 0;
        }

        this.heatmapApp.stage.position.set(x,y);
        this.heatmapApp.stage.scale.set(zoomX, zoomY);

        this.prevYRange = [layout.$hi, layout.$lo];
        this.prevChartRange = [...props.range];
        this.prevXScale = zoomX;
        this.prevYScale = zoomY;

        this.layout = layout;
        this.props = props;
    }

    reset() {
        this.layout = undefined;
        this.props = undefined;
        this.initialHeight = undefined;
        this.initialWidth = undefined;
        this.xInitialScale = undefined;
        this.yInitialScale = undefined;
        this.prevXScale = 1;
        this.prevYScale = 1;
        this.prevYRange = undefined;
        this.prevChartRange = undefined;
    }

    destroy() {
        this.events.off('heatmap-layer');
        this.heatmapApp.stop();
        this.heatmapApp.stage.destroy({children: true, texture: true, baseTexture: true});
        this.heatmapApp.view.remove();
        this.heatmapApp.destroy(true);
        this.heatmapApp = undefined;
    }
}