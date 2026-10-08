import { Link } from 'react-router'

import IVBottle from '../../../src/components/IVBottle.jsx'
import { Beacon, Tag, channelLabel, formatAgo } from '../../../src/components/ui.jsx'
import { getEnabledVitals } from '../../../src/config/vitals.js'
import { alarmClass } from '../../../src/lib/severity.js'
import { emptyAt, fixed1, formatDuration, formatTime, remainingMl } from '../lib/format.js'

/**
 * One bed in the nurse's ward list. Built for a glance from arm's length:
 * flow, how much is left and when it runs out, then the one thing to do.
 * Severity is carried by data-severity exactly as on the website's BedCard.
 */
export default function NurseBedCard({ bed, now, settings }) {
  const { channel, acknowledged, reading } = bed
  const offline = channel === 'offline'
  const top = bed.alerts[0]
  const vitals = getEnabledVitals(settings)
  const left = remainingMl(bed)
  const eta = offline ? null : emptyAt(bed, now)

  let status
  if (bed.paused) status = { text: 'Simulation is off — turn it on in Settings.', sev: true }
  else if (!reading) status = { text: `Waiting for ${bed.device} to report`, sev: true }
  else if (offline) status = { text: 'Sensor offline — readings are stale', sev: true }
  else if (top) {
    const more = bed.alerts.length > 1 ? ` (+${bed.alerts.length - 1})` : ''
    status = { text: `${top.reason} — ${top.action}${more}`, sev: true }
  } else status = { text: 'Infusing as prescribed', sev: false }

  return (
    <Link
      to={`/bed/${bed.id}`}
      data-severity={channel}
      className="dt-card relative block overflow-hidden p-4 pl-5 active:bg-surface-2"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-1.5 ${alarmClass(channel, acknowledged)}`}
        style={{ backgroundColor: 'var(--dt-sev)' }}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[17px] font-semibold">
            {bed.label}
            {bed.simulated && <Tag>Sim</Tag>}
          </p>
          <p className="dt-nums truncate text-[13px] text-ink-muted">{bed.patientId}</p>
        </div>
        <span
          className="flex shrink-0 items-center gap-2 text-[13px] font-semibold"
          style={{ color: channel === 'normal' ? 'var(--dt-text-muted)' : 'var(--dt-sev)' }}
        >
          <Beacon channel={channel} acknowledged={acknowledged} />
          {acknowledged ? `${channelLabel(channel)} · Ack` : channelLabel(channel)}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-4">
        <div className="w-14 shrink-0">
          <IVBottle
            size="compact"
            fraction={(reading?.bottlePercentRemaining ?? 0) / 100}
            dropsPerMin={offline ? 0 : (reading?.dropsPerMin ?? 0)}
            status={channel}
            label={bed.label}
          />
        </div>
        <dl className={`dt-nums grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-2 ${offline ? 'opacity-60' : ''}`}>
          <div>
            <dt className="text-[11px] tracking-wide text-ink-subtle uppercase">Flow</dt>
            <dd className="text-[22px] leading-tight font-semibold">
              {fixed1(reading?.flowRateMlPerHr)}
              <span className="ml-1 text-[12px] font-normal text-ink-muted">mL/h</span>
            </dd>
            <dd className="text-[12px] text-ink-muted">Rx {bed.prescribedFlowMlPerHr}</dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-wide text-ink-subtle uppercase">Left</dt>
            <dd className="text-[22px] leading-tight font-semibold">
              {Number.isFinite(reading?.bottlePercentRemaining) ? Math.round(reading.bottlePercentRemaining) : '—'}
              <span className="ml-0.5 text-[12px] font-normal text-ink-muted">%</span>
            </dd>
            <dd className="text-[12px] text-ink-muted">{left !== null ? `${Math.round(left)} mL` : '—'}</dd>
          </div>
          <div className="col-span-2 text-[12px] text-ink-muted">
            {eta ? (
              <>
                Empty in <span className="font-semibold text-ink">{formatDuration(eta - now)}</span> · {formatTime(eta)}
              </>
            ) : (
              'No time-to-empty while not flowing'
            )}
            {vitals.length > 0 && (
              <span className="block">
                {vitals.map((vital) => {
                  const value = vital.getValue(reading)
                  return (
                    <span key={vital.key} className="mr-3">
                      <span className="text-ink-subtle">{vital.label}</span> {value ?? '—'}
                      {vital.unit === '%' ? '%' : ` ${vital.unit}`}
                    </span>
                  )
                })}
              </span>
            )}
          </div>
        </dl>
      </div>

      <div className="mt-3 flex items-start justify-between gap-3 border-t border-line pt-2.5 text-[13px]">
        <p className="leading-snug" style={{ color: status.sev ? 'var(--dt-sev)' : 'var(--dt-text-muted)' }}>
          {status.text}
        </p>
        <p className="dt-nums shrink-0 text-[12px] text-ink-subtle">
          {reading ? formatAgo(reading.lastUpdated, now) : ''}
        </p>
      </div>
    </Link>
  )
}
