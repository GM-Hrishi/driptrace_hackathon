/**
 * DripTrace data model.
 *
 * One BedReading is what a single ESP32 unit publishes for one bed. The shape
 * below is the contract between firmware and dashboard; the Firebase rules in
 * firebase/database.rules.json validate against the same field names.
 *
 * Realtime Database layout:
 *   beds/
 *     bed-01/            <- BedReading, overwritten in place on every push
 *     bed-02/
 *   history/
 *     bed-01/
 *       <pushId>/        <- FlowSample, append-only, for the trend chart
 */

/**
 * @typedef {'normal' | 'caution' | 'critical'} Severity
 *   Clinical state only. Sensor connectivity is tracked separately in
 *   `sensorOnline`, because a dead sensor is an engineering problem and must
 *   never be painted as a patient alarm.
 */

/**
 * @typedef {'high' | 'medium' | 'none'} AlarmPriority
 *   IEC 60601-1-8 priority. Maps to flash rate, not to color alone.
 */

/**
 * @typedef {Object} BedReading
 * @property {string}  id                       Bed identifier, e.g. "bed-01".
 * @property {string}  label                    Human label shown on the card.
 * @property {string}  [ward]                   Ward or room grouping.
 * @property {number}  weightGrams              Raw load-cell mass in grams.
 * @property {number}  flowRateMlPerHr          Derived from weight delta over time.
 * @property {number}  dropsPerMin              Derived drip rate.
 * @property {number}  bottlePercentRemaining   0-100, derived from weight.
 * @property {boolean} bottleEmpty              Hard empty flag from the unit.
 * @property {number}  [heartRate]              bpm from MAX30102. Absent if no finger.
 * @property {number}  [spo2]                   Percent SpO2 from MAX30102.
 * @property {boolean} sensorOnline             Unit is reporting. NOT a clinical state.
 * @property {number}  lastUpdated              Epoch ms of the unit's last publish.
 * @property {Severity} severity                Computed clinical severity.
 */

/**
 * @typedef {Object} FlowSample
 *   One point on the flow-rate trend chart.
 * @property {number} t                 Epoch ms.
 * @property {number} flowRateMlPerHr
 * @property {number} bottlePercentRemaining
 */

/**
 * @typedef {Object} ActiveAlert
 *   A single resolved alert, used by the card beacon and the topbar banner.
 * @property {string}        bedId
 * @property {string}        bedLabel
 * @property {Severity | 'offline'} severity
 * @property {AlarmPriority} priority
 * @property {string}        reason   Short clinical phrase shown to staff.
 */

export {}
