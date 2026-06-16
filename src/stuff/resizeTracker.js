// Track chart container boundraries & update
// the chart props

export default function resizeTracker(chart) {

    const resizeObserver = new ResizeObserver((entries) => {
        // Chart may have been destroyed between the resize firing and
        // this callback running — bail out instead of poking a dead comp.
        if (!chart.comp || !chart.root) return
        let rect = chart.root.getBoundingClientRect()
        chart.width = rect.width
        chart.height = rect.height
    })
    resizeObserver.observe(chart.root)

    // Disconnect handle — call on chart.destroy() to stop the observer.
    return () => resizeObserver.disconnect()
}
