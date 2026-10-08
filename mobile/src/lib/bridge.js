/**
 * The JavaScript side of MainActivity.WebAppInterface.
 *
 * Inside the Android app every call goes to native code. In a desktop browser
 * (`npm run dev:app`) the same calls fall back to localStorage and no-ops, so
 * the nurse UI can be built and checked without a phone.
 */

const native = typeof window !== 'undefined' ? window.AndroidBridge : undefined

/** True when running inside the DripTrace Android app. */
export const isNativeApp = Boolean(native)

function call(name, ...args) {
  try {
    if (native && typeof native[name] === 'function') return native[name](...args)
  } catch {
    // A failing native call must never take the ward view down with it.
  }
  return undefined
}

/** @param {string} key  @returns {string | null} */
export function readStored(key) {
  if (native) return call('getSetting', key, '') || null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** @param {string} key  @param {string} value */
export function writeStored(key, value) {
  if (native) {
    call('saveSetting', key, value)
    return
  }
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage full or blocked: the session keeps working in memory.
  }
}

/** @param {number | number[]} pattern  Milliseconds, or an on/off pattern. */
export function vibrate(pattern) {
  if (native) {
    call('vibratePattern', JSON.stringify(Array.isArray(pattern) ? pattern : [pattern]))
    return
  }
  navigator.vibrate?.(pattern)
}

/** Start or stop the background MonitorService. */
export function setMonitoring(enabled) {
  call('setMonitoring', Boolean(enabled))
}

export function setKeepScreenOn(enabled) {
  call('setKeepScreenOn', Boolean(enabled))
}

/** @returns {boolean | null} null when unknown (desktop browser). */
export function notificationsEnabled() {
  const value = call('notificationsEnabled')
  return typeof value === 'boolean' ? value : null
}

export function openNotificationSettings() {
  call('openNotificationSettings')
}

/**
 * Acknowledgements made on notifications while the app was not looking,
 * handed over once (native clears them). Null in a desktop browser.
 * @returns {{ acks?: Record<string, { kind: string, at: number }>, log?: any[] } | null}
 */
export function takeInbox() {
  const raw = call('takeInbox')
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Tell the service the stored ward changed, so it re-evaluates now, not on its next tick. */
export function notifyStoreChanged() {
  call('storeChanged')
}

/**
 * Native code dispatches `driptrace:native` on window, e.g. when a nurse taps
 * Acknowledge on a notification while the app is open.
 * @param {(detail: { type: string, [key: string]: unknown }) => void} handler
 */
export function onNativeEvent(handler) {
  const listener = (event) => handler(event.detail ?? {})
  window.addEventListener('driptrace:native', listener)
  return () => window.removeEventListener('driptrace:native', listener)
}
