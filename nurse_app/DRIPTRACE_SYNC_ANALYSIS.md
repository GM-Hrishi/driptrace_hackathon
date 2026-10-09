# DripTrace Sync Analysis

## 1. Stack & Build Status
- **Framework/Language**: Android Native Shell (Java) hosting a WebView. The core UI, state, and networking are built in Vanilla JavaScript, HTML, and CSS (single-page app structure).
- **Build Tool**: Gradle
- **SDK Versions**: `minSdk 26`, `targetSdk 34`
- **Package Name**: `com.ivfluidwatch.app`
- **Build Status**: **SUCCESS**. The app compiles locally with zero errors (built via `.\gradlew.bat assembleDebug`, finished in ~25s).

## 2. Data Sources & Mapping
- **Firebase REST (Mode A)**: 
  - **Reads**: Polls `${backendUrl}/devices/${state.deviceId}/telemetry/latest.json`.
  - **Writes**: Sends POST requests to `${backendUrl}/devices/${state.deviceId}/commands.json`.
- **Local ESP32 (Mode B)**: Polls `${localUrl}/telemetry` and posts to `${localUrl}/command`.
- **Mock Data**: Uses `state.isSimulator` to feed fake static telemetry and simulate commands.
- **Local Storage**: Uses Android `SharedPreferences` (via `window.AndroidBridge`) to store Mode, URLs, Auth Token, and Device ID.
- **ThingSpeak**: Not present in the current application tree.
- **Current Fields Read**: `flowRateMlPerHr`, `prescribedRateMlPerHr`, `deviationPercent`, `bottleWeightGrams`, `bottleLevelPercent`, `bottleEmpty`, `heartRateBpm`, `spo2Percent`, `alertActive`, `alertSeverity`, `wifiRssi`.

## 3. Screen Inventory
The app is a single-page HTML interface containing:
- **Header**: App branding, Simulator toggle, Settings modal button.
- **Status Bar**: Mode indicator (A/B), connection status (Connected/Reconnecting/Offline).
- **Bed Switcher**: Hardcoded horizontal list of pills (`BED 01`, `BED 02`, `BED 03`).
- **Alert Banner**: Conditionally rendered banner for warnings/critical errors with an "ACK" button.
- **Gauges (Grid)**:
  - **Flow Rate**: Displays mL/hr, deviation %, and text status (Normal/Deviation/Critical).
  - **Container**: Shows visual bottle level, %, grams, and status (ACTIVE/LOW/EMPTY).
  - **Vitals**: Displays Heart Rate, SpO2, and WiFi signal strength.
- **Control Panel**: Slider and preset buttons to set target flow rate, plus a Tare Scale button.
- **Settings Modal**: Configuration inputs for Transport Mode, Firebase URL, Auth Token, Local IP, Device ID, and Polling Rate.

## 4. Gap Analysis Table

