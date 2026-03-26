// Container for y-transforms, meta functions, other info
// about overlays (e.g. yRange)

import Events from './events.js'
import DataHub from './dataHub.js'
import Heatmap from "./primitives/heatmap.js";

class MetaHub {

    constructor(nvId) {
        let events = Events.instance(nvId);
        this.hub = DataHub.instance(nvId)
        this.events = events

        // EVENT INTERFACE
        events.on('meta:sidebar-transform', this.onYTransform.bind(this))
        events.on('meta:select-overlay', this.onOverlaySelect.bind(this))
        events.on('meta:grid-mousedown', this.onGridMousedown.bind(this))
        events.on('meta:scroll-lock', this.onScrollLock.bind(this))
        events.on('meta:tool-selected', this.toolSelected.bind(this));
        events.on('meta:drawing-mode-off', this.drawingModeOff.bind(this));
        events.on('meta:change-tool-data', this.changeToolData.bind(this));
        events.on('meta:object-selected', this.objectSelected.bind(this));
        events.on('meta:remove-all-tools', this.removeAllTools.bind(this));
        events.on('meta:keyboard-keydown', this.handleKeyboardDown.bind(this));
        events.on('meta:keyboard-keyup', this.handleKeyboardUp.bind(this));

        this.storage = {};
        this.heatmap = undefined;

        this.tool = 'Cursor';
        this.drawingMode = false;
        this.selectedTool = undefined;
        this.magnet = false;
    }

    init(props, layout) {
        this.panes = 0 // Panes processed
        this.ready = false
        // [API] read-only
        this.legendFns = [] // Legend formatters
        this.yTransforms = [] // yTransforms of sidebars
        this.preSamplers = [] // Auto-precision samplers
        this.yRangeFns = [] // yRange functions of overlays
        this.autoPrecisions = [] // Auto-precision for overlays
        this.valueTrackers = [] // Price labels + price lines
        // TODO: legend formatters ...
        // TODO: last values
        this.selectedOverlay = undefined
        /* OHLC Map format: {
            timestamp: {
                ref: [], // Reference to n-th data item
                index: n // Item global index
            }, ...
        }*/
        this.ohlcMap = [] // time => OHLC map of the main ov
        this.ohlcFn = undefined // OHLC mapper function
        this.scrollLock = false // Scroll lock state
    }

    setTool(toolName) {
        if (this.tool === toolName && toolName !== 'Cursor' && toolName !== 'Brush') {
            this.tool = 'Cursor';
        } else {
            this.tool = toolName;
        }

        this.drawingMode = this.tool !== 'Cursor' && this.tool !== 'Magnet';

        if (this.tool === 'Magnet') {
            this.magnet = !this.magnet;
            this.tool = 'Cursor';
        }

        if (this.drawingMode) {
            this.objectSelected({ id: undefined });
        }

        this.events.emit('meta:tool-changed', {
            tool: this.tool,
            drawingMode: this.drawingMode,
            magnet: this.magnet
        });
    }

    handleKeyboardDown(event) {
        if (event.ctrlKey) {
            this.magnet = true;
        }
    }

    handleKeyboardUp(event) {
        this.magnet = false;
    }

    get isMagnetActive() {
        return this.magnet || this.magnet;
    }

    toolSelected = (event) => {
        this.setTool(event.type);
    }

    drawingModeOff = () => {
        this.tool = 'Cursor';
        this.drawingMode = false;
        this.toolSelected({type: 'Cursor'});
        this.events.emit('tool-changed', { tool: 'Cursor', drawingMode: false });
    }

    objectSelected = ({id}) => {
        this.selectedTool = id;

        const root = this.hub.se.chart.root;
        if (root) {
            if (id) {
                root.style.cursor = 'pointer';
            } else if (this.drawingMode) {
                root.style.cursor = 'crosshair';
            } else {
                root.style.cursor = 'default';
            }
        }
    }

    removeTool = (uuid) => {
        const pane = this.hub.data.panes[0];
        if (!pane) return;

        for (const drawingOverlay of pane.overlays) {
            if (drawingOverlay.drawingTool && drawingOverlay.data) {
                const idx = drawingOverlay.data.findIndex(d => d.uuid === uuid);
                if (idx !== -1) {
                    drawingOverlay.data.splice(idx, 1);
                    if (drawingOverlay.dataExt) {
                        for (let key in drawingOverlay.dataExt) {
                            if (Array.isArray(drawingOverlay.dataExt[key])) {
                                drawingOverlay.dataExt[key].splice(idx, 1);
                            }
                        }
                    }
                }
            }
        }

        this.events.emit('object-selected', {id: undefined});
        this.events.emitSpec('chart', 'update-layout');
        this.events.emit('commit-tool-changes');
    }

    initHeatmap(id) {
        this.heatmap = new Heatmap(id);
    }

    destroyHeatmap() {
        if (this.heatmap) {
            this.heatmap.destroy();
            this.heatmap = undefined;
        }
    }

    resetHeatmap() {
        this.heatmap.reset();
    }

    // User tapped grid (& deselected all overlays)
    onGridMousedown(event) {
        this.selectedOverlay = undefined
        this.events.emit('$overlay-select', {
            index: undefined,
            ov: undefined
        });
    }

    changeToolData = ({id, data}) => {
        const overlay = this.hub.data.panes[0].overlays.find(overlay => overlay.id === id);
        overlay.data = data ?? [];

        this.events.emit('commit-tool-changes');
    }

