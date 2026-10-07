import { useEffect, useId, useRef, useState } from 'react'

import { addBed, useWardStore } from '../lib/store.js'
import { isFirebaseConfigured } from '../lib/firebase.js'
import { BED_LIMITS } from '../lib/validateBed.js'
import { Button } from './ui.jsx'

/**
 * Add Patient.
 *
 * A native <dialog> opened with showModal(), so focus trapping, Escape to
 * close and the inert background come from the browser rather than from
 * hand-rolled code. Every value is validated through validateBed.js, which
 * runs the sanitize.js helpers, before anything is stored.
 */

const EMPTY = {
  patientId: '',
  bedNumber: '',
  volumeMl: '500',
  prescribedFlowMlPerHr: '',
  deviceKind: isFirebaseConfigured ? 'esp32' : 'simulated',
  deviceId: '',
  lowVolumePct: '',
  clinician: '',
  ivStartAt: '',
  notes: '',
}

/** Field order, so focus can jump to the first invalid one on submit. */
const ORDER = Object.keys(EMPTY)

const INPUT =
  'rounded-control w-full border border-line-strong bg-surface-2 px-3 py-2 text-[14px] text-ink placeholder:text-ink-subtle aria-[invalid=true]:border-critical'

function Field({ id, label, hint, error, required, children }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-[13px] font-medium">
        {label}
        {required && (
          <span className="text-ink-subtle" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-[12px] text-critical">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1.5 text-[12px] text-ink-subtle">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

/** @param {{ open: boolean, onClose: () => void }} props */
export default function AddPatientModal({ open, onClose }) {
  const dialogRef = useRef(/** @type {HTMLDialogElement | null} */ (null))
  const formRef = useRef(/** @type {HTMLFormElement | null} */ (null))
  const uid = useId()
  const { settings } = useWardStore()
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}))
  const [showOptional, setShowOptional] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      setForm(EMPTY)
      setErrors({})
      setShowOptional(false)
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const id = (name) => `${uid}-${name}`
  const set = (name) => (event) => {
    setForm((f) => ({ ...f, [name]: event.target.value }))
    if (errors[name]) setErrors(({ [name]: _cleared, ...rest }) => rest)
  }
  const aria = (name, hasHint = false) => ({
    id: id(name),
    name,
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `${id(name)}-error` : hasHint ? `${id(name)}-hint` : undefined,
  })

  function handleSubmit(event) {
    event.preventDefault()
    const result = addBed(form)
    if (!result.ok) {
      setErrors(result.errors)
      const optionalError = ['lowVolumePct', 'clinician', 'ivStartAt', 'notes'].some((k) => result.errors[k])
      if (optionalError) setShowOptional(true)
      const first = ORDER.find((k) => result.errors[k])
      // After the optional section has had a chance to render.
      requestAnimationFrame(() => formRef.current?.elements.namedItem(first)?.focus?.())
      return
    }
    onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === dialogRef.current) onClose()
      }}
      aria-labelledby={id('title')}
      className="dt-card m-auto w-[min(640px,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto p-0 backdrop:bg-black/55 backdrop:backdrop-blur-[2px]"
    >
      <form ref={formRef} noValidate onSubmit={handleSubmit} className="p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={id('title')} className="text-lg font-semibold">
              Add patient
            </h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              Register a bed and its IV order. Fields marked * are required.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </Button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field id={id('patientId')} label="Patient identifier" required error={errors.patientId}>
            <input {...aria('patientId')} className={INPUT} value={form.patientId} onChange={set('patientId')} placeholder="e.g. MRN-20471" autoComplete="off" />
          </Field>
          <Field id={id('bedNumber')} label="Bed or room" required error={errors.bedNumber}>
            <input {...aria('bedNumber')} className={INPUT} value={form.bedNumber} onChange={set('bedNumber')} placeholder="e.g. 7 or ICU-B 3" autoComplete="off" />
          </Field>
          <Field id={id('volumeMl')} label="IV bottle volume (mL)" required error={errors.volumeMl}>
            <input {...aria('volumeMl')} className={`${INPUT} dt-nums`} value={form.volumeMl} onChange={set('volumeMl')} inputMode="decimal" min={BED_LIMITS.volumeMl.min} max={BED_LIMITS.volumeMl.max} />
          </Field>
          <Field
            id={id('prescribedFlowMlPerHr')}
            label="Prescribed flow rate (mL/hr)"
            required
            error={errors.prescribedFlowMlPerHr}
            hint={`Alarms when actual flow is more than ${settings.flowDeviationPct}% off this rate.`}
          >
            <input {...aria('prescribedFlowMlPerHr', true)} className={`${INPUT} dt-nums`} value={form.prescribedFlowMlPerHr} onChange={set('prescribedFlowMlPerHr')} inputMode="decimal" placeholder="e.g. 80" />
          </Field>
        </div>

        <fieldset className="mt-5">
          <legend className="text-[13px] font-medium">
            Device<span className="text-ink-subtle" aria-hidden="true"> *</span>
          </legend>
          <div className="rounded-pill mt-1.5 inline-flex border border-line-strong bg-surface-2 p-1">
            {[
              { value: 'esp32', label: 'ESP32 unit' },
              { value: 'simulated', label: 'Simulated' },
            ].map((option) => (
              <label
                key={option.value}
                className="rounded-pill cursor-pointer px-4 py-1.5 text-[13px] font-medium text-ink-muted has-checked:bg-accent has-checked:text-accent-on has-focus-visible:outline-2 has-focus-visible:outline-accent"
              >
                <input
                  type="radio"
                  name="deviceKind"
                  value={option.value}
                  checked={form.deviceKind === option.value}
                  onChange={set('deviceKind')}
                  className="sr-only"
                />
                {option.label}
              </label>
            ))}
          </div>
          {form.deviceKind === 'esp32' ? (
            <div className="mt-3 sm:max-w-[calc(50%-0.5rem)]">
              <Field
                id={id('deviceId')}
                label="Device ID"
                required
                error={errors.deviceId}
                hint="The key the unit publishes under in the Realtime Database."
              >
                <input {...aria('deviceId', true)} className={`${INPUT} dt-nums`} value={form.deviceId} onChange={set('deviceId')} placeholder="bed-01" autoComplete="off" spellCheck={false} />
              </Field>
            </div>
          ) : (
            <p className="mt-2 text-[12px] text-ink-subtle">
              {settings.simulationMode
                ? 'The bed is simulated in this browser, starting from a full bottle at the prescribed rate.'
                : 'Simulation mode is off, so this bed will show as paused until it is turned on in Admin.'}
            </p>
          )}
        </fieldset>

        <div className="mt-6 border-t border-line pt-4">
          <button
            type="button"
            aria-expanded={showOptional}
            aria-controls={id('optional')}
            onClick={() => setShowOptional((v) => !v)}
            className="flex items-center gap-2 text-[13px] font-medium text-ink-muted hover:text-ink"
          >
            <svg viewBox="0 0 16 16" className={`size-3.5 transition-transform ${showOptional ? 'rotate-90' : ''}`} aria-hidden="true">
              <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Optional details
          </button>
          {showOptional && (
            <div id={id('optional')} className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field
                id={id('lowVolumePct')}
                label="Low-volume alarm (%)"
                error={errors.lowVolumePct}
                hint={`Ward default is ${settings.lowVolumePct}%.`}
              >
                <input {...aria('lowVolumePct', true)} className={`${INPUT} dt-nums`} value={form.lowVolumePct} onChange={set('lowVolumePct')} inputMode="decimal" placeholder={String(settings.lowVolumePct)} />
              </Field>
              <Field id={id('clinician')} label="Nurse or physician" error={errors.clinician}>
                <input {...aria('clinician')} className={INPUT} value={form.clinician} onChange={set('clinician')} autoComplete="off" />
              </Field>
              <Field id={id('ivStartAt')} label="IV start time" error={errors.ivStartAt}>
                <input {...aria('ivStartAt')} type="datetime-local" className={`${INPUT} dt-nums`} value={form.ivStartAt} onChange={set('ivStartAt')} />
              </Field>
              <div className="sm:col-span-2">
                <Field id={id('notes')} label="Notes" error={errors.notes}>
                  <textarea {...aria('notes')} rows={2} maxLength={280} className={`${INPUT} resize-y`} value={form.notes} onChange={set('notes')} />
                </Field>
              </div>
            </div>
          )}
        </div>

        <div className="mt-7 flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            Add to ward
          </Button>
        </div>
      </form>
    </dialog>
  )
}
