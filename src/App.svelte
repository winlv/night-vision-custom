<!-- App.svelte — manual dev/test page.
     Left toolbar groups the things worth exercising by hand (drawing tools,
     scale modes, datasets, indicators) and a Perf HUD (top-right) shows live
     FPS + how often each canvas repaints. The HUD's "main paints" counter is
     the visual check for Phase 1.1: while only moving the mouse it should stay
     ~0 once the crosshair is split onto its own canvas.
     See docs/PHASE1_PLAN.md (Phase 1.0). -->
<script>
    import {NightVision, Utils} from './index.js'
    import {onMount} from 'svelte'
    import perf from './stuff/perf.js'
    import data from '../data/data-ohlcv-rsi.json?id=main'
    import TestStack from '../tests/testStack.js'

    // Console test groups (kept — drive via `stack.exec('<group>')`)
    import fullReset from '../tests/data-sync/fullReset.js'
    import paneAddRem from '../tests/data-sync/paneAddRem.js'
    import ovAddRem from '../tests/data-sync/ovAddRem.js'
    import realTime from '../tests/real-time/realTime.js'
    import indicators from '../tests/indicators/indicators.js'
    import logScaleTest from '../tests/scales/logScale.js'

    let stack = new TestStack()
    let chart = null

    // --- Toolbar / UI state ---
    let activeTool = 'Cursor'
    let magnet = false
    let scaleMode = 'linear'
    let chartType = 'Candles'
    let useGpu = false  // GpuCandles (WebGL) prototype vs Canvas-2D candles
    let rawOHLC = null  // time-based source series, preserved across type switches
    let baseIndexBased = true  // the dataset's natural index/time mode
    let realtime = false
    let rtTimer = null
    let dataLabel = 'rsi ~1k (default)'

    // --- Object tree state (Phase 3.4) ---
    let treeRefresh = 0
    let showTree = true

    // --- Perf HUD state ---
    let fps = 0
    let mainPaints = 0      // main-canvas repaints in the last sample window
    let overlayPaints = 0   // crosshair/overlay-canvas repaints (after Phase 1.1)
    let hudRaf = null

    // Drawing tools wired to the `tool-selected` event.
    const TOOLS = [
        ['Cursor', 'cursor'],
        ['LineTool', 'trend line'],
        ['LineToolHorizontalRay', 'h-ray'],
        ['TrendRay', 'ray'],
        ['Rectangle', 'rectangle'],
        ['Circle', 'circle'],
        ['Brush', 'brush'],
        ['FibRetracement', 'fib'],
        ['LongShortPosition', 'long'],
        ['ShortLongPosition', 'short'],
        ['RangeTool', 'measure'],
        ['Text', 'text'],
        ['ParallelChannel', 'channel'],
        ['VolumeProfileRange', 'VP range'],
    ]

    const INDICATORS = [
        ['SMA', { length: 20 }, false],
        ['EMA', { length: 20 }, false],
        ['BB', { length: 21, mult: 2 }, false],
        ['RSI', { length: 14 }, true],
        ['MACD', {}, true],
    ]

    onMount(() => {
        chart = new NightVision('chart-container', {
            data: data,
            timezone: new Date().getTimezoneOffset() / -60,
            autoResize: true,
            indexBased: true,
            scrollLock: true,
            id: 'test',
            config: {
                ZOOM_MODE: 'tl',
                SCROLL_WHEEL: 'prevent',
                scrollLock: true,
                SBMAX: 500,
                MAX_ZOOM: Infinity,
                MIN_ZOOM: 5,
                DEFAULT_LEN: 250,
                DRAW_SIGNAL_LEVEL_BUTTON: false,
                meta: { scrollLock: true },
            },
            meta: { scrollLock: true },
        })

        try { chart.meta.initHeatmap('test') } catch (e) { /* heatmap optional */ }

        // Make the Parallel Channel tool available (not pre-loaded in the dataset).
        chart.data.panes[0].overlays.push({
            name: 'ParallelChannel', type: 'ParallelChannel',
            data: [], props: {}, settings: { zIndex: 1 }, drawingTool: true
        })
        chart.update()

        window.chart = chart
        window.stack = stack
        captureRaw()

        // Track active tool / magnet for toolbar highlighting.
        chart.events.on('meta:tool-changed', (e) => {
            activeTool = e.tool
            magnet = e.magnet
        })

        // Register console test groups (optional, non-UI).
        stack.setGroup('data-sync')
        fullReset(stack, chart); paneAddRem(stack, chart); ovAddRem(stack, chart)
        stack.setGroup('real-time'); realTime(stack, chart)
        stack.setGroup('ind-test'); indicators(stack, chart)
        stack.setGroup('scales-test'); logScaleTest(stack, chart)

        document.querySelector('#chart-container')
            .addEventListener('mousewheel', (event) => {
                event.preventDefault(); event.stopPropagation()
            })

        startHud()
        return () => { stopHud(); stopRealtime() }
    })

    // --- Toolbar handlers ---

    function selectTool(type) {
        if (type === 'Remove') { chart.meta.removeTool(); return }
        chart.events.emit('tool-selected', { type })
    }

    function toggleMagnet() {
        chart.events.emit('tool-selected', { type: 'Magnet' })
    }

    // --- Object tree (Phase 3.4): list overlays + drawing objects ---

    function buildTree() {
        if (!chart || !chart.data || !chart.data.panes) return []
        const nodes = []
        for (const pane of chart.data.panes) {
            for (const ov of (pane.overlays || [])) {
                const objects = []
                const seen = new Set()
                const collect = (arr) => {
                    if (Array.isArray(arr)) for (const it of arr)
                        if (it && it.uuid && !seen.has(it.uuid)) { seen.add(it.uuid); objects.push(it) }
                }
                if (ov.drawingTool) {
                    collect(ov.data)
                    if (ov.dataExt) for (const k in ov.dataExt) collect(ov.dataExt[k])
                }
                // Show price/indicator overlays always; tool overlays only if used.
                if (!ov.drawingTool || objects.length) {
                    nodes.push({
                        paneId: pane.id, ovRef: ov,
                        name: ov.name || ov.type, type: ov.type,
                        display: ov.settings?.display !== false,
                        drawingTool: !!ov.drawingTool,
                        objects,
                    })
                }
            }
        }
        return nodes
    }

    function toggleOverlay(node) {
        const ov = node.ovRef
        ov.settings = ov.settings || {}
        ov.settings.display = ov.settings.display === false ? true : false
        chart.update('layout')
        treeRefresh++
    }

    function deleteObject(uuid) {
        chart.meta.removeTool(uuid)   // clears data + dataExt + re-renders
        treeRefresh++
    }

    function selectObject(node, uuid) {
        chart.events.emit('object-selected', { id: uuid, type: node.type })
    }

    // Per-object hide/lock. The flag lives on the shape data object (shared ref
    // with the tool's shape instance), so toggling it is respected immediately:
    // shape classes skip draw when `hidden` and skip interaction when `locked`.
    function toggleObjHidden(node, obj) {
        obj.hidden = !obj.hidden
        persistObj(node)
    }
    function toggleObjLocked(node, obj) {
        obj.locked = !obj.locked
        persistObj(node)
    }
    function persistObj(node) {
        // The hidden/locked flag is mutated on the shared shape object, so a
        // redraw is enough to apply it. We must NOT emit 'change-tool-data'
        // with ov.dataExt — that's an OBJECT, and metaHub.changeToolData would
        // assign it to ov.data, breaking tool yRange's `$core.data.slice(...)`.
        chart.update('layout')
        treeRefresh++
    }

    function mainOverlay() {
        const ovs = chart.data.panes[0].overlays
        return ovs.find(o => o.main) || ovs[0]
    }

    // Snapshot the current time-based series so chart-type switches can rebuild
    // from the original (Renko/Range bars replace the series + go index-based).
    function captureRaw() {
        rawOHLC = mainOverlay().data
        baseIndexBased = chart.indexBased
    }

    // Brick/range size auto-derived from average close-to-close move.
    function autoBrick(data) {
        if (!data || data.length < 2) return 1
        let sum = 0
        for (let i = 1; i < data.length; i++) sum += Math.abs(data[i][4] - data[i-1][4])
        return (sum / (data.length - 1)) * 5 || data[0][4] * 0.005
    }

    function setChartType(type) {
        chartType = type
        if (useGpu) { useGpu = false; chart.meta.destroyGpuCandles() }
        const ov = mainOverlay()
        if (type === 'Candles' || type === 'HeikinAshi') {
            ov.type = type            // both render the raw time-based OHLCV
            ov.data = rawOHLC
            chart.indexBased = baseIndexBased
        } else if (type === 'Renko') {
            ov.type = 'Candles'       // bricks rendered as box candles
            ov.data = Utils.renko(rawOHLC, autoBrick(rawOHLC))
            chart.indexBased = true
        } else if (type === 'RangeBars') {
            ov.type = 'Candles'
            ov.data = Utils.rangeBars(rawOHLC, autoBrick(rawOHLC))
            chart.indexBased = true
        }
        chart.fullReset()
        chart.se.uploadAndExec()
    }

    // GpuCandles prototype A/B toggle. Swaps the main overlay between the
    // Canvas-2D `Candles` and the WebGL `GpuCandles` (which lazily creates its
    // GPU overlay instance on first draw via $core.meta.initGpuCandles).
    function toggleGpuCandles() {
        useGpu = !useGpu
        const ov = mainOverlay()
        ov.type = useGpu ? 'GpuCandles' : 'Candles'
        ov.data = rawOHLC
        chart.indexBased = baseIndexBased
        chartType = 'Candles'   // reset the chart-type highlight
        if (useGpu) chart.meta.initGpuCandles(chart.id)
        else chart.meta.destroyGpuCandles()
        chart.fullReset()
        chart.se.uploadAndExec()
    }

    function setScale(mode) {
        scaleMode = mode
        for (const p of chart.data.panes) {
            p.settings = p.settings || {}
            p.settings.scales = p.settings.scales || {}
            p.settings.scales.A = { ...(p.settings.scales.A || {}), log: mode === 'log' }
        }
        chart.fullReset()
        chart.se.uploadAndExec()
    }

    function addIndicator([type, props, offchart]) {
        if (offchart) {
            chart.data.panes.push({ overlays: [], scripts: [{ type, props }] })
        } else {
            const p = chart.data.panes[0]
            p.scripts = p.scripts || []
            p.scripts.push({ type, props })
        }
        chart.fullReset()
        chart.se.uploadAndExec()
    }

    // --- Datasets ---

    async function loadData(kind) {
        let d, label
        if (kind === 'small') {
            d = (await import('../data/data-ohlcv-rsi.json')).default; label = 'small ~1k'
            chart.indexBased = false
        } else if (kind === 'medium') {
            d = (await import('../data/data-scales.json')).default; label = 'medium ~4k (2 panes)'
            chart.indexBased = false
        } else if (kind === 'large') {
            d = { panes: [{ overlays: [{ name: 'Synthetic 100k', type: 'Candles', data: genCandles(100000) }] }] }
            label = 'synthetic 100k'; chart.indexBased = false
        } else if (kind === '3panes') {
            d = (await import('../data/data-3panes.json')).default; label = '3 panes (RSI+MACD)'
            chart.indexBased = false
        } else if (kind === '4panes') {
            d = (await import('../data/data-4panes.json')).default; label = '4 panes (RSI+MACD+Stoch)'
            chart.indexBased = false
        }
        dataLabel = label
        scaleMode = 'linear'
        chartType = 'Candles'
        chart.data = structuredClone(d)
        chart.fullReset()
        chart.se.uploadAndExec()
        captureRaw()
    }

    // Random-walk OHLCV — a real large dataset for FPS testing.
    function genCandles(n, interval = 60_000) {
        const out = []
        let t = Date.now() - n * interval
        let price = 100
        for (let i = 0; i < n; i++) {
            const o = price
            const c = o * (1 + (Math.random() - 0.5) * 0.02)
            const h = Math.max(o, c) * (1 + Math.random() * 0.006)
            const l = Math.min(o, c) * (1 - Math.random() * 0.006)
            const v = 100 + Math.random() * 900
            out.push([t, o, h, l, c, v])
            price = c
            t += interval
        }
        return out
    }

    // --- Real-time append (drives steady-state FPS) ---

    function toggleRealtime() {
        realtime = !realtime
        if (realtime) {
            rtTimer = setInterval(() => {
                try {
                    const ov = chart.hub.mainOv
                    const d = ov.data
                    const last = d[d.length - 1]
                    if (!last) return
                    const interval = chart.scan.interval
                    const o = last[4]
                    const c = o * (1 + (Math.random() - 0.5) * 0.01)
                    d.push([last[0] + interval, o,
                        Math.max(o, c) * 1.002, Math.min(o, c) * 0.998, c, 500])
                    chart.update('data')
                } catch (e) { /* ignore transient */ }
            }, 400)
        } else stopRealtime()
    }

    function stopRealtime() {
        if (rtTimer) { clearInterval(rtTimer); rtTimer = null }
        realtime = false
    }

    function redraw() {
        chart.destroy()
        chart = undefined
        setTimeout(() => location.reload(), 200)
    }

    // --- Perf HUD loop ---

    function startHud() {
        let last = performance.now()
        let frames = 0, acc = 0
        let baseMain = perf.byCtx['Canvas'] || 0
        let baseOv = perf.byCtx['Overlay'] || 0
        const tick = (now) => {
            const dt = now - last; last = now
            frames++; acc += dt
            if (acc >= 500) {
                fps = Math.round((frames * 1000) / acc)
                mainPaints = (perf.byCtx['Canvas'] || 0) - baseMain
                overlayPaints = (perf.byCtx['Overlay'] || 0) - baseOv
                baseMain = perf.byCtx['Canvas'] || 0
                baseOv = perf.byCtx['Overlay'] || 0
                frames = 0; acc = 0
                treeRefresh++ // keep the object tree fresh (cheap rebuild)
            }
            hudRaf = requestAnimationFrame(tick)
        }
        hudRaf = requestAnimationFrame(tick)
    }

    function stopHud() {
        if (hudRaf) cancelAnimationFrame(hudRaf)
        hudRaf = null
    }

    // Rebuilds when treeRefresh bumps (HUD tick / toolbar actions).
    $: tree = (chart && treeRefresh >= 0) ? buildTree() : []

    document.addEventListener('contextmenu', (event) => {
        event.preventDefault(); event.stopPropagation()
    })
