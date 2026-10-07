import { NavLink, Route, Routes } from 'react-router'

import { useRouteTheme } from './lib/useRouteTheme.js'
import DesignTokens from './pages/DesignTokens.jsx'
import NotFound from './pages/NotFound.jsx'
import WardView from './pages/WardView.jsx'

const NAV = [
  { to: '/', label: 'Ward' },
  { to: '/tokens', label: 'Design tokens' },
]

function TopBar() {
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
                  isActive
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
    </header>
  )
}

export default function App() {
  useRouteTheme()

  return (
    <div className="min-h-dvh bg-bg text-ink">
      <TopBar />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Routes>
          <Route path="/" element={<WardView />} />
          <Route path="/tokens" element={<DesignTokens />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="mx-auto max-w-7xl px-4 pb-8 text-[12px] text-ink-subtle sm:px-6">
        DripTrace · KERNEL PRIME&apos;26 · {new Date().getFullYear()}
      </footer>
    </div>
  )
}
