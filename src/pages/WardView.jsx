import { isFirebaseConfigured, missingFirebaseConfig } from '../lib/firebase.js'
import {
  HX711_CALIBRATION_FACTOR_PLACEHOLDER,
  HX711_CALIBRATION_IS_PLACEHOLDER,
} from '../lib/constants.js'

/**
 * Ward overview.
 *
 * The card grid, status rails, beacons and severity banner are built in the
 * next steps. Right now this screen reports the one thing that is actually
 * true: whether the app can reach Firebase at all.
 */
export default function WardView() {
  return (
    <section>
      <h1 className="text-2xl">Ward overview</h1>
      <p className="mt-2 text-[15px] text-ink-muted">
        Live flow rate, bottle level and empty-bottle alerts for every monitored bed.
      </p>

      {HX711_CALIBRATION_IS_PLACEHOLDER && (
        <div
          data-severity="caution"
          className="rounded-card mt-6 flex gap-3 border p-4"
          style={{ borderColor: 'var(--dt-sev)', backgroundColor: 'var(--dt-sev-tint)' }}
        >
          <span aria-hidden="true" className="dt-nums font-semibold text-caution">
            !!
          </span>
          <div className="text-[13px] leading-relaxed">
            <p className="font-semibold text-caution">Load cell is not calibrated</p>
            <p className="mt-1 text-ink-muted">
              The HX711 factor is still{' '}
              <span className="dt-nums">{HX711_CALIBRATION_FACTOR_PLACEHOLDER}</span>, inherited
              from the VitalFlow board. Every weight-derived reading carries an unknown scale error
              until this is measured on the DripTrace cell.
            </p>
          </div>
        </div>
      )}

      {!isFirebaseConfigured ? (
        <div className="dt-card mt-6 p-6">
          <h2 className="text-base">Firebase is not connected</h2>
          <p className="mt-2 max-w-prose text-[14px] leading-relaxed text-ink-muted">
            Copy <code className="dt-nums text-[13px]">.env.example</code> to{' '}
            <code className="dt-nums text-[13px]">.env.local</code> and fill in the project
            configuration. The dashboard reads live bed data once these are set.
          </p>
          <ul className="mt-4 space-y-1.5">
            {missingFirebaseConfig.map((key) => (
              <li key={key} className="dt-nums text-[13px] text-ink-muted">
                {key}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="dt-card mt-6 p-6">
          <h2 className="text-base">Waiting for the first reading</h2>
          <p className="mt-2 max-w-prose text-[14px] leading-relaxed text-ink-muted">
            Firebase is configured. Bed cards appear here as soon as a unit publishes.
          </p>
        </div>
      )}
    </section>
  )
}
