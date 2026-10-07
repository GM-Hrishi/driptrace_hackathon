/**
 * DripTrace hardware and threshold constants.
 *
 * The pin map below is the finalized DripTrace wiring on an ESP32 DOIT DEVKIT
 * V1. It lives here as the single reference the dashboard, the Firebase schema
 * and the setup screens all read from. No firmware is generated from it.
 */

/** @type {Record<string, { bus: string, pins: Record<string, number>, feeds: string[] }>} */
export const PIN_MAP = {
  HX711: {
    bus: 'bitbang',
    pins: { DT: 16, SCK: 17 },
    // Everything about fluid volume is derived from this one load cell.
    feeds: ['weightGrams', 'flowRateMlPerHr', 'dropsPerMin', 'bottlePercentRemaining', 'bottleEmpty'],
  },
  MAX30102: {
    bus: 'i2c',
    pins: { SDA: 21, SCL: 22 },
    feeds: ['heartRate', 'spo2'],
  },
  ST7735S: {
    bus: 'spi',
    pins: { SCLK: 18, MOSI: 23, CS: 5, DC: 27, RST: 26 },
    // On-device display. Nothing here reaches the dashboard.
    feeds: [],
  },
  MAX98357A: {
    bus: 'i2s',
    pins: { BCLK: 19, LRC: 4, DIN: 13 },
    // On-device audio alerts. SD tied to VIN, GAIN tied to GND.
    feeds: [],
  },
}

/**
 * TODO: RECALIBRATE. This factor was inherited from the sibling VitalFlow
 * board and is a placeholder only. It is NOT valid for the DripTrace load
 * cell. Run a known-mass calibration on the actual DripTrace HX711 + cell
 * before any demo or clinical reading is trusted, and replace this value.
 * Until then every weight-derived field (flow rate, drops/min, percent
 * remaining, empty flag) carries the same unknown scale error.
 */
export const HX711_CALIBRATION_FACTOR_PLACEHOLDER = 287836.24

/** True while the calibration above is still the inherited placeholder. */
export const HX711_CALIBRATION_IS_PLACEHOLDER = true

/** A reading older than this means the ESP32 stopped reporting. */
export const SENSOR_STALE_AFTER_MS = 15_000

/** Below this flow, with fluid still in the bottle, the line has stopped. */
export const FLOW_STOPPED_ML_PER_HR = 1

/** Medium-priority low-volume threshold, as a percent of a full bottle. */
export const LOW_VOLUME_PERCENT = 10

/** A bottle at or under this percent is treated as empty. */
export const BOTTLE_EMPTY_PERCENT = 2

/**
 * How far actual flow may stray from the bed's prescribed rate, as a percent of
 * that rate, before a medium-priority deviation alarm is raised. Gravity drips
 * wander more than pumps do, so this is looser than a pump's +/-10%.
 */
export const FLOW_DEVIATION_PERCENT = 30

/** Fallback flow window for a bed that has no prescribed rate on file. */
export const DEFAULT_FLOW_RANGE_ML_PER_HR = { min: 20, max: 180 }

/** Severity order, lowest to highest. Drives critical-first card sorting. */
export const SEVERITY_RANK = { normal: 0, offline: 1, caution: 2, critical: 3 }

/**
 * IEC 60601-1-8 alarm priority per severity.
 *   high   - red, ~2 Hz, 50% duty
 *   medium - amber, ~0.6 Hz pulse
 *   none   - offline and normal do not flash
 */
export const ALARM_PRIORITY = {
  critical: 'high',
  caution: 'medium',
  offline: 'none',
  normal: 'none',
}

/** Reduced-motion substitute for a flashing beacon. */
export const PRIORITY_GLYPH = {
  critical: '!!!',
  caution: '!!',
  offline: '!',
  normal: '',
}
