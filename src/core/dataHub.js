// Data container (original plus subset data)
// + Completes the structure to a full state
// + Implements various update operations.

import Utils from '../stuff/utils.js'
import Events from './events.js'
import SeClient from './se/seClient.js'
import DataView$ from './dataView.js'

class DataHub {

    constructor(nvId) {

        let events = Events.instance(nvId)
        let se = SeClient.instance(nvId)
        this.events = events
        this.se = se
        se.hub = this // Set a ref to the hub

        // EVENT INTERFACE
        events.on('hub:set-scale-index', this.onScaleIndex.bind(this))
        events.on('hub:display-overlay', this.onDisplayOv.bind(this))
        events.on('hub:pane-resize-start', this.onPaneResizeStart.bind(this))
        events.on('hub:pane-resize', this.onPaneResize.bind(this))
        events.on('hub:move-pane', this.onMovePane.bind(this))
        // Cache the latest full layout so pane-resize can read every pane's
        // current pixel height (needed to seed weights without a visual jump).
        events.on('hub:update-pane', l => this._lastLayout = l)

    }

    init(data) {

        // [API] All here are read-only

        // Data object
        this.data = data
        // Index based mode
        this.indexBased = data.indexBased ?? false

        this.chart = null // Pane with the main overlay (main pane)
        this.offchart = null // All other panes
        this.mainOv = null // Main overlay ref
        this.mainPaneId = null // Mane pane id
    }

    // Update data on 'range-changed'. Should apply
    // filters only (not updating the full structure)
    updateRange(range) {
        for (var pane of this.data.panes) {
            for (var ov of pane.overlays) {
                let off = ov.indexOffset
                ov.dataView = this.filter(ov.data, range, off)
                ov.dataSubset = ov.dataView.makeSubset()
            }
        }
    }

    // Calculate visible data section
    // (& completes the main structure)
    // TODO: smarter algo of adding/removing panes. Uuids
    // should remain the same if pane still exists
    calcSubset(range) {
        var paneId = 0
        for (var pane of this.data.panes || []) {
            pane.id = paneId++
            pane.overlays = pane.overlays || []
            pane.settings = pane.settings || {}
            var ovId = 0
            for (var ov of pane.overlays) {
                ov.id = ovId++
                ov.main = !!ov.main
                ov.data = ov.data || []
                ov.dataView = this.filter(
                    ov.data, range,
                    ov.indexOffset
                )
                ov.dataSubset = ov.dataView.makeSubset()
                ov.dataExt = ov.dataExt || {}
                ov.settings = ov.settings || {}
                ov.props = ov.props || {}
                ov.uuid = ov.uuid || Utils.uuid3()
            }
            // Flag that pane is ready for rendering
            pane.uuid = pane.uuid || Utils.uuid3()
        }
    }

    // Load indicator scripts
    async loadScripts(exec = false) {
        for (var pane of this.data.panes || []) {
            var scriptId = 0
            pane.scripts = pane.scripts || []
            for (var s of pane.scripts) {
                s.id = scriptId++
                s.settings = s.settings || {}
                s.props = s.props || {}
                s.uuid = s.uuid || Utils.uuid3()
            }
        }
        if (exec) {
            await Utils.pause(0) // Wait for init
            await this.se.uploadAndExec()
        }
    }

    // Detect the main chart, define offcharts
    detectMain() {

        // TODO: remove duplicate code here & in dataScanner
        let all = Utils.allOverlays(this.data.panes)
        let mainOv = all.find(x => x.main) || all[0]

        if (!all.length || !mainOv) return

        mainOv.main = true // If there is only one OV

        this.chart = this.data.panes.find(
            x => x.overlays.find(
                y => y.main
            )
        )

        this.offchart = this.data.panes.filter(
            x => x !== this.chart
        )

        this.mainOv = mainOv
        this.mainPaneId = this.panes().indexOf(this.chart)

        // Remove all 'main' overlays except the first
        for (var ov of all) {
            if (ov !== mainOv) ov.main = false
        }

    }

    // [API] Create a subset of timeseries
    filter(data, range, offset = 0) {
        let filter = this.indexBased ?
            Utils.fastFilterIB : Utils.fastFilter2
        var ix = filter(
            data,
            range[0] - offset,
            range[1] - offset
        )
        return new DataView$(data, ix[0], ix[1])
    }

    // [API] Get all active panes (with uuid)
    panes() {
        return (this.data.panes || []).filter(x =>
            x.uuid)
    }

    // [API] Get overlay ref by paneId & ovId
    overlay(paneId, ovId) {
        return this.panes()[paneId]?.overlays[ovId]
    }

