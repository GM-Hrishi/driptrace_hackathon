import { FLOW_STOPPED_ML_PER_HR } from '../../../src/lib/constants.js'

/**
 * Nurse-facing derived numbers. The firmware reports percent remaining and
 * flow; the bottle volume comes from the bed's own setup.
 */

/** @returns {number | null} mL left in the bottle. */
export function remainingMl(bed) {
  const pct = bed.reading?.bottlePercentRemaining
  if (!Number.isFinite(pct) || !Number.isFinite(bed.volumeMl)) return null
  return (pct / 100) * bed.volumeMl
}

/**
 * When the bottle will run dry at the current flow, as epoch ms.
 * Null when the line is not flowing or the numbers are missing.
 */
export function emptyAt(bed, now) {
  const left = remainingMl(bed)
  const flow = bed.reading?.flowRateMlPerHr
  if (left === null || !Number.isFinite(flow) || flow <= FLOW_STOPPED_ML_PER_HR) return null
  return now + (left / flow) * 3_600_000
}

/** "8 min", "1 h 40 min". */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const totalMin = Math.round(ms / 60_000)
  if (totalMin < 1) return '< 1 min'
  if (totalMin < 60) return `${totalMin} min`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

/** HH:MM in the phone's locale. */
export function formatTime(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatDateTime(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** One decimal, or an em dash. */
export function fixed1(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '—'
}
