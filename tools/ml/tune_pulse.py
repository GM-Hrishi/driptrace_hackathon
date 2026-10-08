"""
Replay recorded raw MAX30102 samples through a Python copy of
firmware/driptrace_v3/pulse_detector.h and score parameter choices.

Record with the firmware's serial "raw on" command (lines R,idx,ir,red,beat,moving);
save the part after "R," as CSV, then:

  python tools/ml/tune_pulse.py tools/diag/logs/v3_raw_ir.csv

Scores: beats found, intervals that look missed (>1.6x median) or extra
(<0.6x median), beat-to-beat jitter (median |dRR|), and what the rhythm model
says about the resulting RR stream. Keep in step with pulse_detector.h.
"""

from __future__ import annotations

import itertools
import re
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from train_rhythm import features, rr_filter  # noqa: E402

SPS = 50.0


def detect(ir, moving, dc_alpha, lp_alpha, thresh, min_h=15.0, decay=0.995, refractory=15, interp=True):
    dc = float(ir[0])
    lp = x1 = x2 = height = 0.0
    last = None
    beats = []
    for i, v in enumerate(ir):
        dc += (v - dc) * dc_alpha
        x0 = lp + ((dc - v) - lp) * lp_alpha
        is_peak = x1 > x2 and x1 >= x0
        h = x1
        if not moving[i]:
            height *= decay
            if is_peak and h >= min_h and h >= thresh * height and (last is None or i - last >= refractory):
                capped = 2 * height if height > 0 and h > 2 * height else h
                height = h if height == 0 else height + (capped - height) * 0.25
                last = i
                # Peak was at sample i-1; parabolic interpolation for sub-sample timing.
                off = 0.0
                den = x2 - 2 * x1 + x0
                if interp and den != 0:
                    off = max(-0.5, min(0.5, 0.5 * (x2 - x0) / den))
                beats.append((i - 1 + off) * 1000.0 / SPS)
        x2, x1, lp = x1, x0, x0
    return np.array(beats)


def score(beats_ms, w, b):
    iv = np.diff(beats_ms)
    if len(iv) < 5:
        return None
    med = np.median(iv)
    kept = np.array(rr_filter(beats_ms))
    ps = [1 / (1 + np.exp(-(features(kept[i : i + 30]) @ w + b))) for i in range(0, max(1, len(kept) - 30 + 1), 5)
          if len(kept[i : i + 30]) >= 20]
    return {
        "beats": len(beats_ms),
        "bpm": round(60000 / med),
        "missed": int(np.sum(iv > 1.6 * med)),
        "extra": int(np.sum(iv < 0.6 * med)),
        "jitter_ms": round(float(np.median(np.abs(np.diff(kept))))) if len(kept) > 3 else None,
        "max_p": round(max(ps), 2) if ps else None,
    }


def load_model():
    h = (Path(__file__).resolve().parents[2] / "firmware/driptrace_v3/rhythm_model.h").read_text()
    w = np.array([float(x.strip().rstrip("f")) for x in re.search(r"RHYTHM_W\[[^\]]*\] = \{([^}]*)\}", h).group(1).split(",")])
    b = float(re.search(r"RHYTHM_B = ([-\d.e]+)f", h).group(1))
    return w, b


def main():
    d = np.loadtxt(sys.argv[1], delimiter=",")
    ir, moving = d[:, 1], d[:, 4].astype(bool)
    on = ir > 30000
    ir, moving = ir[on], moving[on]
    w, b = load_model()
    print("firmware now:", score(detect(ir, moving, 1 / 25, 0.35, 0.45, interp=False), w, b))
    rows = []
    for dc_a, lp_a, th in itertools.product([1 / 50, 1 / 25, 1 / 15], [0.2, 0.35, 0.5], [0.3, 0.45, 0.6]):
        s = score(detect(ir, moving, dc_a, lp_a, th), w, b)
        if s:
            rows.append(((s["missed"] + s["extra"]) * 100 + (s["jitter_ms"] or 999), dc_a, lp_a, th, s))
    for r in sorted(rows, key=lambda r: r[0])[:8]:
        print(f"dc=1/{round(1 / r[1])} lp={r[2]} th={r[3]} -> {r[4]}")


if __name__ == "__main__":
    main()
