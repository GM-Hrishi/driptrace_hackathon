import { useEffect, useState } from 'react'

import IVBottle from '../components/IVBottle.jsx'
import { alarmClass, resolveChannel } from '../lib/severity.js'
import { PRIORITY_GLYPH } from '../lib/constants.js'
import { startMockBeds } from '../lib/mockBeds.js'

/**
 * Design system reference for "Graphite Clinical / Quiet Ward".
 *
 * Its job is to make drift visible: every token is shown in both themes side
 * by side, and the alarm rails animate at their real rates, so a wrong value
 * or a wrong flash rate is obvious here before it reaches the ward view.
 *
 * Remove this route before the judging demo.
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
    </section>
  )
}

export default function DesignTokens() {
  return (
    <section>
      <h1 className="text-2xl">Design tokens</h1>
      <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-ink-muted">
        Graphite Clinical / Quiet Ward. Status colors appear only on real alert states, the accent
        never touches alarm UI, and normal reads as neutral rather than green.
      </p>
      <div className="mt-7 grid gap-5 lg:grid-cols-2">
        <ThemePanel theme="light" />
        <ThemePanel theme="dark" />
      </div>
      <BottleShowcase />
    </section>
  )
}
