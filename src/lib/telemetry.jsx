import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { onValue, orderByKey, query, ref, startAt } from 'firebase/database'

import { BEDS_PATH, HISTORY_PATH, ensureSignedIn, isFirebaseConfigured, rtdb } from './firebase.js'
import { HISTORY_WINDOW_MS, applyFlowStoppedGrace, mergeLoggedHistory, mergeReadings } from './flowHistory.js'
import { createSimulator } from './mockBeds.js'
import { normalizeHistorySample, normalizeReading } from './reading.js'
import { deriveAlerts, highestActiveAlert, resolveChannel, sortCriticalFirst } from './severity.js'
import { useWardStore } from './store.js'
import { SIMULATED_DEVICE } from './validateBed.js'

/**
 * Live ward telemetry.
 *
 * One provider owns every data source so all screens agree on what is true:
 *   - simulated beds tick from the in-browser simulator while simulation mode
 *     is on;
 *   - ESP32 beds come from the Realtime Database under BEDS_PATH, keyed by the
 *     device id the bed was registered with.
 * Both are merged with the ward registry into one bed list, with alerts
 * derived against each bed's own prescribed rate and thresholds.
 */

/** How long "connecting" may last before the dashboard admits it is offline. */
const CONNECT_GRACE_MS = 8_000

/**
 * @typedef {'not-configured' | 'connecting' | 'connected' | 'offline'} FirebaseConnection
 */

/**
 * @typedef {import('./types.js').BedConfig & Partial<import('./types.js').BedReading> & {
 *   label: string,
 *   reading: import('./types.js').BedReading | null,
 *   simulated: boolean,
 *   paused: boolean,
 *   alerts: import('./types.js').ClinicalAlert[],
 *   channel: import('./types.js').Severity | 'offline',
 *   acknowledged: boolean,
 *   acknowledgedAt: number | null,
 *   history: import('./types.js').FlowSample[],
 * }} WardBed
 */

const TelemetryContext = createContext(null)

