import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { Button, ConfirmButton } from '../../../src/components/ui.jsx'
import { BED_LIMITS } from '../../../src/lib/validateBed.js'
import { Field, Screen, TopBar, inputClass } from '../components/chrome.jsx'
import { assignDevice, editBed, removeBed, useMobileStore } from '../lib/mobileStore.js'
import { useMobileTelemetry } from '../lib/mobileTelemetry.jsx'
import { can } from '../lib/roles.js'

/** epoch ms -> "YYYY-MM-DDTHH:MM" in local time, for datetime-local. */
function toLocalInput(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function initialForm(bed) {
  return {
    bedNumber: bed?.bedNumber ?? '',
    patientId: bed?.patientId ?? '',
    volumeMl: bed ? String(bed.volumeMl) : '500',
    prescribedFlowMlPerHr: bed ? String(bed.prescribedFlowMlPerHr) : '',
    lowVolumePct: bed?.lowVolumePct != null ? String(bed.lowVolumePct) : '',
    clinician: bed?.clinician ?? '',
    ivStartAt: toLocalInput(bed ? bed.ivStartAt : Date.now()),
    notes: bed?.notes ?? '',
  }
}

const VOLUME_PRESETS = [100, 250, 500, 1000]

/**
 * Assign a discovered unit to a bed (/assign/:device) or edit a bed
 * (/bed/:id/edit). Everything goes through the website's validateBedInput, so
 * the same limits and sanitizing apply on both.
 */
export default function BedSetup() {
  const { id, device: rawDevice } = useParams()
  const device = rawDevice ? decodeURIComponent(rawDevice) : null
  const navigate = useNavigate()
  const { beds } = useMobileStore()
  const { settings } = useMobileTelemetry()
  const bed = id ? beds.find((b) => b.id === id) : null
  const [form, setForm] = useState(() => initialForm(bed))
  const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}))

  if (!can('editBed') || (id && !bed)) {
    return (
      <>
        <TopBar title="Bed setup" back />
        <Screen>
          <p className="dt-card p-5 text-[14px] text-ink-muted">This bed is not available.</p>
        </Screen>
      </>
    )
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  function submit(e) {
    e.preventDefault()
    const result = bed ? editBed(bed.id, form) : assignDevice(device, form)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    navigate(`/bed/${result.bed.id}`, { replace: true })
  }

  return (
    <>
      <TopBar title={bed ? `Edit ${bed.label}` : `Assign ${device}`} back />
      <Screen>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {!bed && (
            <p className="text-[14px] leading-relaxed text-ink-muted">
              Unit <span className="dt-nums text-ink">{device}</span> will be watched on this bed. Details stay on this
              phone.
            </p>
          )}
          {errors.form && <p className="text-[14px] text-critical">{errors.form}</p>}
          {errors.deviceId && <p className="text-[14px] text-critical">{errors.deviceId}</p>}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Bed number" error={errors.bedNumber}>
              <input className={inputClass} value={form.bedNumber} onChange={set('bedNumber')} autoFocus={!bed} />
            </Field>
            <Field label="Patient ID / MRN" error={errors.patientId}>
              <input className={inputClass} value={form.patientId} onChange={set('patientId')} autoCapitalize="characters" />
            </Field>
          </div>

          <Field label="Bottle volume (mL)" error={errors.volumeMl}>
            <div className="mb-2 flex gap-2">
              {VOLUME_PRESETS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, volumeMl: String(v) }))}
                  className={`rounded-pill dt-nums min-h-10 flex-1 border text-[14px] ${
                    form.volumeMl === String(v) ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-muted'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <input
              className={inputClass}
              value={form.volumeMl}
              onChange={set('volumeMl')}
              inputMode="numeric"
              min={BED_LIMITS.volumeMl.min}
              max={BED_LIMITS.volumeMl.max}
            />
          </Field>

          <Field
            label="Prescribed rate (mL/h)"
            error={errors.prescribedFlowMlPerHr}
            hint={`Deviation alarm at ±${settings.flowDeviationPct}% of this rate.`}
          >
            <input
              className={inputClass}
              value={form.prescribedFlowMlPerHr}
              onChange={set('prescribedFlowMlPerHr')}
              inputMode="decimal"
            />
          </Field>

          <Field
            label="Low-volume alert (%)"
            error={errors.lowVolumePct}
            hint={`Leave empty to use the ward default (${settings.lowVolumePct}%).`}
          >
            <input
              className={inputClass}
              value={form.lowVolumePct}
              onChange={set('lowVolumePct')}
              inputMode="numeric"
              placeholder={String(settings.lowVolumePct)}
            />
          </Field>

          <Field label="IV started" error={errors.ivStartAt}>
            <input type="datetime-local" className={inputClass} value={form.ivStartAt} onChange={set('ivStartAt')} />
          </Field>

          <Field label="Nurse / clinician">
            <input className={inputClass} value={form.clinician} onChange={set('clinician')} autoComplete="name" />
          </Field>

          <Field label="Notes">
            <textarea className={`${inputClass} min-h-24 py-2`} value={form.notes} onChange={set('notes')} maxLength={280} />
          </Field>

          <Button type="submit" variant="primary" className="min-h-12 w-full text-[16px]">
            {bed ? 'Save changes' : 'Assign to bed'}
          </Button>
        </form>

        {bed && (
          <div className="mt-8 border-t border-line pt-5">
            <p className="mb-3 text-[13px] text-ink-muted">
              Removing the bed stops its alarms.
              {bed.simulated ? '' : ' The unit shows up again under “New units”.'}
            </p>
            <ConfirmButton
              size="md"
              className="min-h-12 w-full"
              confirmLabel="Tap again to remove"
              onConfirm={() => {
                removeBed(bed.id)
                navigate('/', { replace: true })
              }}
            >
              Remove {bed.label} from ward
            </ConfirmButton>
          </div>
        )}
      </Screen>
    </>
  )
}
