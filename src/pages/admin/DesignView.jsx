import { useEffect, useState } from 'react'

import BedCard from '../../components/BedCard.jsx'
import IVBottle from '../../components/IVBottle.jsx'
import { alarmClass, deriveAlerts, resolveChannel } from '../../lib/severity.js'
import { PRIORITY_GLYPH } from '../../lib/constants.js'
import { DEMO_WARD, startMockBeds } from '../../lib/mockBeds.js'

/**
 * Design View: the living reference for "Graphite Clinical / Quiet Ward",
 * nested under Admin.
 *
 * Its job is to make drift visible: every token is shown in both themes side
 * by side, the alarm rails animate at their real rates, and the bottle and the
 * ward card run off the simulator, so a wrong value or a wrong flash rate is
 * obvious here before it reaches the ward view.
 */

const BASE = ['bg', 'surface', 'surface-2', 'surface-3', 'border', 'border-strong']
const INK = ['text', 'text-muted', 'text-subtle']
const ACCENT = ['accent', 'accent-hover', 'accent-soft']
const STATUS = ['critical', 'caution', 'success', 'offline']
const CHANNELS = ['critical', 'caution', 'offline', 'normal']

function Swatch({ token }) {
  return (
    <div className="min-w-0">
      <div
        className="h-12 rounded-control border"
        style={{ backgroundColor: `var(--dt-${token})`, borderColor: 'var(--dt-border)' }}
      />
      <p className="dt-nums mt-1.5 truncate text-[11px] text-ink-muted">--dt-{token}</p>
    </div>
  )
}

function SwatchRow({ title, tokens }) {
  return (
    <div className="mt-5">
      <h4 className="text-[12px] font-semibold tracking-wide text-ink-subtle uppercase">{title}</h4>
      <div className="mt-2 grid grid-cols-3 gap-2.5 sm:grid-cols-6">
        {tokens.map((token) => (
          <Swatch key={token} token={token} />
        ))}
      </div>
    </div>
  )
}

