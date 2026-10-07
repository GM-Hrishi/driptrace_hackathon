import { useSyncExternalStore } from 'react'

import {
  FLOW_DEVIATION_PERCENT,
  HX711_CALIBRATION_FACTOR_PLACEHOLDER,
  LOW_VOLUME_PERCENT,
} from './constants.js'
import { DEMO_WARD } from './mockBeds.js'
import { validateBedInput } from './validateBed.js'

/**
 * Ward registry, operator settings and alarm acknowledgements.
 *
 * Stored in this browser only. The Firebase rules deny every client write by
 * design, so bed configuration typed into the dashboard cannot be pushed to
 * Firestore from here; it lives in localStorage until an admin-credentialed
 * path exists. Live telemetry still comes from Firebase.
 */

const STORAGE_KEY = 'driptrace.ward.v1'

/**
 * @typedef {Object} Settings
 * @property {boolean} simulationMode   Drive simulated beds. Off in production builds by default.
 * @property {boolean} showSimulatedBeds Show SIM beds on the ward. Display only: hidden beds
 *   keep running and keep their data, and reappear unchanged when shown again.
 * @property {number}  simSpeed         Simulated time multiplier.
 * @property {number}  lowVolumePct     Ward default low-volume threshold.
 * @property {number}  flowDeviationPct Allowed deviation from the prescribed rate.
 * @property {number}  calibrationFactor HX711 factor on record. Reference only, see Admin.
 */

/** @type {Settings} */
export const DEFAULT_SETTINGS = {
  simulationMode: import.meta.env.DEV,
  showSimulatedBeds: true,
  simSpeed: 150,
  lowVolumePct: LOW_VOLUME_PERCENT,
  flowDeviationPct: FLOW_DEVIATION_PERCENT,
  calibrationFactor: HX711_CALIBRATION_FACTOR_PLACEHOLDER,
}

/**
 * @typedef {Object} WardState
 * @property {import('./types.js').BedConfig[]} beds
 * @property {Settings} settings
 * @property {Record<string, { kind: string, at: number }>} acks
 *   Per bed: which alert kind staff acknowledged, and when. An ack only holds
 *   while that same alert is the bed's top alert.
 */

let idCounter = 0
function newId() {
  idCounter += 1
  return `b-${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

/** @returns {import('./types.js').BedConfig[]} */
function demoBeds(now = Date.now()) {
  return DEMO_WARD.map((bed, i) => ({
    ...bed,
    id: `demo-${i + 1}`,
    device: 'simulated',
    lowVolumePct: null,
    clinician: bed.clinician ?? '',
    notes: '',
    ivStartAt: now - (i + 1) * 47 * 60_000,
    createdAt: now,
  }))
}

/** @returns {WardState} */
function load() {
  const fresh = {
    beds: DEFAULT_SETTINGS.simulationMode ? demoBeds() : [],
    settings: { ...DEFAULT_SETTINGS },
    acks: {},
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fresh
    const saved = JSON.parse(raw)
    return {
      beds: Array.isArray(saved.beds) ? saved.beds : fresh.beds,
      settings: { ...DEFAULT_SETTINGS, ...saved.settings },
      acks: saved.acks && typeof saved.acks === 'object' ? saved.acks : {},
    }
  } catch {
    // Private mode or corrupted JSON: run on defaults rather than failing.
    return fresh
  }
}

let state = load()
const listeners = new Set()

function commit(next) {
  state = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage full or blocked. The session keeps working in memory.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Another tab changed the ward: pick it up so two screens never disagree. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return
    state = load()
    for (const listener of listeners) listener()
  })
}

/** @returns {WardState} */
export function useWardStore() {
  return useSyncExternalStore(subscribe, () => state)
}

/**
 * Validate and register a bed.
 * @param {import('./validateBed.js').BedFormInput} input
 */
export function addBed(input) {
  const result = validateBedInput(input, state.beds)
  if (!result.ok) return result
  const bed = { ...result.bed, id: newId(), createdAt: Date.now() }
  commit({ ...state, beds: [...state.beds, bed] })
  return { ok: true, bed }
}

/** @param {string} id */
export function removeBed(id) {
  const { [id]: _dropped, ...acks } = state.acks
  commit({ ...state, beds: state.beds.filter((bed) => bed.id !== id), acks })
}

/**
 * @param {string} id
 * @param {Partial<import('./types.js').BedConfig>} patch
 */
export function updateBed(id, patch) {
  commit({
    ...state,
    beds: state.beds.map((bed) => (bed.id === id ? { ...bed, ...patch } : bed)),
  })
}

/** @param {Partial<Settings>} patch */
export function updateSettings(patch) {
  commit({ ...state, settings: { ...state.settings, ...patch } })
}

/**
 * @param {string} bedId
 * @param {string} kind  The alert kind being acknowledged.
 */
export function acknowledgeAlert(bedId, kind) {
  commit({ ...state, acks: { ...state.acks, [bedId]: { kind, at: Date.now() } } })
}

/** Replace every simulated bed with the six-bed demo ward. Real devices stay. */
export function loadDemoWard() {
  const real = state.beds.filter((bed) => bed.device !== 'simulated')
  const taken = new Set(real.map((bed) => bed.bedNumber.toLowerCase()))
  const demo = demoBeds().filter((bed) => !taken.has(bed.bedNumber.toLowerCase()))
  commit({ ...state, beds: [...real, ...demo], acks: {} })
}

/** Remove every simulated bed. */
export function clearSimulatedBeds() {
  commit({ ...state, beds: state.beds.filter((bed) => bed.device !== 'simulated'), acks: {} })
}

/** Typical gravity-drip orders, so a generated ward looks like a real one. */
const SIM_FLOW_CHOICES = [60, 75, 80, 90, 100, 125]

/**
 * Add `count` simulated beds on the next free bed numbers. The scalability
 * lever: the ward can be grown well past the units on the bench, and every
 * generated bed still goes through the same validation as the form.
 * @param {number} count
 */
export function addSimulatedBeds(count) {
  const now = Date.now()
  const added = []
  const taken = new Set(state.beds.map((bed) => bed.bedNumber.toLowerCase()))
  let next = 1
  for (let i = 0; i < count; i++) {
    while (taken.has(String(next))) next++
    taken.add(String(next))
    const result = validateBedInput(
      {
        patientId: `SIM-${Math.floor(10_000 + Math.random() * 90_000)}`,
        bedNumber: String(next),
        volumeMl: Math.random() < 0.6 ? '500' : '1000',
        prescribedFlowMlPerHr: String(SIM_FLOW_CHOICES[Math.floor(Math.random() * SIM_FLOW_CHOICES.length)]),
        deviceKind: 'simulated',
        deviceId: '',
      },
      [...state.beds, ...added],
      now,
    )
    if (!result.ok) continue
    added.push({
      ...result.bed,
      id: newId(),
      createdAt: now,
      startPct: 30 + Math.round(Math.random() * 70),
      ivStartAt: now - Math.round(Math.random() * 4 * 3_600_000),
    })
  }
  if (added.length > 0) commit({ ...state, beds: [...state.beds, ...added] })
  return added.length
}
