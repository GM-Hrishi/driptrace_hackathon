import { useEffect, useRef } from 'react'
import { motion } from 'motion/react'

import { loadDemoWard } from '../lib/store.js'
import BedCard, { BedCardSkeleton } from './BedCard.jsx'
import { Button } from './ui.jsx'

const GRID = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'

/**
 * The ward. Takes beds already sorted critical-first (sortCriticalFirst in
 * severity.js), so the bed that needs a nurse is always top-left.
 *
 * Cards fade in once, staggered, on the first snapshot. After that a re-sort
 * slides cards to their new slot rather than cutting, so staff can follow a
 * bed that just escalated.
 *
 * @param {{
 *   beds: import('../lib/telemetry.jsx').WardBed[],
 *   now: number,
 *   simulation: boolean,
 *   onAddBed: () => void,
 * }} props
 */
export default function WardGrid({ beds, now, simulation, onAddBed }) {
  const firstSnapshot = useRef(true)
  useEffect(() => {
    if (beds.length > 0) firstSnapshot.current = false
  }, [beds.length])

  if (beds.length === 0) {
    return (
      <div className="dt-card flex flex-col items-center px-6 py-14 text-center">
        <svg viewBox="0 0 32 32" aria-hidden="true" className="size-10 text-ink-subtle">
          <path
            d="M16 5c0 0 8.5 10.6 8.5 15.6a8.5 8.5 0 1 1-17 0C7.5 15.6 16 5 16 5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        </svg>
        <h2 className="mt-4 text-lg font-semibold">Add your first bed</h2>
        <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-ink-muted">
          Register a patient, their bed and the IV order, then assign an ESP32 unit or a simulated
          one. The bed appears here as soon as it reports.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button variant="primary" onClick={onAddBed}>
            Add patient
          </Button>
          {simulation && (
            <Button variant="secondary" onClick={loadDemoWard}>
              Load the six-bed demo ward
            </Button>
          )}
        </div>
      </div>
    )
  }

  const stagger = firstSnapshot.current

  return (
    <ul className={GRID} aria-label="Beds, most urgent first">
      {beds.map((bed, i) => (
        <motion.li
          key={bed.id}
          layout="position"
          initial={stagger ? { opacity: 0, y: 4 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            opacity: { duration: 0.2, delay: stagger ? i * 0.04 : 0 },
            y: { duration: 0.2, delay: stagger ? i * 0.04 : 0 },
            layout: { type: 'spring', stiffness: 380, damping: 38 },
          }}
        >
          <BedCard bed={bed} now={now} />
        </motion.li>
      ))}
    </ul>
  )
}

export function WardGridSkeleton({ count = 6 }) {
  return (
    <div className={GRID}>
      {Array.from({ length: count }, (_, i) => (
        <BedCardSkeleton key={i} />
      ))}
    </div>
  )
}
