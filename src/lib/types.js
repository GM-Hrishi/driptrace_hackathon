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
 * @property {boolean} [finger]                 A finger is on the pulse sensor.
 * @property {'no-finger' | 'acquiring' | 'ok' | 'motion' | 'offline'} [signal]
 *   Why HR/SpO2 may be missing; 'motion' means values are held through movement.
 * @property {'regular' | 'irregular' | 'unknown'} [rhythm]  On-device rhythm model.
 * @property {number}  [irregularProb]          Model probability of an irregular rhythm, 0-1.
 * @property {number}  [hrLow]                  This patient's learned normal HR range, low end.
 * @property {number}  [hrHigh]                 ...and high end. Absent while learning.
 * @property {number}  [baselinePct]            Progress learning that range, 0-100.
 * @property {boolean} [hrOutOfRange]           HR outside the learned range for 30 s.
 * @property {boolean} [unresponsive]           Possible unresponsive patient (critical).
 * @property {string}  [unresponsiveWhy]        'no-pulse' | 'low-hr' | 'low-spo2' | 'sim'.
 * @property {number}  [backlog]                Logged seconds the unit has yet to upload.
 * @property {boolean} sensorOnline             Unit is reporting. NOT a clinical state.
 * @property {number}  lastUpdated              Epoch ms of the unit's last publish.
 * @property {Severity} severity                Computed clinical severity.
 */

/**
 * @typedef {'running' | 'fast' | 'slow' | 'stopped' | 'empty' | 'offline'} SimScenario
 *   What a simulated bed is doing. Ignored for beds wired to a real ESP32.
 */

/**
 * @typedef {Object} BedConfig
 *   A patient/bed as registered on the ward. Configuration, not telemetry.
 * @property {string}  id                      Registry id, e.g. "b-lx2k9a".
 * @property {string}  patientId               Patient identifier as typed by staff.
 * @property {string}  bedNumber               Bed or room number, unique on the ward.
 * @property {number}  volumeMl                Full IV bottle volume.
 * @property {number}  prescribedFlowMlPerHr   Ordered rate; deviation alarms key off it.
 * @property {string}  device                  'simulated', or the ESP32's RTDB key.
 * @property {number | null} lowVolumePct      Per-bed override; null uses the ward default.
 * @property {string}  clinician               Nurse or physician, may be empty.
 * @property {number | null} ivStartAt         Epoch ms the infusion started.
 * @property {string}  notes
 * @property {number}  createdAt               Epoch ms.
 * @property {SimScenario} scenario            Simulated beds only.
 * @property {number}  [startPct]              Simulated beds only: initial fill.
 */

/**
 * @typedef {Object} FlowSample
 *   One point on the trend charts: logged on the unit (history/<device>) or
 *   appended live by the browser (`live`).
 * @property {number} t                 Epoch ms.
 * @property {number} flowRateMlPerHr
 * @property {number} bottlePercentRemaining
 * @property {number} [heartRate]
 * @property {number} [spo2]
 * @property {boolean} [approxTime]     Logged on a boot that never synced its clock.
 * @property {boolean} [live]
 */

/**
 * @typedef {'patient-unresponsive' | 'bottle-empty' | 'flow-stopped' | 'flow-high' | 'flow-low' | 'low-volume' | 'irregular-rhythm' | 'hr-out-of-range'} AlertKind
 */

/**
 * @typedef {Object} ClinicalAlert
 *   One condition that is currently true for a bed. A bed can have several.
 * @property {AlertKind} kind
 * @property {Severity}  severity
 * @property {string}    reason   Short phrase, e.g. "Flow rate 3.2x prescribed".
 * @property {string}    action   What staff should check, e.g. "check infusion settings".
 * @property {string}    message  reason and action joined, for the banner and alarm panel.
 */

/**
 * @typedef {Object} ActiveAlert
 *   A single resolved alert, used by the card beacon and the topbar banner.
 * @property {string}        bedId
 * @property {string}        bedLabel
 * @property {Severity | 'offline'} severity
 * @property {AlarmPriority} priority
 * @property {AlertKind | 'sensor-offline'} kind
 * @property {string}        reason   Short clinical phrase shown to staff.
 * @property {string}        message  Reason plus the action to take.
 */

export {}
