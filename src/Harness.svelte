<!-- Smoke-harness UI.
     Exercises the chart across overlay/indicator types, scale modes and
     mount/unmount cycles, and reports leak/error signals. The goal is a
     fast manual regression check while the renderer is refactored. -->
<script>
    import { NightVision } from './index.js'
    import { onMount } from 'svelte'
    import { snapshot, listenerBreakdown, resetCounters } from './harness/probes.js'

    import baseData from '../data/data-ohlcv-rsi.json?id=harness'

    // All per-indicator datasets (candles + one indicator overlay each).
    const INDICATOR_FILES = import.meta.glob(
        '../data/indicators/*.json', { eager: true })
    const INDICATORS = {}
    for (const path in INDICATOR_FILES) {
        const name = path.split('/').pop().split('-')[0]
        INDICATORS[name] = INDICATOR_FILES[path].default
    }
    const indicatorNames = Object.keys(INDICATORS).sort()

    const CONTAINER = 'harness-chart'

    let chart = null
    let log = false
    let status = null
    let breakdown = []
    let messages = []
    let running = false
    let nanReport = null
    let activeIndicator = ''

    function logMsg(m) {
        messages = [`${new Date().toISOString().slice(11, 19)}  ${m}`, ...messages].slice(0, 40)
    }

    function chartConfig() {
        return {
            data: structuredClone(baseData),
            autoResize: true,
            id: 'harness',
            config: {
                DEFAULT_LEN: 200,
            },
        }
    }

    function mountChart() {
        chart = new NightVision(CONTAINER, chartConfig())
        window.chart = chart
    }

    function destroyChart() {
        if (chart) {
            chart.destroy()
            chart = null
        }
    }

    function refresh() {
        status = snapshot()
        breakdown = listenerBreakdown()
    }

    onMount(() => {
        mountChart()
        refresh()
        logMsg('mounted')
        const t = setInterval(refresh, 500)
        return () => { clearInterval(t); destroyChart() }
    })

    function loadIndicator(name) {
        if (!chart) return
        activeIndicator = name
        chart.data = structuredClone(INDICATORS[name])
        applyLog()
        chart.fullReset()
        chart.se.uploadAndExec()
        logMsg(`indicator: ${name}`)
        setTimeout(scanNaN, 600)
    }

    function applyLog() {
        if (!chart || !chart.data.panes || !chart.data.panes[0]) return
        const p = chart.data.panes[0]
        p.settings = p.settings || {}
        p.settings.scales = p.settings.scales || {}
        p.settings.scales.A = { ...(p.settings.scales.A || {}), log }
    }

    function toggleLog() {
        log = !log
        applyLog()
        chart.fullReset()
        chart.se.uploadAndExec()
        logMsg(`scale: ${log ? 'LOG' : 'linear'}`)
    }

    // Scan rendered overlay data for NaN / non-finite numbers — catches
    // broken std functions (floor/pow) producing garbage indicator output.
    function scanNaN() {
        if (!chart || !chart.data.panes) return
        let bad = 0, scanned = 0, where = []
        for (const pane of chart.data.panes) {
            for (const ov of (pane.overlays || [])) {
                const rows = ov.data || []
                for (const row of rows) {
                    if (!Array.isArray(row)) continue
                    for (let k = 1; k < row.length; k++) {
                        const v = row[k]
                        if (typeof v === 'number') {
                            scanned++
                            if (!Number.isFinite(v)) {
                                bad++
                                if (where.length < 5) where.push(`${ov.name}[${k}]=${v}`)
                            }
                        }
                    }
                }
            }
        }
        nanReport = { bad, scanned, where }
        if (bad) logMsg(`NaN/Inf found: ${bad} (${where.join(', ')})`)
    }

    async function showcaseAll() {
        if (running) return
        running = true
        resetCounters()
        for (const name of indicatorNames) {
            loadIndicator(name)
            await new Promise(r => setTimeout(r, 350))
        }
        running = false
        logMsg(`showcase done — errors: ${snapshot().consoleErrors}, warns: ${snapshot().consoleWarns}`)
    }

    async function stress(n = 50) {
        if (running) return
        running = true
        resetCounters()
        const before = snapshot()
        logMsg(`stress ×${n} start — netListeners=${before.netListeners}`)
        for (let i = 0; i < n; i++) {
            destroyChart()
            await new Promise(r => setTimeout(r, 20))
            mountChart()
            await new Promise(r => setTimeout(r, 40))
        }
        // Settle, then read.
        await new Promise(r => setTimeout(r, 300))
        const after = snapshot()
        const dListeners = after.netListeners - before.netListeners
        const dHeap = (before.heap != null && after.heap != null)
            ? ((after.heap - before.heap) / 1048576).toFixed(1) + ' MB' : 'n/a'
        logMsg(`stress done — Δlisteners=${dListeners} (per cycle ${(dListeners / n).toFixed(2)}), Δheap=${dHeap}`)
        running = false
        refresh()
    }
