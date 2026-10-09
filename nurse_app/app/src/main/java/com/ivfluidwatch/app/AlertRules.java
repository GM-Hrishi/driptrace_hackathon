package com.ivfluidwatch.app;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Java port of the dashboard's alarm rules, so the phone raises the same
 * alarms with the screen off as the app and the website raise on screen.
 *
 * Source of truth (keep in step when either changes):
 *   src/lib/severity.js    deriveAlerts, isSensorOnline
 *   src/lib/reading.js     normalizeReading (value clamps)
 *   src/lib/constants.js   thresholds below
 *   src/lib/flowHistory.js FLOW_STOPPED_GRACE_MS
 */
final class AlertRules {

    static final long SENSOR_STALE_AFTER_MS = 15_000;
    static final double FLOW_STOPPED_ML_PER_HR = 1;
    static final double HR_LOW_BELOW = 50;       // constants.js
    static final double HR_STRESSED_ABOVE = 120;
    static final double LOW_VOLUME_PERCENT = 10;
    static final double BOTTLE_EMPTY_PERCENT = 2;
    static final double FLOW_DEVIATION_PERCENT = 30;
    static final double DEFAULT_FLOW_MIN = 20;
    static final double DEFAULT_FLOW_MAX = 180;
    static final long FLOW_STOPPED_GRACE_MS = 60_000;
    private static final long MAX_CLOCK_SKEW_MS = 60_000;

    private AlertRules() {}

    static final class Alert {
        final String kind;
        final String severity; // "critical" | "caution"
        final String reason;
        final String action;

        Alert(String kind, String severity, String reason, String action) {
            this.kind = kind;
            this.severity = severity;
            this.reason = reason;
            this.action = action;
        }

        String message() {
            return reason + " — " + action;
        }
    }

    /** One unit's node under beds/, with the same clamps as normalizeReading. */
    static final class Reading {
        Double flowRateMlPerHr;
        Double bottlePercentRemaining;
        boolean bottleEmpty;
        boolean sensorOnline;
        long lastUpdated; // 0 when missing or implausible
        
        Double heartRate;
        String rhythm;
        Double hrLow;
        Double hrHigh;
        boolean hrOutOfRange;
        boolean unresponsive;
        String clamp;           // "open" | "closed" | "offline" (backflow clamp node)

        static Reading from(JSONObject raw, long now) {
            Reading r = new Reading();
            r.flowRateMlPerHr = clamped(raw.opt("flowRateMlPerHr"), 0, 6000);
            r.bottlePercentRemaining = clamped(raw.opt("bottlePercentRemaining"), 0, 100);
            r.bottleEmpty = Boolean.TRUE.equals(raw.opt("bottleEmpty"));
            // Only an explicit false marks the unit offline; staleness covers the rest.
            r.sensorOnline = !Boolean.FALSE.equals(raw.opt("sensorOnline"));
            Object t = raw.opt("lastUpdated");
            if (t instanceof Number) {
                double v = ((Number) t).doubleValue();
                if (!Double.isNaN(v) && v >= 0 && v <= now + MAX_CLOCK_SKEW_MS) r.lastUpdated = (long) v;
            }
            
            r.heartRate = inRange(raw.opt("heartRate"), 20, 250);
            r.clamp = raw.optString("clamp", null);
            r.rhythm = raw.optString("rhythm", null);
            r.hrLow = clamped(raw.opt("hrLow"), 30, 200);
            r.hrHigh = clamped(raw.opt("hrHigh"), 30, 200);
            if (r.hrLow != null && r.hrHigh != null && r.hrLow >= r.hrHigh) {
                r.hrLow = null;
                r.hrHigh = null;
            }
            r.hrOutOfRange = Boolean.TRUE.equals(raw.opt("hrOutOfRange"));
            r.unresponsive = Boolean.TRUE.equals(raw.opt("unresponsive"));
            
            return r;
        }

        /** A finite number inside [min, max], else null (like num() in reading.js). */
        private static Double inRange(Object value, double min, double max) {
            if (!(value instanceof Number)) return null;
            double v = ((Number) value).doubleValue();
            return v >= min && v <= max ? v : null;
        }

        private static Double clamped(Object value, double min, double max) {
            if (!(value instanceof Number)) return null;
            double v = ((Number) value).doubleValue();
            if (Double.isNaN(v) || Double.isInfinite(v)) return null;
            return Math.min(max, Math.max(min, v));
        }
    }

