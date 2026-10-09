# DripTrace: Antigravity prompts for the nurse app

Two prompts for a teammate's existing app. Paste them into Antigravity, opened in that app's folder.

1. **Prompt 1 (analyze)** is read-only. It writes `DRIPTRACE_SYNC_ANALYSIS.md` in the app folder. Read it before you go on.
2. **Prompt 2 (fix)** makes the app read the same Firebase data and raise the same alarms as the website.

**Before sending Prompt 2:** replace the seven `<VITE_FIREBASE_...>` placeholders with the values from `.env.local`. They are public web identifiers, not secrets. **Never share** the RTDB secret, WiFi or hotspot passwords from `firmware/driptrace_v3/secrets.h`. Do not commit a filled-in copy of this file.

Source of truth for everything below: `src/lib/reading.js`, `src/lib/severity.js`, `src/lib/constants.js`, `firebase/database.rules.json`. Update this file if those change.

---

## PROMPT 1 — Analyze (paste first)

```
You are in my existing mobile app's folder. It must become a companion to the DripTrace website: same live Firebase data, same numbers, same alarms. In this step DO NOT change any code. Only analyze and write a report.

Reference (read-only): https://github.com/GM-Hrishi/driptrace_hackathon
- src/lib/firebase.js (config + anonymous sign-in), src/lib/reading.js (parsing), src/lib/severity.js + src/lib/constants.js (alarm rules), src/lib/telemetry.jsx (live listener), firebase/database.rules.json (rules).
- mobile/src/** is the website team's own nurse UI. Borrow ideas from it, but my app is the one we are fixing.

Do this:
1. Identify the stack (framework, language, build tool, min/target SDK, package name), how to build and run it, and whether it builds right now. Run the build and report errors verbatim.
2. Map every data source: Firebase (which SDK, which config, which paths), ThingSpeak, REST, mock data, local storage. List each path/field the app reads and writes.
3. Map every screen and what it shows: bed list, bed detail, charts, alerts, settings, login.
4. Compare with the contract below and fill a gap table: | Area | App today | Website contract | Gap | Fix size S/M/L |. Cover config/auth, paths, field names, units, the parsing guards, stale/offline rule, every alarm kind + message text, alarm ordering, history chart, calibrated mL display, clamp, vitals, background notifications.
5. Flag anything that WRITES to beds/ or history/ (rules deny it, so it must go), any hard-coded secrets, and any dead code (ThingSpeak, polling).
6. Write DRIPTRACE_SYNC_ANALYSIS.md in the app root with: stack + build status, data-flow summary, the gap table, a numbered fix plan in the order you would do it, and open questions for me. Then stop.

=== DripTrace contract ===
Firebase Realtime Database. Auth: Firebase Anonymous sign-in (already enabled). Reads need auth != null. ALL client writes are denied by the rules: the app is read-only.
Paths:
- beds/<unitId> (e.g. beds/bed-01), live, ~1 Hz from the ESP32.
- history/<unitId>/<13-digit epoch ms>, one sample per second, for the trend chart (indexed on "t"; query orderByChild("t") with limitToLast).
beds/<unitId> fields:
  weightGrams (gross bottle g, 0–5000), flowRateMlPerHr (0–1000), bottlePercentRemaining (0–100), bottleEmpty (bool),
  fluidMl (0–5000) and capacityMl (1–5000): calibrated, shown as "X of Y mL",
  clamp ("open"|"closed"|"offline"): backflow clamp state,
  sensorOnline (bool, load cell connected; only an explicit false means offline), lastUpdated (epoch ms),
  heartRate (20–250), spo2 (50–100), finger (bool), signal ("no-finger"|"acquiring"|"ok"|"motion"|"offline"),
  rhythm ("regular"|"irregular"|"unknown"), irregularProb (0–1), hrLow/hrHigh (30–200, valid only if hrLow<hrHigh),
  baselinePct (0–100), hrOutOfRange (bool), unresponsive (bool), unresponsiveWhy ("no-pulse"|"low-hr"|"low-spo2"|"sim"),
  backlog (int), wifi (bool), bed (string), optional label, dropsPerMin.
history sample fields: t, flowRateMlPerHr, bottlePercentRemaining, weightGrams, sensorOnline, bottleEmpty, optional heartRate, spo2, irregularProb, rhythm, unresponsive, motion, approxTime (true = time estimated, show as approximate).
Parsing: the ESP32 writes with a DB secret that bypasses validation, so never trust a value. Out-of-range or non-number → "—" (missing). Clamp flow 0–1000 and percent 0–100. Ignore lastUpdated more than 60 s in the future.
dropsPerMin = reported value, else round(flowRateMlPerHr * 20 / 60, 1 decimal) (20 gtt/mL set).
Units: flow in mL/hr everywhere in the app (the device's own screen shows mL/min; the website and app use mL/hr).
Offline: a unit is offline if lastUpdated is missing, sensorOnline === false, or now - lastUpdated > 15000 ms. Offline shows grey "Sensor offline — readings are stale, check the unit", never a patient alarm, never flashing.
Alarms (per bed, thresholds: prescribedFlowMlPerHr per bed, optional; lowVolumePct default 10; flowDeviationPct default 30; no-prescription range 20–180 mL/hr). pct = percent ?? 0, flow = flow ?? 0. Evaluate in this order:
  1 unresponsive → critical "patient-unresponsive": "Possible unresponsive patient — check the patient now"
  2 rhythm=="irregular" → caution "irregular-rhythm": "Irregular heartbeat — check pulse manually and inform the doctor"
  3 hrOutOfRange && heartRate && hrLow → caution "hr-out-of-range": "Heart rate {round(HR)}, patient's normal {hrLow}–{hrHigh} — check the patient"
  4 bottleEmpty || pct <= 2 → critical "bottle-empty": "Bottle empty — replace the IV bottle" and STOP (no further line alarms)
  5 flow <= 1 → critical "flow-stopped": "Flow stopped — check clamp, line and cannula"
  6 flowing (flow > 1) with prescription: ratio = flow/prescribed; ratio > 1+dev → caution "flow-high": "Flow rate {ratio}x prescribed — check infusion settings" (one decimal, integer once >=10);
    ratio < 1-dev → caution "flow-low": "Flow rate {round(ratio*100)}% of prescribed — check for a kink or a partly closed clamp"
    flowing without prescription: flow > 180 → "flow-high" "Flow above expected range — set a prescribed rate for this bed"; flow < 20 → "flow-low" "Flow below expected range — set a prescribed rate for this bed"
  7 pct < lowVolumePct → caution "low-volume": "Low volume {round(pct)}% — prepare a replacement bottle"
  Then a stable sort, critical before caution. A bed's severity is its top alert, else "normal". Bed list order: critical, caution, offline, normal, then label with numeric compare (bed-2 before bed-10).
  Alarm look (IEC 60601-1-8): critical red ~2 Hz flash, caution amber slow pulse, offline/normal no flash. An acknowledged alarm keeps its colour and stops flashing. An ack holds only while that same alert kind is still the bed's top alert.
Bed setup (bed number, patient, prescribed rate, bottle volume) is NOT in Firebase (writes are denied). Keep it on the phone. Units seen under beds/ that are not assigned yet show as "New units".
=== end contract ===
```


