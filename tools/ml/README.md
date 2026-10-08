# DripTrace on-device heart model

A very small model that runs on the ESP32-S3 inside the pulse-oximeter task. It does three jobs:

| Job | How | Cost on the ESP32 |
|---|---|---|
| **Irregular heartbeat** (AF-like rhythm) | Logistic regression on 5 features of the last 30 beat-to-beat (RR) intervals | 5 multiply-adds + 1 `exp()` every 5 s |
| **This patient's normal HR range** | Online learning: Welford mean/SD over 5 min of resting, regular readings, then a slow moving average. Range = mean ± max(2.5 SD, 8 bpm). Saved in flash (NVS) | A few float ops every 5 s |
| **Possible unresponsive patient** | Rule on top of the model: clip on and no movement for 60 s, plus no pulse for 15 s, HR < 40 for 15 s, or SpO2 < 85 for 30 s | Comparisons every 20 ms |

Firmware side: `firmware/driptrace_v3/vitals_ml.h`. Weights: `firmware/driptrace_v3/rhythm_model.h` (generated, do not edit).

## Training

```
python -m venv %LOCALAPPDATA%\driptrace-ml-venv
%LOCALAPPDATA%\driptrace-ml-venv\Scripts\python -m pip install numpy scikit-learn wfdb
%LOCALAPPDATA%\driptrace-ml-venv\Scripts\python tools/ml/train_rhythm.py
```

The data is streamed from PhysioNet, so nothing is stored in the repo. A run takes about 20–30 minutes, mostly downloading.

- **MIT-BIH Atrial Fibrillation Database** (`afdb`): ECG beat times and rhythm labels. AF windows are labelled irregular, normal-rhythm windows regular.
- **MIT-BIH Normal Sinus Rhythm Database** (`nsrdb`): the first 3 h of each record, labelled regular.

The ECG beat times are made to look like the MAX30102 before training:
- ±15 ms timing jitter
- 20 ms quantisation (50 samples/s)
- 2 % missed beats and 1 % double detections
- then the same raw-RR filter the firmware applies (`rr_filter`, mirrored in `RawRrFilter`)

Records are split 70/30 into train and test, **by patient record, never by window**.

## Results (held-out records, `metrics.json`)

| Threshold | Accuracy | Sensitivity | Specificity |
|---|---|---|---|
| p ≥ 0.5 | 96.2 % | 95.1 % | 97.1 % |
| p ≥ 0.8 (alarm threshold) | 92.6 % | 85.5 % | 98.8 % |

AUC 0.989 over 43,836 test windows. The firmware alarms only after 3 consecutive windows at p ≥ 0.8 (about 15 s of evidence), which trades some sensitivity for fewer false alarms.

## Limits (say these out loud at the demo)

- Trained on ECG beat times with simulated PPG noise, not on MAX30102 recordings. Real finger-PPG accuracy will be lower, especially with movement. While the finger moves, the model pauses.
- It detects an **irregular rhythm pattern** such as AF. It does not diagnose a specific arrhythmia.
- A finger pulse sensor **cannot measure consciousness**. "Possible unresponsive" means a still patient whose pulse vanished or whose HR or SpO2 dropped dangerously: check the patient now.
- The patient range starts empty. Send `baseline reset` over serial when a new patient is connected.

## Demo without a sick patient

Serial monitor at 115200 baud:

| Command | Effect |
|---|---|
| `sim irregular` | Feeds a random beat stream through the real model. The irregular alert appears after about 30 s |
| `sim regular` | Feeds a steady 75 bpm beat stream |
| `sim unresponsive` | Forces the unresponsive alert (TFT, buzzer, website) |
| `sim off` | Back to the real sensor |

At boot the firmware recomputes 5 test vectors exported by the training script and prints `MODEL SELFTEST OK`, which shows the C++ features and weights match Python.