    /** isSensorOnline: judged from the unit's own timestamp. */
    static boolean isOnline(Reading r, long now) {
        if (r.lastUpdated <= 0) return false;
        if (!r.sensorOnline) return false;
        return now - r.lastUpdated <= SENSOR_STALE_AFTER_MS;
    }

    private static String formatRatio(double ratio) {
        return ratio >= 10
                ? Math.round(ratio) + "x"
                : String.format(Locale.US, "%.1fx", ratio);
    }

    /**
     * deriveAlerts: every clinical alert currently true, most urgent first.
     *
     * @param prescribed    the bed's ordered rate, or <= 0 for none
     * @param lowVolumePct  per-bed override or the ward default
     * @param deviationPct  allowed deviation from the prescribed rate
     */
    static List<Alert> derive(Reading r, double prescribed, double lowVolumePct, double deviationPct, long flowStoppedSince, long now) {
        List<Alert> critical = new ArrayList<>();
        List<Alert> caution = new ArrayList<>();
        double pct = r.bottlePercentRemaining != null ? r.bottlePercentRemaining : 0;
        double flow = r.flowRateMlPerHr != null ? r.flowRateMlPerHr : 0;

        // Rule 1: unresponsive
        if (r.unresponsive) {
            critical.add(new Alert("patient-unresponsive", "critical", "Possible unresponsive patient", "check the patient now"));
        }
        if (r.heartRate != null && r.heartRate < HR_LOW_BELOW) {
            critical.add(new Alert("hr-low", "critical", "Low heart rate " + Math.round(r.heartRate) + " bpm", "check the patient now"));
        } else if (r.heartRate != null && r.heartRate > HR_STRESSED_ABOVE) {
            caution.add(new Alert("hr-high", "caution", "Heart rate " + Math.round(r.heartRate) + " bpm, patient may be stressed", "reassure and recheck"));
        }
        
        // Rule 2: irregular-rhythm
        if ("irregular".equals(r.rhythm)) {
            caution.add(new Alert("irregular-rhythm", "caution", "Irregular heartbeat", "check pulse manually and inform the doctor"));
        }
        
        // Rule 3: hr-out-of-range
        if (r.hrOutOfRange && r.heartRate != null && r.hrLow != null && r.hrHigh != null) {
            caution.add(new Alert("hr-out-of-range", "caution", 
                "Heart rate " + Math.round(r.heartRate) + ", patient's normal " + Math.round(r.hrLow) + "–" + Math.round(r.hrHigh), 
                "check the patient"));
        }

        // Rule 4: bottleEmpty
        // An empty bottle explains a stopped line, so it stops further line alarms.
        if (r.bottleEmpty || pct <= BOTTLE_EMPTY_PERCENT) {
            critical.add(new Alert("bottle-empty", "critical", "Bottle empty", "replace the IV bottle"));
            critical.addAll(caution);
            return critical;
        }
        // The unit shut the line because the bottle is ending: say that, not "flow stopped".
        if ("closed".equals(r.clamp)) {
            critical.add(new Alert("line-clamped", "critical", "Line clamped, bottle finished", "replace the IV bottle"));
            critical.addAll(caution);
            return critical;
        }
        if (flow <= FLOW_STOPPED_ML_PER_HR) {
            critical.add(new Alert("flow-stopped", "critical", "Flow stopped", "check clamp, line and cannula"));
        }

        boolean flowing = flow > FLOW_STOPPED_ML_PER_HR;
        if (flowing && prescribed > 0) {
            double ratio = flow / prescribed;
            double band = deviationPct / 100.0;
            if (ratio > 1 + band) {
                caution.add(new Alert("flow-high", "caution",
                        "Flow rate " + formatRatio(ratio) + " prescribed", "check infusion settings"));
            } else if (ratio < 1 - band) {
                caution.add(new Alert("flow-low", "caution",
                        "Flow rate " + Math.round(ratio * 100) + "% of prescribed",
                        "check for a kink or a partly closed clamp"));
            }
        } else if (flowing) {
            if (flow > DEFAULT_FLOW_MAX) {
                caution.add(new Alert("flow-high", "caution", "Flow above expected range", "set a prescribed rate for this bed"));
            } else if (flow < DEFAULT_FLOW_MIN) {
                caution.add(new Alert("flow-low", "caution", "Flow below expected range", "set a prescribed rate for this bed"));
            }
        }

        if (pct < lowVolumePct) {
            caution.add(new Alert("low-volume", "caution", "Low volume " + Math.round(pct) + "%", "prepare a replacement bottle"));
        }

        critical.addAll(caution);
        return critical;
    }
}


