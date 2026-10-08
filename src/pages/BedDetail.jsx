import NumberFlow from '@number-flow/react'
import { Link, useNavigate, useParams } from 'react-router'

import { DataGate } from '../components/DataState.jsx'
import FlowTrendChart from '../components/FlowTrendChart.jsx'
import IVBottle from '../components/IVBottle.jsx'
import { Beacon, Button, ConfirmButton, Tag, buttonClass, channelLabel, formatAgo, formatClock } from '../components/ui.jsx'
import { getEnabledVitals } from '../config/vitals.js'
import { SCENARIOS } from '../lib/mockBeds.js'
import { alarmClass } from '../lib/severity.js'
import { acknowledgeAlert, removeBed, updateBed } from '../lib/store.js'
import { useTelemetry } from '../lib/telemetry.jsx'

/**
 * Bed detail: everything about one infusion on a single screen.
 */

const ONE = { maximumFractionDigits: 1, minimumFractionDigits: 1 }
const WHOLE = { maximumFractionDigits: 0 }

function BackLink() {
  return (
    <Link to="/" className={`${buttonClass('ghost', 'sm')} -ml-3 mb-4`}>
      <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
        <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Back to ward
    </Link>
  )
}

/** Hours and minutes from a duration, e.g. "1h 12m". */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const totalMin = Math.round(ms / 60_000)
  const h = Math.floor(totalMin / 60)
  return h > 0 ? `${h}h ${totalMin % 60}m` : `${totalMin}m`
}

/**
 * One readout. `severity` tints the tile only when an alert is about this
 * exact quantity; otherwise it stays neutral, so colour on the KPI row always
 * points at the number that is wrong.
 */
function Kpi({ label, value, unit, format = WHOLE, sub, severity, stale }) {
  return (
    <div
      data-severity={severity ?? 'normal'}
      className="dt-card p-4"
      style={severity ? { borderColor: 'var(--dt-sev)', backgroundColor: 'var(--dt-sev-tint)' } : undefined}
    >
      <p className="text-[11px] font-medium tracking-wide text-ink-subtle uppercase">{label}</p>
      <p className={`dt-nums mt-2 flex items-baseline gap-1.5 leading-none ${stale ? 'opacity-60' : ''}`}>
        <span className="text-[26px] font-semibold">
          {Number.isFinite(value) ? <NumberFlow value={value} format={format} /> : '—'}
        </span>
        <span className="text-[12px] text-ink-muted">{unit}</span>
      </p>
      <p
        className="dt-nums mt-2 min-h-[1lh] truncate text-[12px]"
        style={{ color: severity ? 'var(--dt-sev)' : 'var(--dt-text-subtle)' }}
      >
        {sub}
      </p>
    </div>
  )
}