/** A card edge exactly as the ward view will render it: slim rail plus beacon. */
function SeverityRail({ channel }) {
  const glyph = PRIORITY_GLYPH[channel]
  return (
    <div data-severity={channel} className="dt-card relative overflow-hidden p-4 pl-6">
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-1.5 ${alarmClass(channel)}`}
        style={{ backgroundColor: 'var(--dt-sev)' }}
      />
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium capitalize">{channel}</p>
          <p className="dt-nums mt-0.5 text-[11px] text-ink-subtle">
            {channel === 'critical'
              ? '2 Hz · 50% duty'
              : channel === 'caution'
                ? '0.6 Hz pulse'
                : 'no motion'}
          </p>
        </div>
        <span
          aria-hidden="true"
          className={`size-2.5 shrink-0 rounded-full ${alarmClass(channel)}`}
          style={{ backgroundColor: 'var(--dt-sev)' }}
        />
      </div>
      {glyph && (
        <p className="dt-nums mt-2 text-[11px] font-semibold" style={{ color: 'var(--dt-sev)' }}>
          {glyph}
        </p>
      )}
    </div>
  )
}

function ThemePanel({ theme }) {
  return (
    <div
      data-theme={theme}
      className="rounded-card border p-5"
      style={{
        backgroundColor: 'var(--dt-bg)',
        borderColor: 'var(--dt-border)',
        color: 'var(--dt-text)',
      }}
    >
      <h3 className="text-[15px] font-semibold capitalize" style={{ color: 'var(--dt-text)' }}>
        {theme}
      </h3>

      <SwatchRow title="Graphite base" tokens={BASE} />
      <SwatchRow title="Ink" tokens={INK} />
      <SwatchRow title="Accent" tokens={ACCENT} />
      <SwatchRow title="Status and offline" tokens={STATUS} />

      <h4 className="mt-6 text-[12px] font-semibold tracking-wide text-ink-subtle uppercase">
        Severity rails
      </h4>
      <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
        {CHANNELS.map((channel) => (
          <SeverityRail key={channel} channel={channel} />
        ))}
      </div>

      <h4 className="mt-6 text-[12px] font-semibold tracking-wide text-ink-subtle uppercase">
        Headline numerals
      </h4>
      <p className="dt-nums mt-2 text-4xl font-semibold" style={{ color: 'var(--dt-text)' }}>
        118.4
        <span className="ml-2 text-base font-normal" style={{ color: 'var(--dt-text-muted)' }}>
          mL/hr
        </span>
      </p>
      <p className="dt-nums text-xs" style={{ color: 'var(--dt-text-subtle)' }}>
        0123456789 tabular
      </p>
    </div>
  )
}


/**
 * Live bottle check, driven by the simulator so the level, the headline number
 * and the drip rate can be seen agreeing with each other as a bottle drains.
 */
function BottleShowcase() {
  const [beds, setBeds] = useState([])

  useEffect(() => {
    const sim = startMockBeds(setBeds)
    return sim.stop
  }, [])

  if (beds.length === 0) return null

  const now = Date.now()
  const hero = beds[0]
  const heroChannel = resolveChannel(hero)

  return (
    <section className="mt-10">
      <h2 className="text-lg">IV bottle</h2>
      <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-ink-muted">
        Draining in real time from the simulator. The level is a spring off the fill fraction, the
        surface is two scrolling waves, and the drip chamber times off drops per minute.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[auto_1fr] lg:items-start">
        <div data-severity={heroChannel} className="dt-card flex flex-col items-center p-6">
          <IVBottle
            size="hero"
            fraction={hero.bottlePercentRemaining / 100}
            dropsPerMin={hero.dropsPerMin}
            status={heroChannel}
            label={hero.label}
          />
          <p className="dt-nums mt-4 text-3xl font-semibold">
            {hero.bottlePercentRemaining.toFixed(1)}
            <span className="ml-1 text-base font-normal text-ink-muted">%</span>
          </p>
          <p className="dt-nums text-[12px] text-ink-subtle">
            {hero.flowRateMlPerHr} mL/hr · {hero.dropsPerMin} drops/min
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {beds.map((bed) => {
            const channel = resolveChannel(bed)
            return (
              <div
                key={bed.id}
                data-severity={channel}
                className="dt-card relative flex flex-col items-center overflow-hidden p-4"
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 w-1.5 ${alarmClass(channel)}`}
                  style={{ backgroundColor: 'var(--dt-sev)' }}
                />
                <IVBottle
                  size="compact"
                  fraction={bed.bottlePercentRemaining / 100}
                  dropsPerMin={bed.dropsPerMin}
                  status={channel}
                  label={bed.label}
                />
                <p className="mt-2 text-[12px] font-medium">{bed.label}</p>
                <p className="dt-nums text-[11px] text-ink-subtle">
                  {bed.bottlePercentRemaining.toFixed(0)}%
                </p>
                <p className="dt-nums text-[10px] tracking-wide text-ink-subtle uppercase">
                  {channel}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      <h2 className="mt-10 text-lg">Ward card states</h2>
      <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-ink-muted">
        The real BedCard, in the dark ward theme, fed by the same simulator. Critical and caution
        flash at their IEC rates; offline is a static ring with dimmed numbers.
      </p>
      <div data-theme="dark" className="rounded-card mt-5 p-4" style={{ backgroundColor: 'var(--dt-bg)' }}>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {beds.map((reading, i) => (
            <li key={reading.id}>
              <BedCard bed={toWardBed(reading, DEMO_WARD[i], now)} now={now} linked={false} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** Shape a bare simulator reading like a live ward bed, for BedCard. */
function toWardBed(reading, config, now) {
  const alerts = deriveAlerts(reading, { prescribedFlowMlPerHr: config.prescribedFlowMlPerHr })
  const bed = {
    ...reading,
    ...config,
    id: reading.id,
    label: reading.label,
    device: 'simulated',
    reading,
    simulated: true,
    paused: false,
    alerts,
    severity: alerts[0]?.severity ?? 'normal',
    acknowledged: false,
    acknowledgedAt: null,
    history: [],
  }
  bed.channel = resolveChannel(bed, now)
  return bed
}

function TypeSpecimen() {
  return (
    <section className="mt-10">
      <h2 className="text-lg">Type</h2>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="dt-card p-6">
          <p className="dt-nums text-[11px] tracking-wide text-ink-subtle uppercase">
            UI sans · Plus Jakarta Sans Variable
          </p>
          <p className="mt-3 text-3xl font-semibold tracking-tight">Ward overview</p>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
            Headings, body, navigation and labels. Geometric and refined, quiet enough for a clinical
            screen read at a glance.
          </p>
        </div>
        <div className="dt-card p-6">
          <p className="dt-nums text-[11px] tracking-wide text-ink-subtle uppercase">
            Readouts · Geist Mono Variable
          </p>
          <p className="dt-nums mt-3 text-3xl font-semibold">
            208.4 <span className="text-base font-normal text-ink-muted">mL/hr</span>
          </p>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
            Fixed-width digits for live values, so a number can tick without the line shifting.
          </p>
        </div>
      </div>
    </section>
  )
}

export default function DesignView() {
  return (
    <section>
      <h2 className="text-xl">Design tokens</h2>
      <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-ink-muted">
        Graphite Clinical / Quiet Ward. Status colors appear only on real alert states, the accent
        never touches alarm UI, and normal reads as neutral rather than green.
      </p>
      <div className="mt-7 grid gap-5 lg:grid-cols-2">
        <ThemePanel theme="light" />
        <ThemePanel theme="dark" />
      </div>
      <TypeSpecimen />
      <BottleShowcase />
    </section>
  )
}
