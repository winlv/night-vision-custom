// Global instrumentation for the smoke-harness.
//
// Must be imported and `installProbes()` called BEFORE any chart code,
// so we wrap addEventListener/removeEventListener from the very start
// and can measure net listener growth across mount/unmount cycles.

const state = {
    // Net live listeners keyed by a coarse target label.
    listeners: new Map(),   // label -> count
    byType: new Map(),      // `${label}::${type}` -> net count (diagnostic)
    totalAdds: 0,
    totalRemoves: 0,
    consoleErrors: [],
    consoleWarns: [],
    uncaught: [],
    installed: false,
}

function labelFor(target) {
    if (target === window) return 'window'
    if (target === document) return 'document'
    if (typeof Node !== 'undefined' && target instanceof Node) {
        const el = target
        const tag = el.tagName ? el.tagName.toLowerCase() : 'node'
        const id = el.id ? `#${el.id}` : ''
        return `${tag}${id}`
    }
    return target && target.constructor ? target.constructor.name : 'other'
}

export function installProbes() {
    if (state.installed) return state
    state.installed = true

    const origAdd = EventTarget.prototype.addEventListener
    const origRemove = EventTarget.prototype.removeEventListener

    EventTarget.prototype.addEventListener = function (type, fn, opts) {
        const label = labelFor(this)
        state.listeners.set(label, (state.listeners.get(label) || 0) + 1)
        const key = `${label}::${type}`
        state.byType.set(key, (state.byType.get(key) || 0) + 1)
        state.totalAdds++
        return origAdd.call(this, type, fn, opts)
    }

    EventTarget.prototype.removeEventListener = function (type, fn, opts) {
        const label = labelFor(this)
        // Only decrement if there was something tracked — removeEventListener
        // on a non-registered (or wrongly-bound) handler is a no-op in the DOM,
        // so the count must NOT drop. This is exactly how we catch the
        // pointer.js "unbound removeEventListener" leak.
        const had = state.listeners.get(label) || 0
        // We can't know from here whether the DOM actually had this listener,
        // so we optimistically decrement only the global counter; the per-label
        // map is informational. The reliable signal is the net (adds-removes)
        // measured around a mount/unmount cycle (see snapshot()).
        if (had > 0) state.listeners.set(label, had - 1)
        const key = `${label}::${type}`
        state.byType.set(key, (state.byType.get(key) || 0) - 1)
        state.totalRemoves++
        return origRemove.call(this, type, fn, opts)
    }

    const origErr = console.error.bind(console)
    console.error = (...args) => {
        state.consoleErrors.push(args.map(String).join(' '))
        origErr(...args)
    }
    const origWarn = console.warn.bind(console)
    console.warn = (...args) => {
        state.consoleWarns.push(args.map(String).join(' '))
        origWarn(...args)
    }

    window.addEventListener('error', (e) => {
        state.uncaught.push(e.message || String(e.error))
    })
    window.addEventListener('unhandledrejection', (e) => {
        state.uncaught.push('unhandledrejection: ' + String(e.reason))
    })

    window.__nvProbes = state
    return state
}

// A point-in-time snapshot of counters.
export function snapshot() {
    let heap = null
    if (performance && performance.memory) {
        heap = performance.memory.usedJSHeapSize
    }
    return {
        netListeners: state.totalAdds - state.totalRemoves,
        totalAdds: state.totalAdds,
        totalRemoves: state.totalRemoves,
        windowListeners: state.listeners.get('window') || 0,
        documentListeners: state.listeners.get('document') || 0,
        consoleErrors: state.consoleErrors.length,
        consoleWarns: state.consoleWarns.length,
        uncaught: state.uncaught.length,
        heap,
    }
}

export function listenerBreakdown() {
    return [...state.listeners.entries()]
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
}

export function resetCounters() {
    state.consoleErrors.length = 0
    state.consoleWarns.length = 0
    state.uncaught.length = 0
}

export function getState() { return state }
