#pragma once
/*
 * PPG beat detector for the MAX30102 at 50 samples/s.
 *
 * Replaces SparkFun's checkForBeat(), which on this board caught only ~20 of
 * ~70 beats a minute at 50 sps (bench, 2026-10-08), starving both the HR
 * median and the rhythm model.
 *
 *   1. Baseline removal: a ~0.5 s moving average of IR is subtracted. Blood
 *      in systole absorbs more IR, so the sign is flipped to make beats peaks.
 *   2. Smoothing: a one-pole low-pass (~4 Hz) removes sample noise.
 *   3. Peak picking: a local maximum is a beat if it is above PD_THRESH of
 *      the recent typical beat height, above an absolute floor, and at least
 *      PD_REFRACTORY samples (0.3 s, i.e. 200 bpm) after the previous beat.
 *      The typical height decays slowly so it re-adapts after a change.
 *   4. Timing: the beat is timed at the steepest point of the upstroke before
 *      the peak, interpolated between samples. On the bench this cut
 *      beat-to-beat jitter from ~80 ms (peak timing) to ~58 ms.
 *   5. Motion: filters keep running but no beats are reported and the height
 *      estimate is frozen, so a wiggle does not raise the bar for real beats.
 *
 * Mirrored in tools/ml/tune_pulse.py for tuning on recorded raw IR.
 */
#include <stdint.h>

const float PD_DC_ALPHA = 1.0f / 15.0f;   // baseline ~0.3 s (tuned on bench recording)
const float PD_LP_ALPHA = 0.35f;          // smoothing
const float PD_THRESH = 0.45f;            // fraction of typical beat height
const float PD_MIN_HEIGHT = 15.0f;        // IR counts; noise floor
const float PD_HEIGHT_DECAY = 0.995f;     // per sample (~4 s half-life)
const uint16_t PD_REFRACTORY = 15;        // samples (0.3 s)
const uint8_t PD_UPSTROKE_WIN = 15;       // samples searched for the steepest rise
const float PD_SAMPLE_MS = 20.0f;         // 50 sps

struct PulseDetector {
  float dc = 0, lp = 0, x1 = 0, x2 = 0, height = 0;
  uint32_t lastBeatIdx = 0;
  bool primed = false;
  float hist[PD_UPSTROKE_WIN];  // last smoothed values, ring
  uint8_t histPos = 0, histN = 0;
  float beatMs = 0;             // time of the last beat, ms on the sample clock

  void reset(uint32_t ir) {
    dc = (float)ir;
    lp = x1 = x2 = height = 0;
    lastBeatIdx = 0;
    histPos = histN = 0;
    primed = true;
  }

  // Feed every sample. Returns true when the previous sample was a beat peak.
  bool update(uint32_t ir, uint32_t idx, bool moving) {
    if (!primed) reset(ir);
    dc += ((float)ir - dc) * PD_DC_ALPHA;
    lp += ((dc - (float)ir) - lp) * PD_LP_ALPHA;
    bool isPeak = x1 > x2 && x1 >= lp;
    float h = x1;
    x2 = x1;
    x1 = lp;
    bool beat = false;
    if (!moving) {
      height *= PD_HEIGHT_DECAY;
      if (isPeak && h >= PD_MIN_HEIGHT && h >= PD_THRESH * height &&
          !(lastBeatIdx && idx - lastBeatIdx < PD_REFRACTORY) && histN == PD_UPSTROKE_WIN) {
        // A single huge peak (artifact) may only double the typical height.
        float capped = height > 0 && h > 2.0f * height ? 2.0f * height : h;
        height = height == 0 ? h : height + (capped - height) * 0.25f;
        lastBeatIdx = idx;
        beatMs = upstrokeMs(idx);
        beat = true;
      }
    }
    hist[histPos] = lp;
    histPos = (histPos + 1) % PD_UPSTROKE_WIN;
    if (histN < PD_UPSTROKE_WIN) histN++;
    return beat;
  }

  // Steepest rise among the last PD_UPSTROKE_WIN smoothed samples (which end
  // at the peak), with parabolic interpolation. Mirrors tune_pulse.py.
  float upstrokeMs(uint32_t idx) const {
    float seg[PD_UPSTROKE_WIN];
    for (uint8_t i = 0; i < PD_UPSTROKE_WIN; i++) seg[i] = hist[(histPos + i) % PD_UPSTROKE_WIN];
    float ds[PD_UPSTROKE_WIN - 1];
    uint8_t k = 0;
    for (uint8_t i = 0; i + 1 < PD_UPSTROKE_WIN; i++) {
      ds[i] = seg[i + 1] - seg[i];
      if (ds[i] > ds[k]) k = i;
    }
    float off = 0;
    if (k > 0 && k + 1 < PD_UPSTROKE_WIN - 1) {
      float den = ds[k - 1] - 2 * ds[k] + ds[k + 1];
      if (den != 0) off = 0.5f * (ds[k - 1] - ds[k + 1]) / den;
      if (off > 0.5f) off = 0.5f;
      if (off < -0.5f) off = -0.5f;
    }
    float sample = (float)(idx - PD_UPSTROKE_WIN) + k + 0.5f + off;
    return sample * PD_SAMPLE_MS;
  }
};
