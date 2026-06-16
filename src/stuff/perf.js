// Lightweight render perf counters for the dev Perf HUD and for verifying
// Phase 1 (e.g. that a mouse move stops repainting the main canvas).
//
// Always-on but a single integer increment per draw — negligible cost.
// Exposed as `window.__nvPerf` so the dev page / Playwright can read it.

const perf = {
    draws: 0,              // total renderer draws since load
    byCtx: {},             // draws keyed by renderer ctxType ('Canvas', 'Overlay', ...)

    countDraw(ctxType) {
        this.draws++
        const k = ctxType || 'Canvas'
        this.byCtx[k] = (this.byCtx[k] || 0) + 1
    },

    reset() {
        this.draws = 0
        this.byCtx = {}
    },
}

if (typeof window !== 'undefined') window.__nvPerf = perf

export default perf
