import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'

import { TabBar } from './components/chrome.jsx'
import { useInAppAlarm } from './lib/alarm.js'
import { setKeepScreenOn, setMonitoring } from './lib/bridge.js'
import { MobileTelemetryProvider, useMobileTelemetry } from './lib/mobileTelemetry.jsx'
import { can } from './lib/roles.js'
import Alerts from './screens/Alerts.jsx'
import BedDetail from './screens/BedDetail.jsx'
import BedSetup from './screens/BedSetup.jsx'
import Settings from './screens/Settings.jsx'
import Ward from './screens/Ward.jsx'

function Shell() {
  const { wardBeds, settings } = useMobileTelemetry()
  const { pathname } = useLocation()
  useInAppAlarm(wardBeds, settings)

  useEffect(() => {
    setMonitoring(can('backgroundAlarms') && settings.backgroundMonitoring)
  }, [settings.backgroundMonitoring])

  useEffect(() => {
    setKeepScreenOn(settings.keepScreenOn)
  }, [settings.keepScreenOn])

  // Each screen opens at its top, as a native app would.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  const editing = pathname.endsWith('/edit') || pathname.startsWith('/assign/')

  return (
    <>
      <Routes>
        <Route path="/" element={can('viewWard') ? <Ward /> : <Navigate to="/settings" replace />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/bed/:id" element={<BedDetail />} />
        <Route path="/bed/:id/edit" element={<BedSetup />} />
        <Route path="/assign/:device" element={<BedSetup />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!editing && <TabBar />}
    </>
  )
}

export default function App() {
  return (
    <MobileTelemetryProvider>
      <Shell />
    </MobileTelemetryProvider>
  )
}
