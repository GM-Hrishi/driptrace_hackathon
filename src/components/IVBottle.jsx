import { useId } from 'react'
import { motion, useReducedMotion, useSpring, useTransform } from 'motion/react'

/**
 * IVBottle - the hero visual.
 *
 * Hand-authored SVG. The liquid is a plain rect whose top edge is a scrolling
 * wave path, both clipped to the bottle interior, and the level is driven by a
 * spring off the weight-derived fill fraction.
 *
 * Geometry is fixed in one coordinate space so the compact ward-card variant
 * and the full bed-detail variant are the same drawing at two scales, not two
 * drawings that can drift apart.
 */

// --- Bottle geometry, in viewBox units -------------------------------------
const BODY_TOP = 44
const BODY_BOTTOM = 154
const TRAVEL = BODY_BOTTOM - BODY_TOP // how far the surface moves, 0% to 100%
/** Wave crests rise above their baseline, so an empty bottle has to travel a
    little further than the body height - otherwise the troughs stay visible as
    a sliver of fluid in a bottle the dashboard is calling empty. */
const WAVE_AMPLITUDE = 7
const LIQUID_TRAVEL = TRAVEL + WAVE_AMPLITUDE

/** The bottle interior. Used for both the fill shape and the liquid clip. */
const BOTTLE_PATH =
  'M 38 28 L 62 28 L 62 36 Q 62 42 68 46 L 74 50 Q 78 53 78 60 L 78 142 Q 78 154 66 154 L 34 154 Q 22 154 22 142 L 22 60 Q 22 53 26 50 L 32 46 Q 38 42 38 36 Z'

/** Wave runs well past both edges so a one-period scroll never shows a seam. */
const WAVE =
  'M -112 0 q 14 -5 28 0 t 28 0 t 28 0 t 28 0 t 28 0 t 28 0 t 28 0 t 28 0 t 28 0 t 28 0 L 168 150 L -112 150 Z'
const WAVE_PERIOD = 56

const SIZES = {
  compact: { width: 64, viewBox: '0 0 100 170', showChamber: false },
  hero: { width: 200, viewBox: '0 0 100 236', showChamber: true },
}

/**
 * @param {object} props
 * @param {number} props.fraction   0-1 fill, from bottlePercentRemaining.
 * @param {number} [props.dropsPerMin]
 * @param {'normal'|'caution'|'critical'|'offline'} [props.status]
 * @param {'compact'|'hero'} [props.size]
 * @param {string} [props.label]    Bed name, for the accessible description.
 */