export function TelemetryProvider({ children }) {
  const { beds: configs, settings, acks } = useWardStore()
  const [data, setData] = useState({ readings: {}, history: {} })
  const [simReady, setSimReady] = useState(false)
  const [devices, setDevices] = useState(/** @type {Record<string, any> | null} */ (null))
  const [firebase, setFirebase] = useState({
    /** @type {FirebaseConnection} */
    connection: isFirebaseConfigured ? 'connecting' : 'not-configured',
    error: /** @type {string | null} */ (null),
  })
  const [now, setNow] = useState(() => Date.now())

  const configsRef = useRef(configs)
  useEffect(() => {
    configsRef.current = configs
  }, [configs])

  // One clock for "updated Xs ago" and the staleness check, so every card on
  // screen ages in step.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  /** Merge fresh readings in, appending to history only when a unit actually published. */
  const ingest = useCallback((byBedId) => {
    setData((prev) => mergeReadings(prev, byBedId))
  }, [])

  // --- Simulation ---------------------------------------------------------
  const simRef = useRef(/** @type {ReturnType<typeof createSimulator> | null} */ (null))
  useEffect(() => {
    if (!settings.simulationMode) {
      setSimReady(false)
      return undefined
    }
    // Kept across toggles so pausing and resuming does not refill every bottle.
    simRef.current ??= createSimulator({ speed: settings.simSpeed })
    const sim = simRef.current
    const run = () =>
      ingest(sim.tick(configsRef.current.filter((bed) => bed.device === SIMULATED_DEVICE)))
    run()
    setSimReady(true)
    const timer = setInterval(run, 1000)
    return () => clearInterval(timer)
    // simSpeed is applied by the effect below without restarting the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.simulationMode, ingest])

  useEffect(() => {
    simRef.current?.setSpeed(settings.simSpeed)
  }, [settings.simSpeed])

  // --- Firebase -------------------------------------------------------------
  useEffect(() => {
    if (!isFirebaseConfigured || !rtdb) return undefined
    let cancelled = false
    const unsubscribers = []

    const grace = setTimeout(() => {
      setFirebase((f) => (f.connection === 'connecting' ? { ...f, connection: 'offline' } : f))
    }, CONNECT_GRACE_MS)

    ensureSignedIn().then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setFirebase({ connection: 'offline', error: result.error ?? 'Could not sign in.' })
        return
      }
      unsubscribers.push(
        onValue(ref(rtdb, '.info/connected'), (snap) => {
          const connected = snap.val() === true
          setFirebase((f) => ({
            error: connected ? null : f.error,
            // The first `false` is the SDK starting up, not an outage; the
            // grace timer decides when "connecting" becomes "offline".
            connection: connected ? 'connected' : f.connection === 'connecting' ? 'connecting' : 'offline',
          }))
        }),
      )
      unsubscribers.push(
        onValue(
          ref(rtdb, BEDS_PATH),
          (snap) => setDevices(snap.val() ?? {}),
          () => setFirebase({ connection: 'offline', error: 'Not permitted to read bed data.' }),
        ),
      )
    })

    return () => {
      cancelled = true
      clearTimeout(grace)
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [])

  // Map each device's latest publish onto the bed it is assigned to.
  useEffect(() => {
    if (!devices) return
    const byBedId = {}
    for (const bed of configs) {
      if (bed.device === SIMULATED_DEVICE) continue
      const reading = devices[bed.device]
      if (reading && typeof reading === 'object') byBedId[bed.id] = normalizeReading(reading, bed.id)
    }
    if (Object.keys(byBedId).length > 0) ingest(byBedId)
  }, [devices, configs, ingest])

  // Each hardware unit's logged seconds (history/<device>), including any it
  // backfilled after a WiFi outage, so the trend survives a reload and fills
  // offline gaps at the times they were measured.
  const hardwareDevices = useMemo(
    () =>
      [...new Set(configs.filter((bed) => bed.device !== SIMULATED_DEVICE).map((bed) => bed.device))]
        .sort()
        .join('|'),
    [configs],
  )
  const [logged, setLogged] = useState(/** @type {Record<string, import('./types.js').FlowSample[]>} */ ({}))
  useEffect(() => {
    if (!isFirebaseConfigured || !rtdb || !hardwareDevices) return undefined
    let cancelled = false
    const unsubscribers = []
    ensureSignedIn().then((result) => {
      if (cancelled || !result.ok) return
      // Keys are the epoch ms the unit measured each second at.
      const since = String(Date.now() - HISTORY_WINDOW_MS)
      for (const device of hardwareDevices.split('|')) {
        const recent = query(ref(rtdb, `${HISTORY_PATH}/${device}`), orderByKey(), startAt(since))
        unsubscribers.push(
          onValue(
            recent,
            (snap) => {
              const samples = Object.values(snap.val() ?? {})
                .map((raw) => normalizeHistorySample(raw))
                .filter(Boolean)
                .sort((a, b) => a.t - b.t)
              setLogged((prev) => ({ ...prev, [device]: samples }))
            },
            // Not fatal: the live node still drives the dashboard.
            () => {},
          ),
        )
      }
    })
    return () => {
      cancelled = true
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [hardwareDevices])

  useEffect(() => {
    const byBedId = {}
    for (const bed of configs) {
      if (bed.device !== SIMULATED_DEVICE && logged[bed.device]) byBedId[bed.id] = logged[bed.device]
    }
    if (Object.keys(byBedId).length > 0) setData((prev) => mergeLoggedHistory(prev, byBedId))
  }, [logged, configs])

  // --- Merge ----------------------------------------------------------------
  /** @type {WardBed[]} */
  const beds = useMemo(
    () =>
      configs.map((cfg) => {
        const simulated = cfg.device === SIMULATED_DEVICE
        const paused = simulated && !settings.simulationMode
        const reading = paused ? null : (data.readings[cfg.id] ?? null)
        const history = data.history[cfg.id] ?? []
        const derived = reading
          ? deriveAlerts(reading, {
              prescribedFlowMlPerHr: cfg.prescribedFlowMlPerHr,
              lowVolumePct: cfg.lowVolumePct ?? settings.lowVolumePct,
              flowDeviationPct: settings.flowDeviationPct,
            })
          : []
        const alerts = reading && !simulated ? applyFlowStoppedGrace(derived, history, reading) : derived
        const ack = acks[cfg.id]
        const acknowledged = Boolean(ack && alerts[0] && ack.kind === alerts[0].kind)
        const bed = {
          ...(reading ?? {}),
          ...cfg,
          label: `Bed ${cfg.bedNumber}`,
          reading,
          simulated,
          paused,
          alerts,
          severity: alerts[0]?.severity ?? 'normal',
          acknowledged,
          acknowledgedAt: acknowledged ? ack.at : null,
          history,
        }
        bed.channel = resolveChannel(bed, now)
        return bed
      }),
    [configs, settings, acks, data, now],
  )

  const value = useMemo(() => {
    const configured = isFirebaseConfigured
    const simulation = settings.simulationMode
    const firebaseSettled = !configured || devices !== null || firebase.connection === 'offline'
    /** @type {'not-configured' | 'loading' | 'ready'} */
    const status =
      !configured && !simulation
        ? 'not-configured'
        : (simulation && !simReady) || !firebaseSettled
          ? 'loading'
          : 'ready'

    // What the ward shows. Hiding simulated beds is a display filter only:
    // they stay in `beds` (Admin, direct bed links) and keep simulating.
    const wardBeds = settings.showSimulatedBeds ? beds : beds.filter((bed) => !bed.simulated)

    return {
      beds,
      wardBeds,
      hiddenSimulatedCount: beds.length - wardBeds.length,
      sorted: sortCriticalFirst(wardBeds, now),
      topAlert: highestActiveAlert(wardBeds, now),
      status,
      firebase,
      simulation,
      settings,
      now,
    }
  }, [beds, devices, firebase, settings, simReady, now])

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>
}

/**
 * @returns {{
 *   beds: WardBed[], wardBeds: WardBed[], hiddenSimulatedCount: number,
 *   sorted: WardBed[], topAlert: import('./types.js').ActiveAlert | null,
 *   status: 'not-configured' | 'loading' | 'ready',
 *   firebase: { connection: FirebaseConnection, error: string | null },
 *   simulation: boolean, settings: import('./store.js').Settings, now: number,
 * }}
 */
export function useTelemetry() {
  const ctx = useContext(TelemetryContext)
  if (!ctx) throw new Error('useTelemetry must be used inside <TelemetryProvider>')
  return ctx
}
