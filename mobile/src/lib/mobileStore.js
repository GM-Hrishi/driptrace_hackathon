import { useSyncExternalStore } from 'react'

import { FLOW_DEVIATION_PERCENT, LOW_VOLUME_PERCENT } from '../../../src/lib/constants.js'
import { DEMO_WARD } from '../../../src/lib/mockBeds.js'
import { SIMULATED_DEVICE, validateBedInput } from '../../../src/lib/validateBed.js'
import { notifyStoreChanged, onNativeEvent, readStored, takeInbox, writeStored } from './bridge.js'

/**
 * The nurse app's ward: which ESP32 unit is on which bed, who the patient is,
 * the prescribed rate, nurse preferences, acknowledgements and the shift log.
 *
 * Same shape as the website's src/lib/store.js, but persisted through the
 * Android bridge into SharedPreferences, because MonitorService reads the very
 * same JSON to decide which notifications to raise while the phone is locked.
 * Firebase rules deny client writes, so this never leaves the phone.
 */

/** Must match MonitorService.STORE_KEY. */
export const STORAGE_KEY = 'driptrace.app.v1'

/** Shift log entries kept on the phone. */
const LOG_LIMIT = 300

/**
 * @typedef {Object} AppSettings
 * @property {boolean} simulationMode
 * @property {boolean} showSimulatedBeds
 * @property {boolean} heartRateEnabled
 * @property {boolean} spo2Enabled
 * @property {number}  simSpeed
 * @property {number}  lowVolumePct
 * @property {number}  flowDeviationPct
 * @property {boolean} alarmSound           In-app alarm tone while the app is open.
 * @property {boolean} vibration
 * @property {boolean} keepScreenOn         For a phone parked at the nurses' station.
 * @property {boolean} backgroundMonitoring Notifications while locked (MonitorService).
 */

/** @type {AppSettings} */
export const DEFAULT_SETTINGS = {
  simulationMode: false,
  showSimulatedBeds: true,
  heartRateEnabled: true,
  spo2Enabled: true,
  simSpeed: 150,
  lowVolumePct: LOW_VOLUME_PERCENT,
  flowDeviationPct: FLOW_DEVIATION_PERCENT,
  alarmSound: true,
  vibration: true,
  keepScreenOn: false,
  backgroundMonitoring: true,
}

/**
 * @typedef {Object} LogEntry
 * @property {string} id
 * @property {number} at
 * @property {string} bedId
 * @property {string} bedLabel
 * @property {string} kind
 * @property {string} severity
 * @property {'raised' | 'cleared' | 'acknowledged'} event
 * @property {string} reason
 */

/**
 * @typedef {Object} AppState
 * @property {import('../../../src/lib/types.js').BedConfig[]} beds
 * @property {AppSettings} settings
 * @property {Record<string, { kind: string, at: number }>} acks
 * @property {LogEntry[]} log          Newest first.
 * @property {string[]} logActive      "<bedId>:<kind>" currently active, so a restart does not re-log them.
 */

