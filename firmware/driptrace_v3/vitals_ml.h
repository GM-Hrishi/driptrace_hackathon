#pragma once
/*
 * On-device vitals intelligence. Everything here runs inside vitalsTask on
 * core 0; one evaluation every 5 s costs a few hundred float operations.
 *
 *   1. Raw RR filter: beat intervals for rhythm analysis. Unlike the display
 *      HR (which rejects anything 25% off the median), irregular beats are
 *      KEPT here; only double bumps and missed beats are removed. Mirrors
 *      rr_filter() in tools/ml/train_rhythm.py.
 *   2. Rhythm model: logistic regression on 5 shape features of the last 30
 *      RR intervals (rhythm_model.h, trained on PhysioNet AF/NSR data).
 *   3. Patient baseline: learns this patient's own resting HR range
 *      (Welford for 5 min, then a slow moving average), saved in NVS.
 *   4. Possible-unresponsive rule: clip on, no movement for 60 s, and no
 *      pulse / HR < 40 / SpO2 < 85 sustained. A finger PPG cannot tell
 *      consciousness; this flags "check the patient now".
 */
#include <Preferences.h>
#include <math.h>
#include "rhythm_model.h"

const uint8_t RR_WINDOW = 30;               // intervals the model looks at
const uint8_t RR_MIN = 20;                  // fewer -> rhythm "unknown"
const uint32_t RHYTHM_EVAL_MS = 5000;
const uint32_t RR_FRESH_MS = 10000;         // window must include beats this recent
const float IRREGULAR_ON_P = 0.8f, IRREGULAR_OFF_P = 0.5f;
const uint8_t IRREGULAR_ON_WINDOWS = 3;     // ~15 s of evidence before alarming
const uint8_t REGULAR_ON_WINDOWS = 3;

const uint16_t BASELINE_LEARN_WINDOWS = 60; // 60 x 5 s = 5 min
const float BASELINE_EWMA = 0.02f;
const float BASELINE_K_SD = 2.5f;
const float BASELINE_MIN_HALF_RANGE = 8.0f; // bpm
const uint32_t OUT_OF_RANGE_MS = 30000;
const uint32_t STILL_AFTER_MOTION_MS = 10000; // baseline learns only from resting windows

const uint32_t UNRESP_STILL_MS = 60000;
const uint32_t UNRESP_NO_PULSE_MS = 15000;
const uint32_t UNRESP_BRADY_MS = 15000;
const uint32_t UNRESP_HYPOX_MS = 30000;
const int UNRESP_BRADY_BPM = 40, UNRESP_SPO2 = 85;

enum Rhythm : uint8_t { RHYTHM_UNKNOWN, RHYTHM_REGULAR, RHYTHM_IRREGULAR };
inline const char *rhythmName(uint8_t r) {
  return r == RHYTHM_REGULAR ? "regular" : r == RHYTHM_IRREGULAR ? "irregular" : "unknown";
}

// numpy-compatible median (mean of the middle pair for even n). Sorts in place.
inline float medianInPlace(float *v, uint8_t n) {
  for (uint8_t i = 1; i < n; i++) {
    float x = v[i];
    int8_t j = i - 1;
    while (j >= 0 && v[j] > x) { v[j + 1] = v[j]; j--; }
    v[j + 1] = x;
  }
  return (n & 1) ? v[n / 2] : 0.5f * (v[n / 2 - 1] + v[n / 2]);
}

// ---------------------------------------------------------------- raw RR
struct RawRrFilter {
  uint16_t buf[RR_WINDOW];
  uint8_t n = 0, pos = 0;
  bool haveClock = false;
  uint32_t lastT = 0;      // ms, sample clock
  uint32_t lastKeptMs = 0; // millis() of the last kept interval

  void clear() { n = pos = 0; haveClock = false; }
  void restartClock() { haveClock = false; }

  // Oldest first. Returns how many were copied.
  uint8_t copy(uint16_t *out, uint8_t maxN) const {
    uint8_t m = n < maxN ? n : maxN;
    for (uint8_t i = 0; i < m; i++) out[i] = buf[(pos + RR_WINDOW - m + i) % RR_WINDOW];
    return m;
  }

  void push(uint16_t rr) {
    buf[pos] = rr;
    pos = (pos + 1) % RR_WINDOW;
    if (n < RR_WINDOW) n++;
    lastKeptMs = millis();
  }

  // tMs = detection time on the sensor's sample clock.
  void onDetection(uint32_t tMs) {
    if (!haveClock) {
      haveClock = true;
      lastT = tMs;
      return;
    }
    float iv = (float)(tMs - lastT);
    float med = 0;
    if (n >= 5) {
      uint16_t last9[9];
      uint8_t m = copy(last9, 9);
      float tmp[9];
      for (uint8_t i = 0; i < m; i++) tmp[i] = last9[i];
      med = medianInPlace(tmp, m);
    }
    if (iv < 273.0f || (med > 0 && iv < 0.55f * med)) return;                   // double bump: keep clock
    if (iv > 2000.0f || (med > 0 && iv > 2.2f * med)) { lastT = tMs; return; }  // missed beat
    push((uint16_t)iv);
    lastT = tMs;
  }
};

