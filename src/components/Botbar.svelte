<script>
    // The Bottom Bar. Information flow:
    // Input: props, layout, (?events)
    // Output: canvas, (?events)

    // TODO: add support of overlays with
    // drawBotbar() function

    import { onMount, onDestroy } from "svelte";
    import Events from "../core/events.js";
    import Utils from "../stuff/utils.js";
    import dpr from "../stuff/dprCanvas.js";
    import bb from "../core/primitives/botbar.js";
    import MetaHub from "../core/metaHub.js";

    export let props = {}; // General props
    export let layout = {}; // Grid layout

    let bbUpdId = `botbar`;
    let bbId = `${props.id}-botbar`;
    let canvasId = `${props.id}-botbar-canvas`;
    let mc; // Mouse controller
    let drug = {};
    let zoom = 1;
    let meta = MetaHub.instance(props.id);
    let events = Events.instance(props.id);
    let data = [];

    // EVENT INTERFACE
    events.on(`${bbUpdId}:update-bb`, update);
    events.on(`${bbUpdId}:show-bb-panel`, (f) => (showPanel = f));

    $: bbStyle = `
    background: ${props.colors.back};
    width: ${(layout.botbar || {}).width}px;
    height: ${(layout.botbar || {}).height}px;
    margin-left: ${props.offset}px;
    position: relative;
    z-index: 1;
`;

    let canvas; // Canvas ref
    let ctx; // Canvas context
    let showPanel = true;

    $: width = (layout.botbar || {}).width;
    $: resizeWatch(width);

    onMount(() => {
        setup();
    });
    onDestroy(() => {
        events.off(`${bbUpdId}`);
    });

    async function listeners() {
        const Hammer = await import("hammerjs");

        mc = new Hammer.Manager(canvas);
        mc.add(
            new Hammer.Pan({
                direction: Hammer.DIRECTION_VERTICAL,
                threshold: 0,
            }),
        );

        mc.add(
            new Hammer.Tap({
                event: "doubletap",
                taps: 2,
                posThreshold: 50,
            }),
        );

        mc.on("panstart", (event) => {
            drug = {
                y: event.center.y,
                x: event.center.x,
                z: zoom,
                t: props.range[1] - props.range[0],
                r: props.range.slice()
            };
        });

        mc.on("panmove", (event) => {
            zoom = calcZoom(event);
            const range = calcRange(event);
            console.log(range);
            events.emit("range-changed", range);
            update();
        });

        mc.on("panend", () => {
            drug = {};
        });
    }

    function calcZoom(event) {
        let d = drug.y - event.center.x;
        let speed = d > 0 ? 3 : 1;
        let k = 1 + (speed * d) / layout.botbar.width;
        return Utils.clamp(drug.z * k, 0.005, 100);
    }

    function calcRange(event) {
        let range = [...props.range];

        let dt = drug.t * (drug.x - event.center.x) / layout.botbar.width;
        range[0] = drug.r[0] + dt

        return range;
    }

    async function setup() {
        let botbar = layout.botbar;
        [canvas, ctx] = dpr.setup(canvasId, botbar.width, botbar.height);

        await listeners();

        update();
    }

    function update($layout = layout) {
        layout = $layout;
        data = meta.hub.mainOv.dataSubset;

        if (!layout.botbar) return; // If not exists

        bb.body(props, layout, ctx);

        // applyShaders()

        if (props.cursor.x && props.cursor.ti !== undefined && showPanel) {
            bb.panel(props, layout, ctx);
        }
    }

    function resizeWatch() {
        let botbar = layout.botbar;
        if (!canvas || !botbar) return;
        dpr.resize(canvas, ctx, botbar.width, botbar.height);
        update();
    }

    /*function applyShaders() {
    let props = {
        layout: layout,
        cursor: props.cursor
    }
    for (var s of props.bb_shaders) {
        ctx.save()
        s.draw(ctx, props)
        ctx.restore()
    }
}*/
</script>

<div class="nvjs-botbar" id={bbId} style={bbStyle}>
    <canvas id={canvasId}></canvas>
</div>

<style>
    .nvjs-botbar {
    }
</style>
