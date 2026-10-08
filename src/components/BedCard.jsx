import NumberFlow from '@number-flow/react'
import { Link } from 'react-router'

import { getEnabledVitals, vitalPlaceholder } from '../config/vitals.js'
import { alarmClass } from '../lib/severity.js'
import { useWardStore } from '../lib/store.js'
import IVBottle from './IVBottle.jsx'
import { Beacon, Tag, channelLabel, formatAgo } from './ui.jsx'

/**
 * One bed on the ward grid.
 *
 * Everything that signals state reads from data-severity on the card root: the
 * rail, the beacon, the bottle tint and the status line. Clinical alarms are
 * red or amber and flash at their IEC rate; a sensor that stopped reporting is
 * the steel-cyan offline channel, never flashes, and dims its numbers so stale
 * values cannot be read as live ones.
 *
 * @param {{ bed: import('../lib/telemetry.jsx').WardBed, now: number, linked?: boolean }} props
 *   linked=false renders a plain card, for the Design View showcase.
 */
export default function BedCard({ bed, now, linked = true }) {
  const Root = linked ? Link : 'div'
  // Switched off in Admin means not rendered at all, so no space is reserved.
  const vitals = getEnabledVitals(useWardStore().settings)
  const { channel, acknowledged, reading } = bed
  const offline = channel === 'offline'
  const top = bed.alerts[0]
  const deviation = bed.alerts.find((a) => a.kind === 'flow-high' || a.kind === 'flow-low')
  const ratio =
    Number.isFinite(reading?.flowRateMlPerHr) && bed.prescribedFlowMlPerHr
      ? reading.flowRateMlPerHr / bed.prescribedFlowMlPerHr
      : null

  let status
  if (bed.paused) {
    status = { text: 'Simulation is off. Turn it on in Admin to resume this bed.', tone: 'sev' }
  } else if (!reading) {
    status = { text: `Waiting for ${bed.device} to publish its first reading`, tone: 'sev' }
  } else if (offline) {
    status = { text: 'Sensor offline. Readings below are stale.', tone: 'sev' }
  } else if (top) {
    const more = bed.alerts.length > 1 ? ` (+${bed.alerts.length - 1} more)` : ''
    status = { text: `${top.message}${more}`, tone: 'sev' }
  } else {
    status = { text: 'Within prescribed range', tone: 'muted' }
  }

  return (
    <Root
      {...(linked ? { to: `/bed/${bed.id}` } : {})}
      data-severity={channel}
      className="dt-card hover:shadow-card-hover relative flex h-full flex-col overflow-hidden p-5 pl-6 transition-shadow"
    >
      {/* Status rail */}
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-1.5 ${alarmClass(channel, acknowledged)}`}
        style={{ backgroundColor: 'var(--dt-sev)' }}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            {bed.label}
            {bed.simulated && <Tag>Sim</Tag>}
          </p>
          <p className="dt-nums mt-0.5 truncate text-[12px] text-ink-muted">{bed.patientId}</p>
        </div>
        <span
          className="flex shrink-0 items-center gap-2 text-[12px] font-semibold"
          style={{ color: channel === 'normal' ? 'var(--dt-text-muted)' : 'var(--dt-sev)' }}
        >
          <Beacon channel={channel} acknowledged={acknowledged} />
          {acknowledged ? `${channelLabel(channel)} · Ack` : channelLabel(channel)}
        </span>
      </div>

      <div className="mt-4 flex items-end gap-5">
        <IVBottle
          size="compact"
          fraction={(reading?.bottlePercentRemaining ?? 0) / 100}
          dropsPerMin={offline ? 0 : (reading?.dropsPerMin ?? 0)}
          status={channel}
          label={bed.label}
        />
        <div className={`min-w-0 flex-1 pb-1 ${offline ? 'opacity-60' : ''}`}>
          <p className="text-[11px] font-medium tracking-wide text-ink-subtle uppercase">Flow rate</p>
          <p className="dt-nums mt-1 flex items-baseline gap-1.5 leading-none">
            <span className="text-[32px] font-semibold">
              {Number.isFinite(reading?.flowRateMlPerHr) ? (
                <NumberFlow
                  value={reading.flowRateMlPerHr}
                  format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
                />
              ) : (
                '—'
              )}
            </span>
            <span className="text-[13px] text-ink-muted">mL/hr</span>
          </p>
          <p className="dt-nums mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-muted">
            <span>Rx {bed.prescribedFlowMlPerHr}</span>
            {deviation && ratio !== null && !offline && (
              <span
                className="rounded-pill px-1.5 py-px font-semibold"
                style={{ color: 'var(--dt-sev)', backgroundColor: 'var(--dt-sev-tint)' }}
              >
                {ratio.toFixed(1)}x
              </span>
            )}
            <span aria-hidden="true">·</span>
            <span>
              {Number.isFinite(reading?.bottlePercentRemaining)
                ? `${Math.round(reading.bottlePercentRemaining)}% left`
                : '—'}
            </span>
          </p>
          {vitals.length > 0 && (
            <p className="dt-nums mt-1.5 flex flex-wrap gap-x-3 text-[12px] text-ink-muted">
              {vitals.map((vital) => {
                const value = vital.getValue(reading)
                return (
                  <span key={vital.key}>
                    <span className="text-ink-subtle">{vital.label}</span>{' '}
                    {value !== null
                      ? `${value}${vital.unit === '%' ? '%' : ` ${vital.unit}`}`
                      : vitalPlaceholder(reading, 'short')}
                  </span>
                )
              })}
            </p>
          )}
        </div>
      </div>

      <div className="mt-auto flex items-start justify-between gap-3 border-t border-line pt-3 text-[12px]">
        <p
          className="line-clamp-2 min-h-[2lh] leading-snug"
          style={{ color: status.tone === 'sev' ? 'var(--dt-sev)' : 'var(--dt-text-muted)' }}
        >
          {status.text}
        </p>
        <p className="dt-nums shrink-0 text-ink-subtle">
          {reading ? formatAgo(reading.lastUpdated, now) : ''}
        </p>
      </div>
    </Root>
  )
}

/** Loading placeholder with the card's exact geometry, so nothing jumps when data lands. */
export function BedCardSkeleton() {
  const vitalsRow = getEnabledVitals(useWardStore().settings).length > 0
  return (
    <div className="dt-card relative flex h-full flex-col overflow-hidden p-5 pl-6" aria-hidden="true">
      <span className="bg-surface-3 absolute inset-y-0 left-0 w-1.5" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="dt-skeleton h-[18px] w-16 rounded-md" />
          <div className="dt-skeleton mt-1.5 h-3.5 w-24 rounded-md" />
        </div>
        <div className="dt-skeleton h-4 w-16 rounded-md" />
      </div>
      <div className="mt-4 flex items-end gap-5">
        <div className="dt-skeleton h-[109px] w-16 rounded-[18px]" />
        <div className="flex-1 pb-1">
          <div className="dt-skeleton h-3 w-16 rounded-md" />
          <div className="dt-skeleton mt-2 h-8 w-32 rounded-md" />
          <div className="dt-skeleton mt-2.5 h-3.5 w-28 rounded-md" />
          {vitalsRow && <div className="dt-skeleton mt-2 h-3.5 w-32 rounded-md" />}
        </div>
      </div>
      <div className="mt-auto flex justify-between gap-3 border-t border-line pt-3">
        <div className="dt-skeleton h-8 w-40 rounded-md" />
        <div className="dt-skeleton h-3.5 w-12 rounded-md" />
      </div>
    </div>
  )
}
