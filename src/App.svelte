<!-- App.svelte -->
<script>
    import math from "./stuff/math.js";

    import.meta.hot
    import {NightVision} from './index.js'
    import {onMount} from 'svelte'
    // import data from '../data/data-ohlcv.json?id=main'
    import data from '../data/data-ohlcv-rsi.json?id=main'
    import data2 from '../data/data-area.json?id=main-2'
    // import data3 from '../data/data-aapl.json?id=main-3'
    import TestStack from '../tests/testStack.js'


    // Tests
    import fullReset from '../tests/data-sync/fullReset.js'
    import paneAddRem from '../tests/data-sync/paneAddRem.js'
    import paneSettings from '../tests/data-sync/paneSettings.js'
    import ovAddRem from '../tests/data-sync/ovAddRem.js'
    import scaleChange from '../tests/data-sync/scaleChange.js'
    import mainOverlay from '../tests/data-sync/mainOverlay.js'
    import ovSettings from '../tests/data-sync/ovSettings.js'
    import ovPropsChange from '../tests/data-sync/ovPropsChange.js'
    import ovDataChange from '../tests/data-sync/ovDataChange.js'
    import Math2 from './stuff/math.js';

    // More tests
    import realTime from '../tests/real-time/realTime.js'

    // More tests
    import timeBased from '../tests/tfs-test/allTimeBased.js'
    import indexBased from '../tests/tfs-test/allIndexBased.js'

    // More tests
    import indicators from '../tests/indicators/indicators.js'
    import rangeTool from '../tests/tools/rangeTool.js'
    import lineTool from '../tests/tools/lineTool.js'
    import watchPropTest from '../tests/navy/watchPropTest.js'

    // More tests
    import logScaleTest from '../tests/scales/logScale.js'

    /*
    TODO: data-api interface:
    .getPanes()
    .getAllOverlays()
    .pane('main').getRenderers()
    .pane(0).getOverlay('<name>').getRenderer() // id
    ...
    */

    // TODO: Memory leak tests

    let stack = new TestStack()
    let chart = null

    //data.indexBased = true

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
                DEFAULT_LEN: 250,
                meta: {
                    scrollLock: true
                }
            },
            meta: {
                scrollLock: true
            },
        })

        chart.meta.initHeatmap('test');

        // chart.meta.scrollLock = true;
        // chart.data = data3
        window.chart = chart
        window.stack = stack

        stack.setGroup('data-sync')

        fullReset(stack, chart)
        paneAddRem(stack, chart)
        paneSettings(stack, chart)
        ovAddRem(stack, chart)
        scaleChange(stack, chart)
        mainOverlay(stack, chart)
        ovSettings(stack, chart)
        ovPropsChange(stack, chart)
        ovDataChange(stack, chart)

        stack.setGroup('real-time')

        realTime(stack, chart)

        stack.setGroup('tfs-test')

        timeBased(stack, chart)
        indexBased(stack, chart)

        stack.setGroup('ind-test')

        indicators(stack, chart)

        stack.setGroup('tools-test')

        rangeTool(stack, chart)
        lineTool(stack, chart)

        stack.setGroup('navy-test')

        watchPropTest(stack, chart)

        stack.setGroup('scales-test')

        logScaleTest(stack, chart)

        //  Type in the console: stack.execAll()
        //  or: stack.exec('<group>')

    })

    function onClick(type) {
        chart.events.emit('tool-selected', {type});
    }

</script>
<style>
    .app {
        width: 100vw;
        height: 100vh;
        margin: 0 auto;
        position: relative;
        overflow: hidden;
    }

    .toolbar {
        position: absolute;
        left: 0;
        width: 100px;
        height: 100%;
        background: #000;
    }

    .toolbar ul {
        margin: 0;
        padding: 0;
    }

    .toolbar li {
        list-style: none;
        cursor: pointer;
        background-color: #151414;
        padding: 5px;
    }

    #chart-container {
        position: absolute;
        width: calc(100% - 100px);
        left: 100px;
        height: 100%;
    }
</style>

<div class="app">
    <div class="toolbar">
        <ul>
            <li on:click={() => onClick('Cursor')}>cursor</li>
            <li on:click={() => onClick('Brush')}>brush</li>
            <li on:click={() => onClick('LineTool')}>segment</li>
            <li on:click={() => onClick('LineToolHorizontalRay')}>ray</li>
            <li on:click={() => onClick('Rectangle')}>rectangle</li>
            <li on:click={() => onClick('RangeTool')}>measure</li>
            <li>magnet</li>
        </ul>
    </div>
    <div id="chart-container"></div>
</div>