// ---------------------------------------------------------------- model
// Features: cv, rmssd_n, pnn50, medad_n, tpr (see train_rhythm.py features()).
inline bool rhythmFeatures(const uint16_t *rr, uint8_t n, float *f) {
  if (n < 3) return false;
  float mean = 0;
  for (uint8_t i = 0; i < n; i++) mean += rr[i];
  mean /= n;
  float var = 0;
  for (uint8_t i = 0; i < n; i++) var += (rr[i] - mean) * (rr[i] - mean);
  float sd = sqrtf(var / n);
  float ad[RR_WINDOW];
  float ss = 0;
  uint8_t over50 = 0;
  for (uint8_t i = 0; i + 1 < n; i++) {
    float d = (float)rr[i + 1] - (float)rr[i];
    ss += d * d;
    ad[i] = fabsf(d);
    if (ad[i] > 50.0f) over50++;
  }
  uint8_t nd = n - 1;
  uint8_t tp = 0;
  for (uint8_t i = 1; i + 1 < n; i++) {
    bool peak = rr[i] > rr[i - 1] && rr[i] > rr[i + 1];
    bool trough = rr[i] < rr[i - 1] && rr[i] < rr[i + 1];
    if (peak || trough) tp++;
  }
  f[0] = sd / mean;
  f[1] = sqrtf(ss / nd) / mean;
  f[2] = (float)over50 / nd;
  f[3] = medianInPlace(ad, nd) / mean;
  f[4] = (float)tp / (n - 2);
  return true;
}

inline float rhythmProb(const float *f) {
  float z = RHYTHM_B;
  for (uint8_t i = 0; i < RHYTHM_N_FEATURES; i++) z += RHYTHM_W[i] * f[i];
  return 1.0f / (1.0f + expf(-z));
}

// Recompute the exported test vectors; proves features + weights match Python.
inline bool rhythmSelfTest() {
  bool ok = true;
  for (uint8_t t = 0; t < RHYTHM_N_TESTS; t++) {
    float f[RHYTHM_N_FEATURES];
    rhythmFeatures(RHYTHM_TEST_RR[t], RHYTHM_TEST_LEN, f);
    float p = rhythmProb(f);
    bool match = fabsf(p - RHYTHM_TEST_P[t]) < 0.01f;
    Serial.printf("  model test %u: p=%.4f expected %.4f %s\n", t, p, RHYTHM_TEST_P[t], match ? "ok" : "MISMATCH");
    ok &= match;
  }
  return ok;
}

// ---------------------------------------------------------------- baseline
struct HrBaseline {
  float mean = 0, var = 0;
  uint16_t n = 0;
  uint8_t sinceSave = 0;

  bool learned() const { return n >= BASELINE_LEARN_WINDOWS; }
  uint8_t progressPct() const { return learned() ? 100 : (uint8_t)(100UL * n / BASELINE_LEARN_WINDOWS); }
  float halfRange() const {
    float sd = sqrtf(var);
    if (sd < 3.0f) sd = 3.0f;
    float h = BASELINE_K_SD * sd;
    return h < BASELINE_MIN_HALF_RANGE ? BASELINE_MIN_HALF_RANGE : h;
  }
  int low() const { return (int)constrain(lroundf(mean - halfRange()), 40L, 140L); }
  int high() const { return (int)constrain(lroundf(mean + halfRange()), 40L, 140L); }

  void load() {
    Preferences p;
    p.begin("dtml", true);
    mean = p.getFloat("mean", 0);
    var = p.getFloat("var", 0);
    n = p.getUShort("n", 0);
    p.end();
  }
  void save() {
    Preferences p;
    p.begin("dtml", false);
    p.putFloat("mean", mean);
    p.putFloat("var", var);
    p.putUShort("n", n);
    p.end();
  }
  void reset() {
    mean = var = 0;
    n = 0;
    save();
  }

  void update(float hr) {
    if (!learned()) {
      // Welford running mean / variance.
      n++;
      float d = hr - mean;
      mean += d / n;
      var += (d * (hr - mean) - var) / n;
      if (learned() || ++sinceSave >= 12) { save(); sinceSave = 0; }
      return;
    }
    // Learned: adapt slowly, only to values that look like this patient.
    if (fabsf(hr - mean) > halfRange()) return;
    float d = hr - mean;
    mean += BASELINE_EWMA * d;
    var = (1 - BASELINE_EWMA) * (var + BASELINE_EWMA * d * d);
    if (++sinceSave >= 12) { save(); sinceSave = 0; }  // once a minute
  }
};

