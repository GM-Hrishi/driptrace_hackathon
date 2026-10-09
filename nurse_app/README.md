# DripTrace Nurse app (Android)

Java WebView shell (`app/src/main/java/com/ivfluidwatch/app/`) around a single-page nurse UI (`app/src/main/assets/index.html` + `alerts.js`).

- **Mode A (cloud):** Firebase anonymous sign-in, live `beds/` and `history/<bed>`. Read-only.
- **Mode B (hotspot):** native `LocalDeviceClient` polls `http://192.168.4.1/api/live` and `/api/history` over the board's `DripTrace-<bed>` Wi-Fi.
- **Alarms:** `alerts.js` (in-app popup with Acknowledge) and `AlertRules.java` (background notifications from `MonitorService`) mirror `src/lib/severity.js`. Both acknowledge into one store (`WardStore`), so the popup and the notification stay in step.

## Build
1. Copy `app/src/main/assets/web/firebase-config.example.json` to `firebase-config.json` and fill it from the repo's `.env.local` (git-ignored).
2. Set the hotspot password in `index.html` (`data-secret="SET_AP_PASSWORD"`, matches `AP_PASSWORD` in the firmware's `secrets.h`).
3. Create `local.properties` with `sdk.dir=<path to Android SDK>`, then run `gradlew.bat assembleDebug`.
