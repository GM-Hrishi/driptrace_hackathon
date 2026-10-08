import { FLOW_STOPPED_ML_PER_HR } from './constants.js'

/**
 * Trend history and the hardware flow-stopped grace, shared by the website's
 * TelemetryProvider and the nurse app's provider so both raise the same alarms
 * from the same readings.
 */

/**
 * Trend window. Hardware beds fill it from history/<device> (logged on the
 * unit at 1 Hz, backfilled after WiFi outages), so it survives a reload.
 */
export const HISTORY_WINDOW_MS = 2 * 60 * 60 * 1000

/** Hard cap on stored points per bed: two hours at one sample a second. */
export const HISTORY_LIMIT = 7200

/** Minimum spacing between trend points. */
export const HISTORY_MIN_GAP_MS = 1000

/**
 * A hardware bed's "Flow stopped" alarm is held back until flow has read zero
 * for this long. Weight-derived flow reads zero while the unit settles after a
 * bottle is hung and whenever the change is below the scale's drift floor, so
 * an instant alarm would fire on every new bottle.
 */
export const FLOW_STOPPED_GRACE_MS = 60_000

/** Drop a premature flow-stopped alert from a hardware bed's alert list. */
export function applyFlowStoppedGrace(alerts, history, reading) {
  if (!alerts.some((a) => a.kind === 'flow-stopped')) return alerts
  let flowingAt = history.length ? history[0].t : reading.lastUpdated
  for (const sample of history) {
    if (sample.flowRateMlPerHr > FLOW_STOPPED_ML_PER_HR) flowingAt = sample.t
  }
  if (reading.lastUpdated - flowingAt >= FLOW_STOPPED_GRACE_MS) return alerts
  return alerts.filter((a) => a.kind !== 'flow-stopped')
}

/**
 * Merge fresh readings into { readings, history }, appending a trend point only
 * when a unit actually published, and at most one per HISTORY_MIN_GAP_MS.
 *
 * @param {{ readings: Record<string, any>, history: Record<string, any[]> }} prev
 * @param {Record<string, import('./types.js').BedReading>} byBedId
 */
export function mergeReadings(prev, byBedId) {
  const readings = { ...prev.readings }
  const history = { ...prev.history }
  for (const [id, reading] of Object.entries(byBedId)) {
    const before = prev.readings[id]
    readings[id] = reading
    const series = prev.history[id] ?? []
    const lastT = series.length ? series[series.length - 1].t : -Infinity
    // Units publish several times a second; the trend keeps one point per second.
    if (!before || reading.lastUpdated - lastT >= HISTORY_MIN_GAP_MS) {
      history[id] = trim([
        ...series,
        {
          t: reading.lastUpdated,
          flowRateMlPerHr: reading.flowRateMlPerHr,
          bottlePercentRemaining: reading.bottlePercentRemaining,
          heartRate: reading.heartRate,
          spo2: reading.spo2,
          live: true,
        },
      ])
    }
  }
  return { readings, history }
}

/** Keep the newest HISTORY_WINDOW_MS, at most HISTORY_LIMIT points. */
function trim(series) {
  if (!series.length) return series
  const from = series[series.length - 1].t - HISTORY_WINDOW_MS
  let i = 0
  while (i < series.length && series[i].t < from) i++
  const kept = i ? series.slice(i) : series
  return kept.length > HISTORY_LIMIT ? kept.slice(-HISTORY_LIMIT) : kept
}

/**
 * Merge the unit's logged history (sorted by t) into each bed's series.
 *
 * Logged points are the record; live points the browser appended are kept
 * only where the log has not caught up yet (newer than its last point), so
 * the same second never shows twice.
 *
 * @param {{ readings: Record<string, any>, history: Record<string, any[]> }} prev
 * @param {Record<string, import('./types.js').FlowSample[]>} byBedId
 */
export function mergeLoggedHistory(prev, byBedId) {
  const history = { ...prev.history }
  for (const [id, logged] of Object.entries(byBedId)) {
    const lastLogged = logged.length ? logged[logged.length - 1].t : -Infinity
    const liveTail = (prev.history[id] ?? []).filter((s) => s.live && s.t > lastLogged)
    history[id] = trim([...logged, ...liveTail])
  }
  return { ...prev, history }
}

/**
 * At most `max` points for drawing, plus a null break wherever the unit was
 * silent for more than `gapMs`, so a chart never draws a line across an
 * outage it has no data for.
 *
 * @template {{ t: number }} T
 * @param {T[]} series
 * @param {number} [max]
 * @param {number} [gapMs]
 * @returns {(T | { t: number, gap: true })[]}
 */
export function chartPoints(series, max = 600, gapMs = 15_000) {
  const step = Math.max(1, Math.ceil(series.length / max))
  const out = []
  let prevT = null
  // Aligned so the newest point is always drawn.
  for (let i = (series.length - 1) % step; i < series.length; i += step) {
    const s = series[i]
    if (prevT !== null && s.t - prevT > Math.max(gapMs, step * 2000)) out.push({ t: prevT + 1, gap: true })
    out.push(s)
    prevT = s.t
  }
  return out
}
