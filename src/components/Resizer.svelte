<script>
    import Events from "../core/events.js";

    export let props;
    export let id;
    export let layout = {}

    let events = Events.instance(props.id)
    let startY = 0

    function onMouseDown(e) {
        startY = e.clientY;
        events.emit('cursor-locked', true)
        // Seed all pane heights to pixels for this gesture (pixel-space drag).
        events.emitSpec('hub', 'pane-resize-start', {})
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'ns-resize'
    }

    function onMouseMove(e) {
        const deltaPx = e.clientY - startY;
        if (!deltaPx) return;
        startY = e.clientY;
        // deltaPx > 0 (drag down) → pane above grows, this pane shrinks.
        events.emitSpec('hub', 'pane-resize', { paneId: id, deltaPx });
    }

    function onMouseUp() {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = ''
        events.emit('cursor-locked', false)
    }
</script>

<div class="resizer-wrapper">
    <div class="pane-resizer"
         style="--line:{props.colors.scale}; --hover:{props.colors.cross}"
         on:mousedown|preventDefault={onMouseDown}></div>
</div>

<style>
    .resizer-wrapper {
        height: 100%;
        position: relative;
    }
    /* Wide invisible grab zone straddling the pane boundary, thin visible line */
    .pane-resizer {
        position: absolute;
        top: -4px; left: 0; right: 0;
        height: 9px;
        cursor: ns-resize;
        z-index: 100;
    }
    .pane-resizer::after {
        content: '';
        position: absolute;
        left: 0; right: 0; top: 4px;
        height: 1px;
        background: var(--line);
        transition: height .08s ease, background .08s ease, top .08s ease;
    }
    .pane-resizer:hover::after {
        top: 3px;
        height: 3px;
        background: var(--hover);
    }
</style>
