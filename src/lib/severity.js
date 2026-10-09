import {
  ALARM_PRIORITY,
  BOTTLE_EMPTY_PERCENT,
  DEFAULT_FLOW_RANGE_ML_PER_HR,
  FLOW_DEVIATION_PERCENT,
  FLOW_STOPPED_ML_PER_HR,
  HR_LOW_BELOW,
  HR_STRESSED_ABOVE,
  LOW_VOLUME_PERCENT,
  SENSOR_STALE_AFTER_MS,
  SEVERITY_RANK,
} from './constants.js'

/**
 * @typedef {Object} AlertThresholds
 * @property {number} [prescribedFlowMlPerHr]  The bed's ordered rate. Enables deviation alarms.
 * @property {number} [lowVolumePct]           Low-volume caution threshold, percent of a full bottle.
 * @property {number} [flowDeviationPct]       Allowed deviation from the prescribed rate, percent.
 * @property {{ min: number, max: number }} [flowRange]  Used only when no rate is prescribed.
 */

/** "3.2x", or "12x" once the extra decimal stops meaning anything. */
function formatRatio(ratio) {
  return `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}x`
}

/**
 * Every clinical alert currently true for one bed, most urgent first.
 *
 * Each alert carries a short `reason` for tight spaces (card, beacon label), an
 * `action` telling staff what to check, and `message`, the two joined, for the
 * banner and the alarm panel.
 *
 * Connectivity is deliberately NOT folded in here. A stale sensor is resolved
 * by resolveChannel into its own offline channel, so a dead unit is never
 * painted as a patient alarm.
 *
 * @param {Partial<import('./types.js').BedReading>} reading
 * @param {AlertThresholds} [thresholds]
 * @returns {import('./types.js').ClinicalAlert[]}
 */
export function deriveAlerts(reading, thresholds = {}) {
  // `??` rather than destructuring defaults: a bed with no override stores
  // null, and a null threshold must fall back, not silently disable the alarm.
  const prescribedFlowMlPerHr = thresholds.prescribedFlowMlPerHr
  const lowVolumePct = thresholds.lowVolumePct ?? LOW_VOLUME_PERCENT
  const flowDeviationPct = thresholds.flowDeviationPct ?? FLOW_DEVIATION_PERCENT
  const flowRange = thresholds.flowRange ?? DEFAULT_FLOW_RANGE_ML_PER_HR
  const pct = reading.bottlePercentRemaining ?? 0
  const flow = reading.flowRateMlPerHr ?? 0

  /** @type {import('./types.js').ClinicalAlert[]} */
  const alerts = []
  const add = (kind, severity, reason, action) =>
    alerts.push({ kind, severity, reason, action, message: `${reason} — ${action}` })

  // --- Patient vitals, from the unit's on-device model (firmware v3). ---
  // A finger PPG cannot diagnose consciousness: the unit flags a still,
  // clipped-on patient with no pulse or a dangerously low HR or SpO2.
  if (reading.unresponsive) {
    add('patient-unresponsive', 'critical', 'Possible unresponsive patient', 'check the patient now')
  }
  const hr = reading.heartRate
  if (Number.isFinite(hr) && hr < HR_LOW_BELOW) {
    add('hr-low', 'critical', `Low heart rate ${Math.round(hr)} bpm`, 'check the patient now')
  } else if (Number.isFinite(hr) && hr > HR_STRESSED_ABOVE) {
    add('hr-high', 'caution', `Heart rate ${Math.round(hr)} bpm, patient may be stressed`, 'reassure and recheck')
  }
  if (reading.rhythm === 'irregular') {
    add('irregular-rhythm', 'caution', 'Irregular heartbeat', 'check pulse manually and inform the doctor')
  }
  if (reading.hrOutOfRange && Number.isFinite(reading.heartRate) && Number.isFinite(reading.hrLow)) {
    add(
      'hr-out-of-range',
      'caution',
      `Heart rate ${Math.round(reading.heartRate)}, patient's normal ${reading.hrLow}–${reading.hrHigh}`,
      'check the patient',
    )
  }

  // --- High priority: the line is not delivering fluid. ---
  // An empty bottle explains a stopped line, so it is the only line alarm
  // raised; stacking "flow stopped" under it would just be noise.
  if (reading.bottleEmpty || pct <= BOTTLE_EMPTY_PERCENT) {
    add('bottle-empty', 'critical', 'Bottle empty', 'replace the IV bottle')
    return alerts.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
  }
  // The unit shut the line because the bottle is ending: that, not a
  // generic "flow stopped", is what staff need to read.
  if (reading.clamp === 'closed') {
    add('line-clamped', 'critical', 'Line clamped, bottle finished', 'replace the IV bottle')
    return alerts.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
  }
  if (flow <= FLOW_STOPPED_ML_PER_HR) {
    add('flow-stopped', 'critical', 'Flow stopped', 'check clamp, line and cannula')
  }

  // --- Medium priority: still delivering, but not as ordered. ---
  const flowing = flow > FLOW_STOPPED_ML_PER_HR
  const prescribed = Number.isFinite(prescribedFlowMlPerHr) && prescribedFlowMlPerHr > 0

  if (flowing && prescribed) {
    const ratio = flow / prescribedFlowMlPerHr
    const band = flowDeviationPct / 100
    if (ratio > 1 + band) {
      // Over-infusion first: it is the deviation that can harm a patient fastest.
      add('flow-high', 'caution', `Flow rate ${formatRatio(ratio)} prescribed`, 'check infusion settings')
    } else if (ratio < 1 - band) {
      add(
        'flow-low',
        'caution',
        `Flow rate ${Math.round(ratio * 100)}% of prescribed`,
        'check for a kink or a partly closed clamp',
      )
    }
  } else if (flowing) {
    if (flow > flowRange.max) {
      add('flow-high', 'caution', 'Flow above expected range', 'set a prescribed rate for this bed')
    } else if (flow < flowRange.min) {
      add('flow-low', 'caution', 'Flow below expected range', 'set a prescribed rate for this bed')
    }
  }

  if (pct < lowVolumePct) {
    add('low-volume', 'caution', `Low volume ${Math.round(pct)}%`, 'prepare a replacement bottle')
  }

  // Stable sort: critical before caution, declaration order within a rank.
  return alerts.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
}

