import { useReducedMotion } from 'motion/react'

import { PRIORITY_GLYPH } from '../lib/constants.js'
import { alarmClass } from '../lib/severity.js'

/**
 * Small shared primitives. Kept in one file because each is a few lines and
 * they are always reached for together.
 */

const BUTTON = {
  primary: 'bg-accent text-accent-on hover:bg-accent-hover font-semibold',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-2 font-medium',
  ghost: 'text-ink-muted hover:bg-surface-2 hover:text-ink font-medium',
  danger: 'border border-line-strong bg-surface text-critical hover:bg-critical-tint font-medium',
}

/** Shared class string so links can look like buttons. */
export function buttonClass(variant = 'secondary', size = 'md') {
  const sizing = size === 'sm' ? 'px-3 py-1.5 text-[12px]' : 'px-4 py-2 text-[13px]'
  return `rounded-pill inline-flex items-center justify-center gap-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${BUTTON[variant]}`
}

/**
 * @param {{ variant?: keyof typeof BUTTON, size?: 'sm' | 'md' } & React.ButtonHTMLAttributes<HTMLButtonElement>} props
 */
export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...rest }) {
  return <button type={type} className={`${buttonClass(variant, size)} ${className}`} {...rest} />
}

const CHANNEL_LABEL = {
  critical: 'Critical',
  caution: 'Caution',
  offline: 'Offline',
  normal: 'Infusing',
}

/** @param {import('../lib/types.js').Severity | 'offline'} channel */
export function channelLabel(channel) {
  return CHANNEL_LABEL[channel] ?? channel
}

/**
 * The beacon: the one element, with the rail, allowed to flash.
 *
 * Clinical alarms are a filled dot at their IEC flash rate. Offline is a hollow
 * ring that never moves, so a dead sensor cannot be mistaken for a patient
 * alarm at a glance. Normal shows nothing at all. Must sit inside an element
 * carrying data-severity.
 *
 * @param {{ channel: import('../lib/types.js').Severity | 'offline', acknowledged?: boolean, className?: string }} props
 */
export function Beacon({ channel, acknowledged = false, className = '' }) {
  const reduced = useReducedMotion()
  if (channel === 'normal') return null
  if (channel === 'offline') {
    return (
      <span
        aria-hidden="true"
        className={`inline-block size-2.5 shrink-0 rounded-full border-2 ${className}`}
        style={{ borderColor: 'var(--dt-sev)' }}
      />
    )
  }
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 ${className}`} aria-hidden="true">
      <span
        className={`inline-block size-2.5 rounded-full ${alarmClass(channel, acknowledged)}`}
        style={{ backgroundColor: 'var(--dt-sev)' }}
      />
      {/* With motion off, priority is carried by the glyph instead of the rate. */}
      {reduced && (
        <span className="dt-nums text-[11px] font-semibold" style={{ color: 'var(--dt-sev)' }}>
          {PRIORITY_GLYPH[channel]}
        </span>
      )}
    </span>
  )
}

/**
 * "just now", "12s ago", "4m ago", "2h 5m ago".
 * @param {number | undefined} then
 * @param {number} now
 */
export function formatAgo(then, now) {
  if (!then) return 'never'
  const s = Math.max(0, Math.round((now - then) / 1000))
  if (s < 2) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m ago`
}

/** @param {number | null | undefined} ms */
export function formatClock(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Small uppercase tag, e.g. SIM. Neutral on purpose: it is metadata, not status. */
export function Tag({ children, className = '' }) {
  return (
    <span
      className={`dt-nums rounded-pill border border-line px-1.5 py-px text-[10px] font-medium tracking-wider text-ink-subtle uppercase ${className}`}
    >
      {children}
    </span>
  )
}

/** Section heading used on Admin and Bed Detail. */
export function SectionTitle({ children, hint, as: Heading = 'h2' }) {
  return (
    <div className="mb-4">
      <Heading className="text-[15px] font-semibold">{children}</Heading>
      {hint && <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-ink-muted">{hint}</p>}
    </div>
  )
}