</script>

<div class="app">
    <div class="toolbar">
        <div class="grp-title">Tools</div>
        {#each TOOLS as [type, label]}
            <button class:active={activeTool === type}
                    on:click={() => selectTool(type)}>{label}</button>
        {/each}
        <button class:active={magnet} on:click={toggleMagnet}>magnet</button>
        <button on:click={() => selectTool('Remove')}>remove</button>

        <div class="grp-title">Chart type</div>
        <button class:active={chartType === 'Candles'} on:click={() => setChartType('Candles')}>candles</button>
        <button class:active={chartType === 'HeikinAshi'} on:click={() => setChartType('HeikinAshi')}>heikin ashi</button>
        <button class:active={chartType === 'Renko'} on:click={() => setChartType('Renko')}>renko</button>
        <button class:active={chartType === 'RangeBars'} on:click={() => setChartType('RangeBars')}>range bars</button>

        <div class="grp-title">GPU (proto)</div>
        <button class:active={useGpu} on:click={toggleGpuCandles}>{useGpu ? '⚡ GPU candles ON' : 'GPU candles OFF'}</button>

        <div class="grp-title">Scale</div>
        <button class:active={scaleMode === 'linear'} on:click={() => setScale('linear')}>linear</button>
        <button class:active={scaleMode === 'log'} on:click={() => setScale('log')}>log</button>

        <div class="grp-title">Data</div>
        <button on:click={() => loadData('small')}>small 1k</button>
        <button on:click={() => loadData('medium')}>medium 4k</button>
        <button on:click={() => loadData('large')}>large 100k</button>
        <button on:click={() => loadData('3panes')}>3 panes</button>
        <button on:click={() => loadData('4panes')}>4 panes</button>
        <button class:active={realtime} on:click={toggleRealtime}>{realtime ? '⏸ realtime' : '▶ realtime'}</button>

        <div class="grp-title">Indicators</div>
        {#each INDICATORS as ind}
            <button on:click={() => addIndicator(ind)}>+ {ind[0]}</button>
        {/each}

        <div class="grp-title">Misc</div>
        <button on:click={redraw}>destroy+reload</button>
    </div>

    <div id="chart-container">
        <canvas id="heatmapCanvas" style="position:absolute; top:0; left:0;"></canvas>
    </div>

    <div class="hud">
        <div class="hud-row"><span>FPS</span><b class:warn={fps && fps < 50}>{fps}</b></div>
        <div class="hud-row"><span>main paints /0.5s</span><b class:warn={mainPaints > 30}>{mainPaints}</b></div>
        <div class="hud-row"><span>overlay paints /0.5s</span><b>{overlayPaints}</b></div>
        <div class="hud-row"><span>dataset</span><b class="sm">{dataLabel}</b></div>
    </div>

    <div class="tree">
        <div class="tree-head" on:click={() => showTree = !showTree}>
            <span>Objects ({tree.length})</span><span>{showTree ? '▾' : '▸'}</span>
        </div>
        {#if showTree}
            <div class="tree-body">
                {#each tree as node}
                    <div class="tree-node">
                        <span class="eye" title="show / hide"
                              on:click|stopPropagation={() => toggleOverlay(node)}>{node.display ? '◉' : '○'}</span>
                        <span class="nm" class:dim={!node.display}>{node.name}</span>
                        <span class="ty">{node.type}</span>
                    </div>
                    {#each node.objects as obj}
                        <div class="tree-obj">
                            <span class="o-btn" class:on={obj.hidden} title="hide"
                                  on:click={() => toggleObjHidden(node, obj)}>H</span>
                            <span class="o-btn" class:on={obj.locked} title="lock"
                                  on:click={() => toggleObjLocked(node, obj)}>L</span>
                            <span class="obj-sel" class:dim={obj.hidden}
                                  on:click={() => selectObject(node, obj.uuid)}>{node.type} · {obj.uuid.slice(0, 6)}</span>
                            <span class="del" title="delete" on:click={() => deleteObject(obj.uuid)}>✕</span>
                        </div>
                    {/each}
                {/each}
                {#if !tree.length}<div class="tree-empty">— no overlays —</div>{/if}
            </div>
        {/if}
    </div>
</div>

<style>
    :global(body) { margin: 0; }
    .app {
        width: 100vw; height: 100vh; margin: 0 auto;
        position: relative; overflow: hidden;
    }
    .toolbar {
        position: absolute; left: 0; top: 0;
        width: 120px; height: 100%;
        background: #0f1015; overflow-y: auto;
        padding: 4px; box-sizing: border-box;
        font: 11px monospace; z-index: 5;
    }
    .grp-title {
        color: #5f6a76; text-transform: uppercase; font-size: 9px;
        margin: 10px 2px 3px; letter-spacing: 0.5px;
    }
    .toolbar button {
        display: block; width: 100%; text-align: left;
        background: #16181f; color: #cfd2d6; border: 1px solid #23272f;
        padding: 4px 6px; margin: 2px 0; cursor: pointer;
        border-radius: 3px; font: 11px monospace;
    }
    .toolbar button:hover { background: #1e222b; }
    .toolbar button.active { border-color: #41a376; color: #41a376; }
    #chart-container {
        position: absolute; left: 120px; top: 0;
        width: calc(100% - 120px); height: 100%;
    }
    .hud {
        position: absolute; right: 8px; top: 8px; z-index: 6;
        background: #0f1015dd; border: 1px solid #23272f; border-radius: 4px;
        padding: 6px 8px; font: 11px monospace; color: #adb3ba;
        min-width: 150px; pointer-events: none;
    }
    .hud-row { display: flex; justify-content: space-between; gap: 10px; padding: 1px 0; }
    .hud-row b { color: #dedddd; }
    .hud-row b.sm { font-weight: normal; font-size: 10px; color: #818989; }
    .hud-row b.warn { color: #de4646; }

    .tree {
        position: absolute; right: 8px; top: 120px; z-index: 6;
        width: 190px; max-height: calc(100% - 140px); overflow-y: auto;
        background: #0f1015ee; border: 1px solid #23272f; border-radius: 4px;
        font: 11px monospace; color: #adb3ba;
    }
    .tree-head {
        display: flex; justify-content: space-between; cursor: pointer;
        padding: 5px 8px; color: #7f8a96; text-transform: uppercase;
        font-size: 10px; border-bottom: 1px solid #23272f; user-select: none;
    }
    .tree-body { padding: 3px 0; }
    .tree-node {
        display: flex; align-items: center; gap: 5px; padding: 2px 8px;
    }
    .tree-node .eye { cursor: pointer; color: #41a376; width: 12px; }
    .tree-node .nm { color: #dedddd; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tree-node .nm.dim { color: #5f6a76; }
    .tree-node .ty { color: #5f6a76; font-size: 9px; }
    .tree-obj {
        display: flex; align-items: center; justify-content: space-between;
        padding: 1px 8px 1px 22px; color: #818989;
    }
    .tree-obj .obj-sel { cursor: pointer; flex: 1; }
    .tree-obj .obj-sel:hover { color: #dedddd; }
    .tree-obj .obj-sel.dim { color: #4a525c; }
    .tree-obj .o-btn {
        cursor: pointer; width: 11px; text-align: center; color: #4a525c;
        border: 1px solid transparent; border-radius: 2px; font-size: 10px;
    }
    .tree-obj .o-btn:hover { color: #adb3ba; }
    .tree-obj .o-btn.on { color: #dc9800; border-color: #5a4a20; }
    .tree-obj .del { cursor: pointer; color: #80535a; padding: 0 2px; }
    .tree-obj .del:hover { color: #de4646; }
    .tree-empty { padding: 4px 8px; color: #5f6a76; }
</style>
