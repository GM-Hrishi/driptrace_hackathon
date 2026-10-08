import { Link } from 'react-router'

import { Beacon, Button, ConfirmButton, channelLabel } from '../../../src/components/ui.jsx'
import { Screen, Section, TopBar } from '../components/chrome.jsx'
import { formatDateTime, formatTime } from '../lib/format.js'
import { acknowledgeAlert, clearLog, useMobileStore } from '../lib/mobileStore.js'
import { useMobileTelemetry } from '../lib/mobileTelemetry.jsx'
import { can } from '../lib/roles.js'

const EVENT_LABEL = { raised: 'Raised', cleared: 'Cleared', acknowledged: 'Acknowledged' }

function ActiveAlerts({ beds }) {
  const active = beds.filter((bed) => bed.channel !== 'normal' && !bed.paused && bed.reading)
  if (active.length === 0) {
    return <p className="dt-card p-5 text-center text-[14px] text-ink-muted">No active alerts on the ward.</p>
  }
  return (
    <ul className="space-y-2">
      {active.map((bed) => {
        const top = bed.channel === 'offline' ? null : bed.alerts[0]
        return (
          <li key={bed.id} data-severity={bed.channel} className="dt-card flex items-center gap-3 p-4">
            <Beacon channel={bed.channel} acknowledged={bed.acknowledged} />
            <Link to={`/bed/${bed.id}`} className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold">
                {bed.label} <span className="font-normal text-ink-muted">· {channelLabel(bed.channel)}</span>
              </p>
              <p className="text-[13px] leading-snug" style={{ color: 'var(--dt-sev)' }}>
                {top ? top.message : 'Sensor offline — check the unit'}
              </p>
              {bed.acknowledged && (
                <p className="text-[12px] text-ink-subtle">Acknowledged {formatTime(bed.acknowledgedAt)}</p>
              )}
            </Link>
            {top && !bed.acknowledged && can('acknowledge') && (
              <Button variant="primary" className="min-h-11 shrink-0" onClick={() => acknowledgeAlert(bed, top)}>
                Ack
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function ShiftLog({ log }) {
  if (log.length === 0) {
    return <p className="dt-card p-5 text-center text-[14px] text-ink-muted">Nothing logged yet this shift.</p>
  }
  return (
    <ol className="dt-card divide-y divide-line">
      {log.map((entry) => (
        <li
          key={entry.id}
          data-severity={entry.event === 'raised' ? entry.severity : 'normal'}
          className="flex gap-3 px-4 py-3"
        >
          <span
            aria-hidden="true"
            className="mt-1.5 size-2 shrink-0 rounded-full"
            style={{ backgroundColor: entry.event === 'raised' ? 'var(--dt-sev)' : 'var(--dt-border-strong)' }}
          />
          <div className="min-w-0 flex-1 text-[14px]">
            <p>
              <span className="font-semibold">{entry.bedLabel}</span>{' '}
              <span className="text-ink-muted">· {EVENT_LABEL[entry.event] ?? entry.event}</span>
            </p>
            <p className="text-[13px] text-ink-muted">{entry.reason}</p>
          </div>
          <time className="dt-nums shrink-0 text-[12px] text-ink-subtle" dateTime={new Date(entry.at).toISOString()}>
            {formatDateTime(entry.at)}
          </time>
        </li>
      ))}
    </ol>
  )
}

export default function Alerts() {
  const { wardBeds } = useMobileTelemetry()
  const { log } = useMobileStore()

  return (
    <>
      <TopBar title="Alerts" />
      <Screen>
        <Section title="Active now">
          <ActiveAlerts beds={wardBeds} />
        </Section>
        {can('viewAlertLog') && (
          <Section
            title="Shift log"
            hint="Every alert raised, acknowledged and cleared. Stored on this phone."
            action={
              log.length > 0 && (
                <ConfirmButton confirmLabel="Tap to clear" onConfirm={clearLog}>
                  Clear
                </ConfirmButton>
              )
            }
          >
            <ShiftLog log={log} />
          </Section>
        )}
      </Screen>
    </>
  )
}
