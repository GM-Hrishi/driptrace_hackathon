import { missingFirebaseConfig } from '../lib/firebase.js'
import { updateSettings } from '../lib/store.js'
import { useTelemetry } from '../lib/telemetry.jsx'
import { Button } from './ui.jsx'

/**
 * Connection and data-readiness states, shared by every screen so the ward,
 * a bed and the admin page all say the same thing about the same situation.
 *
 *   not-configured  no Firebase config and simulation off: explain the setup
 *   loading         a source is connecting: render the screen's skeleton
 *   ready           render the screen, with a banner if Firebase dropped out
 *                   or if what is on screen is simulated
 */

export function NotConfiguredCard({ compact = false }) {
  return (
    <div className="dt-card p-6">
      <h2 className="text-base font-semibold">Firebase is not connected</h2>
      <p className="mt-2 max-w-prose text-[14px] leading-relaxed text-ink-muted">
        Copy <code className="dt-nums text-[13px]">.env.example</code> to{' '}
        <code className="dt-nums text-[13px]">.env.local</code> and fill in the project
        configuration. The dashboard reads live bed data once these are set.
      </p>
      {!compact && (
        <ul className="mt-4 space-y-1.5">
          {missingFirebaseConfig.map((key) => (
            <li key={key} className="dt-nums text-[13px] text-ink-muted">
              {key}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => updateSettings({ simulationMode: true })}>
          Turn on simulation mode
        </Button>
        <p className="text-[12px] text-ink-subtle">
          Runs simulated beds in this browser. Nothing is written anywhere.
        </p>
      </div>
    </div>
  )
}

/**
 * Status line under the page header. Offline uses the offline channel, never
 * caution or critical: losing the database is an engineering fault, and the
 * readings on screen are stale, not alarming.
 */
export function ConnectionBanner() {
  const { firebase, simulation } = useTelemetry()

  if (firebase.connection === 'offline') {
    return (
      <div
        data-severity="offline"
        role="status"
        className="rounded-control mb-5 flex items-start gap-3 border px-4 py-3 text-[13px]"
        style={{ borderColor: 'var(--dt-sev)', backgroundColor: 'var(--dt-sev-tint)' }}
      >
        <span
          aria-hidden="true"
          className="mt-1 inline-block size-2.5 shrink-0 rounded-full border-2"
          style={{ borderColor: 'var(--dt-sev)' }}
        />
        <p>
          <span className="font-semibold" style={{ color: 'var(--dt-sev)' }}>
            Connection to Firebase lost.
          </span>{' '}
          <span className="text-ink-muted">
            {firebase.error ?? 'Hardware beds show their last known readings until it returns.'}
          </span>
        </p>
      </div>
    )
  }

  if (simulation) {
    return (
      <p className="mb-5 flex items-center gap-2 text-[12px] text-ink-subtle">
        <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-ink-subtle" />
        {firebase.connection === 'not-configured'
          ? 'Simulation mode. Firebase is not connected, so every bed on screen is simulated.'
          : 'Simulation mode is on. Simulated beds are tagged SIM.'}
      </p>
    )
  }

  return null
}

/**
 * Renders one of the three states. `skeleton` is the screen's own loading
 * layout, so the page holds its final geometry while data arrives.
 */
export function DataGate({ skeleton, children }) {
  const { status } = useTelemetry()
  if (status === 'not-configured') return <NotConfiguredCard />
  if (status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Loading ward data">
        {skeleton}
      </div>
    )
  }
  return (
    <>
      <ConnectionBanner />
      {children}
    </>
  )
}
