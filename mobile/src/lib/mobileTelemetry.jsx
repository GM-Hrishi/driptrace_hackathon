import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { onValue, ref } from 'firebase/database'

import { BEDS_PATH, ensureSignedIn, isFirebaseConfigured, rtdb } from '../../../src/lib/firebase.js'
import { applyFlowStoppedGrace, mergeReadings } from '../../../src/lib/flowHistory.js'
import { createSimulator } from '../../../src/lib/mockBeds.js'
import { normalizeReading } from '../../../src/lib/reading.js'
import { deriveAlerts, highestActiveAlert, resolveChannel, sortCriticalFirst } from '../../../src/lib/severity.js'
import { SIMULATED_DEVICE } from '../../../src/lib/validateBed.js'
import { recordAlertTransitions, useMobileStore } from './mobileStore.js'

/**
 * Live ward telemetry for the nurse app.
 *
 * Same contract as the website's TelemetryProvider (src/lib/telemetry.jsx):
 * one onValue listener on beds/ pushes every ESP32 publish the moment it lands
 * (no polling), alerts are derived per bed with the shared severity rules, and
 * simulated beds tick from the shared simulator. Differences for the phone:
 *   - every unit under beds/ is discovered, so a nurse can put a new unit on a
 *     bed without typing its id;
 *   - alert starts and ends are written to the on-phone shift log.
 */

/** How long "connecting" may last before the app admits it is offline. */
const CONNECT_GRACE_MS = 8_000

const TelemetryContext = createContext(null)

export function MobileTelemetryProvider({ children }) {
  const { beds: configs, settings, acks } = useMobileStore()
  const [data, setData] = useState({ readings: {}, history: {} })
  const [devices, setDevices] = useState(/** @type {Record<string, any> | null} */ (null))
  const [lastSnapshotAt, setLastSnapshotAt] = useState(/** @type {number | null} */ (null))
  const [firebase, setFirebase] = useState({
    /** @type {'not-configured' | 'connecting' | 'connected' | 'offline'} */
    connection: isFirebaseConfigured ? 'connecting' : 'not-configured',
    error: /** @type {string | null} */ (null),
  })
  const [now, setNow] = useState(() => Date.now())

  const configsRef = useRef(configs)
  useEffect(() => {
    configsRef.current = configs
  }, [configs])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const ingest = useCallback((byBedId) => {
    setData((prev) => mergeReadings(prev, byBedId))
  }, [])

  // --- Simulation ---------------------------------------------------------
  const simRef = useRef(/** @type {ReturnType<typeof createSimulator> | null} */ (null))
  useEffect(() => {
    if (!settings.simulationMode) return undefined
    simRef.current ??= createSimulator({ speed: settings.simSpeed })
    const sim = simRef.current
    const run = () => ingest(sim.tick(configsRef.current.filter((bed) => bed.device === SIMULATED_DEVICE)))
    run()
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
            connection: connected ? 'connected' : f.connection === 'connecting' ? 'connecting' : 'offline',
          }))
        }),
      )
      unsubscribers.push(
        onValue(
          ref(rtdb, BEDS_PATH),
          (snap) => {
            setDevices(snap.val() ?? {})
            setLastSnapshotAt(Date.now())
          },
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

  // Every unit publishing under beds/, normalized, whether assigned or not.
  const units = useMemo(() => {
    if (!devices) return []
    return Object.entries(devices)
      .filter(([, raw]) => raw && typeof raw === 'object')
      .map(([key, raw]) => ({ device: key, reading: normalizeReading(raw, key) }))
      .sort((a, b) => a.device.localeCompare(b.device, undefined, { numeric: true }))
  }, [devices])

  useEffect(() => {
    if (!devices) return
    const byBedId = {}
    for (const bed of configs) {
      if (bed.device === SIMULATED_DEVICE) continue
      const raw = devices[bed.device]
      if (raw && typeof raw === 'object') byBedId[bed.id] = normalizeReading(raw, bed.id)
    }
    if (Object.keys(byBedId).length > 0) ingest(byBedId)
  }, [devices, configs, ingest])

  // --- Merge ----------------------------------------------------------------
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

  const wardBeds = useMemo(
    () => (settings.showSimulatedBeds ? beds : beds.filter((bed) => !bed.simulated)),
    [beds, settings.showSimulatedBeds],
  )

  // Shift log: an alert is logged once when it starts and once when it ends.
  useEffect(() => {
    /** @type {Record<string, any>} */
    const active = {}
    const evaluated = new Set()
    for (const bed of beds) {
      if (!bed.reading) continue
      evaluated.add(bed.id)
      if (bed.channel === 'offline') {
        active[`${bed.id}:sensor-offline`] = {
          bedId: bed.id,
          bedLabel: bed.label,
          kind: 'sensor-offline',
          severity: 'offline',
          reason: 'Sensor offline',
        }
        continue
      }
      for (const alert of bed.alerts) {
        active[`${bed.id}:${alert.kind}`] = {
          bedId: bed.id,
          bedLabel: bed.label,
          kind: alert.kind,
          severity: alert.severity,
          reason: alert.reason,
        }
      }
    }
    recordAlertTransitions(active, evaluated)
  }, [beds])

  const value = useMemo(() => {
    const assigned = new Set(configs.map((bed) => bed.device))
    const firebaseSettled = !isFirebaseConfigured || devices !== null || firebase.connection === 'offline'
    const status =
      !isFirebaseConfigured && !settings.simulationMode ? 'not-configured' : firebaseSettled ? 'ready' : 'loading'
    return {
      beds,
      wardBeds,
      sorted: sortCriticalFirst(wardBeds, now),
      topAlert: highestActiveAlert(wardBeds, now),
      units,
      unassigned: units.filter((unit) => !assigned.has(unit.device)),
      status,
      firebase,
      lastSnapshotAt,
      settings,
      now,
    }
  }, [beds, wardBeds, units, configs, devices, firebase, lastSnapshotAt, settings, now])

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>
}

export function useMobileTelemetry() {
  const ctx = useContext(TelemetryContext)
  if (!ctx) throw new Error('useMobileTelemetry must be used inside <MobileTelemetryProvider>')
  return ctx
}