| Area | App today | Website contract | Gap | Fix size |
| :--- | :--- | :--- | :--- | :--- |
| **Config/Auth** | Custom bearer token input in Settings. | Firebase Anonymous Auth. | Auth layer completely missing in app. Needs Firebase SDK or REST auth exchange. | M |
| **Data Paths** | Reads `/devices/<id>/telemetry/latest.json`. | Reads `beds/<unitId>` (live) and `history/<unitId>` (trend). | Path structure mismatch. History endpoint unused. | S |
| **Polling vs Listeners** | `setTimeout` HTTP polling (1.5s interval). | Firebase live listeners implied. App background polling is paused via lifecycle hooks. | Polling is deprecated. Needs Firebase SDK realtime sync for live + background alerts. | L |
| **Field Names & Schema** | Reads `alertActive`, `bottleWeightGrams`, `heartRateBpm`. Computes deviation internally via arbitrary flags. | Reads `weightGrams`, `capacityMl`, `clamp`, `rhythm`, `sensorOnline`, `unresponsive`, etc. | Massive schema mismatch. The app relies on the ESP32 to calculate alarms. | M |
| **Units & Calibrated mL** | Shows raw % and grams. | Displays calibrated `fluidMl` of `capacityMl`. | Missing capacity logic and mL rendering. | S |
| **Guards / Bad Data** | Basic `isNaN` and null checks. | Must discard `lastUpdated` > 60s future. Invalid fields must show "—". | Stricter validation needed on incoming payloads. | S |
| **Stale/Offline Rule** | Network failure -> "offline". | Offline if `sensorOnline === false`, `lastUpdated` missing, or > 15s old. Shows grey text, no alarms. | Offline logic needs to be tied to payload timestamps/flags, not just HTTP failure. | S |
| **Alarm Rules & Ordering** | Relies on backend/ESP32 payload (`alertSeverity`, `alertActive`). | Client must compute alarms strictly (1. unresponsive -> 2. irregular -> ... -> 7. low volume). | Alarm evaluation engine missing entirely. | M |
| **Alarm Styling** | CSS keyframe bounce and static red/amber colors. | IEC 60601-1-8: critical red ~2 Hz flash, caution amber slow pulse. Ack stops flashing. | Flashing speeds and persistent color states need adjustment. | S |
| **Clamp & Vitals** | No clamp UI. Basic HR/SpO2 readouts. | Clamp states (open/closed/offline). Advanced vitals (rhythm, out-of-range, unresponsive). | UI needs expansion for clamp status and advanced cardiac alerts. | M |
| **History Chart** | Does not exist. | Reads `history/<unitId>`, orders by `t`, displays trend chart. | Need to build a charting component (e.g., Chart.js) and wire it to history. | L |
| **Drops Per Min** | Does not exist. | Computed from flow rate (20 gtt/mL). | Formula injection missing. | S |
| **Background Notifications** | Triggers Android native alert via `triggerNativeAlert()`. Fails in background due to paused WebView. | Needs to fire reliably if device drops below thresholds while app is closed. | Need an Android Native Service running the Firebase SDK to trigger notifications. | L |
| **Bed Management** | Hardcoded DOM (`bed-01`, `02`, `03`). | App manages setup natively. Unassigned beds show as "New units". | Bed registry needs to be moved to SharedPreferences and populated dynamically. | M |

## 5. Flags (Critical Issues to Resolve)
- **ILLEGAL WRITES**: The Control Panel sends `POST` requests to change prescribed rates and tare the scale. The contract explicitly states *ALL client writes are denied by the rules*. The entire Control Panel (Sliders, Tare buttons) must be removed.
- **HARDCODED SECRETS/CONFIGS**: `https://driptrace-hackathon-default-rtdb.firebaseio.com` is baked into the UI defaults and JS state initialization.
- **DEAD CODE**: 
  - The `fetchTelemetry()` polling interval system (`setTimeout`, `restartPolling()`) is dead code under the new contract.
  - The entire simulated data engine (`runSimulatorTick()`, `state.isSimulator`) is obsolete.
  - *Note: No ThingSpeak integration was found in the current codebase.*

## 6. Recommended Action Plan
1. **Remove Illegal Writes & Dead Code**: Delete the Control Panel UI (sliders, tare buttons), the `sendCommand()` JS function, and the simulator payload generator. Remove the HTTP polling loop logic.
2. **Implement Firebase Auth & SDK**: Replace the manual REST `fetch()` calls with the official Firebase JS SDK. Implement Anonymous Sign-in. 
3. **Map New Data Schema**: Update the UI to bind to the new fields (`fluidMl`, `capacityMl`, `clamp`, `rhythm`). Remove old dependencies like `alertSeverity`.
4. **Build the Alarm Engine**: Write a client-side evaluation function that runs on every Firebase payload update, checking the 7 rules in strict priority order to dictate UI state and Native Notifications.
5. **Implement Offline & Guard Rules**: Inject the 15-second timestamp checks and `sensorOnline` verification before processing a payload.
6. **Add the History Chart**: Fetch the `history/` path using `limitToLast` and render a trend graph.
7. **Native Background Service (Optional but Recommended)**: Move the Firebase listener logic out of the WebView and into a native Android Foreground Service to guarantee alerts fire when the app is minimized.

## Open Questions
1. Should Mode B (Local ESP32 connectivity over offline WiFi) be completely removed, or does it still need to be supported alongside the new Firebase contract?
2. Do you want to continue using the WebView/HTML architecture, or should we port the UI to native Android (Kotlin/Compose) to make background Firebase listeners easier to implement?
3. The contract mentions "Bed setup is NOT in Firebase. Keep it on the phone." Should I build a new native screen to map Firebase `unitId`s to Patient Names/Prescribed Rates?
