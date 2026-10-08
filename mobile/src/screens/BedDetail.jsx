import { Link, useParams } from 'react-router'

import FlowTrendChart from '../../../src/components/FlowTrendChart.jsx'
import IVBottle from '../../../src/components/IVBottle.jsx'
import { Beacon, Button, Tag, channelLabel, formatAgo } from '../../../src/components/ui.jsx'
import { getEnabledVitals } from '../../../src/config/vitals.js'
import { SENSOR_STALE_AFTER_MS } from '../../../src/lib/constants.js'
import { Screen, Section, TopBar } from '../components/chrome.jsx'
import { emptyAt, fixed1, formatDateTime, formatDuration, formatTime, remainingMl } from '../lib/format.js'
import { acknowledgeAlert } from '../lib/mobileStore.js'
import { useMobileTelemetry } from '../lib/mobileTelemetry.jsx'
import { can } from '../lib/roles.js'

function Stat({ label, value, unit, sub, stale, emphasis = false }) {
  return (
    <div className={`dt-card p-3.5 ${stale ? 'opacity-60' : ''}`} style={{ borderRadius: 'var(--dt-radius-control)' }}>
      <p className="text-[11px] tracking-wide text-ink-subtle uppercase">{label}</p>
      <p
        className="dt-nums mt-1 text-[24px] leading-none font-semibold"
        style={emphasis ? { color: 'var(--dt-sev)' } : undefined}
      >
        {value}
        {unit && <span className="ml-1 text-[12px] font-normal text-ink-muted">{unit}</span>}
      </p>
      {sub && <p className="dt-nums mt-1 text-[12px] text-ink-muted">{sub}</p>}
    </div>
  )
}

