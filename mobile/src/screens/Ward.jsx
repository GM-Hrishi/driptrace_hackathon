import { useState } from 'react'
import { Link } from 'react-router'

import { Button, formatAgo } from '../../../src/components/ui.jsx'
import { isSensorOnline } from '../../../src/lib/severity.js'
import NurseBedCard from '../components/NurseBedCard.jsx'
import { AlarmBanner, Screen, Section, TopBar } from '../components/chrome.jsx'
import { emptyAt, formatDuration, formatTime } from '../lib/format.js'
import { loadDemoWard } from '../lib/mobileStore.js'
import { useMobileTelemetry } from '../lib/mobileTelemetry.jsx'
import { can } from '../lib/roles.js'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'offline', label: 'Offline' },
]

const COUNTS = [
  { key: 'critical', label: 'Critical', filter: 'attention' },
  { key: 'caution', label: 'Caution', filter: 'attention' },
  { key: 'offline', label: 'Offline', filter: 'offline' },
  { key: 'normal', label: 'Infusing', filter: 'all' },
]

function matches(filter, bed) {
  if (filter === 'attention') return bed.channel === 'critical' || bed.channel === 'caution'
  if (filter === 'offline') return bed.channel === 'offline'
  return true
}

/** The bottle that runs out first: the one a nurse should prepare next. */
function NextChange({ beds, now }) {
  let next = null
  for (const bed of beds) {
    if (bed.channel === 'offline') continue
    const at = emptyAt(bed, now)
    if (at && (!next || at < next.at)) next = { bed, at }
  }
  if (!next) return null
  return (
    <Link to={`/bed/${next.bed.id}`} className="dt-card mb-4 flex items-center gap-3 p-4 active:bg-surface-2">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="13" r="8" />
          <path d="M12 9v4l2.5 2.5M9 2.5h6" strokeLinecap="round" />
        </svg>
      </span>
      <p className="min-w-0 flex-1 text-[14px] leading-snug">
        <span className="block text-[12px] text-ink-subtle">Next bottle change</span>
        <span className="font-semibold">{next.bed.label}</span> empties in{' '}
        <span className="dt-nums font-semibold">{formatDuration(next.at - now)}</span>
        <span className="dt-nums text-ink-muted"> · {formatTime(next.at)}</span>
      </p>
    </Link>
  )
}

function NewUnits({ units, now }) {
  if (units.length === 0 || !can('assignDevice')) return null
  return (
    <Section title="New units detected" hint="Publishing to the cloud but not on a bed yet.">
      <ul className="space-y-2">
        {units.map(({ device, reading }) => {
          const online = isSensorOnline(reading, now)
          return (
            <li key={device} className="dt-card flex items-center gap-3 p-4">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: online ? 'var(--dt-success)' : 'var(--dt-offline)' }}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="dt-nums text-[15px] font-semibold">{device}</p>
                <p className="dt-nums text-[12px] text-ink-muted">
                  {online ? 'Online' : 'Not reporting'} ·{' '}
                  {Number.isFinite(reading.bottlePercentRemaining)
                    ? `${Math.round(reading.bottlePercentRemaining)}% bottle`
                    : 'no bottle reading'}{' '}
                  · {formatAgo(reading.lastUpdated, now)}
                </p>
              </div>
              <Link
                to={`/assign/${encodeURIComponent(device)}`}
                className="rounded-pill bg-accent px-4 py-2 text-[14px] font-semibold text-accent-on"
              >
                Assign
              </Link>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function EmptyWard({ firebase }) {
  return (
    <div className="dt-card p-6 text-center">
      <h2 className="text-[17px] font-semibold">No beds on your ward yet</h2>
      <p className="mx-auto mt-2 max-w-xs text-[14px] leading-relaxed text-ink-muted">
        {firebase.connection === 'connected'
          ? 'Switch on a DripTrace unit. It appears below under “New units” within a second, ready to assign to a bed.'
          : 'Waiting for the cloud connection. Units appear here as soon as they publish.'}
      </p>
      {can('simulation') && (
        <Button className="mt-5" onClick={loadDemoWard}>
          Load demo ward
        </Button>
      )}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="dt-card h-44 p-4">
          <div className="dt-skeleton h-5 w-20 rounded-md" />
          <div className="dt-skeleton mt-4 h-20 rounded-md" />
        </div>
      ))}
    </div>
  )
}

export default function Ward() {
  const { sorted, wardBeds, unassigned, status, firebase, settings, now } = useMobileTelemetry()
  const [filter, setFilter] = useState('all')
  const counts = Object.fromEntries(COUNTS.map((c) => [c.key, wardBeds.filter((b) => b.channel === c.key).length]))
  const shown = sorted.filter((bed) => matches(filter, bed))

  return (
    <>
      <TopBar title={`Ward · ${wardBeds.length} bed${wardBeds.length === 1 ? '' : 's'}`} />
      <AlarmBanner />
      <Screen>
        {firebase.connection === 'offline' && (
          <p data-severity="offline" className="dt-card mb-4 p-3 text-[13px]" style={{ color: 'var(--dt-sev)' }}>
            {firebase.error ?? 'Cloud connection lost.'} Showing last known readings; they are marked stale after 15 s.
          </p>
        )}

        {status === 'loading' ? (
          <Skeleton />
        ) : wardBeds.length === 0 ? (
          <>
            <EmptyWard firebase={firebase} />
            <NewUnits units={unassigned} now={now} />
          </>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-4 gap-2">
              {COUNTS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  data-severity={c.key}
                  onClick={() => setFilter(c.filter)}
                  className="dt-card px-2 py-2.5 text-center"
                  style={{ borderRadius: 'var(--dt-radius-control)' }}
                >
                  <span
                    className="dt-nums block text-[22px] leading-none font-semibold"
                    style={{ color: c.key !== 'normal' && counts[c.key] > 0 ? 'var(--dt-sev)' : 'var(--dt-text)' }}
                  >
                    {counts[c.key]}
                  </span>
                  <span className="mt-1 block text-[11px] text-ink-subtle">{c.label}</span>
                </button>
              ))}
            </div>

            <NextChange beds={wardBeds} now={now} />

            <div className="mb-3 flex gap-2 overflow-x-auto" role="tablist" aria-label="Filter beds">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={`rounded-pill min-h-10 shrink-0 border px-4 text-[14px] font-medium ${
                    filter === f.key ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-muted'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {shown.length === 0 ? (
              <p className="dt-card p-5 text-center text-[14px] text-ink-muted">Nothing here. All beds are fine.</p>
            ) : (
              <ul className="space-y-3">
                {shown.map((bed) => (
                  <li key={bed.id}>
                    <NurseBedCard bed={bed} now={now} settings={settings} />
                  </li>
                ))}
              </ul>
            )}

            <NewUnits units={unassigned} now={now} />
          </>
        )}
      </Screen>
    </>
  )
}
