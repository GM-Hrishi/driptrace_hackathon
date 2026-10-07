import {
  ALARM_PRIORITY,
  BOTTLE_EMPTY_PERCENT,
  DEFAULT_FLOW_RANGE_ML_PER_HR,
  FLOW_STOPPED_ML_PER_HR,
  LOW_VOLUME_PERCENT,
  SENSOR_STALE_AFTER_MS,
  SEVERITY_RANK,
} from './constants.js'

/**
 * Clinical severity for one bed, plus the reason staff need to read.
 *
 * Connectivity is deliberately NOT folded in here. A stale sensor returns
 * severity 'normal' with sensorOnline false, so the UI can show the offline
 * channel without ever claiming the patient is in a red state.
 *
 * @param {import('./types.js').BedReading} reading
 * @param {{ min: number, max: number }} [flowRange]
 * @returns {{ severity: import('./types.js').Severity, reason: string }}
 */
export function deriveSeverity(reading, flowRange = DEFAULT_FLOW_RANGE_ML_PER_HR) {
  const pct = reading.bottlePercentRemaining ?? 0
  const flow = reading.flowRateMlPerHr ?? 0

  // --- High priority: the line is not delivering fluid. ---
  if (reading.bottleEmpty || pct <= BOTTLE_EMPTY_PERCENT) {
    return { severity: 'critical', reason: 'Bottle empty' }
  }
  if (flow <= FLOW_STOPPED_ML_PER_HR) {
    return { severity: 'critical', reason: 'Flow stopped' }
  }

  // --- Medium priority: still delivering, but outside safe bounds. ---
  if (pct < LOW_VOLUME_PERCENT) {
    return { severity: 'caution', reason: `Low volume ${Math.round(pct)}%` }
  }
  if (flow < flowRange.min) {
    return { severity: 'caution', reason: 'Flow below prescribed rate' }
  }
  if (flow > flowRange.max) {
    return { severity: 'caution', reason: 'Flow above prescribed rate' }
  }

  return { severity: 'normal', reason: 'Within range' }
}

/**
 * Whether a unit counts as reporting, judged from its own timestamp rather
 * than a flag it may have failed to clear before dying.
 *
 * @param {import('./types.js').BedReading} reading
 * @param {number} [now]
 */
export function isSensorOnline(reading, now = Date.now()) {
  if (!reading?.lastUpdated) return false
  return now - reading.lastUpdated <= SENSOR_STALE_AFTER_MS
}

/**
 * The visual channel a card edge should paint. Offline wins the *channel* so
 * stale numbers are never dressed up as live ones, but it carries no clinical
 * weight and never flashes.
 *
 * @param {import('./types.js').BedReading} reading
 * @param {number} [now]
 * @returns {import('./types.js').Severity | 'offline'}
 */
export function resolveChannel(reading, now = Date.now()) {
  if (!isSensorOnline(reading, now)) return 'offline'
  return reading.severity ?? deriveSeverity(reading).severity
}

/** @param {import('./types.js').Severity | 'offline'} channel */
export function alarmPriority(channel) {
  return ALARM_PRIORITY[channel] ?? 'none'
}

/** @param {import('./types.js').Severity | 'offline'} channel */
export function alarmClass(channel) {
  const priority = alarmPriority(channel)
  if (priority === 'high') return 'dt-alarm-high'
  if (priority === 'medium') return 'dt-alarm-medium'
  return 'dt-alarm-none'
}

/**
 * Critical first, then caution, then offline, then normal. Ties fall back to
 * bed label so card order stays stable between snapshots and nothing jumps
 * around while staff are looking at it.
 *
 * @param {import('./types.js').BedReading[]} beds
 * @param {number} [now]
 */
export function sortCriticalFirst(beds, now = Date.now()) {
  return [...beds].sort((a, b) => {
    const rank = SEVERITY_RANK[resolveChannel(b, now)] - SEVERITY_RANK[resolveChannel(a, now)]
    if (rank !== 0) return rank
    return String(a.label ?? a.id).localeCompare(String(b.label ?? b.id), undefined, {
      numeric: true,
    })
  })
}

/**
 * The single highest active alert, for the topbar banner. Returns null when
 * every bed is normal, so the banner can disappear entirely rather than
 * showing a reassuring green bar nobody needs.
 *
 * @param {import('./types.js').BedReading[]} beds
 * @param {number} [now]
 * @returns {import('./types.js').ActiveAlert | null}
 */
export function highestActiveAlert(beds, now = Date.now()) {
  let top = null
  for (const bed of beds) {
    const channel = resolveChannel(bed, now)
    if (channel === 'normal') continue
    if (top && SEVERITY_RANK[channel] <= SEVERITY_RANK[top.severity]) continue
    top = {
      bedId: bed.id,
      bedLabel: bed.label ?? bed.id,
      severity: channel,
      priority: alarmPriority(channel),
      reason: channel === 'offline' ? 'Sensor offline' : deriveSeverity(bed).reason,
    }
  }
  return top
}