    removeAllTools = () => {
        for (const drawingOverlay of this.hub.data.panes[0].overlays) {
            if (drawingOverlay.drawingTool) {
                drawingOverlay.data = [];
                drawingOverlay.dataExt = {};
            }
        }

        this.drawingModeOff();
        this.events.emit('object-selected', {id: undefined});
        this.events.emitSpec('chart', 'update-layout');
        this.events.emit('commit-tool-changes');
    }

    // Extract meta functions from overlay
    exctractFrom(overlay) {
        let gridId = overlay.gridId()
        let id = overlay.id()

        // yRange functions
        var yrfs = this.yRangeFns[gridId] || []
        yrfs[id] = overlay.yRange ? {
            exec: overlay.yRange,
            preCalc: overlay.yRangePreCalc
        } : null

        // Precision samplers
        var aps = this.preSamplers[gridId] || []
        aps[id] = overlay.preSampler

        // Legend formatters
        var lfs = this.legendFns[gridId] || []
        lfs[id] = {
            legend: overlay.legend,
            legendHtml: overlay.legendHtml,
            noLegend: overlay.noLegend ?? false
        }

        // Value trackers
        var vts = this.valueTrackers[gridId] || []
        vts[id] = overlay.valueTracker

        // Ohlc mapper function
        let main = this.hub.overlay(gridId, id).main
        if (main) {
            this.ohlcFn = overlay.ohlc
        }

        this.yRangeFns[gridId] = yrfs
        this.preSamplers[gridId] = aps
        this.legendFns[gridId] = lfs
        this.valueTrackers[gridId] = vts

    }

    // Maps timestamp => ohlc, index
    // TODO: should add support for indexBased? 
    calcOhlcMap() {
        this.ohlcMap = {}
        let data = this.hub.mainOv.data
        for (var i = 0; i < data.length; i++) {
            this.ohlcMap[data[i][0]] = {
                ref: data[i],
                index: i
            }
        }
    }

    // Store auto precision for a specific overlay
    setAutoPrec(gridId, ovId, prec) {
        let aps = this.autoPrecisions[gridId] || []
        aps[ovId] = prec
        this.autoPrecisions[gridId] = aps
    }

    // Call this after all overlays are processed
    // We need to make an update to apply freshly
    // extracted functions
    // TODO: probably can do better
    finish() {
        this.panes++
        if (this.panes < this.hub.panes().length) return
        this.autoPrecisions = [] // wait for preSamplers
        //this.restore()
        this.calcOhlcMap()
        this.ready = true
        setTimeout(() => {
            this.events.emitSpec('chart', 'update-layout')
            this.events.emit('update-legend')
        })
    }

    // Store some meta info such as ytransform by
    // (pane.uuid + scaleId) hash
    store() {
        this.storage = {}
        let yts = this.yTransforms || []
        for (var paneId in yts) {
            let paneYts = yts[paneId]
            let pane = this.hub.panes()[paneId]
            if (!pane) continue
            for (var scaleId in paneYts) {
                let hash = `yts:${pane.uuid}:${scaleId}`
                this.storage[hash] = paneYts[scaleId]
            }
        }

    }

    // Restore that info after an update in the
    // pane/overlay order
    restore() {
        let yts = this.yTransforms
        for (var hash in this.storage) {
            let [type, uuid1, uuid2] = hash.split(':')
            let pane = this.hub.panes().find(x => x.uuid === uuid1)
            if (!pane) continue
            switch (type) {
                case 'yts': // Y-transforms
                    if (!yts[pane.id]) yts[pane.id] = []
                    yts[pane.id][uuid2] = this.storage[hash]
                    break
            }
        }
        this.store() // Store new state
    }

    // [API] Get y-transform of a specific scale
    getYtransform(gridId, scaleId) {
        return (this.yTransforms[gridId] || [])[scaleId]
    }

    // [API] Get auto precision of a specific overlay
    getAutoPrec(gridId, ovId) {
        return (this.autoPrecisions[gridId] || [])[ovId]
    }

    // [API] Get a precision smapler of a specific overlay
    getPreSampler(gridId, ovId) {
        return (this.preSamplers[gridId] || [])[ovId]
    }

    // [API] Get legend formatter of a specific overlay
    getLegendFns(gridId, ovId) {
        return (this.legendFns[gridId] || [])[ovId]
    }

    // [API] Get OHLC values to use as "magnet" values
    ohlc(t) {
        let el = this.ohlcMap[t]
        if (!el || !this.ohlcFn) return
        return this.ohlcFn(el.ref)
    }

    // EVENT HANDLERS
    // User changed y-range
    onYTransform(event) {
        let yts = this.yTransforms[event.gridId] || {}
        let tx = yts[event.scaleId] || {}
        yts[event.scaleId] = Object.assign(tx, event)
        this.yTransforms[event.gridId] = yts
        if (event.updateLayout) {
            this.events.emitSpec('chart', 'update-layout')
        }
        this.store()
    }

    // User tapped legend & selected the overlay
    onOverlaySelect(event) {
        this.selectedOverlay = event.index
        this.events.emit('$overlay-select', {
            index: event.index,
            ov: this.hub.overlay(...event.index)
        })
    }

    // Overlay/user set lock on scrolling
    onScrollLock(event) {
        this.scrollLock = event
    }
}


let instances = {}

function instance(id) {
    if (!instances[id]) {
        instances[id] = new MetaHub(id)
    }
    return instances[id]
}

export default {instance}
