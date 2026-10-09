// alerts.js
// Shared alarm rules for DripTrace matching the contract

export const SENSOR_STALE_AFTER_MS = 15000;
export const FLOW_STOPPED_ML_PER_HR = 1;
export const LOW_VOLUME_PERCENT = 10;
export const BOTTLE_EMPTY_PERCENT = 2;
export const FLOW_DEVIATION_PERCENT = 30;
export const DEFAULT_FLOW_MIN = 20;
export const DEFAULT_FLOW_MAX = 180;
export const HR_LOW_BELOW = 50;
export const HR_STRESSED_ABOVE = 120;

export function isOnline(reading, now) {
    if (!reading.lastUpdated || reading.lastUpdated <= 0) return false;
    if (reading.sensorOnline === false) return false;
    return (now - reading.lastUpdated) <= SENSOR_STALE_AFTER_MS;
}

export function deriveAlerts(r, prescribed, lowVolumePct = LOW_VOLUME_PERCENT, deviationPct = FLOW_DEVIATION_PERCENT, flowStoppedSince = 0, now = Date.now()) {
    let critical = [];
    let caution = [];
    let pct = r.bottlePercentRemaining != null ? r.bottlePercentRemaining : 0;
    let flow = r.flowRateMlPerHr != null ? r.flowRateMlPerHr : 0;

    // Rule 1: unresponsive
    if (r.unresponsive) {
        critical.push({ kind: "patient-unresponsive", severity: "critical", reason: "Possible unresponsive patient", action: "check the patient now" });
    }
    const hr = typeof r.heartRate === "number" && r.heartRate >= 20 && r.heartRate <= 250 ? r.heartRate : null;
    if (hr !== null && hr < HR_LOW_BELOW) {
        critical.push({ kind: "hr-low", severity: "critical", reason: `Low heart rate ${Math.round(hr)} bpm`, action: "check the patient now" });
    } else if (hr !== null && hr > HR_STRESSED_ABOVE) {
        caution.push({ kind: "hr-high", severity: "caution", reason: `Heart rate ${Math.round(hr)} bpm, patient may be stressed`, action: "reassure and recheck" });
    }

    // Rule 2: irregular-rhythm
    if (r.rhythm === "irregular") {
        caution.push({ kind: "irregular-rhythm", severity: "caution", reason: "Irregular heartbeat", action: "check pulse manually and inform the doctor" });
    }

    // Rule 3: hr-out-of-range
    if (r.hrOutOfRange && r.heartRate != null && r.hrLow != null && r.hrHigh != null) {
        caution.push({ kind: "hr-out-of-range", severity: "caution", reason: `Heart rate ${Math.round(r.heartRate)}, patient's normal ${Math.round(r.hrLow)}–${Math.round(r.hrHigh)}`, action: "check the patient" });
    }

    // Rule 4: bottle-empty
    if (r.bottleEmpty || pct <= BOTTLE_EMPTY_PERCENT) {
        critical.push({ kind: "bottle-empty", severity: "critical", reason: "Bottle empty", action: "replace the IV bottle" });
        return critical.concat(caution);
    }

    // The unit shut the line because the bottle is ending: say that, not "flow stopped".
    if (r.clamp === "closed") {
        critical.push({ kind: "line-clamped", severity: "critical", reason: "Line clamped, bottle finished", action: "replace the IV bottle" });
        return critical.concat(caution);
    }

        // Rule 5: flow-stopped
    if (flow <= FLOW_STOPPED_ML_PER_HR) {
        if (flowStoppedSince > 0 && (now - flowStoppedSince) >= 60000) {
            critical.push({ kind: "flow-stopped", severity: "critical", reason: "Flow stopped", action: "check clamp, line and cannula" });
        }
    }

    // Rule 6: flow-high/low
    let flowing = flow > FLOW_STOPPED_ML_PER_HR;
    if (flowing && prescribed > 0) {
        let ratio = flow / prescribed;
        let band = deviationPct / 100.0;
        if (ratio > 1 + band) {
            let rStr = ratio >= 10 ? Math.round(ratio) + "x" : ratio.toFixed(1) + "x";
            caution.push({ kind: "flow-high", severity: "caution", reason: `Flow rate ${rStr} prescribed`, action: "check infusion settings" });
        } else if (ratio < 1 - band) {
            caution.push({ kind: "flow-low", severity: "caution", reason: `Flow rate ${Math.round(ratio * 100)}% of prescribed`, action: "check for a kink or a partly closed clamp" });
        }
    } else if (flowing) {
        if (flow > DEFAULT_FLOW_MAX) {
            caution.push({ kind: "flow-high", severity: "caution", reason: "Flow above expected range", action: "set a prescribed rate for this bed" });
        } else if (flow < DEFAULT_FLOW_MIN) {
            caution.push({ kind: "flow-low", severity: "caution", reason: "Flow below expected range", action: "set a prescribed rate for this bed" });
        }
    }

    // Rule 7: low-volume
    if (pct < lowVolumePct) {
        caution.push({ kind: "low-volume", severity: "caution", reason: `Low volume ${Math.round(pct)}%`, action: "prepare a replacement bottle" });
    }

    return critical.concat(caution);
}