let idCounter = 0
function newId(prefix = 'b') {
  idCounter += 1
  return `${prefix}-${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

/** @returns {AppState} */
function load() {
  const fresh = { beds: [], settings: { ...DEFAULT_SETTINGS }, acks: {}, log: [], logActive: [] }
  try {
    const raw = readStored(STORAGE_KEY)
    if (!raw) return fresh
    const saved = JSON.parse(raw)
    return {
      beds: Array.isArray(saved.beds) ? saved.beds : [],
      settings: { ...DEFAULT_SETTINGS, ...saved.settings },
      acks: saved.acks && typeof saved.acks === 'object' ? saved.acks : {},
      log: Array.isArray(saved.log) ? saved.log : [],
      logActive: Array.isArray(saved.logActive) ? saved.logActive : [],
    }
  } catch {
    // Corrupted JSON: run on defaults rather than failing.
    return fresh
  }
}

let state = load()
const listeners = new Set()

function emit() {
  for (const listener of listeners) listener()
}

/** @param {AppState} next */
function commit(next) {
  state = next
  writeStored(STORAGE_KEY, JSON.stringify(state))
  notifyStoreChanged()
  emit()
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Fold in what native code queued (an Acknowledge tapped on a notification).
 * Native never writes STORAGE_KEY itself, so the two sides cannot overwrite
 * each other; this is the one place its changes enter the ward.
 */
function drainInbox() {
  const inbox = takeInbox()
  if (!inbox) return
  const acks = { ...state.acks }
  for (const [bedId, ack] of Object.entries(inbox.acks ?? {})) {
    if (!state.beds.some((bed) => bed.id === bedId)) continue
    if (!acks[bedId] || ack.at >= acks[bedId].at) acks[bedId] = ack
  }
  const known = new Set(state.log.map((entry) => entry.id))
  const entries = (inbox.log ?? []).filter((entry) => entry && !known.has(entry.id))
  const log = [...entries, ...state.log].sort((a, b) => b.at - a.at).slice(0, LOG_LIMIT)
  commit({ ...state, acks, log })
}

if (typeof window !== 'undefined') {
  drainInbox()
  onNativeEvent((detail) => {
    if (detail.type === 'store-changed') drainInbox()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') drainInbox()
  })
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return
    state = load()
    emit()
  })
}

/** @returns {AppState} */
export function useMobileStore() {
  return useSyncExternalStore(subscribe, () => state)
}

export function getMobileState() {
  return state
}

/** @param {AppState} base  @param {LogEntry[]} entries */
function withLog(base, entries) {
  return [...entries, ...base.log].slice(0, LOG_LIMIT)
}

/**
 * Put a discovered ESP32 unit on a bed.
 * @param {string} device  RTDB key under beds/, e.g. "bed-01".
 * @param {import('../../../src/lib/validateBed.js').BedFormInput} input
 */
export function assignDevice(device, input) {
  const result = validateBedInput({ ...input, deviceKind: 'esp32', deviceId: device }, state.beds)
  if (!result.ok) return result
  const bed = { ...result.bed, id: newId(), createdAt: Date.now() }
  commit({ ...state, beds: [...state.beds, bed] })
  return { ok: true, bed }
}

/**
 * Edit a bed's patient and prescription. The device it is wired to is kept.
 * @param {string} id
 * @param {import('../../../src/lib/validateBed.js').BedFormInput} input
 */
export function editBed(id, input) {
  const current = state.beds.find((bed) => bed.id === id)
  if (!current) return { ok: false, errors: { form: 'This bed no longer exists.' } }
  const others = state.beds.filter((bed) => bed.id !== id)
  const simulated = current.device === SIMULATED_DEVICE
  const result = validateBedInput(
    { ...input, deviceKind: simulated ? 'simulated' : 'esp32', deviceId: simulated ? '' : current.device },
    others,
  )
  if (!result.ok) return result
  const bed = { ...current, ...result.bed, scenario: current.scenario ?? 'running' }
  commit({ ...state, beds: state.beds.map((b) => (b.id === id ? bed : b)) })
  return { ok: true, bed }
}

/** Take a bed off the ward. Its unit shows up again under "New units". */
export function removeBed(id) {
  const { [id]: _dropped, ...acks } = state.acks
  commit({
    ...state,
    beds: state.beds.filter((bed) => bed.id !== id),
    acks,
    logActive: state.logActive.filter((key) => !key.startsWith(`${id}:`)),
  })
}

/** @param {Partial<AppSettings>} patch */
export function updateSettings(patch) {
  commit({ ...state, settings: { ...state.settings, ...patch } })
}

/**
 * Silence the bed's current top alert. Holds only while that same alert stays
 * on top, exactly as on the website.
 */
export function acknowledgeAlert(bed, alert) {
  const at = Date.now()
  commit({
    ...state,
    acks: { ...state.acks, [bed.id]: { kind: alert.kind, at } },
    log: withLog(state, [
      {
        id: newId('l'),
        at,
        bedId: bed.id,
        bedLabel: bed.label,
        kind: alert.kind,
        severity: alert.severity,
        event: 'acknowledged',
        reason: alert.reason,
      },
    ]),
  })
}

/**
 * Record alerts that started or stopped since the last call.
 * @param {Record<string, { bedId: string, bedLabel: string, kind: string, severity: string, reason: string }>} active
 *   Keyed "<bedId>:<kind>".
 * @param {Set<string>} evaluated  Beds that have a reading right now. A bed still
 *   waiting for its first reading (app just opened) cannot clear its alerts.
 */
export function recordAlertTransitions(active, evaluated) {
  const before = new Set(state.logActive)
  const existing = new Set(state.beds.map((bed) => bed.id))
  const canClear = (bedId) => evaluated.has(bedId) || !existing.has(bedId)
  const raised = Object.keys(active).filter((key) => !before.has(key))
  const cleared = [...before].filter((key) => !(key in active) && canClear(key.split(':')[0]))
  const current = [...before].filter((key) => !cleared.includes(key)).concat(raised)
  if (raised.length === 0 && cleared.length === 0) return

  const at = Date.now()
  const entries = [
    ...raised.map((key) => ({ id: newId('l'), at, ...active[key], event: 'raised' })),
    ...cleared.map((key) => {
      const [bedId, kind] = key.split(':')
      const bed = state.beds.find((b) => b.id === bedId)
      return {
        id: newId('l'),
        at,
        bedId,
        bedLabel: bed ? `Bed ${bed.bedNumber}` : bedId,
        kind,
        severity: 'normal',
        event: 'cleared',
        reason: 'Resolved',
      }
    }),
  ]
  commit({ ...state, logActive: current, log: withLog(state, entries) })
}

export function clearLog() {
  commit({ ...state, log: [] })
}

/** Replace every simulated bed with the six-bed demo ward and switch simulation on. */
export function loadDemoWard() {
  const now = Date.now()
  const real = state.beds.filter((bed) => bed.device !== SIMULATED_DEVICE)
  const taken = new Set(real.map((bed) => bed.bedNumber.toLowerCase()))
  const demo = DEMO_WARD.filter((bed) => !taken.has(bed.bedNumber.toLowerCase())).map((bed, i) => ({
    ...bed,
    id: `demo-${i + 1}`,
    device: SIMULATED_DEVICE,
    lowVolumePct: null,
    clinician: bed.clinician ?? '',
    notes: '',
    ivStartAt: now - (i + 1) * 47 * 60_000,
    createdAt: now,
  }))
  commit({
    ...state,
    beds: [...real, ...demo],
    acks: {},
    settings: { ...state.settings, simulationMode: true },
  })
}

/** Remove every simulated bed. */
export function clearSimulatedBeds() {
  const simIds = new Set(state.beds.filter((b) => b.device === SIMULATED_DEVICE).map((b) => b.id))
  commit({
    ...state,
    beds: state.beds.filter((bed) => !simIds.has(bed.id)),
    acks: Object.fromEntries(Object.entries(state.acks).filter(([id]) => !simIds.has(id))),
    logActive: state.logActive.filter((key) => !simIds.has(key.split(':')[0])),
  })
}
