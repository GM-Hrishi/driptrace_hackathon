import { useState } from 'react'

import AddPatientModal from '../components/AddPatientModal.jsx'
import { DataGate } from '../components/DataState.jsx'
import WardGrid, { WardGridSkeleton } from '../components/WardGrid.jsx'
import { Button } from '../components/ui.jsx'
import { useTelemetry } from '../lib/telemetry.jsx'

/**
 * Ward overview: every monitored bed, most urgent first.
 */
export default function WardView() {
  const { beds, sorted, now, simulation, status } = useTelemetry()
  const [adding, setAdding] = useState(false)

  const count = (channel) => beds.filter((bed) => bed.channel === channel).length
  const summary = [
    `${beds.length} ${beds.length === 1 ? 'bed' : 'beds'}`,
    count('critical') && `${count('critical')} critical`,
    count('caution') && `${count('caution')} caution`,
    count('offline') && `${count('offline')} offline`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Ward overview</h1>
          <p className="mt-1.5 text-[14px] text-ink-muted">
            {status === 'ready' && beds.length > 0 ? (
              <span className="dt-nums text-[13px]">{summary}</span>
            ) : (
              'Live flow rate, bottle level and empty-bottle alerts for every monitored bed.'
            )}
          </p>
        </div>
        {status !== 'not-configured' && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Add patient
          </Button>
        )}
      </div>

      <DataGate skeleton={<WardGridSkeleton />}>
        <WardGrid beds={sorted} now={now} simulation={simulation} onAddBed={() => setAdding(true)} />
      </DataGate>

      <AddPatientModal open={adding} onClose={() => setAdding(false)} />
    </section>
  )
}
