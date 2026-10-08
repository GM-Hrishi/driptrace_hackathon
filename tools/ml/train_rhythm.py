"""
Train DripTrace's on-device irregular-rhythm classifier and export it as a C
header for the ESP32-S3 firmware.

Model: logistic regression on 5 shape features of the last 30 beat-to-beat
(RR) intervals. On the device that is 5 multiply-adds and one exp() every
5 seconds.

Data (PhysioNet, streamed with wfdb, nothing stored in the repo):
  - afdb  MIT-BIH Atrial Fibrillation Database: beat times (.qrs) and rhythm
          labels (.atr): AF windows are "irregular", N windows "regular".
  - nsrdb MIT-BIH Normal Sinus Rhythm Database: more "regular" windows.

The ECG beat times are degraded to look like the MAX30102 beat detector before
training: timing jitter, 20 ms quantisation (50 sps), missed beats and double
detections, then the SAME raw-RR filter the firmware applies (rr_filter below
mirrors vitals_ml.h). Train/test are split by record, never by window.

Usage:
  python tools/ml/train_rhythm.py            # writes firmware/driptrace_v3/rhythm_model.h
"""

from __future__ import annotations

import argparse
import json
import pathlib

import numpy as np
import wfdb
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix, roc_auc_score

ROOT = pathlib.Path(__file__).resolve().parents[2]
HEADER = ROOT / "firmware" / "driptrace_v3" / "rhythm_model.h"
METRICS = pathlib.Path(__file__).resolve().parent / "metrics.json"

WINDOW = 30          # RR intervals per window (firmware RR_WINDOW)
STEP = 10            # beats between training windows
SPS = 50.0           # MAX30102 rate in firmware v3
NSR_HOURS = 3.0      # hours taken from each (24 h) NSR record

FEATURES = ["cv", "rmssd_n", "pnn50", "medad_n", "tpr"]


# --------------------------------------------------------------------------
# Firmware mirror: raw RR filter and features (keep in step with vitals_ml.h)
# --------------------------------------------------------------------------
def rr_filter(detections_ms: np.ndarray) -> list[float]:
    """RR intervals the firmware would keep from a list of detection times."""
    kept: list[float] = []
    last = None
    for t in detections_ms:
        if last is None:
            last = t
            continue
        iv = t - last
        med = float(np.median(kept[-9:])) if len(kept) >= 5 else None
        if iv < 273.0 or (med is not None and iv < 0.55 * med):
            continue                      # double bump inside one beat: keep the clock
        if iv > 2000.0 or (med is not None and iv > 2.2 * med):
            last = t                      # a beat was missed: restart here
            continue
        kept.append(iv)
        last = t
    return kept


def features(rr: np.ndarray) -> np.ndarray:
    rr = np.asarray(rr, dtype=np.float64)
    mean = rr.mean()
    d = np.diff(rr)
    ad = np.abs(d)
    cv = rr.std() / mean
    rmssd_n = np.sqrt(np.mean(d * d)) / mean
    pnn50 = np.mean(ad > 50.0)
    medad_n = np.median(ad) / mean
    mid = rr[1:-1]
    tp = ((mid > rr[:-2]) & (mid > rr[2:])) | ((mid < rr[:-2]) & (mid < rr[2:]))
    tpr = tp.sum() / (len(rr) - 2)
    return np.array([cv, rmssd_n, pnn50, medad_n, tpr])


