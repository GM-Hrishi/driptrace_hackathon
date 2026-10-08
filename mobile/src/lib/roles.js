/**
 * Who is holding the phone, and what they may do.
 *
 * Only the nurse role ships today. The relative role is written down here so
 * adding it later is a build flag plus one screen, not a rewrite: every screen
 * and action asks `can(...)` instead of assuming a nurse.
 *
 * Build a role with VITE_APP_ROLE=<role> npm run build:app.
 */

/**
 * @typedef {'viewWard' | 'viewBedDetail' | 'editBed' | 'assignDevice' | 'acknowledge'
 *   | 'viewAlertLog' | 'viewThresholds' | 'viewDeviceInfo' | 'simulation'
 *   | 'backgroundAlarms'} Capability
 */

/** @type {Record<string, { label: string, capabilities: Capability[] }>} */
export const ROLES = {
  nurse: {
    label: 'Nurse',
    capabilities: [
      'viewWard',
      'viewBedDetail',
      'editBed',
      'assignDevice',
      'acknowledge',
      'viewAlertLog',
      'viewThresholds',
      'viewDeviceInfo',
      'simulation',
      'backgroundAlarms',
    ],
  },
  // Not wired yet. Planned: one linked bed, read-only, plain-language status
  // ("Drip running normally", "Nurse has been alerted"), no thresholds, device
  // ids, acknowledge buttons or ward-wide data.
  relative: {
    label: 'Family',
    capabilities: ['viewBedDetail'],
  },
}

const requested = import.meta.env.VITE_APP_ROLE
/** The active role. Unknown values fall back to nurse rather than locking the app. */
export const ROLE = requested && ROLES[requested] ? requested : 'nurse'

/** @param {Capability} capability */
export function can(capability) {
  return ROLES[ROLE].capabilities.includes(capability)
}