function AlarmPanel({ bed, now }) {
  const { channel, alerts, acknowledged } = bed
  const offline = channel === 'offline'
  const top = alerts[0]

  return (
    <section data-severity={channel} aria-labelledby="alarms-title" className="dt-card relative overflow-hidden p-5 pl-6">
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-1.5 ${alarmClass(channel, acknowledged)}`}
        style={{ backgroundColor: 'var(--dt-sev)' }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="alarms-title" className="flex items-center gap-2.5 text-[15px] font-semibold">
          <Beacon channel={channel} acknowledged={acknowledged} />
          Alarms
        </h2>
        {top && !offline && !acknowledged && (
          <Button size="sm" variant="secondary" onClick={() => acknowledgeAlert(bed.id, top.kind)}>
            Acknowledge
          </Button>
        )}
      </div>

      {offline ? (
        <p className="mt-3 text-[13px] leading-relaxed" style={{ color: 'var(--dt-sev)' }}>
          {bed.paused
            ? 'Simulation is off, so this bed is not reporting. Alarms resume when it is turned back on.'
            : 'Sensor offline. Alarms cannot be evaluated until the unit reports again; the last values on this page are stale.'}
        </p>
      ) : alerts.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-muted">No active alarms. Flow is within the prescribed range.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {alerts.map((alert, i) => (
            <li
              key={alert.kind}
              data-severity={alert.severity}
              className="rounded-control flex items-start gap-3 border px-3.5 py-2.5"
              style={{ borderColor: 'var(--dt-sev)', backgroundColor: 'var(--dt-sev-tint)' }}
            >
              <span className="dt-nums mt-px w-8 shrink-0 text-[11px] font-semibold tracking-wide uppercase" style={{ color: 'var(--dt-sev)' }}>
                {alert.severity === 'critical' ? 'High' : 'Med'}
              </span>
              <div className="min-w-0 text-[13px] leading-snug">
                <p className="font-semibold" style={{ color: 'var(--dt-sev)' }}>
                  {alert.reason}
                </p>
                <p className="text-ink-muted">
                  {alert.action.charAt(0).toUpperCase() + alert.action.slice(1)}.
                  {i === 0 && acknowledged && (
                    <span className="text-ink-subtle">
                      {' '}
                      Acknowledged at {formatClock(bed.acknowledgedAt)}; flashing paused until the condition changes.
                    </span>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="dt-nums mt-3 text-[11px] text-ink-subtle">
        Evaluated {bed.reading ? formatAgo(bed.reading.lastUpdated, now) : 'never'}
      </p>
    </section>
  )
}

function SensorStatus({ bed, now }) {
  const online = bed.channel !== 'offline'
  return (
    <div
      data-severity={online ? 'normal' : 'offline'}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4 text-[12px] text-ink-muted"
    >
      <span className="flex items-center gap-2 font-medium" style={{ color: online ? 'var(--dt-text)' : 'var(--dt-sev)' }}>
        {online ? (
          <span aria-hidden="true" className="inline-block size-2 rounded-full bg-ink-subtle" />
        ) : (
          <Beacon channel="offline" />
        )}
        Sensor {online ? 'online' : 'offline'}
      </span>
      <span className="dt-nums">Last publish {bed.reading ? formatAgo(bed.reading.lastUpdated, now) : 'never'}</span>
      <span>{bed.simulated ? 'Simulated unit' : <>ESP32 <span className="dt-nums">{bed.device}</span></>}</span>
      <span>Load cell HX711 · Pulse oximeter MAX30102</span>
      {bed.simulated && (
        <label className="ml-auto flex items-center gap-2">
          <span>Scenario</span>
          <select
            value={bed.scenario}
            onChange={(e) => updateBed(bed.id, { scenario: e.target.value })}
            className="rounded-control border border-line-strong bg-surface-2 px-2 py-1 text-[12px] text-ink"
          >
            {SCENARIOS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}

function BedDetailBody({ bed, now, settings, onRemove }) {
  const { reading, channel } = bed
  const offline = channel === 'offline'
  const sevFor = (...kinds) => (offline ? undefined : bed.alerts.find((a) => kinds.includes(a.kind))?.severity)

  const pct = reading?.bottlePercentRemaining
  const remainingMl = Number.isFinite(pct) ? (pct / 100) * bed.volumeMl : NaN
  const flow = reading?.flowRateMlPerHr
  const ratio = Number.isFinite(flow) ? flow / bed.prescribedFlowMlPerHr : NaN
  const toEmpty = flow > 1 ? (remainingMl / flow) * 3_600_000 : NaN

  return (
    <>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold">
            {bed.label}
            {bed.simulated && <Tag>Sim</Tag>}
          </h1>
          <p className="dt-nums mt-1 text-[14px] text-ink-muted">{bed.patientId}</p>
        </div>
        <div className="flex items-center gap-3">
          <span
            data-severity={channel}
            className="rounded-pill flex items-center gap-2 border px-3 py-1.5 text-[13px] font-semibold"
            style={{
              color: channel === 'normal' ? 'var(--dt-text-muted)' : 'var(--dt-sev)',
              borderColor: 'var(--dt-sev)',
              backgroundColor: 'var(--dt-sev-tint)',
            }}
          >
            <Beacon channel={channel} acknowledged={bed.acknowledged} />
            {channelLabel(channel)}
          </span>
          {/* Unregisters the bed in this browser only. A hardware unit keeps
              publishing to the Realtime Database; client writes there are denied. */}
          <ConfirmButton confirmLabel="Confirm remove" onConfirm={onRemove}>
            Remove bed
          </ConfirmButton>
        </div>
        <dl className="grid w-full grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-3 lg:grid-cols-5">
          {[
            ['Bed / room', bed.bedNumber],
            ['Device', bed.simulated ? 'Simulated' : bed.device, !bed.simulated],
            ['IV started', bed.ivStartAt ? `${formatClock(bed.ivStartAt)} · ${formatDuration(now - bed.ivStartAt)} ago` : 'Not recorded', Boolean(bed.ivStartAt)],
            ['Prescribed', `${bed.prescribedFlowMlPerHr} mL/hr · ${bed.volumeMl} mL bottle`, true],
            ['Clinician', bed.clinician || '—'],
          ].map(([term, detail, numeric]) => (
            <div key={term} className="min-w-0">
              <dt className="text-[11px] font-medium tracking-wide text-ink-subtle uppercase">{term}</dt>
              <dd className={`mt-0.5 truncate ${numeric ? 'dt-nums' : ''}`}>{detail}</dd>
            </div>
          ))}
        </dl>
        {bed.notes && <p className="w-full text-[13px] text-ink-muted">{bed.notes}</p>}
      </header>

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div data-severity={channel} className="dt-card relative flex flex-col items-center overflow-hidden p-6 pl-7">
          <span
            aria-hidden="true"
            className={`absolute inset-y-0 left-0 w-1.5 ${alarmClass(channel, bed.acknowledged)}`}
            style={{ backgroundColor: 'var(--dt-sev)' }}
          />
          <IVBottle
            size="hero"
            fraction={(pct ?? 0) / 100}
            dropsPerMin={offline ? 0 : (reading?.dropsPerMin ?? 0)}
            status={channel}
            label={bed.label}
          />
          <p className={`dt-nums mt-5 text-[40px] leading-none font-semibold ${offline ? 'opacity-60' : ''}`}>
            {Number.isFinite(pct) ? <NumberFlow value={pct} format={ONE} /> : '—'}
            <span className="ml-1 text-base font-normal text-ink-muted">%</span>
          </p>
          <p className="dt-nums mt-2 text-[13px] text-ink-muted">
            {Number.isFinite(remainingMl) ? `${Math.round(remainingMl)} of ${bed.volumeMl} mL` : '—'}
          </p>
          <p className="dt-nums mt-1 text-[12px] text-ink-subtle">
            {offline ? 'Stale reading' : Number.isFinite(toEmpty) ? `Empty in ~${formatDuration(toEmpty)} at this rate` : 'Not flowing'}
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Kpi
              label="Flow rate"
              value={flow}
              unit="mL/hr"
              format={ONE}
              stale={offline}
              severity={sevFor('flow-high', 'flow-low', 'flow-stopped')}
              sub={Number.isFinite(ratio) ? `Rx ${bed.prescribedFlowMlPerHr} · ${ratio.toFixed(1)}x` : `Rx ${bed.prescribedFlowMlPerHr}`}
            />
            <Kpi
              label="Bottle remaining"
              value={pct}
              unit="%"
              format={ONE}
              stale={offline}
              severity={sevFor('low-volume', 'bottle-empty')}
              sub={`Alarm below ${bed.lowVolumePct ?? settings.lowVolumePct}%`}
            />
            <Kpi label="Drops / min" value={reading?.dropsPerMin} unit="gtt" stale={offline} sub="20 gtt/mL set" />
            <Kpi label="Weight" value={reading?.weightGrams} unit="g" format={ONE} stale={offline} sub="Bottle + set, HX711" />
            {getEnabledVitals(settings).map((vital) => (
              <Kpi
                key={vital.key}
                label={vital.fullLabel}
                value={vital.getValue(reading) ?? NaN}
                unit={vital.unit}
                stale={offline}
                sub={vital.source}
              />
            ))}
          </div>

          <section aria-labelledby="trend-title" className="dt-card p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="trend-title" className="text-[15px] font-semibold">
                Flow rate trend
              </h2>
              <p className="text-[12px] text-ink-subtle">
                Shaded band is ±{settings.flowDeviationPct}% of prescribed; outside it raises a caution alarm
              </p>
            </div>
            <FlowTrendChart history={bed.history} prescribed={bed.prescribedFlowMlPerHr} deviationPct={settings.flowDeviationPct} />
          </section>

          <AlarmPanel bed={bed} now={now} />
        </div>
      </div>

      <div className="mt-6">
        <SensorStatus bed={bed} now={now} />
      </div>
    </>
  )
}

function BedDetailSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="dt-skeleton h-8 w-32 rounded-md" />
      <div className="dt-skeleton mt-2 h-4 w-24 rounded-md" />
      <div className="dt-skeleton mt-5 mb-6 h-10 w-full max-w-3xl rounded-md" />
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="dt-card dt-skeleton h-[420px]" />
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="dt-card dt-skeleton h-[106px]" />
            ))}
          </div>
          <div className="dt-card dt-skeleton h-[310px]" />
        </div>
      </div>
    </div>
  )
}

export default function BedDetail() {
  const { id } = useParams()
  const { beds, now, settings } = useTelemetry()
  const bed = beds.find((b) => b.id === id)
  const navigate = useNavigate()

  function remove() {
    removeBed(bed.id)
    navigate('/', { replace: true })
  }

  return (
    <section>
      <BackLink />
      <DataGate skeleton={<BedDetailSkeleton />}>
        {bed ? (
          <BedDetailBody bed={bed} now={now} settings={settings} onRemove={remove} />
        ) : (
          <div className="dt-card p-8 text-center">
            <h1 className="text-xl font-semibold">This bed is not on the ward</h1>
            <p className="mt-2 text-[14px] text-ink-muted">
              It may have been removed in Admin, or the link is from another browser.
            </p>
            <Link to="/" className={`${buttonClass('primary')} mt-6`}>
              Back to ward
            </Link>
          </div>
        )}
      </DataGate>
    </section>
  )
}
