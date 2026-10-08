import { FLOW_STOPPED_ML_PER_HR } from './constants.js'

/**
 * Trend history and the hardware flow-stopped grace, shared by the website's
 * TelemetryProvider and the nurse app's provider so both raise the same alarms
 * from the same readings.
 */

/** Trend chart window, in samples. At one sample a second, three minutes. */
export const HISTORY_LIMIT = 180

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
      history[id] = [
        ...series.slice(-(HISTORY_LIMIT - 1)),
        {
          t: reading.lastUpdated,
          flowRateMlPerHr: reading.flowRateMlPerHr,
          bottlePercentRemaining: reading.bottlePercentRemaining,
        },
      ]
    }
  }
  return { readings, history }
}
