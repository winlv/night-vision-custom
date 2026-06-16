// Smoke-harness entry.
//
// Installs global instrumentation (listener + console-error counters)
// BEFORE any chart code runs, then mounts the Harness component.
// Used to catch regressions while refactoring the renderer (Phase 1).

import { installProbes } from './harness/probes.js'

installProbes()

import Harness from './Harness.svelte'

let app = new Harness({
    target: document.body
})

export default app
