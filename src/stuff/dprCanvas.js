
// Setup canvas element with DPI adjustment

import Utils from './utils.js'

function setup(id, w, h) {
    let canvas = document.getElementById(id)
    let dpr = window.devicePixelRatio || 1
    if (dpr < 1) dpr = 1
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    canvas.width = w * dpr
    canvas.height = h * dpr
    let ctx = canvas.getContext('2d', {})
    ctx.scale(dpr, dpr)
    // Fallback fix for Brave browser
    // https://github.com/brave/brave-browser/issues/1738
    if (!ctx.measureTextOrg) {
        ctx.measureTextOrg = ctx.measureText
    }
    let nvjsId = id.split('-').shift()
    ctx.measureText = text =>
        Utils.measureText(ctx, text, nvjsId)

    return [canvas, ctx]

}

function resize(canvas, ctx, w, h) {
    let dpr = window.devicePixelRatio || 1
    if (dpr < 1) dpr = 1
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)
}

export default { setup, resize }
