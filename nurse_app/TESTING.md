# DripTrace App Final Testing Report

## What Changed
- **Mode B (Local)**: Moved HTTP polling from WebView Javascript to native `LocalDeviceClient.java` utilizing Android `ConnectivityManager` to enforce routing through the active Wi-Fi connection. This circumvents mixed-content and CORS WebView restrictions while enabling background service polling.
- **Firebase Configuration**: Moved to a single read-only configuration inside `assets/web/firebase-config.json`. Dropped all `<VITE_...>` placeholders. 
- **Offline / Isolated Asset Loading**: Downloaded Firebase JS SDK and Chart.js into `assets/web/`. Updated the UI to exclusively use local files and load them via `WebViewAssetLoader` over `https://appassets.androidplatform.net`.
- **Bed UI**: Dropped all writing control fields (sliders, tare). Bound "X of Y mL" format strings correctly for `fluidMl` and `capacityMl`. Added the "Edit bed" form to dynamically control metadata variables via `WardStore`.
- **Chart.js Historian**: Added a `historyChart` using local Chart.js dependencies. Subscribes accurately to `<bedId>/history` via Firebase or locally caches `history?min=120`.
- **Hotspot Info**: Included the SSID `DripTrace-<bed>` and `soldering26` password into the 'Mode B' settings UI, coupled with an automated Intent bridge straight to Android's Wi-Fi panel.
- **Flow Stopped Grace Period**: Updated `AlertRules.java` and `alerts.js` to track `flowStoppedSince`. `flow-stopped` triggers only after 60 continuous seconds of flow reading ≤ 1 mL/hr. 

## Testing Summary
1. `assembleDebug` builds perfectly with no deprecation warnings triggering compilation failure.
2. Web assets grep: verified zero occurrences of `https://` scripts, `/command`, `telemetry/latest`, and `Auth Token`.
3. Java vs Javascript parity: Tested identically for 60-second grace period handling.

## Manual Checks to perform
- Compare website vs app numbers on bed-01. They must match perfectly.
- Power off ESP32 -> App should render grey offline UI in ≤ 15 s.
- In Mode B with internet router off, live data and graph persist.
- Lock phone -> Background service critical alarm rings and repeats every 30s.
- Hang a new bottle -> Wait 61 seconds for flow to remain at 0 -> flow-stopped triggers successfully.

**APK Path**: `app/build/outputs/apk/debug/app-debug.apk`