export default function IVBottle({
  fraction = 0,
  dropsPerMin = 0,
  status = 'normal',
  size = 'compact',
  label,
}) {
  // useId embeds colons, which are not valid in a url(#...) reference.
  const uid = useId().replace(/:/g, '')
  const reduced = useReducedMotion()
  const { width, viewBox, showChamber } = SIZES[size] ?? SIZES.compact

  const safeFraction = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0

  // Stiff but heavily damped: the level settles quickly and never overshoots.
  // A bouncing fluid level reads as a broken instrument.
  const level = useSpring(safeFraction, { stiffness: 120, damping: 24, mass: 0.6 })
  level.set(safeFraction)

  // Full bottle sits at offset 0; an empty one is pushed down by the full travel.
  const surfaceY = useTransform(level, (f) => (1 - f) * LIQUID_TRAVEL)

  const dropInterval = dropsPerMin > 0 ? Math.min(3, Math.max(0.28, 60 / dropsPerMin)) : 0
  const showDrops = showChamber && dropInterval > 0 && !reduced
  const fallDuration = Math.min(0.6, dropInterval * 0.6)

  const percent = Math.round(safeFraction * 100)
  const description = [
    label,
    `IV bottle ${percent} percent remaining`,
    dropsPerMin > 0 ? `${dropsPerMin} drops per minute` : 'no flow',
    status === 'offline' ? 'sensor offline, reading may be stale' : status,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <svg
      viewBox={viewBox}
      width={width}
      style={{ width, height: 'auto', maxWidth: '100%' }}
      role="img"
      aria-label={description}
    >
      <defs>
        {/* Clips the liquid to the bottle interior, so it cannot spill past the
            glass however far the spring travels mid-flight. */}
        <clipPath id={`${uid}-inner`}>
          <path d={BOTTLE_PATH} />
        </clipPath>
      </defs>

      {/* --- Hanger loop --- */}
      <path
        d="M 50 6 a 7 7 0 0 1 0 14"
        fill="none"
        stroke="var(--dt-border-strong)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* --- Bottle interior, empty --- */}
      <path d={BOTTLE_PATH} fill="var(--dt-surface-2)" />

      {/* --- Liquid --- */}
      <g clipPath={`url(#${uid}-inner)`}>
        <motion.g style={{ y: surfaceY }}>
          <rect
            x="18"
            y={BODY_TOP}
            width="64"
            height={TRAVEL + 40}
            fill="var(--dt-liquid)"
            opacity="0.5"
          />
          {/* Two waves at different speeds and directions read as a surface
              with depth. Held at half opacity so the fill never competes with
              the beacon for attention. */}
          <motion.g
            style={{ y: BODY_TOP }}
            animate={reduced ? undefined : { x: [0, -WAVE_PERIOD] }}
            transition={{ duration: 6.5, repeat: Infinity, ease: 'linear' }}
          >
            <path d={WAVE} fill="var(--dt-liquid)" opacity="0.28" />
          </motion.g>
          <motion.g
            style={{ y: BODY_TOP }}
            animate={reduced ? undefined : { x: [-WAVE_PERIOD, 0] }}
            transition={{ duration: 4.2, repeat: Infinity, ease: 'linear' }}
          >
            <path d={WAVE} fill="var(--dt-liquid)" opacity="0.42" />
          </motion.g>
        </motion.g>
      </g>

      {/* --- Glass outline, drawn over the liquid --- */}
      <path d={BOTTLE_PATH} fill="none" stroke="var(--dt-border-strong)" strokeWidth="2" />

      {/* Neck collar */}
      <rect
        x="36"
        y="24"
        width="28"
        height="6"
        rx="3"
        fill="var(--dt-surface-3)"
        stroke="var(--dt-border-strong)"
        strokeWidth="1.5"
      />

      {/* --- Graduations, so the level reads as a quantity and not just art --- */}
      {[0.25, 0.5, 0.75].map((mark) => (
        <line
          key={mark}
          x1="66"
          x2="74"
          y1={BODY_BOTTOM - mark * TRAVEL}
          y2={BODY_BOTTOM - mark * TRAVEL}
          stroke="var(--dt-border-strong)"
          strokeWidth="1.2"
          opacity="0.7"
        />
      ))}

      {showChamber && (
        <g>
          {/* Outlet into the drip chamber */}
          <path d="M 46 154 L 54 154 L 53 168 L 47 168 Z" fill="var(--dt-border-strong)" />
          <rect
            x="38"
            y="168"
            width="24"
            height="42"
            rx="11"
            fill="var(--dt-surface-2)"
            stroke="var(--dt-border-strong)"
            strokeWidth="2"
          />
          {/* Standing fluid in the bottom of the chamber */}
          <path
            d="M 39 198 L 61 198 L 61 199 Q 61 209 50 209 Q 39 209 39 199 Z"
            fill="var(--dt-liquid)"
            opacity="0.5"
          />
          {showDrops && (
            <motion.ellipse
              cx="50"
              rx="2.6"
              ry="3.4"
              fill="var(--dt-liquid)"
              opacity="0.85"
              initial={{ cy: 176, opacity: 0 }}
              animate={{ cy: [176, 195], opacity: [0, 1, 1, 0] }}
              transition={{
                duration: fallDuration,
                repeat: Infinity,
                repeatDelay: Math.max(0, dropInterval - fallDuration),
                ease: 'easeIn',
                times: [0, 0.15, 0.85, 1],
              }}
            />
          )}
          {/* Tube away to the patient */}
          <path
            d="M 50 210 L 50 232"
            stroke="var(--dt-border-strong)"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />
        </g>
      )}
    </svg>
  )
}
