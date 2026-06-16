// Configurable hotkey matching for .navy tools.
//
// The host app passes a custom key map via props.config.hotkeys, keyed by
// action name, e.g. { brush: ['Alt+B'], deleteSelected: ['Delete','Backspace'] }.
// Combo strings use the same canonical format as the host:
//   modifier tokens (Ctrl / Shift / Alt / Meta) + a single key token, joined
//   by "+", e.g. "Alt+B", "Delete", "Escape". Key tokens: A–Z uppercase,
//   digits, "Space", "Escape", "ArrowUp/Down/Left/Right".
//
// When no custom map is supplied (or an action is missing), DEFAULT_HOTKEYS is
// used, so existing callers behave exactly as before.

export const DEFAULT_HOTKEYS = {
    brush: ['Alt+B'],
    trend: ['Alt+T'],
    trendRay: ['Alt+G'],
    rectangle: ['Alt+R'],
    fib: ['Alt+F'],
    deleteSelected: ['Delete', 'Backspace'],
    cancelDrawing: ['Escape'],
}

// Canonical key token for a keyboard event ("B", "1", "Escape", "ArrowDown", "Space").
function eventKeyToken(event) {
    let code = event.code || ''
    if (/^Key[A-Z]$/.test(code)) return code.slice(3)
    if (/^Digit[0-9]$/.test(code)) return code.slice(5)
    if (code === 'Space') return 'Space'
    return event.key
}

// Does the event match a single canonical combo string?
export function matchCombo(event, combo) {
    if (!combo) return false
    let parts = combo.split('+').map(p => p.trim())
    let want = {Ctrl: false, Shift: false, Alt: false, Meta: false}
    let key = ''
    for (let p of parts) {
        if (p === 'Ctrl') want.Ctrl = true
        else if (p === 'Shift') want.Shift = true
        else if (p === 'Alt') want.Alt = true
        else if (p === 'Meta' || p === 'Cmd') want.Meta = true
        else key = p
    }
    if (event.ctrlKey !== want.Ctrl) return false
    if (event.shiftKey !== want.Shift) return false
    if (event.altKey !== want.Alt) return false
    if (event.metaKey !== want.Meta) return false
    if (!key) return true
    return eventKeyToken(event).toLowerCase() === key.toLowerCase()
}

// Match an action against the user map (or the built-in default).
export function matchHotkeyAction(event, action, userMap) {
    let combos = (userMap && userMap[action]) || DEFAULT_HOTKEYS[action] || []
    for (let combo of combos) {
        if (matchCombo(event, combo)) return true
    }
    return false
}
