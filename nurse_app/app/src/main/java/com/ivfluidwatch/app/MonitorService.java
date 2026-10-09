package com.ivfluidwatch.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Keeps watching the ward while the phone is locked or the app is closed.
 *
 * Reads the ward the nurse set up in the app (WardStore), streams beds/ live
 * from Firebase (FirebaseStream), runs the shared alarm rules (AlertRules)
 * every second and on every publish, and keeps one notification per bed in
 * step with that bed's top alert:
 *   - critical: alarm-channel notification, re-sounds every 30 s until acknowledged;
 *   - caution: sounds once when it appears;
 *   - sensor offline: quiet notification, never dressed up as a patient alarm.
 * While the app is on screen the notifications stay silent, because the app
 * plays its own alarm.
 */
public class MonitorService extends Service {

    private static final String TAG = "DripTraceMonitor";

    static final String ACTION_START = "com.ivfluidwatch.app.MONITOR_START";

    static final String CHANNEL_CRITICAL = "driptrace_critical";
    static final String CHANNEL_CAUTION = "driptrace_caution";
    static final String CHANNEL_SENSOR = "driptrace_sensor";
    static final String CHANNEL_MONITOR = "driptrace_monitor";
    private static final String LEGACY_CHANNEL = "driptrace_alerts_channel";

    private static final int ONGOING_ID = 1;
    private static final int CLOUD_ID = 2;
    private static final long TICK_MS = 1_000;
    private static final long CRITICAL_REPEAT_MS = 30_000;
    private static final long CLOUD_LOST_ALERT_MS = 60_000;
    private static final String SIMULATED = "simulated";

    /** Set by MainActivity: while true, notifications post silently. */
    static volatile boolean appInForeground = false;
    private static volatile MonitorService instance;

    private final Handler main = new Handler(Looper.getMainLooper());
        private FirebaseStream stream;
    private LocalDeviceClient localClient;
    private volatile JSONObject devices = new JSONObject();
    private volatile boolean cloudConnected = false;
    private volatile String cloudError = null;
    private final java.util.Map<String, Long> flowStoppedSince = new java.util.HashMap<>();
    private long cloudLostSince = 0;
    private boolean cloudAlertPosted = false;

