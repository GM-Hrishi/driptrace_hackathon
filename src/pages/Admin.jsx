import { useEffect, useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { NotConfiguredCard } from '../components/DataState.jsx'
import { Button, ConfirmButton, SectionTitle, Tag, formatAgo } from '../components/ui.jsx'
import {
  DROP_FACTOR_GTT_PER_ML,
  HX711_CALIBRATION,
  PIN_MAP,
} from '../lib/constants.js'
import { isFirebaseConfigured, missingFirebaseConfig } from '../lib/firebase.js'
import { VITALS } from '../config/vitals.js'
import { SCENARIOS } from '../lib/mockBeds.js'
import { sanitizeNumber } from '../lib/sanitize.js'
import {
  DEFAULT_SETTINGS,
  addSimulatedBeds,
  clearSimulatedBeds,
  loadDemoWard,
  removeBed,
  updateBed,
  updateSettings,
} from '../lib/store.js'
import { useTelemetry } from '../lib/telemetry.jsx'
import DesignView from './admin/DesignView.jsx'

/**
 * Admin. Same dark theme and tokens as the ward view.
 *
 * Everything set here is stored in this browser (see lib/store.js): the
 * Firebase rules deny client writes, so nothing on this page can reach the
 * database or a device.
 */

const TABS = [
  { id: 'config', label: 'Configuration' },
  { id: 'design', label: 'Design View' },
]

const INPUT =
  'dt-nums rounded-control w-full border border-line-strong bg-surface px-3 py-2 text-[14px] text-ink aria-[invalid=true]:border-critical'

/**
 * A single numeric setting with its own Save, validated through sanitizeNumber
 * so an out-of-range value is refused rather than clamped behind the user's back.
 */
function NumberSetting({ label, value, bounds, unit, hint, onSave }) {
  const id = useId()
  const [draft, setDraft] = useState(String(value))
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  // Pick up changes made elsewhere (another tab, a reset).
  useEffect(() => setDraft(String(value)), [value])

  function save(event) {
    event.preventDefault()
    const n = sanitizeNumber(draft, bounds)
    if (n === null) {
      setError(`Enter a number from ${bounds.min} to ${bounds.max}.`)
      return
    }
    setError('')
    onSave(n)
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
  }

  const dirty = draft !== String(value)

  return (
    <form onSubmit={save} noValidate className="min-w-0">
      <label htmlFor={id} className="block text-[13px] font-medium">
        {label}
      </label>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            id={id}
            inputMode="decimal"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setError('')
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-help`}
            className={`${INPUT} ${unit ? 'pr-12' : ''}`}
          />
          {unit && (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[12px] text-ink-subtle">
              {unit}
            </span>
          )}
        </div>
        <Button type="submit" size="sm" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty}>
          Save
        </Button>
      </div>
      <p
        id={`${id}-help`}
        role={error ? 'alert' : undefined}
        className={`mt-1.5 min-h-[1lh] text-[12px] ${error ? 'text-critical' : saved ? 'text-success' : 'text-ink-subtle'}`}
      >
        {error || (saved ? 'Saved.' : hint)}
      </p>
    </form>
  )
}

function Switch({ checked, onChange, label, description }) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p id={id} className="text-[14px] font-medium">
          {label}
        </p>
        <p className="mt-0.5 max-w-prose text-[13px] text-ink-muted">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        onClick={() => onChange(!checked)}
        className={`rounded-pill relative h-7 w-12 shrink-0 transition-colors ${checked ? 'bg-accent' : 'bg-surface-3'}`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`}
        />
      </button>
    </div>
  )
}

function Panel({ children, className = '' }) {
  return <section className={`dt-card p-6 ${className}`}>{children}</section>
}

// --- Sections ------------------------------------------------------------------

