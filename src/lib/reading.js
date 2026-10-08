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
    ...normalizeVitalsState(raw),
    // Only an explicit false marks the unit offline; staleness covers the rest.
    sensorOnline: raw.sensorOnline !== false,
    backlog: num(raw.backlog, 0, 10_000_000),
    lastUpdated,
  }
}

const SIGNALS = new Set(['no-finger', 'acquiring', 'ok', 'motion', 'offline'])
const RHYTHMS = new Set(['regular', 'irregular', 'unknown'])
const UNRESPONSIVE_WHY = new Set(['no-pulse', 'low-hr', 'low-spo2', 'sim'])

/**
 * Pulse-oximeter state and the unit's on-device model outputs (firmware v3):
 * why a vital may be missing, the rhythm classifier, the patient's learned
 * heart-rate range and the possible-unresponsive flag.
 */
function normalizeVitalsState(raw) {
  const hrLow = num(raw.hrLow, 30, 200)
  const hrHigh = num(raw.hrHigh, 30, 200)
  const range = hrLow !== undefined && hrHigh !== undefined && hrLow < hrHigh
  return {
    finger: typeof raw.finger === 'boolean' ? raw.finger : undefined,
    signal: SIGNALS.has(raw.signal) ? raw.signal : undefined,
    rhythm: RHYTHMS.has(raw.rhythm) ? raw.rhythm : undefined,
    irregularProb: num(raw.irregularProb, 0, 1),
    hrLow: range ? hrLow : undefined,
    hrHigh: range ? hrHigh : undefined,
    baselinePct: num(raw.baselinePct, 0, 100),
    hrOutOfRange: raw.hrOutOfRange === true,
    unresponsive: raw.unresponsive === true,
    unresponsiveWhy: UNRESPONSIVE_WHY.has(raw.unresponsiveWhy) ? raw.unresponsiveWhy : undefined,
  }
}

/**
 * One second from history/<device>, logged on the unit (possibly while it was
 * offline) and uploaded later. `approxTime` marks a boot that never synced its
 * clock, whose times were estimated.
 *
 * @param {Record<string, unknown>} raw
 * @param {number} [now]
 * @returns {import('./types.js').FlowSample | null}
 */
export function normalizeHistorySample(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null
  const t = num(raw.t, 1_600_000_000_000, now + MAX_CLOCK_SKEW_MS)
  if (t === undefined) return null
  return {
    t,
    flowRateMlPerHr: clamped(raw.flowRateMlPerHr, 0, 1000),
    bottlePercentRemaining: clamped(raw.bottlePercentRemaining, 0, 100),
    heartRate: num(raw.heartRate, 20, 250),
    spo2: num(raw.spo2, 50, 100),
    approxTime: raw.approxTime === true,
  }
}
