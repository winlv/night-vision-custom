<script>
    import { createEventDispatcher } from 'svelte';
    import Events from "../core/events.js";
    const dispatch = createEventDispatcher();
    export let props;
    export let id;

    let events = Events.instance(props.id)

    let startY, startHeightPx;
    export let layout = {}


    function onMouseDown(e) {
        startY = e.clientY;
        startHeightPx = layout.height;
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }

    function onMouseMove(e) {
        const deltaPx = e.clientY - startY;
        startY = e.clientY;

        events.emitSpec('hub', 'pane-resize', { paneId: id, deltaPx, layout })
    }

    function onMouseUp() {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    }

    $:style = `
    // bottom: ${layout.height}px;
      `
</script>

<div class="resizer-wrapper">
    <div class="pane-resizer" on:mousedown={onMouseDown} {style} ></div>
</div>

<style>
    .resizer-wrapper {
        height: 100%;
        display: block;
        position: relative;
    }
    .pane-resizer {
        height: 3px;
        cursor: ns-resize;
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 100;
        background: #424242;
    }
    .pane-resizer:hover {
        background: rgba(100, 100, 255, 0.5);
    }
</style>