## PROMPT 2 — Fix (paste after reviewing the analysis)

```
Read DRIPTRACE_SYNC_ANALYSIS.md (your previous report) and the DripTrace contract below. Now fix the app so it works in sync with the DripTrace website. Work through the fix plan in order. After each step, build the app and fix any errors before moving on. Use git if the folder is a repo, with one commit per step and plain messages.

Firebase web config (public identifiers, safe to put in the app; NOT a secret):
  apiKey:            <VITE_FIREBASE_API_KEY>
  authDomain:        <VITE_FIREBASE_AUTH_DOMAIN>
  projectId:         <VITE_FIREBASE_PROJECT_ID>
  storageBucket:     <VITE_FIREBASE_STORAGE_BUCKET>
  messagingSenderId: <VITE_FIREBASE_MESSAGING_SENDER_ID>
  appId:             <VITE_FIREBASE_APP_ID>
  databaseURL:       <VITE_FIREBASE_DATABASE_URL>
  beds path: beds    history path: history    auth: Anonymous
Keep these in one config file/module, never logged. If the app uses the native Firebase Android SDK and needs google-services.json, tell me and I will register the app's package name in the Firebase console. Until then, prefer the Firebase JS SDK (for web or hybrid apps) or the RTDB REST streaming API with an anonymous ID token (identitytoolkit accounts:signUp?key=apiKey, then GET <databaseURL>/beds.json?auth=<idToken> with Accept: text/event-stream, refreshing the token through securetoken.googleapis.com before it expires).

Hard rules:
- The app is READ-ONLY on beds/ and history/. Remove every write to them. Never ask for or use a database secret or service account.
- Remove ThingSpeak, polling and mock data paths that compete with the live listener. Keep a clearly labelled demo mode only if one exists already.
- Parsing, offline rule, alarm kinds, messages and ordering must match the contract EXACTLY (copy the message strings). Put them in one module (e.g. alerts/severity) with the thresholds as named constants. If the app has background/native alarms in another language, port the same rules there and keep both identical.
- Flow is shown in mL/hr. Show "X of Y mL" when fluidMl and capacityMl exist, else percent. Show clamp state when present. Show HR/SpO2 only when signal == "ok" or the value is present; otherwise show the signal state (No finger / Acquiring / Motion).
- Bed setup (bed number, patient ID, prescribed mL/hr, bottle volume, low-volume %) is stored locally on the phone, because Firebase denies client writes. Unassigned units under beds/ appear as "New units" that the nurse can assign.
- Live listener: a single subscription to beds/ (onValue or SSE), reconnect with backoff, show an "offline / reconnecting" banner after 10 s without a connection, and re-evaluate staleness every second even when no data arrives.
- Bed detail: a flow-rate trend from history/<unitId> (last 30 min, orderByChild("t"), limitToLast(1800)), drawn approximate when approxTime is true.
- Background: if the app already has notifications or a foreground service, critical alarms must still fire with the screen locked, repeat every 30 s until acknowledged, with an Acknowledge action. Caution notifies once. Offline is quiet.

Verification (report each as PASS / FAIL / NOT RUN, honestly):
1. The app builds with no errors. Install it on a phone or emulator if one is available.
2. Live parity: open the website and the app side by side for bed-01. Weight, mL/hr, %, "X of Y mL", HR, SpO2 and severity colour match, and changes appear in the app within 2 s.
3. Unplug or power off the ESP32: within ~15 s the bed goes grey "Sensor offline", with no red alarm.
4. Alarm unit tests (add them to the project's test runner) for these inputs, with the expected top alert:
   a pct 50, flow 60, presc 60 → normal
   b pct 1, flow 0 → bottle-empty only
   c bottleEmpty true, pct 40 → bottle-empty only
   d pct 50, flow 0.5 → flow-stopped
   e pct 50, flow 100, presc 60 → flow-high "Flow rate 1.7x prescribed — check infusion settings"
   f pct 50, flow 30, presc 60 → flow-low "Flow rate 50% of prescribed — check for a kink or a partly closed clamp"
   g pct 8, flow 60, presc 60 → low-volume "Low volume 8% — prepare a replacement bottle"
   h pct 50, flow 200, no presc → flow-high "Flow above expected range — …"
   i pct 50, flow 10, no presc → flow-low "Flow below expected range — …"
   j unresponsive true, pct 50, flow 60, presc 60 → patient-unresponsive (critical)
   k pct 5, flow 0 → [flow-stopped (critical), low-volume (caution)] in that order
   l lastUpdated 20 s ago → offline channel, no clinical alarm shown
   m flowRateMlPerHr "abc", spo2 140, heartRate -5 → shown as "—", no crash
5. Search the project for secrets and for writes to beds/ or history/; report what you found.
Finish with a summary: what changed (files), how to build and install, test results, and anything left open.

=== DripTrace contract ===
Firebase Realtime Database. Auth: Firebase Anonymous sign-in (already enabled). Reads need auth != null. ALL client writes are denied by the rules: the app is read-only.
Paths:
- beds/<unitId> (e.g. beds/bed-01), live, ~1 Hz from the ESP32.
- history/<unitId>/<13-digit epoch ms>, one sample per second, for the trend chart (indexed on "t"; query orderByChild("t") with limitToLast).
beds/<unitId> fields:
  weightGrams (gross bottle g, 0–5000), flowRateMlPerHr (0–1000), bottlePercentRemaining (0–100), bottleEmpty (bool),
  fluidMl (0–5000) and capacityMl (1–5000): calibrated, shown as "X of Y mL",
  clamp ("open"|"closed"|"offline"): backflow clamp state,
  sensorOnline (bool, load cell connected; only an explicit false means offline), lastUpdated (epoch ms),
  heartRate (20–250), spo2 (50–100), finger (bool), signal ("no-finger"|"acquiring"|"ok"|"motion"|"offline"),
  rhythm ("regular"|"irregular"|"unknown"), irregularProb (0–1), hrLow/hrHigh (30–200, valid only if hrLow<hrHigh),
  baselinePct (0–100), hrOutOfRange (bool), unresponsive (bool), unresponsiveWhy ("no-pulse"|"low-hr"|"low-spo2"|"sim"),
  backlog (int), wifi (bool), bed (string), optional label, dropsPerMin.
history sample fields: t, flowRateMlPerHr, bottlePercentRemaining, weightGrams, sensorOnline, bottleEmpty, optional heartRate, spo2, irregularProb, rhythm, unresponsive, motion, approxTime (true = time estimated, show as approximate).
Parsing: the ESP32 writes with a DB secret that bypasses validation, so never trust a value. Out-of-range or non-number → "—" (missing). Clamp flow 0–1000 and percent 0–100. Ignore lastUpdated more than 60 s in the future.
dropsPerMin = reported value, else round(flowRateMlPerHr * 20 / 60, 1 decimal) (20 gtt/mL set).
Units: flow in mL/hr everywhere in the app (the device's own screen shows mL/min; the website and app use mL/hr).
Offline: a unit is offline if lastUpdated is missing, sensorOnline === false, or now - lastUpdated > 15000 ms. Offline shows grey "Sensor offline — readings are stale, check the unit", never a patient alarm, never flashing.
Alarms (per bed, thresholds: prescribedFlowMlPerHr per bed, optional; lowVolumePct default 10; flowDeviationPct default 30; no-prescription range 20–180 mL/hr). pct = percent ?? 0, flow = flow ?? 0. Evaluate in this order:
  1 unresponsive → critical "patient-unresponsive": "Possible unresponsive patient — check the patient now"
  2 rhythm=="irregular" → caution "irregular-rhythm": "Irregular heartbeat — check pulse manually and inform the doctor"
  3 hrOutOfRange && heartRate && hrLow → caution "hr-out-of-range": "Heart rate {round(HR)}, patient's normal {hrLow}–{hrHigh} — check the patient"
  4 bottleEmpty || pct <= 2 → critical "bottle-empty": "Bottle empty — replace the IV bottle" and STOP (no further line alarms)
  5 flow <= 1 → critical "flow-stopped": "Flow stopped — check clamp, line and cannula"
  6 flowing (flow > 1) with prescription: ratio = flow/prescribed; ratio > 1+dev → caution "flow-high": "Flow rate {ratio}x prescribed — check infusion settings" (one decimal, integer once >=10);
    ratio < 1-dev → caution "flow-low": "Flow rate {round(ratio*100)}% of prescribed — check for a kink or a partly closed clamp"
    flowing without prescription: flow > 180 → "flow-high" "Flow above expected range — set a prescribed rate for this bed"; flow < 20 → "flow-low" "Flow below expected range — set a prescribed rate for this bed"
  7 pct < lowVolumePct → caution "low-volume": "Low volume {round(pct)}% — prepare a replacement bottle"
  Then a stable sort, critical before caution. A bed's severity is its top alert, else "normal". Bed list order: critical, caution, offline, normal, then label with numeric compare (bed-2 before bed-10).
  Alarm look (IEC 60601-1-8): critical red ~2 Hz flash, caution amber slow pulse, offline/normal no flash. An acknowledged alarm keeps its colour and stops flashing. An ack holds only while that same alert kind is still the bed's top alert.
Bed setup (bed number, patient, prescribed rate, bottle volume) is NOT in Firebase (writes are denied). Keep it on the phone. Units seen under beds/ that are not assigned yet show as "New units".
=== end contract ===
```