function AlertsPanel({ bed }) {
  if (bed.paused) {
    return <p className="dt-card p-4 text-[14px] text-ink-muted">Simulation is off. Turn it on in Settings.</p>
  }
  if (bed.channel === 'offline') {
    return (
      <div data-severity="offline" className="dt-card p-4">
        <p className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: 'var(--dt-sev)' }}>
          <Beacon channel="offline" /> Sensor offline
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
          No reading for over {SENSOR_STALE_AFTER_MS / 1000} s. Check the unit’s power and Wi-Fi. This is a device
          fault, not a patient alarm — but this bottle is not being watched until the unit reports again.
        </p>
      </div>
    )
  }
  if (bed.alerts.length === 0) {
    return <p className="dt-card p-4 text-[14px] text-ink-muted">No active alerts. Infusing as prescribed.</p>
  }
  return (
    <ul className="space-y-2">
      {bed.alerts.map((alert, i) => {
        const isTop = i === 0
        const acked = isTop && bed.acknowledged
        return (
          <li key={alert.kind} data-severity={alert.severity} className="dt-card flex items-start gap-3 p-4">
            <span className="mt-1.5">
              <Beacon channel={alert.severity} acknowledged={acked || !isTop} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold" style={{ color: 'var(--dt-sev)' }}>
                {alert.reason}
              </p>
              <p className="mt-0.5 text-[13px] text-ink-muted">Action: {alert.action}</p>
              {acked && (
                <p className="mt-1 text-[12px] text-ink-subtle">Acknowledged {formatTime(bed.acknowledgedAt)}</p>
              )}
            </div>
            {isTop && !acked && can('acknowledge') && (
              <Button variant="primary" className="min-h-11 shrink-0" onClick={() => acknowledgeAlert(bed, alert)}>
                Acknowledge
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3 text-[14px]">
      <span className="text-ink-muted">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  )
}

export default function BedDetail() {
  const { id } = useParams()
  const { beds, settings, now, status } = useMobileTelemetry()
  const bed = beds.find((b) => b.id === id)

  if (!bed) {
    return (
      <>
        <TopBar title="Bed" back />
        <Screen>
          <p className="dt-card p-5 text-[14px] text-ink-muted">
            {status === 'loading' ? 'Loading…' : 'This bed is no longer on the ward.'}
          </p>
        </Screen>
      </>
    )
  }

  const { reading, channel } = bed
  const offline = channel === 'offline'
  const left = remainingMl(bed)
  const eta = offline ? null : emptyAt(bed, now)
  const flow = reading?.flowRateMlPerHr
  const ratio = Number.isFinite(flow) && bed.prescribedFlowMlPerHr ? flow / bed.prescribedFlowMlPerHr : null
  const deviated = bed.alerts.some((a) => a.kind === 'flow-high' || a.kind === 'flow-low')
  const elapsed = bed.ivStartAt ? now - bed.ivStartAt : null

  return (
    <>
      <TopBar
        title={bed.label}
        back
        action={
          can('editBed') && (
            <Link
              to={`/bed/${bed.id}/edit`}
              className="rounded-pill flex min-h-10 items-center px-3 text-[14px] font-medium text-accent"
            >
              Edit
            </Link>
          )
        }
      />
      <Screen>
        <div data-severity={channel} className="dt-card relative overflow-hidden p-5">
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5" style={{ backgroundColor: 'var(--dt-sev)' }} />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="dt-nums text-[14px] text-ink-muted">{bed.patientId}</p>
              <p className="flex items-center gap-2 text-[13px] text-ink-subtle">
                {bed.simulated ? <Tag>Sim</Tag> : <span className="dt-nums">{bed.device}</span>}
                {reading && <span>· {formatAgo(reading.lastUpdated, now)}</span>}
              </p>
            </div>
            <span
              className="flex items-center gap-2 text-[14px] font-semibold"
              style={{ color: channel === 'normal' ? 'var(--dt-text-muted)' : 'var(--dt-sev)' }}
            >
              <Beacon channel={channel} acknowledged={bed.acknowledged} />
              {channelLabel(channel)}
            </span>
          </div>
          <div className="mt-2 flex items-end justify-center gap-6">
            <div className="w-28">
              <IVBottle
                size="hero"
                fraction={(reading?.bottlePercentRemaining ?? 0) / 100}
                dropsPerMin={offline ? 0 : (reading?.dropsPerMin ?? 0)}
                status={channel}
                label={bed.label}
              />
            </div>
            <div className={`dt-nums pb-4 ${offline ? 'opacity-60' : ''}`}>
              <p className="text-[44px] leading-none font-semibold">
                {Number.isFinite(reading?.bottlePercentRemaining) ? Math.round(reading.bottlePercentRemaining) : '—'}
                <span className="text-[18px] font-normal text-ink-muted">%</span>
              </p>
              <p className="mt-1 text-[14px] text-ink-muted">
                {left !== null ? `${Math.round(left)} of ${bed.volumeMl} mL` : `of ${bed.volumeMl} mL`}
              </p>
              <p className="mt-3 text-[13px] text-ink-subtle">Empties</p>
              <p className="text-[17px] font-semibold">{eta ? formatTime(eta) : '—'}</p>
              <p className="text-[12px] text-ink-muted">{eta ? `in ${formatDuration(eta - now)}` : 'not flowing'}</p>
            </div>
          </div>
        </div>

        <Section title="Alerts">
          <AlertsPanel bed={bed} />
        </Section>

        <Section title="Infusion">
          <div className="grid grid-cols-2 gap-2">
            <div data-severity={deviated ? bed.severity : 'normal'}>
              <Stat
                label="Flow rate"
                value={fixed1(flow)}
                unit="mL/h"
                sub={`Rx ${bed.prescribedFlowMlPerHr}${ratio !== null ? ` · ${ratio.toFixed(1)}x` : ''}`}
                stale={offline}
                emphasis={deviated && !offline}
              />
            </div>
            <Stat
              label="Drops / min"
              value={Number.isFinite(reading?.dropsPerMin) ? reading.dropsPerMin : '—'}
              unit="gtt"
              sub="20 gtt/mL set"
              stale={offline}
            />
            {getEnabledVitals(settings).map((vital) => {
              const value = vital.getValue(reading)
              return (
                <Stat
                  key={vital.key}
                  label={vital.fullLabel}
                  value={value ?? '—'}
                  unit={vital.unit}
                  sub={value === null ? 'No finger on sensor' : vital.source}
                  stale={offline}
                />
              )
            })}
          </div>
        </Section>

        <Section title="Flow trend" hint="Since this screen opened, up to 3 minutes, live.">
          <div className="dt-card p-3">
            <FlowTrendChart
              history={bed.history}
              prescribed={bed.prescribedFlowMlPerHr}
              deviationPct={settings.flowDeviationPct}
            />
          </div>
        </Section>

        <Section title="Patient">
          <div className="dt-card divide-y divide-line">
            <Row label="Patient ID">
              <span className="dt-nums">{bed.patientId}</span>
            </Row>
            <Row label="Clinician">{bed.clinician || '—'}</Row>
            <Row label="IV started">
              {bed.ivStartAt ? (
                <>
                  {formatDateTime(bed.ivStartAt)}
                  <span className="block text-[12px] text-ink-muted">{formatDuration(elapsed)} ago</span>
                </>
              ) : (
                '—'
              )}
            </Row>
            <Row label="Bottle">{bed.volumeMl} mL</Row>
            <Row label="Low-volume alert">
              {bed.lowVolumePct ?? settings.lowVolumePct}%{bed.lowVolumePct == null ? ' (ward default)' : ''}
            </Row>
            {bed.notes && <Row label="Notes">{bed.notes}</Row>}
          </div>
        </Section>

        {can('viewDeviceInfo') && !bed.simulated && (
          <Section title="Sensor">
            <div className="dt-card divide-y divide-line">
              <Row label="Unit">
                <span className="dt-nums">{bed.device}</span>
              </Row>
              <Row label="Load cell">
                {reading ? (reading.sensorOnline ? 'Connected' : 'Disconnected') : 'No data yet'}
              </Row>
              <Row label="Gross weight">
                <span className="dt-nums">{reading ? `${fixed1(reading.weightGrams)} g` : '—'}</span>
              </Row>
              <Row label="Last reading">
                <span className="dt-nums">{reading ? formatAgo(reading.lastUpdated, now) : '—'}</span>
              </Row>
            </div>
          </Section>
        )}
      </Screen>
    </>
  )
}
