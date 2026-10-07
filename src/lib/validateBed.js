import { sanitizeKey, sanitizeNumber, sanitizeText } from './sanitize.js'

/**
 * Validation for the Add Patient form.
 *
 * Every field goes through the sanitize.js helpers before anything is stored,
 * so a value that renders on the ward view has already been stripped of
 * control characters, bidi overrides and angle brackets, and every number is
 * finite and inside a clinically plausible range.
 */

/** Bounds mirror firebase/database.rules.json where a field also exists there. */
export const BED_LIMITS = {
  volumeMl: { min: 50, max: 3000 },
  prescribedFlowMlPerHr: { min: 1, max: 999 },
  lowVolumePct: { min: 1, max: 50 },
}

/** Literal value of the device field meaning "no hardware, simulate it". */
export const SIMULATED_DEVICE = 'simulated'

/**
 * @typedef {Object} BedFormInput   Raw strings straight from the form.
 * @property {string} patientId
 * @property {string} bedNumber
 * @property {string} volumeMl
 * @property {string} prescribedFlowMlPerHr
 * @property {'simulated' | 'esp32'} deviceKind
 * @property {string} deviceId
 * @property {string} [lowVolumePct]
 * @property {string} [clinician]
 * @property {string} [ivStartAt]    datetime-local value, e.g. "2026-10-08T09:30".
 * @property {string} [notes]
 */

/**
 * @param {BedFormInput} input
 * @param {import('./types.js').BedConfig[]} existing  Beds already on the ward.
 * @param {number} [now]
 * @returns {{ ok: true, bed: Omit<import('./types.js').BedConfig, 'id' | 'createdAt'> }
 *         | { ok: false, errors: Record<string, string> }}
 */
export function validateBedInput(input, existing, now = Date.now()) {
  /** @type {Record<string, string>} */
  const errors = {}

  const patientId = sanitizeText(input.patientId, 40)
  if (!patientId) errors.patientId = 'Enter a patient identifier.'

  const bedNumber = sanitizeText(input.bedNumber, 16)
  if (!bedNumber) {
    errors.bedNumber = 'Enter a bed or room number.'
  } else if (existing.some((bed) => bed.bedNumber.toLowerCase() === bedNumber.toLowerCase())) {
    errors.bedNumber = `Bed ${bedNumber} is already on the ward.`
  }

  const volumeMl = sanitizeNumber(input.volumeMl, BED_LIMITS.volumeMl)
  if (volumeMl === null) {
    errors.volumeMl = `Enter a volume between ${BED_LIMITS.volumeMl.min} and ${BED_LIMITS.volumeMl.max} mL.`
  }

  const flow = sanitizeNumber(input.prescribedFlowMlPerHr, BED_LIMITS.prescribedFlowMlPerHr)
  if (flow === null) {
    errors.prescribedFlowMlPerHr = `Enter a rate between ${BED_LIMITS.prescribedFlowMlPerHr.min} and ${BED_LIMITS.prescribedFlowMlPerHr.max} mL/hr.`
  }

  let device = SIMULATED_DEVICE
  if (input.deviceKind === 'esp32') {
    // The device id is the Realtime Database key the unit publishes under, and
    // the rules require it to equal the unit's auth uid, so it must be key-safe.
    device = sanitizeKey(input.deviceId)
    if (!device || device === SIMULATED_DEVICE) {
      errors.deviceId = 'Enter the device ID the ESP32 publishes under, e.g. bed-01.'
    } else if (existing.some((bed) => bed.device === device)) {
      errors.deviceId = `Device ${device} is already assigned to another bed.`
    }
  }

  let lowVolumePct = null
  if (input.lowVolumePct?.trim()) {
    lowVolumePct = sanitizeNumber(input.lowVolumePct, BED_LIMITS.lowVolumePct)
    if (lowVolumePct === null) {
      errors.lowVolumePct = `Enter a threshold between ${BED_LIMITS.lowVolumePct.min} and ${BED_LIMITS.lowVolumePct.max}%.`
    }
  }

  let ivStartAt = null
  if (input.ivStartAt?.trim()) {
    const parsed = Date.parse(input.ivStartAt)
    if (!Number.isFinite(parsed)) {
      errors.ivStartAt = 'Enter a valid date and time.'
    } else if (parsed > now + 60 * 60 * 1000) {
      errors.ivStartAt = 'Start time cannot be more than an hour in the future.'
    } else {
      ivStartAt = parsed
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    bed: {
      patientId,
      bedNumber,
      volumeMl,
      prescribedFlowMlPerHr: flow,
      device,
      lowVolumePct,
      clinician: sanitizeText(input.clinician, 60),
      ivStartAt,
      notes: sanitizeText(input.notes, 280),
      scenario: 'running',
    },
  }
}
