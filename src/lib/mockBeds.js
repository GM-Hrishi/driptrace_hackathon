import { deriveAlerts } from './severity.js'
import { SENSOR_STALE_AFTER_MS } from './constants.js'

/**
 * Bed simulator.
 *
 * Exists so the ward view, alarm priorities and trend chart can be built and
 * verified before the ESP32 units are publishing, so a judge can watch the
 * ward scale past the number of physical units on the bench, and so there is a
 * working fallback if the hardware misbehaves during judging.
 *
 * It is driven by the ward registry: every bed whose device is 'simulated'
 * gets a reading per tick, shaped exactly like what an ESP32 publishes. It
 * only runs while the operator's simulation toggle is on, which defaults to
 * off in production builds.
 */

/** Grams of empty bottle plus giving set, subtracted to get fluid mass. */
const TARE_GRAMS = 120

/** How long an emptied bottle stays empty before staff "replace" it. */
const REFILL_AFTER_MS = 12_000

/**
 * Multiplier on the prescribed rate for each scenario. `fast` sits at 3.2x so
 * the flow-deviation alarm is unmistakable when it is switched on in a demo.
 * @type {Record<import('./types.js').SimScenario, number>}
 */
export const SCENARIO_FLOW_FACTOR = {
  running: 1,
  fast: 3.2,
  slow: 0.4,
  stopped: 0,
  empty: 0,
  offline: 1,
}

/** @type {{ value: import('./types.js').SimScenario, label: string }[]} */
export const SCENARIOS = [
  { value: 'running', label: 'Running as prescribed' },
  { value: 'fast', label: 'Flow too fast (3.2x)' },
  { value: 'slow', label: 'Flow too slow (0.4x)' },
  { value: 'stopped', label: 'Line occluded' },
  { value: 'empty', label: 'Bottle empty' },
  { value: 'offline', label: 'Sensor offline' },
]

/**
 * The six-bed demo ward. Bed 3 stays empty and Bed 4 stays offline so there is
 * always a live example of a high-priority alarm and of a dead sensor; Bed 5
 * runs fast so the deviation alarm is on screen from the first frame.
 */
export const DEMO_WARD = [
  { patientId: 'MRN-20417', bedNumber: '1', volumeMl: 500, prescribedFlowMlPerHr: 90, scenario: 'running', startPct: 68, clinician: 'Nurse R. Iyer' },
  { patientId: 'MRN-20422', bedNumber: '2', volumeMl: 500, prescribedFlowMlPerHr: 80, scenario: 'running', startPct: 9, clinician: 'Nurse R. Iyer' },
  { patientId: 'MRN-20431', bedNumber: '3', volumeMl: 500, prescribedFlowMlPerHr: 75, scenario: 'empty', startPct: 0, clinician: 'Nurse S. Das' },
  { patientId: 'MRN-20448', bedNumber: '4', volumeMl: 1000, prescribedFlowMlPerHr: 70, scenario: 'offline', startPct: 51, clinician: 'Nurse S. Das' },
  { patientId: 'MRN-20453', bedNumber: '5', volumeMl: 500, prescribedFlowMlPerHr: 65, scenario: 'fast', startPct: 72, clinician: 'Dr. A. Menon' },
  { patientId: 'MRN-20460', bedNumber: '6', volumeMl: 1000, prescribedFlowMlPerHr: 100, scenario: 'running', startPct: 88, clinician: 'Dr. A. Menon' },
]

/** Small jitter so numbers move without flickering wildly. */
function drift(value, amount) {
  return value + (Math.random() - 0.5) * amount
}

/** @param {number} flowMlPerHr - 20 drops/mL giving set is the usual default. */
function dropsFromFlow(flowMlPerHr) {
  return Math.max(0, Math.round((flowMlPerHr * 20) / 60))
}

/**
 * Create a simulator. It holds the physical state of each simulated bed (fill
 * level, current flow), keyed by bed id, and advances it on every tick.
 *
 * @param {{ speed?: number }} [options]  speed multiplies elapsed time, so a
 *   bottle drains in a demo-friendly span instead of several real hours. At 150
 *   a 500 mL bottle at a typical rate empties in roughly two to three minutes.
 */
