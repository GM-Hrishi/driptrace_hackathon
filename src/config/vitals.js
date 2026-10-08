/**
 * vitals.js
 *
 * Single config-driven registry of patient vitals (HR, SpO2) read from the
 * MAX30102. Same pattern as VitalFlow's src/config/vitals.js: the bed card,
 * the bed detail KPI row and the Admin settings panel all iterate this array
 * instead of hardcoding a field per vital.
 *
 * To add a vital:
 *   1. Add an entry with a unique `key`.
 *   2. Give it a `settingKey` and add that boolean to DEFAULT_SETTINGS in
 *      src/lib/store.js; the Admin panel picks the toggle up automatically.
 *   3. `getValue(reading)` pulls the raw field off a BedReading.
 *
 * Vitals carry no colour here on purpose: status colours are reserved for
 * alarms. The HR/SpO2 alarms (possible unresponsive patient, irregular
 * rhythm, HR outside the patient's learned range) come from the unit's
 * on-device model and are raised in src/lib/severity.js.
 */

/**
 * @typedef {Object} Vital
 * @property {string} key
 * @property {string} label       Short label for tight spaces, e.g. "HR".
 * @property {string} fullLabel   Label for tiles and settings.
 * @property {string} unit
 * @property {string} source      Sensor the value comes from.
 * @property {'heartRateEnabled' | 'spo2Enabled'} settingKey
 * @property {(settings: import('../lib/store.js').Settings) => boolean} isEnabled
 * @property {(reading: Partial<import('../lib/types.js').BedReading> | null) => number | null} getValue
 */

/** @type {Vital[]} */
export const VITALS = [
  {
    key: 'heartRate',
    label: 'HR',
    fullLabel: 'Heart rate',
    unit: 'bpm',
    source: 'MAX30102',
    settingKey: 'heartRateEnabled',
    isEnabled: (settings) => settings.heartRateEnabled !== false,
    getValue: (reading) => (Number.isFinite(reading?.heartRate) ? reading.heartRate : null),
  },
  {
    key: 'spo2',
    label: 'SpO₂',
    fullLabel: 'SpO₂',
    unit: '%',
    source: 'MAX30102',
    settingKey: 'spo2Enabled',
    isEnabled: (settings) => settings.spo2Enabled !== false,
    getValue: (reading) => (Number.isFinite(reading?.spo2) ? reading.spo2 : null),
  },
]

const MISSING = {
  'no-finger': { short: 'no finger', long: 'Place finger on sensor' },
  acquiring: { short: 'reading…', long: 'Reading…' },
  motion: { short: 'hold still', long: 'Hold still…' },
  offline: { short: 'sensor off', long: 'Pulse sensor offline' },
}

/**
 * Why a vital has no value, from the unit's `signal` field, so a missing
 * number never shows as a bare dash.
 *
 * @param {Partial<import('../lib/types.js').BedReading> | null} reading
 * @param {'short' | 'long'} [form]
 */
export function vitalPlaceholder(reading, form = 'long') {
  return MISSING[reading?.signal]?.[form] ?? '—'
}

/** Only the vitals currently switched on in Admin. */
export function getEnabledVitals(settings) {
  return VITALS.filter((vital) => vital.isEnabled(settings))
}
