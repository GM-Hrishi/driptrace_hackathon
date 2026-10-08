import { NavLink, useNavigate } from 'react-router'

import { Beacon } from '../../../src/components/ui.jsx'
import { can } from '../lib/roles.js'
import { useMobileTelemetry } from '../lib/mobileTelemetry.jsx'

/**
 * App chrome: top bar, ward alarm banner, bottom tab bar. The only glass in
 * the app, same rule as the website (dt-chrome).
 */

const CONNECTION = {
  connected: { label: 'Live', tone: 'var(--dt-success)' },
  connecting: { label: 'Connecting', tone: 'var(--dt-text-subtle)' },
  offline: { label: 'Offline', tone: 'var(--dt-critical)' },
  'not-configured': { label: 'No cloud', tone: 'var(--dt-text-subtle)' },
}

function DropMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="currentColor">
      <path d="M12 2.5c-.3 0-.6.2-.8.4C9.6 5 5.5 10.3 5.5 14.5a6.5 6.5 0 0 0 13 0c0-4.2-4.1-9.5-5.7-11.6a1 1 0 0 0-.8-.4Z" />
    </svg>
  )
}

export function TopBar({ title, back = false, action = null }) {
  const navigate = useNavigate()
  const { firebase, settings } = useMobileTelemetry()
  const conn = CONNECTION[firebase.connection] ?? CONNECTION.connecting

  return (
    <header
      className="dt-chrome sticky top-0 z-30 border-b"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="mx-auto flex h-14 max-w-xl items-center gap-2 px-3">
        {back ? (
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
            className="rounded-pill -ml-1 flex size-11 items-center justify-center text-ink hover:bg-surface-2"
            aria-label="Back"
          >
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
          <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <DropMark />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] leading-tight font-semibold">{title}</h1>
        </div>
        {action}
        <span
          className="rounded-pill flex items-center gap-1.5 border border-line px-2.5 py-1 text-[12px] font-medium text-ink-muted"
          title={firebase.error ?? conn.label}
        >
          <span className="size-2 rounded-full" style={{ backgroundColor: conn.tone }} />
          {settings.simulationMode && firebase.connection !== 'connected' ? 'Demo' : conn.label}
        </span>
      </div>
    </header>
  )
}

/** Highest active alarm on the ward. Hidden when nothing is wrong. */
export function AlarmBanner() {
  const { topAlert, wardBeds, status } = useMobileTelemetry()
  const navigate = useNavigate()
  if (status !== 'ready' || !topAlert) return null
  const others = wardBeds.filter((bed) => bed.channel !== 'normal').length - 1
  const acknowledged = wardBeds.find((bed) => bed.id === topAlert.bedId)?.acknowledged ?? false

  return (
    <button
      type="button"
      data-severity={topAlert.severity}
      onClick={() => navigate(`/bed/${topAlert.bedId}`)}
      className="sticky z-20 block w-full border-b text-left"
      style={{
        top: 'calc(3.5rem + env(safe-area-inset-top))',
        backgroundColor: 'var(--dt-sev-tint)',
        borderColor: 'var(--dt-chrome-border)',
      }}
    >
      <div aria-live="assertive" className="mx-auto flex max-w-xl items-center gap-3 px-4 py-2.5">
        <Beacon channel={topAlert.severity} acknowledged={acknowledged} />
        <p className="min-w-0 flex-1 text-[14px] leading-snug">
          <span className="font-semibold" style={{ color: 'var(--dt-sev)' }}>
            {topAlert.bedLabel} · {topAlert.reason}
          </span>
          {acknowledged && <span className="text-ink-muted"> · acknowledged</span>}
          {others > 0 && (
            <span className="block text-[12px] text-ink-muted">
              +{others} more bed{others > 1 ? 's' : ''} need attention
            </span>
          )}
        </p>
        <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-ink-muted" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </button>
  )
}

function TabIcon({ name }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }
  if (name === 'ward') {
    return (
      <svg viewBox="0 0 24 24" className="size-6" {...common}>
        <rect x="3.5" y="4" width="7" height="7" rx="2" />
        <rect x="13.5" y="4" width="7" height="7" rx="2" />
        <rect x="3.5" y="14" width="7" height="7" rx="2" />
        <rect x="13.5" y="14" width="7" height="7" rx="2" />
      </svg>
    )
  }
  if (name === 'alerts') {
    return (
      <svg viewBox="0 0 24 24" className="size-6" {...common}>
        <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15Z" />
        <path d="M10 20.5a2 2 0 0 0 4 0" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" className="size-6" {...common}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  )
}

export function TabBar() {
  const { wardBeds } = useMobileTelemetry()
  const unacked = wardBeds.filter(
    (bed) => (bed.channel === 'critical' || bed.channel === 'caution') && !bed.acknowledged,
  ).length

  const tabs = [
    can('viewWard') && { to: '/', label: 'Ward', icon: 'ward', end: true },
    can('viewAlertLog') && { to: '/alerts', label: 'Alerts', icon: 'alerts', badge: unacked },
    { to: '/settings', label: 'Settings', icon: 'settings' },
  ].filter(Boolean)

  return (
    <nav
      className="dt-chrome fixed inset-x-0 bottom-0 z-30 border-t"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Main"
    >
      <div className="mx-auto grid h-16 max-w-xl" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${isActive ? 'text-accent' : 'text-ink-subtle'}`
            }
          >
            <TabIcon name={tab.icon} />
            {tab.label}
            {tab.badge > 0 && (
              <span
                data-severity="critical"
                aria-label={`${tab.badge} unacknowledged`}
                className="dt-nums absolute top-2 left-1/2 ml-2 min-w-[18px] rounded-full px-1 text-center text-[10px] leading-[18px] font-semibold text-white"
                style={{ backgroundColor: 'var(--dt-sev)' }}
              >
                {tab.badge}
              </span>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

/** Screen body with room for the fixed tab bar. */
export function Screen({ children }) {
  return (
    <main
      className="mx-auto max-w-xl px-4 pt-4"
      style={{ paddingBottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}
    >
      {children}
    </main>
  )
}

export function Section({ title, hint, children, action = null }) {
  return (
    <section className="mt-6 first:mt-0">
      <div className="mb-2 flex items-end justify-between gap-3 px-1">
        <div>
          <h2 className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">{title}</h2>
          {hint && <p className="mt-0.5 text-[12px] text-ink-subtle">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Toggle({ label, hint, checked, onChange, disabled = false }) {
  return (
    <label className={`flex min-h-14 items-center gap-3 px-4 py-3 ${disabled ? 'opacity-50' : ''}`}>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px]">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-snug text-ink-subtle">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className="relative h-7 w-12 shrink-0 rounded-full bg-surface-3 transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-accent after:absolute after:top-1 after:left-1 after:size-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5"
      />
    </label>
  )
}

/** Opaque grouped list, settings style. */
export function Group({ children }) {
  return <div className="dt-card divide-y divide-line overflow-hidden">{children}</div>
}

export function Field({ label, error, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-muted">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[12px] text-critical">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-[12px] text-ink-subtle">{hint}</span>
      )}
    </label>
  )
}

export const inputClass =
  'rounded-control block min-h-12 w-full border border-line-strong bg-surface-2 px-3 text-[16px] text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none'