/**
 * Clinical severity for one bed, plus the reason staff need to read.
 *
 * @param {Partial<import('./types.js').BedReading>} reading
 * @param {AlertThresholds} [thresholds]
 * @returns {{ severity: import('./types.js').Severity, reason: string }}
 */
export function deriveSeverity(reading, thresholds) {
  const [top] = deriveAlerts(reading, thresholds)
  return top ? { severity: top.severity, reason: top.reason } : { severity: 'normal', reason: 'Within range' }
}

/**
 * Whether a unit counts as reporting, judged from its own timestamp rather
 * than a flag it may have failed to clear before dying.
 *
 * @param {Partial<import('./types.js').BedReading>} reading
 * @param {number} [now]
 */
export function isSensorOnline(reading, now = Date.now()) {
  if (!reading?.lastUpdated) return false
  if (reading.sensorOnline === false) return false
  return now - reading.lastUpdated <= SENSOR_STALE_AFTER_MS
}

/**
 * The visual channel a card edge should paint. Offline wins the *channel* so
 * stale numbers are never dressed up as live ones, but it carries no clinical
 * weight and never flashes.
 *
 * @param {Partial<import('./types.js').BedReading>} reading
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

/**
 * @param {import('./types.js').Severity | 'offline'} channel
 * @param {boolean} [acknowledged]  An acknowledged alarm keeps its color but
 *   stops flashing, which is how IEC 60601-1-8 treats a paused visual signal.
 */
export function alarmClass(channel, acknowledged = false) {
  const priority = acknowledged ? 'none' : alarmPriority(channel)
  if (priority === 'high') return 'dt-alarm-high'
  if (priority === 'medium') return 'dt-alarm-medium'
  return 'dt-alarm-none'
}

/**
 * Critical first, then caution, then offline, then normal. Ties fall back to
 * bed label so card order stays stable between snapshots and nothing jumps
 * around while staff are looking at it.
 *
 * @template {Partial<import('./types.js').BedReading>} T
 * @param {T[]} beds
 * @param {number} [now]
 * @returns {T[]}
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
 * Beds that carry precomputed `alerts` (the live ward does, with each bed's own
 * prescribed rate) are read as-is; anything else is derived on the spot.
 *
 * @param {(Partial<import('./types.js').BedReading> & { alerts?: import('./types.js').ClinicalAlert[] })[]} beds
 * @param {number} [now]
 * @returns {import('./types.js').ActiveAlert | null}
 */
export function highestActiveAlert(beds, now = Date.now()) {
  let top = null
  for (const bed of sortCriticalFirst(beds, now)) {
    const channel = resolveChannel(bed, now)
    if (channel === 'normal') continue
    if (top && SEVERITY_RANK[channel] <= SEVERITY_RANK[top.severity]) continue
    const alert = channel === 'offline' ? null : (bed.alerts ?? deriveAlerts(bed))[0]
    top = {
      bedId: bed.id,
      bedLabel: bed.label ?? bed.id,
      severity: channel,
      priority: alarmPriority(channel),
      kind: alert?.kind ?? 'sensor-offline',
      reason: alert?.reason ?? 'Sensor offline',
      message: alert?.message ?? 'Sensor offline — readings are stale, check the unit',
    }
  }
  return top
}