# --------------------------------------------------------------------------
# Data
# --------------------------------------------------------------------------
def degrade(beats_ms: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Make ECG beat times look like PPG detections at 50 sps."""
    t = beats_ms + rng.normal(0.0, 15.0, beats_ms.shape)               # pulse transit jitter
    t = t[rng.random(t.shape) > 0.02]                                   # 2 % missed beats
    gaps = np.diff(t)
    at = np.where(rng.random(gaps.shape) < 0.01)[0]                     # 1 % double bumps
    extras = t[at] + rng.uniform(0.25, 0.5, at.shape) * gaps[at]
    t = np.sort(np.concatenate([t, extras]))
    q = 1000.0 / SPS
    return np.round(t / q) * q                                          # sample quantisation


def segments_afdb(rec: str):
    """(start_ms, end_ms, label) rhythm segments; label 1 = AF, 0 = N."""
    atr = wfdb.rdann(rec, "atr", pn_dir="afdb")
    out = []
    for i, note in enumerate(atr.aux_note):
        start = atr.sample[i] * 1000.0 / atr.fs
        end = atr.sample[i + 1] * 1000.0 / atr.fs if i + 1 < len(atr.sample) else np.inf
        tag = note.strip("\x00").strip()
        if tag == "(AFIB":
            out.append((start, end, 1))
        elif tag == "(N":
            out.append((start, end, 0))
    return out


def windows_for(beats_ms, segs, rng):
    det = degrade(beats_ms, rng)
    X, y = [], []
    for start, end, label in segs:
        rr = rr_filter(det[(det >= start) & (det < end)])
        for i in range(0, len(rr) - WINDOW + 1, STEP):
            X.append(features(np.array(rr[i : i + WINDOW])))
            y.append(label)
    return X, y


def load(seed: int):
    rng = np.random.default_rng(seed)
    data = {}
    for rec in wfdb.get_record_list("afdb"):
        try:
            qrs = wfdb.rdann(rec, "qrs", pn_dir="afdb")
            segs = segments_afdb(rec)
        except Exception as exc:  # a few records lack annotation files
            print(f"  afdb {rec}: skipped ({exc.__class__.__name__})")
            continue
        X, y = windows_for(qrs.sample * 1000.0 / qrs.fs, segs, rng)
        if X:
            data[f"afdb/{rec}"] = (np.array(X), np.array(y))
            print(f"  afdb {rec}: {len(y)} windows, {int(np.sum(y))} AF")
    for rec in wfdb.get_record_list("nsrdb"):
        try:
            ann = wfdb.rdann(rec, "atr", pn_dir="nsrdb", sampto=int(NSR_HOURS * 3600 * 128))
        except Exception as exc:
            print(f"  nsrdb {rec}: skipped ({exc.__class__.__name__})")
            continue
        beats = ann.sample[np.array(ann.symbol) == "N"] * 1000.0 / ann.fs
        X, y = windows_for(beats, [(0.0, np.inf, 0)], rng)
        if X:
            data[f"nsrdb/{rec}"] = (np.array(X), np.array(y))
            print(f"  nsrdb {rec}: {len(y)} windows")
    return data


# --------------------------------------------------------------------------
# Train / evaluate / export
# --------------------------------------------------------------------------
def split_records(names, seed):
    rng = np.random.default_rng(seed)
    test = set()
    for db in ("afdb", "nsrdb"):
        recs = sorted(n for n in names if n.startswith(db))
        rng.shuffle(recs)
        test.update(recs[: max(1, round(len(recs) * 0.3))])
    return sorted(n for n in names if n not in test), sorted(test)


def stack(data, names):
    return (np.concatenate([data[n][0] for n in names]), np.concatenate([data[n][1] for n in names]))


def report(y, p, thr):
    tn, fp, fn, tp = confusion_matrix(y, p >= thr, labels=[0, 1]).ravel()
    return {
        "threshold": thr,
        "accuracy": round(float((tp + tn) / len(y)), 4),
        "sensitivity": round(float(tp / max(1, tp + fn)), 4),
        "specificity": round(float(tn / max(1, tn + fp)), 4),
        "windows": int(len(y)),
    }


def predict(w, b, f):
    return 1.0 / (1.0 + np.exp(-(f @ w + b)))


def c_floats(values):
    return ", ".join(f"{v:.8g}f" for v in values)


def export(w, b, tests, metrics):
    m = metrics["test_at_0.5"]
    lines = [
        "// Generated by tools/ml/train_rhythm.py. Do not edit by hand.",
        "// Logistic regression, irregular (AF-like) vs regular rhythm, on 5",
        "// features of the last RR_WINDOW beat intervals. Scaler folded in.",
        f"// Held-out records, per window at p >= 0.5: accuracy {m['accuracy']},",
        f"// sensitivity {m['sensitivity']}, specificity {m['specificity']}; AUC {metrics['test_auc']}.",
        "#pragma once",
        "#include <stdint.h>",
        "",
        f"#define RHYTHM_N_FEATURES {len(w)}",
        f"// Features: {', '.join(FEATURES)}",
        f"static const float RHYTHM_W[RHYTHM_N_FEATURES] = {{{c_floats(w)}}};",
        f"static const float RHYTHM_B = {b:.8g}f;",
        "",
        "// Self-test: RR windows (ms) with the probability this script computed.",
        "// The firmware recomputes them at boot (features + model).",
        f"#define RHYTHM_N_TESTS {len(tests)}",
        f"#define RHYTHM_TEST_LEN {WINDOW}",
        "static const uint16_t RHYTHM_TEST_RR[RHYTHM_N_TESTS][RHYTHM_TEST_LEN] = {",
    ]
    for rr, _ in tests:
        lines.append("  {" + ", ".join(str(int(v)) for v in rr) + "},")
    lines += [
        "};",
        f"static const float RHYTHM_TEST_P[RHYTHM_N_TESTS] = {{{c_floats([p for _, p in tests])}}};",
        "",
    ]
    HEADER.write_text("\n".join(lines), encoding="utf-8", newline="\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    print("Loading PhysioNet records (streamed)...")
    data = load(args.seed)
    train, test = split_records(list(data), args.seed)
    Xtr, ytr = stack(data, train)
    Xte, yte = stack(data, test)
    print(f"train windows {len(ytr)} ({ytr.mean():.0%} AF), test windows {len(yte)} ({yte.mean():.0%} AF)")

    mu, sd = Xtr.mean(0), Xtr.std(0)
    clf = LogisticRegression(class_weight="balanced", C=1.0, max_iter=1000)
    clf.fit((Xtr - mu) / sd, ytr)
    w = clf.coef_[0] / sd
    b = float(clf.intercept_[0] - np.sum(clf.coef_[0] * mu / sd))

    pte = predict(w, b, Xte)
    metrics = {
        "features": FEATURES,
        "train_records": train,
        "test_records": test,
        "test_auc": round(float(roc_auc_score(yte, pte)), 4),
        "test_at_0.5": report(yte, pte, 0.5),
        "test_at_0.8": report(yte, pte, 0.8),
    }
    print(json.dumps(metrics, indent=2))

    # Self-test vectors: two steady, two irregular, one alternating rhythm.
    rng = np.random.default_rng(args.seed)
    tests = []
    for mean, spread in ((800, 15), (650, 20), (700, 160), (850, 220)):
        rr = np.clip(np.round(rng.normal(mean, spread, WINDOW)), 300, 1900)
        tests.append((rr, float(predict(w, b, features(rr)))))
    alt = np.full(WINDOW, 800.0)
    alt[::2] += 20
    tests.append((alt, float(predict(w, b, features(alt)))))

    export(w, b, tests, metrics)
    METRICS.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {HEADER.relative_to(ROOT)} and {METRICS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