</script>

<div class="harness">
    <div class="panel">
        <h3>Smoke Harness</h3>

        <section>
            <h4>Scale</h4>
            <button on:click={toggleLog}>Toggle scale → {log ? 'LOG' : 'linear'}</button>
        </section>

        <section>
            <h4>Indicators ({indicatorNames.length})</h4>
            <div class="chips">
                {#each indicatorNames as name}
                    <button class:active={activeIndicator === name}
                            on:click={() => loadIndicator(name)}>{name}</button>
                {/each}
            </div>
            <button on:click={showcaseAll} disabled={running}>▶ Showcase all</button>
            <button on:click={scanNaN}>Scan NaN/Inf</button>
        </section>

        <section>
            <h4>Leak stress</h4>
            <button on:click={() => stress(25)} disabled={running}>Mount/unmount ×25</button>
            <button on:click={() => stress(50)} disabled={running}>×50</button>
        </section>

        <section>
            <h4>Status</h4>
            {#if status}
                <table>
                    <tr><td>net listeners</td><td>{status.netListeners}</td></tr>
                    <tr><td>window listeners</td><td>{status.windowListeners}</td></tr>
                    <tr><td>document listeners</td><td>{status.documentListeners}</td></tr>
                    <tr><td>adds / removes</td><td>{status.totalAdds} / {status.totalRemoves}</td></tr>
                    <tr class:bad={status.consoleErrors > 0}><td>console.error</td><td>{status.consoleErrors}</td></tr>
                    <tr><td>console.warn</td><td>{status.consoleWarns}</td></tr>
                    <tr class:bad={status.uncaught > 0}><td>uncaught</td><td>{status.uncaught}</td></tr>
                    <tr><td>heap</td><td>{status.heap != null ? (status.heap / 1048576).toFixed(1) + ' MB' : 'n/a'}</td></tr>
                </table>
            {/if}
            {#if nanReport}
                <p class:bad={nanReport.bad > 0}>
                    NaN scan: {nanReport.bad} bad / {nanReport.scanned} numbers
                </p>
            {/if}
        </section>

        <section>
            <h4>Listener breakdown</h4>
            <ul class="bk">
                {#each breakdown.slice(0, 8) as [label, n]}
                    <li>{label}: {n}</li>
                {/each}
            </ul>
        </section>

        <section>
            <h4>Log</h4>
            <ul class="msgs">
                {#each messages as m}<li>{m}</li>{/each}
            </ul>
        </section>
    </div>

    <div id={CONTAINER} class="chart"></div>
</div>

<style>
    :global(body) { margin: 0; background: #0c0d12; color: #cfd2d6; font: 12px monospace; }
    .harness { position: fixed; inset: 0; display: flex; }
    .panel { width: 320px; height: 100%; overflow-y: auto; padding: 10px;
        background: #14151c; box-sizing: border-box; border-right: 1px solid #2a2f38; }
    .chart { flex: 1; position: relative; }
    h3 { margin: 0 0 8px; }
    h4 { margin: 12px 0 4px; color: #7f8a96; text-transform: uppercase; font-size: 10px; }
    button { background: #1d2029; color: #cfd2d6; border: 1px solid #2a2f38;
        padding: 4px 7px; margin: 2px 2px 0 0; cursor: pointer; border-radius: 3px; font: 11px monospace; }
    button:hover { background: #262a35; }
    button.active { border-color: #41a376; color: #41a376; }
    button:disabled { opacity: 0.4; cursor: default; }
    .chips { display: flex; flex-wrap: wrap; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 1px 0; }
    td:last-child { text-align: right; color: #dedddd; }
    .bad td, .bad { color: #de4646; }
    ul { margin: 0; padding: 0; list-style: none; }
    .bk li, .msgs li { padding: 1px 0; color: #818989; }
    .msgs { max-height: 200px; overflow-y: auto; }
</style>