// ---------------------------------------------------------------- brain
struct VitalsInputs {
  bool finger;
  uint32_t fingerSinceMs, lastMotionMs, lastBeatMs;
  bool hrFresh;
  int hr;
  bool spo2Fresh;
  int spo2;
};

struct VitalsOutputs {
  uint8_t rhythm = RHYTHM_UNKNOWN;
  float irregularProb = -1;        // -1 = not evaluated
  bool baselineLearned = false;
  uint8_t baselinePct = 0;
  int hrLow = 0, hrHigh = 0;
  bool hrOutOfRange = false;
  bool unresponsive = false;
  const char *unresponsiveWhy = "";
};

enum SimMode : uint8_t { SIM_OFF, SIM_REGULAR, SIM_IRREGULAR, SIM_UNRESPONSIVE };

struct VitalsBrain {
  RawRrFilter rr;
  HrBaseline baseline;
  VitalsOutputs out;
  uint32_t lastEvalMs = 0, outOfRangeSince = 0, bradySince = 0, hypoxSince = 0;
  uint8_t irregularRun = 0, regularRun = 0;

  void begin() {
    baseline.load();
    publishBaseline();
  }

  void publishBaseline() {
    out.baselineLearned = baseline.learned();
    out.baselinePct = baseline.progressPct();
    out.hrLow = out.baselineLearned ? baseline.low() : 0;
    out.hrHigh = out.baselineLearned ? baseline.high() : 0;
  }

  void evaluate(uint32_t now, const VitalsInputs &in, bool sim) {
    if (now - lastEvalMs < RHYTHM_EVAL_MS) return;
    lastEvalMs = now;

    bool resting = in.finger && now - in.lastMotionMs >= STILL_AFTER_MOTION_MS;
    bool rrUsable = rr.n >= RR_MIN && now - rr.lastKeptMs < RR_FRESH_MS && (in.finger || sim);
    if (rrUsable) {
      uint16_t w[RR_WINDOW];
      uint8_t m = rr.copy(w, RR_WINDOW);
      float f[RHYTHM_N_FEATURES];
      rhythmFeatures(w, m, f);
      float p = rhythmProb(f);
      out.irregularProb = p;
      if (p >= IRREGULAR_ON_P) { irregularRun++; regularRun = 0; }
      else if (p < IRREGULAR_OFF_P) { regularRun++; irregularRun = 0; }
      if (irregularRun >= IRREGULAR_ON_WINDOWS) out.rhythm = RHYTHM_IRREGULAR;
      else if (regularRun >= REGULAR_ON_WINDOWS) out.rhythm = RHYTHM_REGULAR;
      else if (out.rhythm == RHYTHM_UNKNOWN && p < IRREGULAR_OFF_P) out.rhythm = RHYTHM_REGULAR;
    } else {
      out.irregularProb = -1;
      out.rhythm = RHYTHM_UNKNOWN;
      irregularRun = regularRun = 0;
    }

    // The patient's own range is learned only from resting, regular windows.
    if (resting && in.hrFresh && out.rhythm != RHYTHM_IRREGULAR) baseline.update((float)in.hr);
    publishBaseline();

    if (out.baselineLearned && in.hrFresh && (in.hr < out.hrLow || in.hr > out.hrHigh)) {
      if (!outOfRangeSince) outOfRangeSince = now;
    } else {
      outOfRangeSince = 0;
    }
    out.hrOutOfRange = outOfRangeSince && now - outOfRangeSince >= OUT_OF_RANGE_MS;
  }

  // Called every loop (cheap).
  void checkUnresponsive(uint32_t now, const VitalsInputs &in, SimMode sim) {
    if (sim == SIM_UNRESPONSIVE) {
      out.unresponsive = true;
      out.unresponsiveWhy = "sim";
      return;
    }
    bool still = in.finger && now - in.lastMotionMs >= UNRESP_STILL_MS;
    uint32_t pulseRef = in.lastBeatMs > in.fingerSinceMs ? in.lastBeatMs : in.fingerSinceMs;
    bool noPulse = in.finger && now - pulseRef >= UNRESP_NO_PULSE_MS;

    if (in.hrFresh && in.hr < UNRESP_BRADY_BPM) { if (!bradySince) bradySince = now; }
    else bradySince = 0;
    if (in.spo2Fresh && in.spo2 < UNRESP_SPO2) { if (!hypoxSince) hypoxSince = now; }
    else hypoxSince = 0;
    bool brady = bradySince && now - bradySince >= UNRESP_BRADY_MS;
    bool hypox = hypoxSince && now - hypoxSince >= UNRESP_HYPOX_MS;

    out.unresponsive = still && (noPulse || brady || hypox);
    out.unresponsiveWhy = !out.unresponsive ? "" : noPulse ? "no-pulse" : brady ? "low-hr" : "low-spo2";
  }
};