export function createSimulator({ speed = 150 } = {}) {
  /** @type {Map<string, { pct: number, flow: number, hr: number, spo2: number, lastUpdated: number, emptiedAt?: number }>} */
  const units = new Map()
  let last = Date.now()

  /**
   * @param {import('./types.js').BedConfig[]} beds  Simulated beds only.
   * @param {number} [now]
   * @returns {Record<string, import('./types.js').BedReading>}  Keyed by bed id.
   */
  function tick(beds, now = Date.now()) {
    // Capped, so a backgrounded tab or a paused simulation does not drain
    // every bottle in a single catch-up tick when it resumes.
    const hours = (Math.min(now - last, 5_000) * speed) / 3_600_000
    last = now
    /** @type {Record<string, import('./types.js').BedReading>} */
    const out = {}

    for (const bed of beds) {
      const prescribed = bed.prescribedFlowMlPerHr
      let unit = units.get(bed.id)
      if (!unit) {
        unit = {
          pct: bed.startPct ?? 100,
          flow: prescribed * SCENARIO_FLOW_FACTOR[bed.scenario ?? 'running'],
          hr: drift(78, 10),
          spo2: drift(97, 2),
          // A bed that starts offline has already gone quiet.
          lastUpdated: bed.scenario === 'offline' ? now - SENSOR_STALE_AFTER_MS - 5_000 : now,
        }
        units.set(bed.id, unit)
      }

      const scenario = bed.scenario ?? 'running'

      if (scenario === 'offline') {
        // The unit stops publishing. Its last reading recedes into the past,
        // which is exactly how the real staleness check decides it is gone.
        out[bed.id] = toReading(bed, unit)
        continue
      }
      unit.lastUpdated = now

      if (scenario === 'empty') {
        unit.pct = 0
        unit.flow = 0
      } else if (unit.pct <= 0) {
        unit.flow = 0
        unit.emptiedAt ??= now
        // A fresh bottle, so a long demo keeps moving instead of every bed
        // ending stuck in red.
        if (now - unit.emptiedAt > REFILL_AFTER_MS) {
          unit.pct = 100
          unit.emptiedAt = undefined
        }
      } else {
        const target = prescribed * SCENARIO_FLOW_FACTOR[scenario]
        // Ease toward the target so switching scenario looks like a clamp
        // being adjusted, not a teleport.
        unit.flow = Math.max(0, drift(unit.flow + (target - unit.flow) * 0.35, target > 0 ? 2 : 0))
        // Draining is driven by the flow rate, so the level and the headline
        // number always agree - a mismatch there would make the demo look fake.
        unit.pct = Math.max(0, unit.pct - ((unit.flow * hours) / bed.volumeMl) * 100)
      }

      unit.hr = Math.min(110, Math.max(58, drift(unit.hr, 3)))
      unit.spo2 = Math.min(100, Math.max(93, drift(unit.spo2, 0.6)))
      out[bed.id] = toReading(bed, unit)
    }

    // Forget units for beds that were removed or switched to hardware.
    for (const id of units.keys()) {
      if (!beds.some((bed) => bed.id === id)) units.delete(id)
    }
    return out
  }

  return {
    tick,
    /** @param {number} next */
    setSpeed(next) {
      speed = next
    },
  }
}

/**
 * One simulated reading, in the same shape an ESP32 publishes.
 * @returns {import('./types.js').BedReading}
 */
function toReading(bed, unit) {
  const pct = Math.min(100, Math.max(0, unit.pct))
  const flow = Math.max(0, unit.flow)
  const grams = TARE_GRAMS + (pct / 100) * bed.volumeMl

  const reading = {
    id: bed.id,
    label: `Bed ${bed.bedNumber}`,
    weightGrams: Math.round(grams * 10) / 10,
    flowRateMlPerHr: Math.round(flow * 10) / 10,
    dropsPerMin: dropsFromFlow(flow),
    bottlePercentRemaining: Math.round(pct * 10) / 10,
    bottleEmpty: pct <= 2,
    heartRate: Math.round(unit.hr),
    spo2: Math.round(unit.spo2),
    sensorOnline: true,
    lastUpdated: unit.lastUpdated,
  }
  reading.severity =
    deriveAlerts(reading, { prescribedFlowMlPerHr: bed.prescribedFlowMlPerHr })[0]?.severity ?? 'normal'
  return reading
}

/**
 * Standalone demo-ward simulation, for the Design View showcase. Independent
 * of the ward registry, so it always shows the full set of states.
 *
 * @param {(beds: import('./types.js').BedReading[]) => void} onUpdate
 * @param {{ intervalMs?: number, speed?: number }} [options]
 * @returns {{ stop: () => void }}
 */
export function startMockBeds(onUpdate, { intervalMs = 1000, speed = 150 } = {}) {
  const sim = createSimulator({ speed })
  const beds = DEMO_WARD.map((bed, i) => ({ ...bed, id: `showcase-${i + 1}` }))

  const emit = () => {
    const readings = sim.tick(beds)
    onUpdate(beds.map((bed) => readings[bed.id]))
  }

  emit()
  const timer = setInterval(emit, intervalMs)
  return { stop: () => clearInterval(timer) }
}
