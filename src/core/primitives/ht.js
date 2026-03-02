import Layer from "../layer.js";
import * as PIXI from "pixi.js";
import Events from "../events.js";
import MetaHub from "../metaHub.js";
import Utils from "../../stuff/utils.js";

export default class Heatmap {

    heatmapApp;
    heatmapMesh;
    instanceBuffer;

    prevYRange;
    prevChartRange;
    prevXScale = 1;
    prevYScale = 1;

    xInitialScale;
    yInitialScale;

    initialWidth = 0;
    initialHeight = 0;

    props;
    layout;

    constructor(id) {

        this.nvId = id;

        this.events = Events.instance(this.nvId);
        this.meta = MetaHub.instance(this.nvId);

        this.events.on(`heatmap-layer:layout-update`, this.layoutUpdate.bind(this));

        this.heatmapApp = new PIXI.Application({
            backgroundAlpha: 0,
            clearBeforeRender: true,
            antialias: !Utils.isMobile,
            autoDensity: true,
            resizeTo: window,
            resolution: window.devicePixelRatio || 1,
        });

        this.heatmapApp.view.style.position = "absolute";
        this.heatmapApp.view.style.top = 0;
        this.heatmapApp.view.style.left = 0;
        this.heatmapApp.view.style.pointerEvents = "none";
        this.heatmapApp.view.classList.add("orderbook-heatmap");

        window.PIXI = PIXI;

        this.meta.hub.se.chart.root.appendChild(this.heatmapApp.view);

        this.createMesh();

    }

    createMesh() {

        const geometry = new PIXI.Geometry()
            .addAttribute(
                "aVertexPosition",
                new Float32Array([
                    0, 0,
                    1, 0,
                    0, 1,
                    0, 1,
                    1, 0,
                    1, 1
                ]),
                2
            );

        this.instanceBuffer = new PIXI.Buffer(new Float32Array(8), true, false);

        geometry.addAttribute(
            "aRect",
            this.instanceBuffer,
            4,
            false,
            PIXI.TYPES.FLOAT,
            8 * 4,
            0,
            true
        );

        geometry.addAttribute(
            "aColor",
            this.instanceBuffer,
            4,
            false,
            PIXI.TYPES.FLOAT,
            8 * 4,
            4 * 4,
            true
        );

        const shader = PIXI.Shader.from(
            `
        precision highp float;

        attribute vec2 aVertexPosition;
        attribute vec4 aRect;
        attribute vec4 aColor;

        uniform mat3 translationMatrix;
        uniform mat3 projectionMatrix;

        varying vec4 vColor;

        void main() {
            vec2 pos = aRect.xy + aVertexPosition * aRect.zw;
            vec3 world = translationMatrix * vec3(pos, 1.0);
            vec3 clip = projectionMatrix * world;
            gl_Position = vec4(clip.xy, 0.0, 1.0);
            vColor = aColor;
        }
        `,
            `
        precision highp float;
        varying vec4 vColor;
        void main() {
            gl_FragColor = vColor;
        }
        `
        );

        this.heatmapMesh = new PIXI.Mesh(geometry, shader);
        this.heatmapMesh.drawMode = PIXI.DRAW_MODES.TRIANGLES;

        this.heatmapApp.stage.addChild(this.heatmapMesh);


    }

    updateData(data) {
        if (!this.layout) return;

        const buffer = [];
        const step = this.props?.aggregationStep ?? 0;

        for (let i = 0; i < data.length; i++) {

            const [timestamp, levels] = data[i];
            const x = this.layout.ti2xWithoutRound(timestamp);

            this.pushOrders(levels.a, x, buffer);
            this.pushOrders(levels.b, x, buffer);
        }

        const floatArray = new Float32Array(buffer);

        this.instanceBuffer.update(floatArray);
        this.heatmapMesh.geometry.instanceCount = floatArray.length / 8;
    }

    pushOrders(orders, x, buffer) {

        for (let j = 0; j < orders.length; j += 3) {

            const price = orders[j];
            const qty = orders[j + 1];

            const y = this.layout.value2y(price, false);

            const color = this.getColor(qty);
            if (!color) continue;

            const rgba = this.parseRGBA(color);

            buffer.push(
                x,
                y,
                5,   // width (можешь заменить на свою)
                5,   // height
                rgba[0],
                rgba[1],
                rgba[2],
                rgba[3]
            );
        }
    }

    getColor(value) {
        return value > 0 ? "rgba(255,0,0,0.6)" : "rgba(0,255,0,0.6)";
    }

    parseRGBA(str) {
        const match = str.match(/rgba?\(([^)]+)\)/);
        if (!match) return [0,0,0,0];

        const parts = match[1].split(",").map(v => parseFloat(v));

        return [
            parts[0] / 255,
            parts[1] / 255,
            parts[2] / 255,
            parts[3] ?? 1
        ];
    }

    layoutUpdate({layout, props} = data) {

        if (!layout?.main) return;

        this.layout = layout;
        this.props = props;

        if (!this.prevYRange) {
            this.prevYRange = [layout.$hi, layout.$lo];
            this.prevChartRange = [...props.range];
            return;
        }

        const prevPosX = layout.ti2xWithoutRound(this.prevChartRange[0]);
        const crntPosX = layout.ti2xWithoutRound(props.range[0]);
        const offsetX = prevPosX - crntPosX;

        const zoomX = 1 / (props.range[1] - props.range[0]);

        this.heatmapApp.stage.position.x += offsetX;
        this.heatmapApp.stage.scale.x = zoomX;

        this.prevYRange = [layout.$hi, layout.$lo];
        this.prevChartRange = [...props.range];
    }

    destroy() {
        this.heatmapApp.destroy(true);
        this.heatmapApp = null;
    }
}
