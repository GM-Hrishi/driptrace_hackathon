/**
 * DripTrace hardware and threshold constants.
 *
 * The pin map below is the DripTrace wiring on the ESP32-S3-WROOM-1 N16R8
 * (docs/hardware/DRIPTRACE_FACTS.md). It lives here as the single reference
 * the dashboard and the setup screens read from. No firmware is generated
 * from it.
 */

/** @type {Record<string, { bus: string, pins: Record<string, number>, feeds: string[] }>} */
/** Heart rate above this reads as a stressed patient (caution). */
export const HR_STRESSED_ABOVE = 120

/** Heart rate below this is a critical alert. */
export const HR_LOW_BELOW = 50

export const PIN_MAP = {
  HX711: {
    bus: 'bitbang',
    pins: { DT: 40, SCK: 41 },
    // Everything about fluid volume is derived from this one load cell.
    feeds: ['weightGrams', 'flowRateMlPerHr', 'dropsPerMin', 'bottlePercentRemaining', 'bottleEmpty'],
  },
  MAX30102: {
    bus: 'i2c',
    pins: { SDA: 38, SCL: 39 },
    feeds: ['heartRate', 'spo2'],
  },
  ST7735S: {
    bus: 'spi',
    pins: { SCLK: 12, MOSI: 11, CS: 10, DC: 7, RST: 6 },
    // On-device display. Nothing here reaches the dashboard.
    feeds: [],
  },
  MAX98357A: {
    bus: 'i2s',
    pins: { BCLK: 20, LRC: 21, DIN: 47 },
    // On-device audio alerts.
    feeds: [],
  },
}

/**
 * Load-cell calibration measured on the DripTrace cell on 2026-10-08, from a
 * full and an empty 100 mL bottle (100.5 g of fluid). The firmware holds and
 * applies it; the dashboard only displays it.
 */
export const HX711_CALIBRATION = {
  countsPerGram: -255.85,
  emptyBottleGrams: 16.0,
  measuredOn: '2026-10-08',
}

/** Standard gravity giving set: drops per mL, used to derive drops/min. */
export const DROP_FACTOR_GTT_PER_ML = 20

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