    // [API] Get overlay data by paneId & ovId
    ovData(paneId, ovId) {
        return this.panes()[paneId]
            ?.overlays[ovId]?.data
    }

    // [API] Get overlay extra data by paneId & ovId
    ovDataExt(paneId, ovId) {
        return this.panes()[paneId]
            ?.overlays[ovId]?.dataExt
    }

    // [API] Get overlay data subset by paneId & ovId
    ovDataSubset(paneId, ovId) {
        return this.panes()[paneId]
            ?.overlays[ovId]?.dataSubset
    }

    // [API] Get All overlays
    allOverlays(type) {
        let all = Utils.allOverlays(this.data.panes)
        return type ? all.filter(x => x.type === type) : all
    }

    // Event handlers

    onScaleIndex(event) {

        let pane = this.panes()[event.paneId]
        if (!pane) return

        // Main scale index (that used for the grid)
        pane.settings.scaleIndex = event.index

        // Local left & right indices used to
        // display the correct Scale
        pane.settings.scaleSideIdxs = event.sideIdxs

        this.events.emitSpec('chart', 'update-layout')
    }

    onDisplayOv(event) {

        let pane = this.panes()[event.paneId]
        if (!pane) return

        let ov = pane.overlays[event.ovId]
        if (!ov) return

        ov.settings.display = event.flag

        // Legend-line id
        let llId = `${event.paneId}-${event.ovId}`

        this.events.emitSpec('chart', 'update-layout')
        this.events.emitSpec(`ll-${llId}`, 'update-ll')

    }



    // Called once when a resize gesture starts (mousedown on the handle).
    // Converts EVERY pane's `settings.height` to its current PIXEL height, so
    // the drag math below is in pixel space no matter what the heights held
    // before (auto/null, small relative weights, or pixels from a prior drag).
    // Re-seeding to pixels is render-neutral: weightedHs is proportional, so
    // pixel weights reproduce the exact same layout — no jump.
    onPaneResizeStart() {
        const panes = this.data.panes;
        const L = this._lastLayout;
        if (!panes || !L || !L.grids) return;
        if (L.grids.length !== panes.length) return; // stale layout — don't corrupt
        for (let i = 0; i < panes.length; i++) {
            const g = L.grids[i];
            if (g && g.height) panes[i].settings.height = g.height;
        }
    }

    // Resize the boundary between a pane and the one directly above it.
    // The resizer handle sits at the TOP edge of `pane`, so dragging it down
    // grows the pane ABOVE and shrinks `pane` (and vice-versa). Only the two
    // adjacent panes change — everything else stays put. Heights are in pixels
    // here (seeded by onPaneResizeStart), so the boundary tracks the cursor 1:1.
    onPaneResize(event) {
        const { paneId, deltaPx } = event;

        const panes = this.panes();
        const pane = panes[paneId];
        const above = panes[paneId - 1];
        if (!pane || !above) return;

        const ah = pane.settings.height, bh = above.settings.height;
        if (ah == null || bh == null) return; // gesture not seeded yet — bail

        const MIN = 28; // px — minimum pane height
        let d = deltaPx;
        // Clamp so neither adjacent pane drops below MIN (prevents "sticking"
        // where hitting the limit would abort the whole drag).
        d = Math.max(d, -(bh - MIN));
        d = Math.min(d, (ah - MIN));
        if (!d) return;

        above.settings.height = bh + d;
        pane.settings.height = ah - d;

        this.events.emitSpec('chart', 'update-layout');
    }

    // Reorder panes (move a pane up/down). Swaps the entries in data.panes;
    // the order change flips the panes-hash, so update() routes to a full
    // rebuild that re-indexes ids + remakes the grids in the new order.
    // Each pane keeps its own settings.height, so sizes travel with the pane.
    onMovePane(event) {
        const { paneId, dir } = event;
        const panes = this.data.panes;
        if (!panes) return;
        const j = paneId + dir;
        if (j < 0 || j >= panes.length) return;
        // The main (chart) pane stays fixed on top: never move it, and never
        // move another pane across it. Placing a sub-pane ABOVE the main pane
        // glitches the layout, so it's disallowed here (and disabled in the UI).
        const isMain = (pn) => pn && pn.overlays && pn.overlays.some(o => o.main);
        if (isMain(panes[paneId]) || isMain(panes[j])) return;
        const t = panes[paneId];
        panes[paneId] = panes[j];
        panes[j] = t;
        this.events.emitSpec('chart', 'update-layout');
    }

}

let instances = {}

function instance(id) {
    if (!instances[id]) {
        instances[id] = new DataHub(id)
    }
    return instances[id]
}

export default {instance}