function SystemStatus() {
  const { firebase, simulation, beds, now, status } = useTelemetry()
  const connectionText = {
    'not-configured': 'Not configured',
    connecting: 'Connecting',
    connected: 'Connected',
    offline: 'Offline',
  }[firebase.connection]

  return (
    <Panel className="lg:col-span-2">
      <SectionTitle hint="Live view of the data sources this dashboard reads from.">System status</SectionTitle>

      {!isFirebaseConfigured && !simulation && (
        <div className="mb-5">
          <NotConfiguredCard compact />
        </div>
      )}

      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-control border border-line p-4">
          <dt className="text-[11px] font-medium tracking-wide text-ink-subtle uppercase">Firebase</dt>
          <dd
            data-severity={firebase.connection === 'offline' ? 'offline' : 'normal'}
            className="mt-1.5 text-[14px] font-medium"
            style={firebase.connection === 'offline' ? { color: 'var(--dt-sev)' } : undefined}
          >
            {connectionText}
          </dd>
          <p className="mt-1 text-[12px] text-ink-subtle">
            {firebase.error ??
              (isFirebaseConfigured
                ? 'Realtime Database, anonymous auth'
                : `${missingFirebaseConfig.length} env keys missing`)}
          </p>
        </div>
        <div className="rounded-control border border-line p-4">
          <dt className="text-[11px] font-medium tracking-wide text-ink-subtle uppercase">Simulation</dt>
          <dd className="mt-1.5 text-[14px] font-medium">{simulation ? 'On' : 'Off'}</dd>
          <p className="mt-1 text-[12px] text-ink-subtle">
            {beds.filter((b) => b.simulated).length} simulated · {beds.filter((b) => !b.simulated).length} hardware
          </p>
        </div>
        <div className="rounded-control border border-line p-4">
          <dt className="text-[11px] font-medium tracking-wide text-ink-subtle uppercase">Devices reporting</dt>
          <dd className="dt-nums mt-1.5 text-[14px] font-medium">
            {status === 'ready' ? `${beds.filter((b) => b.channel !== 'offline').length} of ${beds.length}` : '—'}
          </dd>
          <p className="mt-1 text-[12px] text-ink-subtle">Stale after 15 s without a publish</p>
        </div>
      </dl>

      <div className="mt-5 overflow-x-auto">
        {status === 'loading' ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="dt-skeleton h-9 rounded-md" />
            ))}
          </div>
        ) : beds.length === 0 ? (
          <p className="text-[13px] text-ink-muted">No beds registered.</p>
        ) : (
          <table className="w-full min-w-[520px] text-left text-[13px]">
            <thead className="text-[11px] tracking-wide text-ink-subtle uppercase">
              <tr>
                <th className="py-2 pr-4 font-medium">Bed</th>
                <th className="py-2 pr-4 font-medium">Device</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {beds.map((bed) => {
                const online = bed.channel !== 'offline'
                return (
                  <tr key={bed.id} className="border-t border-line">
                    <td className="py-2 pr-4">
                      <Link to={`/bed/${bed.id}`} className="font-medium hover:underline">
                        {bed.label}
                      </Link>
                    </td>
                    <td className="dt-nums py-2 pr-4 text-ink-muted">{bed.device}</td>
                    <td className="py-2 pr-4">
                      <span
                        data-severity={online ? 'normal' : 'offline'}
                        className="flex items-center gap-2"
                        style={online ? undefined : { color: 'var(--dt-sev)' }}
                      >
                        <span
                          aria-hidden="true"
                          className={`inline-block size-2 rounded-full ${online ? 'bg-ink-subtle' : 'border-2'}`}
                          style={online ? undefined : { borderColor: 'var(--dt-sev)' }}
                        />
                        {bed.paused ? 'Paused' : online ? 'Online' : 'Offline'}
                      </span>
                    </td>
                    <td className="dt-nums py-2 text-ink-muted">
                      {bed.reading ? formatAgo(bed.reading.lastUpdated, now) : 'never'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  )
}

function Calibration() {
  const rows = [
    ['Scale', `${HX711_CALIBRATION.countsPerGram} counts/g`],
    ['Empty bottle', `${HX711_CALIBRATION.emptyBottleGrams} g`],
    ['Drop factor', `${DROP_FACTOR_GTT_PER_ML} gtt/mL`],
    ['HX711 pins', `DT ${PIN_MAP.HX711.pins.DT} · SCK ${PIN_MAP.HX711.pins.SCK}`],
  ]
  return (
    <Panel>
      <SectionTitle hint="Scale factor that turns raw HX711 counts into grams.">Load cell calibration</SectionTitle>
      <p className="mb-4 text-[13px] leading-relaxed text-ink-muted">
        Measured on the DripTrace cell on{' '}
        <span className="dt-nums">{HX711_CALIBRATION.measuredOn}</span> with a full and an empty
        100 mL bottle. The firmware applies it on the device; the unit tares itself at power-on with
        the hook empty.
      </p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] font-medium tracking-wide text-ink-subtle uppercase">{label}</dt>
            <dd className="dt-nums mt-1 font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}

function Thresholds() {
  const { settings } = useTelemetry()
  return (
    <Panel>
      <SectionTitle hint="Ward-wide alarm limits. A bed's own low-volume threshold, if set, wins.">
        Alarm thresholds
      </SectionTitle>
      <div className="grid gap-4">
        <NumberSetting
          label="Low-volume caution"
          unit="%"
          value={settings.lowVolumePct}
          bounds={{ min: 1, max: 50 }}
          hint={`Amber when the bottle drops below this. Default ${DEFAULT_SETTINGS.lowVolumePct}%.`}
          onSave={(n) => updateSettings({ lowVolumePct: n })}
        />
        <NumberSetting
          label="Flow-rate deviation caution"
          unit="%"
          value={settings.flowDeviationPct}
          bounds={{ min: 5, max: 300 }}
          hint={`Amber when flow is more than this far from the prescribed rate. Default ${DEFAULT_SETTINGS.flowDeviationPct}%.`}
          onSave={(n) => updateSettings({ flowDeviationPct: n })}
        />
      </div>
    </Panel>
  )
}

function Vitals() {
  const { settings } = useTelemetry()
  return (
    <Panel className="lg:col-span-2">
      <SectionTitle hint="Choose which MAX30102 vitals appear on bed cards and bed pages. A vital switched off is not rendered at all.">
        Vitals
      </SectionTitle>
      <div className="grid gap-5 sm:grid-cols-2">
        {VITALS.map((vital) => (
          <Switch
            key={vital.key}
            checked={vital.isEnabled(settings)}
            onChange={(on) => updateSettings({ [vital.settingKey]: on })}
            label={`${vital.fullLabel} (${vital.unit})`}
            description={`From the ${vital.source} pulse oximeter.`}
          />
        ))}
      </div>
    </Panel>
  )
}

const SPEEDS = [
  { value: 1, label: 'Real time (1x)' },
  { value: 60, label: '1 min per second (60x)' },
  { value: 150, label: 'Demo (150x)' },
  { value: 600, label: 'Fast drain (600x)' },
]

function BedManagement() {
  const { beds, settings } = useTelemetry()
  const simCount = beds.filter((b) => b.simulated).length

  return (
    <Panel className="lg:col-span-2">
      <SectionTitle hint="Grow the ward with simulated beds to show it scales past the units on the bench, and switch each simulated bed into any alarm state.">
        Beds and simulation
      </SectionTitle>

      <Switch
        checked={settings.simulationMode}
        onChange={(on) => updateSettings({ simulationMode: on })}
        label="Simulation mode"
        description="Drives every bed assigned to a simulated unit. Hardware beds are unaffected. Off by default in production builds."
      />

      <div className="mt-5 border-t border-line pt-5">
        <Switch
          checked={settings.showSimulatedBeds}
          onChange={(on) => updateSettings({ showSimulatedBeds: on })}
          label="Show simulated beds on the ward"
          description="Hides SIM beds from the ward view and the alert banner without deleting them. They keep running here and reappear unchanged when switched back on."
        />
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-line pt-5">
        <label className="text-[13px]">
          <span className="block font-medium">Simulation speed</span>
          <select
            value={settings.simSpeed}
            onChange={(e) => updateSettings({ simSpeed: Number(e.target.value) })}
            className="rounded-control mt-1.5 border border-line-strong bg-surface px-3 py-2 text-[13px]"
          >
            {SPEEDS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => addSimulatedBeds(1)}>+1 simulated bed</Button>
          <Button onClick={() => addSimulatedBeds(10)}>+10 simulated beds</Button>
          <Button variant="ghost" onClick={loadDemoWard}>
            Reset to demo ward
          </Button>
          {simCount > 0 && (
            <ConfirmButton size="md" confirmLabel={`Remove all ${simCount}?`} onConfirm={clearSimulatedBeds}>
              Remove simulated beds
            </ConfirmButton>
          )}
        </div>
      </div>

      <div className="mt-5 overflow-x-auto">
        {beds.length === 0 ? (
          <p className="text-[13px] text-ink-muted">
            No beds yet. Add simulated beds above, or register a patient from the{' '}
            <Link to="/" className="font-medium underline underline-offset-2">
              ward
            </Link>
            .
          </p>
        ) : (
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="text-[11px] tracking-wide text-ink-subtle uppercase">
              <tr>
                <th className="py-2 pr-4 font-medium">Bed</th>
                <th className="py-2 pr-4 font-medium">Patient</th>
                <th className="py-2 pr-4 font-medium">Rx</th>
                <th className="py-2 pr-4 font-medium">Scenario</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {beds.map((bed) => (
                <tr key={bed.id} className="border-t border-line">
                  <td className="py-2 pr-4">
                    <span className="flex items-center gap-2 font-medium">
                      {bed.label}
                      {bed.simulated ? <Tag>Sim</Tag> : <Tag>ESP32</Tag>}
                    </span>
                  </td>
                  <td className="dt-nums py-2 pr-4 text-ink-muted">{bed.patientId}</td>
                  <td className="dt-nums py-2 pr-4 text-ink-muted">{bed.prescribedFlowMlPerHr} mL/hr</td>
                  <td className="py-2 pr-4">
                    {bed.simulated ? (
                      <select
                        aria-label={`Scenario for ${bed.label}`}
                        value={bed.scenario}
                        onChange={(e) => updateBed(bed.id, { scenario: e.target.value })}
                        className="rounded-control border border-line-strong bg-surface px-2 py-1 text-[12px]"
                      >
                        {SCENARIOS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="dt-nums text-ink-subtle">{bed.device}</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <ConfirmButton confirmLabel="Confirm remove" onConfirm={() => removeBed(bed.id)}>
                      Remove
                    </ConfirmButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  )
}

export default function Admin() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'config'

  return (
    <section>
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p className="mt-1.5 text-[14px] text-ink-muted">
        Calibration, alarm thresholds, simulated beds and system health. Settings are stored in this
        browser.
      </p>

      <div role="tablist" aria-label="Admin sections" className="rounded-pill mt-6 inline-flex border border-line bg-surface p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setParams(t.id === 'config' ? {} : { tab: t.id }, { replace: true })}
            className={`rounded-pill px-4 py-1.5 text-[13px] font-medium transition-colors ${
              tab === t.id ? 'bg-accent text-accent-on' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-6">
        {tab === 'design' ? (
          <DesignView />
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            <SystemStatus />
            <BedManagement />
            <Thresholds />
            <Calibration />
            <Vitals />
          </div>
        )}
      </div>
    </section>
  )
}
