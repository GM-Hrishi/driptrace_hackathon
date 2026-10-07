import { deriveSeverity } from './severity.js'
import { SENSOR_STALE_AFTER_MS } from './constants.js'

/**
 * Development-only bed simulator.
 *
 * Exists so the ward view, alarm priorities and trend chart can be built and
 * verified before the ESP32 units are publishing, and so there is a working
 * fallback if the hardware misbehaves during judging.
 *
 * This module must never drive the deployed dashboard on its own. Call sites
 * gate it behind import.meta.env.DEV or an explicit operator toggle.
 */

const FULL_BOTTLE_ML = 500
/** Grams of empty bottle plus giving set, subtracted to get fluid mass. */
const TARE_GRAMS = 120

/** @typedef {'running' | 'low' | 'empty' | 'stopped' | 'offline' | 'fast'} MockMode */

/** @type {{ id: string, label: string, ward: string, mode: MockMode, pct: number, flow: number }[]} */
const SEED = [
  { id: 'bed-01', label: 'Bed 1', ward: 'ICU A', mode: 'running', pct: 68, flow: 92 },
  { id: 'bed-02', label: 'Bed 2', ward: 'ICU A', mode: 'low', pct: 9, flow: 81 },
  // Pinned beds never recover, so the ward always has a live example of a
  // high-priority alarm and of a dead sensor for judges to look at.
  { id: 'bed-03', label: 'Bed 3', ward: 'ICU A', mode: 'empty', pct: 0, flow: 0, pinned: true },
  { id: 'bed-04', label: 'Bed 4', ward: 'ICU B', mode: 'offline', pct: 51, flow: 74, pinned: true },
  { id: 'bed-05', label: 'Bed 5', ward: 'ICU B', mode: 'fast', pct: 44, flow: 210 },
  { id: 'bed-06', label: 'Bed 6', ward: 'ICU B', mode: 'running', pct: 88, flow: 105 },
]

/** How long an emptied bottle stays empty before staff "replace" it. */
const REFILL_AFTER_MS = 12_000

/** Small deterministic-ish jitter so numbers move without flickering wildly. */
function drift(value, amount) {
  return value + (Math.random() - 0.5) * amount
}

/** @param {number} flowMlPerHr - 20 drops/mL giving set is the usual default. */
function dropsFromFlow(flowMlPerHr) {
  return Math.max(0, Math.round((flowMlPerHr * 20) / 60))
}

/**
 * One simulated reading.
 * @returns {import('./types.js').BedReading}
 */
function toReading(bed, now) {
  const offline = bed.mode === 'offline'
  const pct = Math.max(0, Math.min(100, bed.pct))
  const flow = bed.mode === 'empty' || bed.mode === 'stopped' ? 0 : Math.max(0, bed.flow)
  const grams = TARE_GRAMS + (pct / 100) * FULL_BOTTLE_ML

  const reading = {
    id: bed.id,
    label: bed.label,
    ward: bed.ward,
    weightGrams: Math.round(grams * 10) / 10,
    flowRateMlPerHr: Math.round(flow * 10) / 10,
    dropsPerMin: dropsFromFlow(flow),
    bottlePercentRemaining: Math.round(pct * 10) / 10,
    bottleEmpty: pct <= 2,
    heartRate: Math.round(drift(78, 8)),
    spo2: Math.round(drift(97, 2)),
    sensorOnline: !offline,
    // An offline unit's last publish recedes into the past, which is exactly
    // how the real staleness check decides it has stopped reporting.
    lastUpdated: offline ? now - SENSOR_STALE_AFTER_MS - 5_000 : now,
  }
  reading.severity = deriveSeverity(reading).severity
  return reading
}

/**
 * Advance the simulation by one tick.
 * @param {number} elapsedMs
 */
function advance(beds, elapsedMs, now) {
  const hours = elapsedMs / 3_600_000
  for (const bed of beds) {
    if (bed.mode === 'offline' || bed.mode === 'stopped') continue

    if (bed.mode === 'empty') {
      // An unpinned bed gets a fresh bottle, so a long demo keeps moving
      // instead of ending with every bed stuck in red.
      if (!bed.pinned && bed.emptiedAt && now - bed.emptiedAt > REFILL_AFTER_MS) {
        bed.pct = 100
        bed.flow = 70 + Math.random() * 60
        bed.mode = 'running'
        bed.emptiedAt = undefined
      }
      continue
    }

    bed.flow = Math.max(0, drift(bed.flow, 2))
    // Draining is driven by the flow rate, so the level and the headline number
    // always agree - a mismatch there would make the whole demo look fake.
    bed.pct -= ((bed.flow * hours) / FULL_BOTTLE_ML) * 100

    if (bed.pct <= 0) {
      bed.pct = 0
      bed.mode = 'empty'
      bed.emptiedAt = now
    } else if (bed.pct < 10 && bed.mode === 'running') {
      bed.mode = 'low'
    }
  }
}

/**
 * Start a simulation.
 *
 * @param {(beds: import('./types.js').BedReading[]) => void} onUpdate
 * @param {{ intervalMs?: number, speed?: number }} [options]
 *   speed multiplies elapsed time, so a bottle can drain in a demo-friendly
 *   span instead of several real hours. At the default a 500 mL bottle at a
 *   typical rate empties in roughly two to three minutes.
 * @returns {{ stop: () => void, setMode: (bedId: string, mode: MockMode) => void }}
 */
export function startMockBeds(onUpdate, { intervalMs = 1000, speed = 150 } = {}) {
  const beds = SEED.map((bed) => ({ ...bed }))
  let last = Date.now()

  const emit = () => {
    const now = Date.now()
    advance(beds, (now - last) * speed, now)
    last = now
    onUpdate(beds.map((bed) => toReading(bed, now)))
  }

  emit()
  const timer = setInterval(emit, intervalMs)

  return {
    stop: () => clearInterval(timer),
    setMode: (bedId, mode) => {
      const bed = beds.find((b) => b.id === bedId)
      if (bed) bed.mode = mode
    },
  }
}

/** A single frozen snapshot, for stories and visual checks. */
export function mockSnapshot(now = Date.now()) {
  return SEED.map((bed) => toReading({ ...bed }, now))
}
