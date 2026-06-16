
<script>

// CanvasJS renderer. Displays layers
// ~ Information flow ~
// Input: props, layout, layers (data+overlay), Input object
// Output: Graphix

import { onMount, onDestroy } from 'svelte'
import Events from '../../core/events.js'
import dpr from '../../stuff/dprCanvas.js'
import math from "../../stuff/math.js";
import perf from "../../stuff/perf.js";

export let id // Pane/grid id
export let props = {} // General props
export let rr = {} // Renderer props
export let layout = {} // Grid layout

let events = Events.instance(props.id)

let rrUpdId = `rr-${id}-${rr.id}`
let gridUpdId = `grid-${id}`
let rrId = `${props.id}-rr-${id}-${rr.id}`
let canvasId = `${props.id}-canvas-${id}-${rr.id}`

// TODO: separate renderer, meaning it's not bundled with
// other overlay and can be update separately
// EVENT INTERFACE
events.on(`${rrUpdId}:update-rr`, update)
events.on(`${rrUpdId}:run-rr-task`, onTask)

$:rrStyle = `
    left: ${layout.sbMax[0] + props.offset}px;
    top: ${layout.offset || 0}px;
    position: absolute;
    height: ${layout.height}px;
}`
$:canvasStyle = `
    position: relative;
    z-index:1;
    background: ${(layout.main || rr.ctxType === 'Overlay') ? 'transparent' :  props.colors.back};
`;
$:width = layout.width
$:height = layout.height
$:resizeWatch(width, height)

let canvas // Canvas ref
let ctx // Canvas context
let input // Input attacher to the renderer

// Phase 1.2: rAF batching. Multiple `update-rr` events within one frame are
// coalesced into a single paint via a dirty flag + one requestAnimationFrame.
let dirty = false
let pendingLayout = layout
let rafId = null

onMount(() => { setup() })
onDestroy(() => {
    events.off(`${rrUpdId}`)
    if (rafId !== null) cancelAnimationFrame(rafId)
    if (input) input.destroy()
})

// Attach an input object
// Remove input listeners on renderer dostroy() event
export function attach($input) {
    input = $input
    input.setup({
        id, canvas, ctx, props, layout, rrUpdId, gridUpdId
    })
}

export function detach() {
    if (input) {
        input.destroy()
        input = null
    }
}

export function getInput() {
    return input
}

function setup() {
    window.Math2 = math;

    [canvas, ctx] = dpr.setup(
        canvasId, layout.width, layout.height)

    //update()

}

// Schedule a paint (coalesced to one per frame). Use draw() directly only
// when a synchronous repaint is required (e.g. right after a resize).
function update($layout = layout) {
    pendingLayout = $layout
    dirty = true
    if (rafId === null) rafId = requestAnimationFrame(flush)
}

function flush() {
    rafId = null
    if (!dirty) return
    dirty = false
    draw(pendingLayout)
}

function draw($layout = layout) {

    layout = $layout

    if (!ctx || !layout) return

    // Perf counter: lets the dev HUD / tests see how often THIS renderer
    // repaints (e.g. confirm a mouse move no longer redraws the main canvas).
    perf.countDraw(rr.ctxType)

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    //if (this.$p.shaders.length) this.apply_shaders()
    rr.layers.forEach(l => {
        if (!l.display) return
        ctx.save()
        let r = l.overlay
        //if (r.preDraw) r.preDraw(ctx)
        if (l.opacity) ctx.globalAlpha = l.opacity
        try {
            r.draw(ctx)
        } catch(e) {
            console.log(`Layer ${id}.${l.id}`, e)
        }
        ctx.globalAlpha = 1
        //if (r.postDraw) r.postDraw(ctx)
        ctx.restore()
    })

    // TODO: css thing didn't work, coz canvas draws
    // through the border somehow. See Pane.svelte
    // (the pane separator belongs to the static canvas, not the crosshair one)
    if (id > 0 && rr.ctxType !== 'Overlay') upperBorder()

}

// Perform various tasks
function onTask(event) {
    event.handler(canvas, ctx, input)
}

// Upper grid splitter (line)
function upperBorder() {
    ctx.strokeStyle = props.colors.scale
    ctx.beginPath()
    ctx.moveTo(0, 0.5)
    ctx.lineTo(layout.width, 0.5)
    ctx.stroke()
}

// TODO: potential performance improvement
function resizeWatch() {
    if (!canvas) return
    dpr.resize(canvas, ctx, layout.width, layout.height)
    draw() // sync — avoid a blank frame after the canvas is resized/cleared
}

</script>
<style>
.nvjs-canvas-rendrer {}
</style>
<div id={rrId} style={rrStyle}
    class="nvjs-canvas-rendrer">
    <canvas style="{canvasStyle}" id={canvasId}></canvas>
</div>
