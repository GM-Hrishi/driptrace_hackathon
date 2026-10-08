import { DROP_FACTOR_GTT_PER_ML } from './constants.js'

/**
 * Normalize one device's raw Realtime Database node into a BedReading.
 *
 * The ESP32 writes with a database secret, which bypasses the type and range
 * checks in firebase/database.rules.json, so nothing here may assume the rules
 * ran. Bad values become `undefined` (rendered as "—") instead of reaching the
 * UI as NaN, negatives or strings.
 */

/** A finite number inside [min, max], else undefined. */
function num(value, min, max) {
  const n = typeof value === 'number' ? value : Number.NaN
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined
}

/** A finite number clamped into [min, max], else undefined. */
function clamped(value, min, max) {
  const n = typeof value === 'number' ? value : Number.NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined
}

/** A reading stamped further ahead than this is treated as having no timestamp. */
const MAX_CLOCK_SKEW_MS = 60_000

/**
 * @param {Record<string, unknown>} raw  The node as read from beds/<device>.
 * @param {string} id                    Registry id of the bed it maps to.
 * @param {number} [now]
 * @returns {import('./types.js').BedReading}
 */
export function normalizeReading(raw, id, now = Date.now()) {
  const flowRateMlPerHr = clamped(raw.flowRateMlPerHr, 0, 1000)
  const lastUpdated = num(raw.lastUpdated, 0, now + MAX_CLOCK_SKEW_MS)

  // No drop sensor on this build: drops/min follows from the flow rate and the
  // giving set's drop factor when the unit does not report it.
  const reportedDrops = num(raw.dropsPerMin, 0, 400)
  const dropsPerMin =
    reportedDrops ??
    (flowRateMlPerHr !== undefined
      ? Math.round(((flowRateMlPerHr * DROP_FACTOR_GTT_PER_ML) / 60) * 10) / 10
      : undefined)

  return {
    id,
    label: typeof raw.label === 'string' ? raw.label : id,
    weightGrams: clamped(raw.weightGrams, 0, 5000),
    flowRateMlPerHr,
    dropsPerMin,
    bottlePercentRemaining: clamped(raw.bottlePercentRemaining, 0, 100),
    bottleEmpty: raw.bottleEmpty === true,
    heartRate: num(raw.heartRate, 20, 250),
    spo2: num(raw.spo2, 50, 100),
    // Only an explicit false marks the unit offline; staleness covers the rest.
    sensorOnline: raw.sensorOnline !== false,
    lastUpdated,
  }
}