---

## PROMPT 4 — final fixes (paste in the app folder)

```
FINAL FIXES. The demo is soon: make each fix, build, and move on. Do not ask questions unless blocked. Do not add any database secret or auth token anywhere; Firebase access is Anonymous auth + read-only.

=== Facts about the device (verified in the firmware, do not guess) ===
- Bedside hotspot: SSID "DripTrace-bed-01", password "<AP_PASSWORD>", device IP 192.168.4.1. The board runs AP+STA, so the hotspot is always on, even while it is online.
- GET http://192.168.4.1/api/live returns the SAME JSON as Firebase beds/bed-01 (weightGrams, flowRateMlPerHr, bottlePercentRemaining, bottleEmpty, lastUpdated, sensorOnline, wifi, backlog, finger, signal, heartRate?, spo2?, fluidMl, capacityMl, rhythm/irregularProb/hrLow/hrHigh/baselinePct/hrOutOfRange/unresponsive when present, clamp). lastUpdated is 0 when the board never synced its clock.
- GET http://192.168.4.1/api/history?min=N (N 1..120) returns {"points":[[ageSeconds, flowMlPerHr, pct, hr, spo2, flags], ...]}, newest last, max ~360 points. hr/spo2 = 0 means no reading.
- The firmware sends NO CORS headers. There is no /telemetry and no /command endpoint.

=== 1. Mode B: fix "RECONNECTING..." (root cause: mixed content + CORS + Android routing) ===
The WebView page is https://appassets.androidplatform.net, so fetch("http://192.168.4.1/...") is blocked (mixed content) and would fail CORS anyway. Do Mode B natively:
a. New Java class LocalDeviceClient: find the Wi-Fi Network (ConnectivityManager.requestNetwork with NetworkRequest TRANSPORT_WIFI; also accept it if the SSID is DripTrace-*), and open connections with network.openConnection(url) (HttpURLConnection, 2 s connect/read timeout). Do NOT rely on the default route. Poll /api/live every 1 s; fetch /api/history?min=120 when the bed screen opens and every 30 s while it is open.
b. Push results into the WebView with evaluateJavascript("window.onLocalLive(<json>)") / onLocalHistory(<json>), on the UI thread, JSON-escaped. Keep a @JavascriptInterface method startLocal()/stopLocal() for the JS mode switch.
c. In JS, Mode B readings go through the SAME parser + alarm engine as Firebase readings. Staleness in Mode B = phone receive time (now - lastReceivedAt > 15 s → "Sensor offline"), because lastUpdated may be 0. If lastUpdated is 0, show times as "approximate".
d. MonitorService: in Mode B, use LocalDeviceClient instead of FirebaseStream so locked-phone alarms still work with no internet.
e. Remove any leftover JS fetch to 192.168.4.1, /telemetry or /command. Keep network_security_config cleartext allowed only for 192.168.4.1.
f. On-screen status line in Mode B: "Wi-Fi: <ssid or not connected> · Device: reachable / no reply (<error>) · last reading <n> s ago".

=== 2. Firebase mode: fix "couldn't connect" ===
a. Confirm assets/web/firebase-config.json has 7 real values, not <VITE_FIREBASE_...> placeholders.
b. Bundle the Firebase JS SDK (compat or modular, any v10/v11 build) and Chart.js as LOCAL files in assets/web. Remove every https:// <script> tag (the CDN fails on the hotspot and when offline).
c. Serve the WebView only through WebViewAssetLoader (https://appassets.androidplatform.net), never file://. Enable DOM storage.
d. Add a small status line under the header: "Config ✓ · SDK ✓ · Sign-in ✓ / ✗ <error code> · Beds: <n>". If sign-in fails with an API-key/referrer error, show that code on screen so I can fix the key restriction in Google Cloud.
e. Stream beds/ with onValue (single subscription). History: history/<unitId> orderByChild("t").startAt(now - range).limitToLast(7200).

=== 3. Bed dashboard (individual bed screen) ===
a. REMOVE the prescribed-flow-rate slider and presets from the bed screen completely.
b. The prescribed rate (mL/hr), patient ID, bed number, bottle volume and low-volume % are entered ONLY in the first-time registration form, when a "New unit" is assigned to a bed. On the bed screen show the prescribed rate as read-only text ("Prescribed 60 mL/hr"). Put a small "Edit bed" link at the bottom that reopens the same registration form (needed if a doctor changes the order). Save through the bridge to WardStore (SharedPreferences) so MonitorService uses the same values.
c. Show: weight g, "X of Y mL" (fluidMl of capacityMl, else %), bottle %, flow mL/hr, drops/min (flow*20/60, 1 decimal), clamp state (open/closed/offline), HR, SpO2, rhythm, and the active alarm banner with Acknowledge.

=== 4. Past IV graphs on the bed screen ===
a. Chart.js line chart, time on X axis: flow rate (mL/hr, left axis) and bottle % remaining (right axis, 0–100). HR and SpO2 are a second small chart, shown only when the data has values.
b. Range chips: 30 min · 2 h · 6 h · 24 h (default 2 h). Firebase mode: history/<unitId> as above. Mode B: /api/history?min=min(range,120); convert ageSeconds to time = receiveTime - age*1000.
c. Downsample to at most ~600 points for drawing. Break the line (null point) where samples are more than 15 s apart, so an offline gap is not drawn as a straight line. Grey dashed style for samples with approxTime true.
d. "Past infusions" list under the chart: split history into infusions wherever bottle % jumps up by 30+ points (a new bottle was hung). For each one show start time, end time, duration, volume given (start % - end % times capacityMl, or mL difference), and average flow. Tapping one zooms the chart to that infusion.
e. Empty state: "No history yet. The unit uploads one sample per second while it runs."

=== 5. Show hotspot connection info in the app ===
Settings → "Direct connection (Mode B)" card:
  Network: DripTrace-bed-01 [Copy]
  Password: <AP_PASSWORD> [Copy] [Show/Hide], hidden by default
  Device address: http://192.168.4.1
  Button "Open Wi-Fi settings" (Settings.Panel.ACTION_WIFI on Android 10+, else Settings.ACTION_WIFI_SETTINGS).
  Short steps: "1 Open Wi-Fi settings  2 Join DripTrace-bed-01  3 If Android says 'No internet', tap 'Stay connected'  4 Come back; the app switches to the device."
Store SSID/password as constants in one file (hotspotConfig), with SSID built as "DripTrace-" + bedId so another bed works later. Fix any stale "DripTrace-Demo" text anywhere.

=== 6. Alarm parity addition (the website does this) ===
For a hardware bed, hold back "flow-stopped" until flow has been <= 1 mL/hr for 60 s continuously (after a bottle is hung, flow reads 0 while the scale settles). Implement in alerts.js AND AlertRules.java/MonitorService, and add a test: flow 0 for 30 s → no flow-stopped; flow 0 for 61 s → flow-stopped.

=== Verify and report (PASS / FAIL / NOT RUN, with output) ===
1. .\gradlew.bat assembleDebug and .\gradlew.bat testDebugUnitTest pass; node test_alerts.js passes. Give the APK path.
2. grep the web assets: no "https://" script tags, no "/command", no "telemetry/latest", no "Auth Token", no "DripTrace-Demo".
3. If adb devices shows a phone: adb install -r the APK, then adb logcat -s DripTraceMonitor DripTraceStream LocalDeviceClient while switching to Mode B on DripTrace-bed-01; paste the lines showing /api/live HTTP 200.
4. Write TESTING.md with the manual checks: website vs app numbers match on bed-01; power off ESP32 → grey offline in ≤15 s; Mode B with the router off still shows live data and the graph; lock the phone → critical alarm rings and repeats every 30 s; past-infusions list appears after a bottle change.
Finish with a 10-line summary: what changed, APK path, test results.
```
