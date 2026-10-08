import { useEffect, useState } from 'react'

import { Button, ConfirmButton, formatAgo } from '../../../src/components/ui.jsx'
import { VITALS } from '../../../src/config/vitals.js'
import { BED_LIMITS } from '../../../src/lib/validateBed.js'
import { Group, Screen, Section, Toggle, TopBar, inputClass } from '../components/chrome.jsx'
import { testAlarm } from '../lib/alarm.js'
import { isNativeApp, notificationsEnabled, openNotificationSettings } from '../lib/bridge.js'
import { clearSimulatedBeds, loadDemoWard, updateSettings } from '../lib/mobileStore.js'
import { useMobileTelemetry } from '../lib/mobileTelemetry.jsx'
import { ROLE, ROLES, can } from '../lib/roles.js'

const CONNECTION_TEXT = {
  connected: 'Connected — live updates',
  connecting: 'Connecting…',
  offline: 'Offline',
  'not-configured': 'Firebase not configured in this build',
}

function NumberSetting({ label, hint, value, limits, onCommit }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const n = Number(draft)
    if (draft.trim() && Number.isFinite(n) && n >= limits.min && n <= limits.max) onCommit(Math.round(n))
    else setDraft(String(value))
  }
  return (
    <label className="flex min-h-14 items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px]">{label}</span>
        <span className="mt-0.5 block text-[12px] text-ink-subtle">{hint}</span>
      </span>
      <input
        className={`${inputClass} dt-nums w-20 text-center`}
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </label>
  )
}

/** Re-checked whenever the nurse comes back from Android's settings screen. */
function useNotificationStatus() {
  const [enabled, setEnabled] = useState(() => notificationsEnabled())
  useEffect(() => {
    const check = () => setEnabled(notificationsEnabled())
    document.addEventListener('visibilitychange', check)
    return () => document.removeEventListener('visibilitychange', check)
  }, [])
  return enabled
}

export default function Settings() {
  const { settings, firebase, units, beds, lastSnapshotAt, now } = useMobileTelemetry()
  const notifications = useNotificationStatus()
  const simCount = beds.filter((bed) => bed.simulated).length

  return (
    <>
      <TopBar title="Settings" />
      <Screen>
        <Section title="Alarms">
          {notifications === false && (
            <div data-severity="critical" className="dt-card mb-2 p-4">
              <p className="text-[14px] font-semibold" style={{ color: 'var(--dt-sev)' }}>
                Notifications are off
              </p>
              <p className="mt-1 text-[13px] text-ink-muted">Alarms cannot reach you while the phone is locked.</p>
              <Button variant="primary" className="mt-3" onClick={openNotificationSettings}>
                Turn on notifications
              </Button>
            </div>
          )}
          <Group>
            {can('backgroundAlarms') && (
              <Toggle
                label="Alarm when phone is locked"
                hint={
                  isNativeApp
                    ? 'Keeps a live connection and notifies you of every alarm. Shows a “Monitoring” notification.'
                    : 'Available in the Android app.'
                }
                checked={settings.backgroundMonitoring}
                disabled={!isNativeApp}
                onChange={(v) => updateSettings({ backgroundMonitoring: v })}
              />
            )}
            <Toggle
              label="Alarm sound in app"
              hint="Critical repeats until acknowledged; caution plays once."
              checked={settings.alarmSound}
              onChange={(v) => updateSettings({ alarmSound: v })}
            />
            <Toggle label="Vibrate" checked={settings.vibration} onChange={(v) => updateSettings({ vibration: v })} />
            <Toggle
              label="Keep screen on"
              hint="For a phone parked at the nurses’ station."
              checked={settings.keepScreenOn}
              disabled={!isNativeApp}
              onChange={(v) => updateSettings({ keepScreenOn: v })}
            />
            <div className="px-4 py-3">
              <Button onClick={() => testAlarm(settings)}>Test alarm</Button>
            </div>
          </Group>
        </Section>

        {can('viewThresholds') && (
          <Section title="Ward thresholds" hint="Apply to every bed unless a bed sets its own.">
            <Group>
              <NumberSetting
                label="Low-volume alert"
                hint="Percent of bottle left"
                value={settings.lowVolumePct}
                limits={BED_LIMITS.lowVolumePct}
                onCommit={(v) => updateSettings({ lowVolumePct: v })}
              />
              <NumberSetting
                label="Flow deviation"
                hint="± percent of prescribed rate"
                value={settings.flowDeviationPct}
                limits={{ min: 5, max: 80 }}
                onCommit={(v) => updateSettings({ flowDeviationPct: v })}
              />
            </Group>
          </Section>
        )}

        <Section title="Vitals" hint="From the MAX30102 finger sensor. Display only; they raise no alarms.">
          <Group>
            {VITALS.map((vital) => (
              <Toggle
                key={vital.key}
                label={`Show ${vital.fullLabel}`}
                checked={vital.isEnabled(settings)}
                onChange={(v) => updateSettings({ [vital.settingKey]: v })}
              />
            ))}
          </Group>
        </Section>

        {can('simulation') && (
          <Section title="Demo" hint="Simulated beds run on this phone only and are tagged SIM.">
            <Group>
              <Toggle
                label="Run simulated beds"
                checked={settings.simulationMode}
                onChange={(v) => updateSettings({ simulationMode: v })}
              />
              <Toggle
                label="Show simulated beds on ward"
                checked={settings.showSimulatedBeds}
                onChange={(v) => updateSettings({ showSimulatedBeds: v })}
              />
              <div className="flex flex-wrap gap-2 px-4 py-3">
                <Button onClick={loadDemoWard}>Load demo ward</Button>
                {simCount > 0 && (
                  <ConfirmButton size="md" confirmLabel="Tap again" onConfirm={clearSimulatedBeds}>
                    Remove {simCount} simulated
                  </ConfirmButton>
                )}
              </div>
            </Group>
          </Section>
        )}

        {can('viewDeviceInfo') && (
          <Section title="Connection">
            <div className="dt-card divide-y divide-line text-[14px]">
              <p className="flex justify-between gap-4 px-4 py-3">
                <span className="text-ink-muted">Cloud</span>
                <span className="text-right">{firebase.error ?? CONNECTION_TEXT[firebase.connection]}</span>
              </p>
              <p className="flex justify-between gap-4 px-4 py-3">
                <span className="text-ink-muted">Last update</span>
                <span className="dt-nums">{lastSnapshotAt ? formatAgo(lastSnapshotAt, now) : '—'}</span>
              </p>
              <p className="flex justify-between gap-4 px-4 py-3">
                <span className="text-ink-muted">Units publishing</span>
                <span className="dt-nums text-right">
                  {units.length ? units.map((u) => u.device).join(', ') : 'none'}
                </span>
              </p>
              <p className="flex justify-between gap-4 px-4 py-3">
                <span className="text-ink-muted">App mode</span>
                <span>{ROLES[ROLE].label} view</span>
              </p>
            </div>
          </Section>
        )}

        <p className="mt-8 text-center text-[12px] text-ink-subtle">
          DripTrace · decision support only — always confirm at the bedside.
        </p>
      </Screen>
    </>
  )
}
