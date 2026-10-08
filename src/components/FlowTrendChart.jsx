import { useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

/**
 * Flow rate over time against the prescribed rate.
 *
 * One series, so no legend: the card title names it. The prescribed rate is a
 * dashed reference line and the no-alarm band around it a faint fill, so a
 * deviation alarm can be seen as the line leaving the band. The line draws in
 * once on mount; after that animation is off, so live samples append without
 * the whole path re-tweening every second.
 */

const TICK = { fill: 'var(--dt-text-subtle)', fontSize: 11, fontFamily: 'var(--font-mono)' }
const HEIGHT = 240

function clock(t) {
  return new Date(t).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function ChartTooltip({ active, payload, prescribed }) {
  if (!active || !payload?.length) return null
  const { t, flow } = payload[0].payload
  return (
    <div className="rounded-control border border-line-strong bg-surface px-3 py-2 text-[12px] shadow-[var(--dt-shadow-card)]">
      <p className="dt-nums text-ink-subtle">{clock(t)}</p>
      <p className="dt-nums mt-0.5 text-ink">
        <span className="text-[14px] font-semibold">{flow.toFixed(1)}</span> mL/hr
      </p>
      <p className="dt-nums text-ink-muted">{(flow / prescribed).toFixed(2)}x prescribed</p>
    </div>
  )
}

/**
 * @param {{
 *   history: import('../lib/types.js').FlowSample[],
 *   prescribed: number,
 *   deviationPct: number,
 * }} props
 */
export default function FlowTrendChart({ history, prescribed, deviationPct }) {
  const [animate, setAnimate] = useState(true)

  // A reading with no usable flow value is skipped, not plotted as NaN.
  const data = history
    .filter((s) => Number.isFinite(s.t) && Number.isFinite(s.flowRateMlPerHr))
    .map((s) => ({ t: s.t, flow: s.flowRateMlPerHr }))

  if (data.length < 2) {
    return (
      <div
        className="rounded-control flex items-center justify-center border border-dashed border-line text-[13px] text-ink-subtle"
        style={{ height: HEIGHT }}
      >
        Collecting trend data. The chart starts after two readings.
      </div>
    )
  }

  const band = (prescribed * deviationPct) / 100
  const peak = Math.max(...data.map((d) => d.flow))
  const yMax = Math.ceil(Math.max(peak * 1.1, (prescribed + band) * 1.15, 10) / 10) * 10
  const latest = data[data.length - 1]
  const minutes = Math.max(1, Math.round((latest.t - data[0].t) / 60_000))

  return (
    <figure>
      <figcaption className="sr-only">
        Flow rate over the last {minutes} minutes. Latest {latest.flow.toFixed(1)} mL/hr against{' '}
        {prescribed} mL/hr prescribed; alarm band {Math.round(prescribed - band)} to{' '}
        {Math.round(prescribed + band)} mL/hr.
      </figcaption>
      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <LineChart data={data} margin={{ top: 10, right: 28, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--dt-border)" />
            <ReferenceArea
              y1={Math.max(0, prescribed - band)}
              y2={prescribed + band}
              fill="var(--dt-text-subtle)"
              fillOpacity={0.08}
              stroke="none"
            />
            <ReferenceLine
              y={prescribed}
              stroke="var(--dt-text-subtle)"
              strokeDasharray="4 4"
              label={{
                value: `Rx ${prescribed}`,
                position: 'insideTopLeft',
                fill: 'var(--dt-text-muted)',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
              }}
            />
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
              width={44}
              domain={[0, yMax]}
              tick={TICK}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              tickCount={5}
            />
            <Tooltip
              content={<ChartTooltip prescribed={prescribed} />}
              cursor={{ stroke: 'var(--dt-border-strong)', strokeWidth: 1 }}
              isAnimationActive={false}
            />
            <Line
              dataKey="flow"
              type="monotone"
              stroke="var(--dt-accent)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--dt-surface)', strokeWidth: 2, fill: 'var(--dt-accent)' }}
              isAnimationActive={animate}
              animationDuration={700}
              onAnimationEnd={() => setAnimate(false)}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <details className="mt-3 text-[12px] text-ink-muted">
        <summary className="cursor-pointer select-none hover:text-ink">Show as table</summary>
        <div className="mt-2 max-h-48 overflow-auto">
          <table className="dt-nums w-full text-left">
            <thead className="text-ink-subtle">
              <tr>
                <th className="py-1 pr-4 font-medium">Time</th>
                <th className="py-1 pr-4 font-medium">Flow (mL/hr)</th>
                <th className="py-1 font-medium">vs Rx</th>
              </tr>
            </thead>
            <tbody>
              {data
                .slice(-20)
                .reverse()
                .map((row) => (
                  <tr key={row.t} className="border-t border-line">
                    <td className="py-1 pr-4">{clock(row.t)}</td>
                    <td className="py-1 pr-4 text-ink">{row.flow.toFixed(1)}</td>
                    <td className="py-1">{(row.flow / prescribed).toFixed(2)}x</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
