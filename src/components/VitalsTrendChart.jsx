import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { chartPoints } from '../lib/flowHistory.js'

/**
 * Heart rate and SpO2 over time, from the unit's 1 Hz log (including seconds
 * it recorded offline and backfilled).
 *
 * Two series on two axes, so a small legend names them. The shaded band is
 * this patient's normal heart-rate range as learned on the unit; it appears
 * once learning finishes.
 */

const TICK = { fill: 'var(--dt-text-subtle)', fontSize: 11, fontFamily: 'var(--font-mono)' }
const HEIGHT = 200
const HR_COLOR = 'var(--dt-vital-hr, #e0567a)'
const SPO2_COLOR = 'var(--dt-vital-spo2, #3aa3d9)'

function clock(t) {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const { t, hr, spo2 } = payload[0].payload
  if (!Number.isFinite(hr) && !Number.isFinite(spo2)) return null
  return (
    <div className="rounded-control border border-line-strong bg-surface px-3 py-2 text-[12px] shadow-[var(--dt-shadow-card)]">
      <p className="dt-nums text-ink-subtle">{clock(t)}</p>
      {Number.isFinite(hr) && <p className="dt-nums mt-0.5 text-ink">HR {Math.round(hr)} bpm</p>}
      {Number.isFinite(spo2) && <p className="dt-nums text-ink">SpO₂ {Math.round(spo2)}%</p>}
    </div>
  )
}

/**
 * @param {{
 *   history: import('../lib/types.js').FlowSample[],
 *   hrLow?: number,
 *   hrHigh?: number,
 *   showHr: boolean,
 *   showSpo2: boolean,
 * }} props
 */
export default function VitalsTrendChart({ history, hrLow, hrHigh, showHr, showSpo2 }) {
  const samples = history.filter((s) => Number.isFinite(s.heartRate) || Number.isFinite(s.spo2))

  if (samples.length < 2) {
    return (
      <div
        className="rounded-control flex items-center justify-center border border-dashed border-line px-4 text-center text-[13px] text-ink-subtle"
        style={{ height: HEIGHT }}
      >
        No pulse readings yet. Place a finger on the sensor and keep it still.
      </div>
    )
  }

  // Drawn against the full timeline, so seconds with no finger break the line.
  const data = chartPoints(history.filter((s) => Number.isFinite(s.t))).map((s) => ({
    t: s.t,
    hr: s.gap ? null : (s.heartRate ?? null),
    spo2: s.gap ? null : (s.spo2 ?? null),
  }))
  const latest = samples[samples.length - 1]
  const hrs = samples.map((s) => s.heartRate).filter(Number.isFinite)
  const hrMin = Math.min(...hrs, hrLow ?? Infinity, 60)
  const hrMax = Math.max(...hrs, hrHigh ?? -Infinity, 100)

  return (
    <figure>
      <figcaption className="sr-only">
        Heart rate and SpO₂ trend.{' '}
        {Number.isFinite(latest.heartRate) ? `Latest heart rate ${Math.round(latest.heartRate)} bpm. ` : ''}
        {Number.isFinite(latest.spo2) ? `Latest SpO₂ ${Math.round(latest.spo2)}%. ` : ''}
        {Number.isFinite(hrLow) ? `Patient's normal range ${hrLow} to ${hrHigh} bpm.` : ''}
      </figcaption>
      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <LineChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--dt-border)" />
            {showHr && Number.isFinite(hrLow) && Number.isFinite(hrHigh) && (
              <ReferenceArea yAxisId="hr" y1={hrLow} y2={hrHigh} fill={HR_COLOR} fillOpacity={0.08} stroke="none" />
            )}
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={clock}
              tick={TICK}
              axisLine={{ stroke: 'var(--dt-border-strong)' }}
              tickLine={false}
              minTickGap={56}
            />
            <YAxis
              yAxisId="hr"
              hide={!showHr}
              width={40}
              domain={[Math.floor((hrMin - 5) / 10) * 10, Math.ceil((hrMax + 5) / 10) * 10]}
              tick={TICK}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <YAxis
              yAxisId="spo2"
              orientation="right"
              hide={!showSpo2}
              width={36}
              domain={[80, 100]}
              tick={TICK}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--dt-border-strong)', strokeWidth: 1 }} isAnimationActive={false} />
            {showHr && (
              <Line yAxisId="hr" dataKey="hr" type="monotone" stroke={HR_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
            )}
            {showSpo2 && (
              <Line yAxisId="spo2" dataKey="spo2" type="monotone" stroke={SPO2_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 text-[12px] text-ink-muted">
        {showHr && (
          <span>
            <span aria-hidden="true" className="mr-1.5 inline-block h-0.5 w-3 align-middle" style={{ backgroundColor: HR_COLOR }} />
            Heart rate (bpm, left)
          </span>
        )}
        {showSpo2 && (
          <span>
            <span aria-hidden="true" className="mr-1.5 inline-block h-0.5 w-3 align-middle" style={{ backgroundColor: SPO2_COLOR }} />
            SpO₂ (%, right)
          </span>
        )}
        {showHr && Number.isFinite(hrLow) && <span>Shaded: patient's normal {hrLow}–{hrHigh} bpm</span>}
      </p>
    </figure>
  )
}