    /** Per bed: what its notification currently shows, and when it last made a sound. */
    private final Map<String, String> shownKey = new HashMap<>();
    private final Map<String, Long> lastSoundAt = new HashMap<>();
    /** Per bed: last time flow was above the stopped threshold (flow-stopped grace). */
    private final Map<String, Long> flowingAt = new HashMap<>();
    private String lastOngoingText = "";

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            evaluate();
            if (instance != null) main.postDelayed(this, TICK_MS);
        }
    };

    // --- Lifecycle ------------------------------------------------------------

    static void start(Context context) {
        Intent i = new Intent(context, MonitorService.class).setAction(ACTION_START);
        ContextCompat.startForegroundService(context, i);
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, MonitorService.class));
    }

    /** Re-evaluate now (the ward changed in the app, or an alarm was acknowledged). */
    static void poke() {
        MonitorService s = instance;
        if (s != null) s.main.post(s::evaluate);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannels(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            Notification ongoing = ongoing("Connecting to the ward…");
            if (Build.VERSION.SDK_INT >= 34) {
                // The specialUse type only exists on Android 14+; older versions reject it.
                startForeground(ONGOING_ID, ongoing, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(ONGOING_ID, ongoing);
            }
        } catch (RuntimeException e) {
            // Android 12+ refuses a foreground start from the background (e.g. a
            // sticky restart). The app starts it again the next time it opens.
            Log.w(TAG, "Could not start in foreground", e);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (stream == null) {
            FirebaseStream.Config config = FirebaseStream.Config.load(this);
            if (config.usable()) {
                stream = new FirebaseStream(this, config, new FirebaseStream.Listener() {
                    @Override
                    public void onTree(JSONObject tree) {
                        devices = tree;
                        main.post(MonitorService.this::evaluate);
                    }

                    @Override
                    public void onConnection(boolean connected, String error) {
                        cloudConnected = connected;
                        cloudError = error;
                    }
                });
                stream.start();
            } else {
                cloudError = "Firebase is not configured in this build";
            }
            main.removeCallbacks(tick);
            main.post(tick);
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        instance = null;
        main.removeCallbacks(tick);
        if (stream != null) stream.stop();
        stream = null;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
            for (String bedId : shownKey.keySet()) nm.cancel(bedNotificationId(bedId));
            nm.cancel(CLOUD_ID);
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // --- Evaluation -------------------------------------------------------------

    /**
     * The web UI stores each bed's setup as DripTracePrefs "setup_<unit>" =
     * {patientId, prescribedRate, bottleVolume, lowVolumePct}, not in the old
     * WardStore list. Watch every unit publishing under beds/ and apply its
     * setup when there is one, so alarms fire even for a bed not set up yet.
     */
    private JSONArray bedsFromUnits(JSONObject tree) {
        JSONArray beds = new JSONArray();
        SharedPreferences prefs = getSharedPreferences(WardStore.PREFS, MODE_PRIVATE);
        Iterator<String> units = tree.keys();
        while (units.hasNext()) {
            String unit = units.next();
            try {
                JSONObject bed = new JSONObject().put("id", unit).put("device", unit).put("bedNumber", unit);
                JSONObject setup = new JSONObject(prefs.getString("setup_" + unit, "{}"));
                if (!setup.optString("patientId").isEmpty()) bed.put("bedNumber", setup.optString("patientId"));
                double rate = setup.optDouble("prescribedRate", 0);
                if (rate > 0) bed.put("prescribedFlowMlPerHr", rate);
                double low = setup.optDouble("lowVolumePct", 0);
                if (low > 0) bed.put("lowVolumePct", low);
                beds.put(bed);
            } catch (Exception e) {
                Log.w(TAG, "Bad setup for " + unit, e);
            }
        }
        return beds;
    }

    private void evaluate() {
        if (instance == null) return;
        long now = System.currentTimeMillis();
        JSONObject store = WardStore.readStore(this);
        JSONObject settings = store.optJSONObject("settings");
        if (settings == null) settings = new JSONObject();
        if (!settings.optBoolean("backgroundMonitoring", true)) {
            stopSelf();
            return;
        }
        double wardLowVolume = settings.optDouble("lowVolumePct", AlertRules.LOW_VOLUME_PERCENT);
        double deviation = settings.optDouble("flowDeviationPct", AlertRules.FLOW_DEVIATION_PERCENT);
        JSONObject acks = store.optJSONObject("acks");
        if (acks == null) acks = new JSONObject();
        JSONObject pending = WardStore.pendingAcks(this);
        JSONArray beds = store.optJSONArray("beds");
        if (beds == null) beds = new JSONArray();
        JSONObject tree = devices;
        if (beds.length() == 0) beds = bedsFromUnits(tree);

        NotificationManager nm = getSystemService(NotificationManager.class);
        Set<String> seen = new HashSet<>();
        int watched = 0;
        int alarms = 0;

        for (int i = 0; i < beds.length(); i++) {
            JSONObject bed = beds.optJSONObject(i);
            if (bed == null) continue;
            String device = bed.optString("device", "");
            // Simulated beds live in the app only.
            if (device.isEmpty() || SIMULATED.equals(device)) continue;
            String bedId = bed.optString("id", device);
            String label = "Bed " + bed.optString("bedNumber", "?");
            seen.add(bedId);
            watched++;

            JSONObject raw = tree.optJSONObject(device);
            if (raw == null) {
                clear(nm, bedId);
                continue;
            }
            AlertRules.Reading reading = AlertRules.Reading.from(raw, now);

            if (!AlertRules.isOnline(reading, now)) {
                show(nm, bedId, "sensor-offline", "offline", label, "Sensor offline",
                        "Readings are stale — check the unit’s power and Wi-Fi", now);
                continue;
            }

            Object lowOverride = bed.opt("lowVolumePct");
            double lowVolume = lowOverride instanceof Number ? ((Number) lowOverride).doubleValue() : wardLowVolume;
            double flow = reading.flowRateMlPerHr != null ? reading.flowRateMlPerHr : 0;
            if (flow <= AlertRules.FLOW_STOPPED_ML_PER_HR) {
                if (!flowStoppedSince.containsKey(bedId)) {
                    flowStoppedSince.put(bedId, System.currentTimeMillis());
                }
            } else {
                flowStoppedSince.remove(bedId);
            }
            long since = flowStoppedSince.containsKey(bedId) ? flowStoppedSince.get(bedId) : 0;
            List<AlertRules.Alert> alerts = AlertRules.derive(
                    reading, bed.optDouble("prescribedFlowMlPerHr", 0), lowVolume, deviation, since, System.currentTimeMillis());

            if (alerts.isEmpty()) {
                if (pending.has(bedId)) WardStore.clearAck(this, bedId);
                clear(nm, bedId);
                continue;
            }
            AlertRules.Alert top = alerts.get(0);
            if (isAcked(acks, pending, bedId, top.kind)) {
                clear(nm, bedId);
                continue;
            }
            alarms++;
            String more = alerts.size() > 1 ? " (+" + (alerts.size() - 1) + " more)" : "";
            show(nm, bedId, top.kind, top.severity, label, top.reason, "Action: " + top.action + more, now);
        }

        // Beds removed in the app since the last pass.
        for (String bedId : new HashSet<>(shownKey.keySet())) {
            if (!seen.contains(bedId)) clear(nm, bedId);
        }
        flowingAt.keySet().retainAll(seen);

        updateCloudAlert(nm, watched, now);
        updateOngoing(nm, watched, alarms);
    }

    /** A hardware bed's "Flow stopped" waits until flow has read zero for a minute. */
    private List<AlertRules.Alert> applyFlowStoppedGrace(String bedId, AlertRules.Reading r,
                                                         List<AlertRules.Alert> alerts) {
        double flow = r.flowRateMlPerHr != null ? r.flowRateMlPerHr : 0;
        Long since = flowingAt.get(bedId);
        if (since == null || flow > AlertRules.FLOW_STOPPED_ML_PER_HR) {
            flowingAt.put(bedId, r.lastUpdated);
            since = r.lastUpdated;
        }
        if (r.lastUpdated - since >= AlertRules.FLOW_STOPPED_GRACE_MS) return alerts;
        alerts.removeIf(a -> "flow-stopped".equals(a.kind));
        return alerts;
    }

    /** An ack holds only while that same alert is the bed's top alert, as in the app. */
    private static boolean isAcked(JSONObject acks, JSONObject pending, String bedId, String kind) {
        JSONObject a = acks.optJSONObject(bedId);
        JSONObject p = pending.optJSONObject(bedId);
        JSONObject newest = a;
        if (p != null && (a == null || p.optLong("at") >= a.optLong("at"))) newest = p;
        return newest != null && kind.equals(newest.optString("kind"));
    }

    // --- Notifications ------------------------------------------------------------

    static int bedNotificationId(String bedId) {
        return 1000 + (bedId.hashCode() & 0x7fff);
    }

    private void clear(NotificationManager nm, String bedId) {
        if (shownKey.remove(bedId) != null && nm != null) nm.cancel(bedNotificationId(bedId));
        lastSoundAt.remove(bedId);
    }

    private void show(NotificationManager nm, String bedId, String kind, String severity, String label,
                      String reason, String detail, long now) {
        if (nm == null) return;
        String key = kind + "|" + reason + "|" + detail;
        String previous = shownKey.get(bedId);
        boolean changedKind = !kind.equals(kindOf(previous));
        boolean changedText = !key.equals(previous);
        Long lastSound = lastSoundAt.get(bedId);
        boolean repeat = "critical".equals(severity) && lastSound != null && now - lastSound >= CRITICAL_REPEAT_MS;
        if (!changedText && !repeat) return;

        boolean offline = "offline".equals(severity);
        boolean sound = (changedKind || repeat) && !offline && !appInForeground;
        String channel = "critical".equals(severity) ? CHANNEL_CRITICAL
                : "caution".equals(severity) ? CHANNEL_CAUTION : CHANNEL_SENSOR;

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, channel)
                .setSmallIcon(android.R.drawable.stat_notify_error)
                .setContentTitle(label + " · " + reason)
                .setContentText(detail)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(detail))
                .setCategory(offline ? NotificationCompat.CATEGORY_STATUS : NotificationCompat.CATEGORY_ALARM)
                .setPriority(offline ? NotificationCompat.PRIORITY_DEFAULT : NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing("critical".equals(severity))
                .setOnlyAlertOnce(!sound)
                .setSilent(!sound)
                .setWhen(now)
                .setContentIntent(openApp(bedId));
        if ("critical".equals(severity)) b.setColor(0xFFFF3838);
        else if ("caution".equals(severity)) b.setColor(0xFFFFB302);

        if (!offline) {
            Intent ack = new Intent(this, AckReceiver.class)
                    .putExtra(AckReceiver.EXTRA_BED_ID, bedId)
                    .putExtra(AckReceiver.EXTRA_BED_LABEL, label)
                    .putExtra(AckReceiver.EXTRA_KIND, kind)
                    .putExtra(AckReceiver.EXTRA_SEVERITY, severity)
                    .putExtra(AckReceiver.EXTRA_REASON, reason);
            PendingIntent ackPi = PendingIntent.getBroadcast(this, bedNotificationId(bedId), ack,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            b.addAction(0, "Acknowledge", ackPi);
        }

        try {
            nm.notify(bedNotificationId(bedId), b.build());
        } catch (SecurityException e) {
            Log.w(TAG, "Notifications not permitted", e);
        }
        shownKey.put(bedId, key);
        if (sound || changedKind) lastSoundAt.put(bedId, now);
    }

    private static String kindOf(String key) {
        if (key == null) return "";
        int bar = key.indexOf('|');
        return bar < 0 ? key : key.substring(0, bar);
    }

    /** No cloud for a minute while beds are on the ward: say so, once. */
    private void updateCloudAlert(NotificationManager nm, int watched, long now) {
        if (nm == null) return;
        if (cloudConnected || watched == 0) {
            cloudLostSince = 0;
            if (cloudAlertPosted) nm.cancel(CLOUD_ID);
            cloudAlertPosted = false;
            return;
        }
        if (cloudLostSince == 0) cloudLostSince = now;
        if (cloudAlertPosted || now - cloudLostSince < CLOUD_LOST_ALERT_MS) return;
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_CAUTION)
                .setSmallIcon(android.R.drawable.stat_notify_error)
                .setContentTitle("DripTrace cannot reach the ward")
                .setContentText((cloudError != null ? cloudError : "No connection") + " — alarms are paused until it reconnects")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setSilent(appInForeground)
                .setContentIntent(openApp(null));
        try {
            nm.notify(CLOUD_ID, b.build());
            cloudAlertPosted = true;
        } catch (SecurityException ignored) {
            // No permission: the app shows the offline state when opened.
        }
    }

    private void updateOngoing(NotificationManager nm, int watched, int alarms) {
        String text;
        if (!cloudConnected) {
            text = cloudError != null ? cloudError + " — reconnecting" : "Connecting to the ward…";
        } else if (watched == 0) {
            text = "No beds assigned yet";
        } else {
            text = "Watching " + watched + " bed" + (watched == 1 ? "" : "s")
                    + (alarms > 0 ? " · " + alarms + " alarm" + (alarms == 1 ? "" : "s") : " · all clear");
        }
        if (text.equals(lastOngoingText) || nm == null) return;
        lastOngoingText = text;
        try {
            nm.notify(ONGOING_ID, ongoing(text));
        } catch (SecurityException ignored) {
            // Shown again on the next change once permission is granted.
        }
    }

    private Notification ongoing(String text) {
        return new NotificationCompat.Builder(this, CHANNEL_MONITOR)
                .setSmallIcon(android.R.drawable.ic_popup_sync)
                .setContentTitle("DripTrace is monitoring")
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(openApp(null))
                .build();
    }

    private PendingIntent openApp(String bedId) {
        Intent open = new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (bedId != null) open.putExtra(MainActivity.EXTRA_BED_ID, bedId);
        int request = bedId == null ? 0 : bedNotificationId(bedId);
        return PendingIntent.getActivity(this, request, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return;
        nm.deleteNotificationChannel(LEGACY_CHANNEL);

        AudioAttributes alarmAudio = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();

        NotificationChannel critical = new NotificationChannel(CHANNEL_CRITICAL, "Critical IV alarms",
                NotificationManager.IMPORTANCE_HIGH);
        critical.setDescription("Bottle empty and flow stopped. Repeats until acknowledged.");
        critical.enableVibration(true);
        critical.setVibrationPattern(new long[]{0, 400, 200, 400, 200, 400});
        critical.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), alarmAudio);
        critical.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        critical.setBypassDnd(true); // Honoured only if the nurse allows it in system settings.

        NotificationChannel caution = new NotificationChannel(CHANNEL_CAUTION, "IV warnings",
                NotificationManager.IMPORTANCE_HIGH);
        caution.setDescription("Flow off prescription, low volume, cloud connection lost.");
        caution.enableVibration(true);
        caution.setVibrationPattern(new long[]{0, 250, 150, 250});

        NotificationChannel sensor = new NotificationChannel(CHANNEL_SENSOR, "Sensor status",
                NotificationManager.IMPORTANCE_DEFAULT);
        sensor.setDescription("A DripTrace unit stopped reporting. Not a patient alarm.");
        sensor.setSound(null, null);

        NotificationChannel monitor = new NotificationChannel(CHANNEL_MONITOR, "Monitoring status",
                NotificationManager.IMPORTANCE_LOW);
        monitor.setDescription("Shown while DripTrace watches the ward in the background.");

        nm.createNotificationChannel(critical);
        nm.createNotificationChannel(caution);
        nm.createNotificationChannel(sensor);
        nm.createNotificationChannel(monitor);
    }
}





