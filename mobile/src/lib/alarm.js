import { useEffect, useRef } from 'react'

import { vibrate } from './bridge.js'

/**
 * In-app audible alarm while the app is on screen. With the screen off or the
 * app in the background, MonitorService's notifications take over.
 *
 * Patterns follow the IEC 60601-1-8 idea of priority-by-rhythm rather than by
 * pitch alone: high priority is a fast five-pulse burst that repeats until
 * acknowledged; medium priority is a slower three-pulse burst played once when
 * the alert first appears.
 */

const HIGH = { freq: 880, pulses: 5, on: 0.12, gap: 0.08, repeatMs: 6_000 }
const MEDIUM = { freq: 600, pulses: 3, on: 0.18, gap: 0.16 }

/** @type {AudioContext | null} */
let ctx = null

function audio() {
  if (ctx) return ctx
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return null
  ctx = new Ctor()
  return ctx
}

// Browsers keep audio suspended until the first touch. The Android WebView is
// configured to allow playback without one, so this only matters in Chrome.
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => audio()?.resume(), { once: true })
}

function burst({ freq, pulses, on, gap }) {
  const ac = audio()
  if (!ac) return
  if (ac.state === 'suspended') ac.resume()
  let t = ac.currentTime + 0.02
  for (let i = 0; i < pulses; i++) {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'square'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.18, t + 0.01)
    gain.gain.setValueAtTime(0.18, t + on - 0.02)
    gain.gain.linearRampToValueAtTime(0, t + on)
    osc.connect(gain).connect(ac.destination)
    osc.start(t)
    osc.stop(t + on + 0.01)
    t += on + gap
  }
}

/** Play one sample burst, for the Settings "Test alarm" button. */
export function testAlarm(settings) {
  if (settings.alarmSound) burst(HIGH)
  if (settings.vibration) vibrate([300, 150, 300])
}

/**
 * @param {any[]} beds  Ward beds from useMobileTelemetry().
 * @param {import('./mobileStore.js').AppSettings} settings
 */
export function useInAppAlarm(beds, settings) {
  const seenCaution = useRef(new Set())
  const highActive = beds.some((bed) => bed.channel === 'critical' && !bed.acknowledged)

  // Medium priority: once per new alert.
  const cautionKeys = beds
    .filter((bed) => bed.channel === 'caution' && !bed.acknowledged && bed.alerts[0])
    .map((bed) => `${bed.id}:${bed.alerts[0].kind}`)
    .sort()
    .join('|')

  useEffect(() => {
    const keys = cautionKeys ? cautionKeys.split('|') : []
    const fresh = keys.filter((key) => !seenCaution.current.has(key))
    seenCaution.current = new Set(keys)
    if (fresh.length === 0 || document.visibilityState !== 'visible') return
    if (settings.alarmSound) burst(MEDIUM)
    if (settings.vibration) vibrate(200)
  }, [cautionKeys, settings.alarmSound, settings.vibration])

  // High priority: repeats until every critical bed is acknowledged or resolved.
  useEffect(() => {
    if (!highActive) return undefined
    const sound = () => {
      if (document.visibilityState !== 'visible') return
      if (settings.alarmSound) burst(HIGH)
      if (settings.vibration) vibrate([300, 150, 300])
    }
    sound()
    const timer = setInterval(sound, HIGH.repeatMs)
    return () => clearInterval(timer)
  }, [highActive, settings.alarmSound, settings.vibration])
}
