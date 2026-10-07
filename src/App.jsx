import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router'

import { Beacon } from './components/ui.jsx'
import { TelemetryProvider, useTelemetry } from './lib/telemetry.jsx'
import { useRouteTheme } from './lib/useRouteTheme.js'
import Admin from './pages/Admin.jsx'
import BedDetail from './pages/BedDetail.jsx'
import NotFound from './pages/NotFound.jsx'
import WardView from './pages/WardView.jsx'

const NAV = [
  { to: '/', label: 'Ward' },
  { to: '/admin', label: 'Admin' },
]

/**
 * The single highest active alert across the ward, pinned under the nav on
 * every screen. Disappears entirely when nothing is wrong: there is no green
 * "all clear" bar to habituate staff into ignoring the strip.
 */
function SeverityBanner() {
  const { topAlert, beds, status } = useTelemetry()
  if (status !== 'ready' || !topAlert) return null

  const others = beds.filter((bed) => bed.channel !== 'normal').length - 1
  const acknowledged = beds.find((bed) => bed.id === topAlert.bedId)?.acknowledged ?? false

  return (
    <div
      data-severity={topAlert.severity}
      className="border-t"
      style={{ backgroundColor: 'var(--dt-sev-tint)', borderColor: 'var(--dt-chrome-border)' }}
    >
      <div
        aria-live="polite"
        className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2 text-[13px] sm:px-6"
      >
        <Beacon channel={topAlert.severity} acknowledged={acknowledged} />
        <p className="min-w-0 flex-1 truncate">
          <span className="font-semibold" style={{ color: 'var(--dt-sev)' }}>
            {topAlert.bedLabel}
          </span>
          <span className="text-ink"> · {topAlert.message}</span>
          {acknowledged && <span className="text-ink-muted"> · acknowledged</span>}
        </p>
        {others > 0 && (
          <span className="dt-nums hidden shrink-0 text-[12px] text-ink-muted sm:inline">
            +{others} more {others === 1 ? 'bed' : 'beds'}
          </span>
        )}
        <Link
          to={`/bed/${topAlert.bedId}`}
          className="shrink-0 font-semibold underline-offset-4 hover:underline"
          style={{ color: 'var(--dt-sev)' }}
        >
          View bed
        </Link>
      </div>
    </div>
  )
}

function TopBar() {
  // A bed belongs to the ward, so Ward stays lit on /bed/:id.
  const { pathname } = useLocation()
  return (
    <header className="dt-chrome sticky top-0 z-20 border-b">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <NavLink to="/" className="flex shrink-0 items-center gap-2.5">
          <svg viewBox="0 0 32 32" aria-hidden="true" className="size-6">
            <path
              d="M16 5c0 0 8.5 10.6 8.5 15.6a8.5 8.5 0 1 1-17 0C7.5 15.6 16 5 16 5Z"
              fill="var(--dt-accent)"
            />
          </svg>
          <span className="text-[15px] font-semibold tracking-tight">DripTrace</span>
        </NavLink>

        <nav aria-label="Main" className="flex items-center gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                [
                  'rounded-pill px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                  isActive || (item.to === '/' && pathname.startsWith('/bed/'))
                    ? 'bg-accent text-accent-on'
                    : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
                ].join(' ')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <SeverityBanner />
    </header>
  )
}

export default function App() {
  useRouteTheme()

  return (
    <TelemetryProvider>
      <div className="min-h-dvh bg-bg text-ink">
        <TopBar />
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <Routes>
            <Route path="/" element={<WardView />} />
            <Route path="/bed/:id" element={<BedDetail />} />
            <Route path="/admin" element={<Admin />} />
            {/* The old standalone token page now lives under Admin. */}
            <Route path="/tokens" element={<Navigate to="/admin?tab=design" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <footer className="mx-auto max-w-7xl px-4 pb-8 text-[12px] text-ink-subtle sm:px-6">
          DripTrace · KERNEL PRIME&apos;26 · {new Date().getFullYear()}
        </footer>
      </div>
    </TelemetryProvider>
  )
}
