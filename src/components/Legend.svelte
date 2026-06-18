<script>
    import { onMount, onDestroy } from 'svelte'
    import Events from '../core/events.js'
    import DataHub from '../core/dataHub.js'
    import LegendLine from './LegendLine.svelte'

    export let id // Legend/pane id
    export let props // General props
    export let main // Is this the main Pane
    export let layout // Pane/grid layout

    let hub = DataHub.instance(props.id)
    let events = Events.instance(props.id)

    let legendRR = 0 // Re-render key
    let collapsed = false // collapse/expand state

    $:style = `
        left: ${layout.sbMax[0] + props.offset + 5}px;
        top: ${(layout.offset || 0) + 5}px;
        position: absolute;
    `

    // EVENT INTERFACE
    events.on(`legend-${id}:update-legend`, update)

    onMount(() => {
        // восстановить состояние при загрузке
        const saved = localStorage.getItem(`legend-collapsed-${id}`)
        if (saved !== null) {
            collapsed = saved === 'true'
        }
    })

    onDestroy(() => {
        events.off(`legend-${id}`)
    })

    function update() {
        legendRR++
    }

    function toggleCollapse() {
        collapsed = !collapsed
        localStorage.setItem(`legend-collapsed-${id}`, collapsed)
    }

    function showLegendToggle() {
        if (!hub.panes()[id]) {
            return false;
        }

        const visibleOverlaysLegend = hub.panes()[id].overlays.filter(ov => ov.showLegend !== false && !ov.drawingTool);
        return visibleOverlaysLegend?.length > 0;
    }

    // Reorder this pane up (-1) / down (+1) via the data hub.
    function movePane(dir) {
        events.emitSpec('hub', 'move-pane', { paneId: id, dir })
    }

    // Index of the main (chart) pane — it stays pinned, sub-panes can't cross it.
    function mainIdx() {
        return hub.panes().findIndex(p => p.overlays && p.overlays.some(o => o.main))
    }
</script>

<style>
    .nvjs-legend {
        pointer-events: none;
    }

    .legend-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        user-select: none;
        font-size: 12px;
        color: #aaa;
        margin-bottom: 3px;
        pointer-events: all;
        position: relative;
        height: 14px;
        width: 14px;
        border: 1px solid #252732;
        border-radius: 3px;
        padding: 2px 6px;
        z-index: 1;

        &.collapsed svg {
            transform: rotate(180deg);
        }
    }

    .legend-header svg {
        transition: transform .1s cubic-bezier(.06,.52,1,.54);
    }

    .legend-tools {
        display: flex;
        align-items: center;
        gap: 3px;
        pointer-events: all;
        width: fit-content;
        /* Sit above the canvas (z-index:1), like the legend lines (z-index:10),
           otherwise the buttons render BEHIND the chart and are invisible. */
        position: relative;
        z-index: 10;
        margin-top: 2px;
    }
    .pm-btn {
        cursor: pointer;
        color: #9aa3ad;
        font-size: 10px;
        line-height: 1;
        padding: 3px 5px;
        background: #14151c99;
        border: 1px solid #2a2f38;
        border-radius: 3px;
        user-select: none;
    }
    .pm-btn:hover { color: #fff; border-color: #41a376; background: #1c2a22; }
    .pm-btn.off { opacity: 0.2; pointer-events: none; }
</style>

{#key legendRR}
    {#if hub.panes()[id]}
        <div class="nvjs-legend" {style}>
            {#if !collapsed}
                {#each hub.panes()[id].overlays as ov, i}
                    <LegendLine gridId={id}
                                {props} {layout} {ov} />
                {/each}
            {/if}

            {#if hub.panes().length > 1 || showLegendToggle()}
                <div class="legend-tools">
                    {#if hub.panes().length > 1}
                        <span class="pm-btn" class:off={main || id === 0 || id - 1 === mainIdx()}
                              title="move pane up"
                              on:click|stopPropagation={() => movePane(-1)}>▲</span>
                        <span class="pm-btn" class:off={main || id === hub.panes().length - 1 || id + 1 === mainIdx()}
                              title="move pane down"
                              on:click|stopPropagation={() => movePane(1)}>▼</span>
                    {/if}
                    {#if showLegendToggle()}
                        <div class="legend-header {collapsed ? 'collapsed' : ''}" on:click={toggleCollapse}>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"
                                 class="w-6 h-6">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/>
                            </svg>
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    {/if}
{/key}
