/*
 * DripTrace diagnostic sketch — MEASURE ONLY. Never writes to Firebase.
 *
 * Board: ESP32-S3-WROOM-1 N16R8 on CH343 UART0, 115200 baud.
 * Pins/configs identical to production (driptrace_esp32s3_firmware_final.ino).
 * Libraries identical to production: HX711 (Rob Tillaart 0.6.5),
 * SparkFun MAX3010x 1.1.2, Adafruit ST7735 1.11.0 / GFX 1.12.6, core i2s.
 *
 * Every line starts with a tag: INFO, HX, MAX, SPK, NET, RESULT.
 * Send ONE character to run one test:
 *   i info | z k f e HX711 10 s static (zero/known/full/empty) | w HX711 60 s drift
 *   d HX711 disconnect 30 s | a b c MAX30102 per-sample HR (3 configs)
 *   o MAX30102 old polled getIR() HR | x HR + production SpO2 burst 40 s
 *   p MAX30102 disconnect 30 s | s speaker interference 10 s | n WiFi
 */

#include <Wire.h>
#include <SPI.h>
#include <WiFi.h>
#include <HX711.h>
#include "MAX30105.h"
#include "heartRate.h"
#include "spo2_algorithm.h"
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <driver/i2s.h>
#include <esp_system.h>
#include <esp_arduino_version.h>

// ---- Pins (locked, same as production) ----
#define TFT_CS 10
#define TFT_DC 7
#define TFT_RST 6
#define TFT_SCLK 12
#define TFT_MOSI 11
#define I2C_SDA 38
#define I2C_SCL 39
#define HX711_DT 40
#define HX711_SCK 41
#define I2S_BCLK 20
#define I2S_LRC 21
#define I2S_DOUT 47

#define FINGER_THRESHOLD 30000
#define SAMPLE_RATE 16000
#define BEEP_AMPLITUDE 1800
#define HX_READY_TIMEOUT_MS 150

#include "secrets.h"  // WIFI_SSID, WIFI_PASSWORD (git-ignored; see secrets.example.h)

HX711 scale;
MAX30105 particleSensor;
Adafruit_ST7735 tft = Adafruit_ST7735(TFT_CS, TFT_DC, TFT_RST);

bool maxOk = false;
float lastZeroSd = NAN;  // stddev of the most recent 'z' run, for 's'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
struct Stats {
  uint32_t n = 0;
  double mean = 0, m2 = 0;
  double mn = 1e18, mx = -1e18;
  void add(double x) {
    n++;
    double d = x - mean;
    mean += d / n;
    m2 += d * (x - mean);
    if (x < mn) mn = x;
    if (x > mx) mx = x;
  }
  double sd() const { return n > 1 ? sqrt(m2 / (n - 1)) : 0; }
};

const char *resetReasonStr(esp_reset_reason_t r) {
  switch (r) {
    case ESP_RST_POWERON: return "POWERON";
    case ESP_RST_EXT: return "EXT";
    case ESP_RST_SW: return "SW";
    case ESP_RST_PANIC: return "PANIC";
    case ESP_RST_INT_WDT: return "INT_WDT";
    case ESP_RST_TASK_WDT: return "TASK_WDT";
    case ESP_RST_WDT: return "WDT";
    case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
    case ESP_RST_BROWNOUT: return "BROWNOUT";
    case ESP_RST_SDIO: return "SDIO";
    default: return "UNKNOWN";
  }
}

bool isSuspiciousRaw(int32_t r) {
  return r == 0 || r == -1 || r == 8388607 || r == -8388608;
}

// Never-blocking HX711 sample: wait for DOUT low for at most timeoutMs,
// then read(). read() only spins while DOUT is HIGH, so once is_ready() is
// true it returns after the 25 clock pulses.
bool hxSample(int32_t &raw, uint32_t &waitMs, uint32_t timeoutMs = HX_READY_TIMEOUT_MS) {
  uint32_t t0 = millis();
  while (!scale.is_ready()) {
    if (millis() - t0 >= timeoutMs) {
      waitMs = millis() - t0;
      return false;
    }
    delayMicroseconds(200);
  }
  waitMs = millis() - t0;
  raw = (int32_t)scale.read();
  return true;
}

// ---------------------------------------------------------------------------
// i — info
// ---------------------------------------------------------------------------
void testInfo() {
  Serial.printf("INFO chip=%s rev=%d cores=%d cpu_mhz=%lu\n", ESP.getChipModel(), ESP.getChipRevision(),
                ESP.getChipCores(), (unsigned long)ESP.getCpuFreqMHz());
  Serial.printf("INFO flash_bytes=%lu flash_speed_hz=%lu psram_bytes=%lu free_psram=%lu\n",
                (unsigned long)ESP.getFlashChipSize(), (unsigned long)ESP.getFlashChipSpeed(),
                (unsigned long)ESP.getPsramSize(), (unsigned long)ESP.getFreePsram());
  Serial.printf("INFO free_heap=%lu min_free_heap=%lu\n", (unsigned long)ESP.getFreeHeap(),
                (unsigned long)ESP.getMinFreeHeap());
  Serial.printf("INFO reset_reason=%s core=%s sdk=%s\n", resetReasonStr(esp_reset_reason()), ESP_ARDUINO_VERSION_STR,
                ESP.getSdkVersion());
  Serial.print("INFO i2c_scan_bus38_39=");
  int found = 0;
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      Serial.printf("%s0x%02X", found ? "," : "", a);
      found++;
    }
  }
  if (!found) Serial.print("none");
  Serial.println();
  Serial.printf("RESULT i chip=%s rev=%d cpu=%lu flash=%lu psram=%lu heap=%lu reset=%s core=%s i2c_devices=%d\n",
                ESP.getChipModel(), ESP.getChipRevision(), (unsigned long)ESP.getCpuFreqMHz(),
                (unsigned long)ESP.getFlashChipSize(), (unsigned long)ESP.getPsramSize(),
                (unsigned long)ESP.getFreeHeap(), resetReasonStr(esp_reset_reason()), ESP_ARDUINO_VERSION_STR, found);
}

// ---------------------------------------------------------------------------
// z k f e — HX711 10 s static
// ---------------------------------------------------------------------------
void testHxStatic(char cmd) {
  Stats s;
  uint32_t timeouts = 0, suspicious = 0, maxWait = 0;
  uint32_t start = millis();
  while (millis() - start < 10000) {
    int32_t raw;
    uint32_t w;
    if (hxSample(raw, w)) {
      s.add(raw);
      if (isSuspiciousRaw(raw)) suspicious++;
      Serial.printf("HX t=%lu raw=%ld wait_ms=%lu\n", (unsigned long)(millis() - start), (long)raw, (unsigned long)w);
    } else {
      timeouts++;
      Serial.printf("HX t=%lu timeout wait_ms=%lu\n", (unsigned long)(millis() - start), (unsigned long)w);
    }
    if (w > maxWait) maxWait = w;
  }
  if (cmd == 'z') lastZeroSd = s.sd();
  Serial.printf("RESULT %c n=%lu mean=%.1f stddev=%.1f min=%.0f max=%.0f timeouts=%lu suspicious=%lu max_wait_ms=%lu sps=%.1f\n",
                cmd, (unsigned long)s.n, s.mean, s.sd(), s.n ? s.mn : 0, s.n ? s.mx : 0, (unsigned long)timeouts,
                (unsigned long)suspicious, (unsigned long)maxWait, s.n / 10.0);
}

// ---------------------------------------------------------------------------
// w — HX711 60 s drift
// ---------------------------------------------------------------------------
void testHxDrift() {
  Stats first10, last10, all;
  uint32_t timeouts = 0;
  uint32_t start = millis();
  for (int sec = 0; sec < 60; sec++) {
    Stats s;
    while (millis() - start < (uint32_t)(sec + 1) * 1000) {
      int32_t raw;
      uint32_t w;
      if (hxSample(raw, w)) {
        s.add(raw);
        all.add(raw);
        if (sec < 10) first10.add(raw);
        if (sec >= 50) last10.add(raw);
      } else {
        timeouts++;
      }
    }
    Serial.printf("HX sec=%d n=%lu mean=%.1f stddev=%.1f\n", sec, (unsigned long)s.n, s.mean, s.sd());
  }
  Serial.printf("RESULT w n=%lu first10_mean=%.1f last10_mean=%.1f drift=%.1f overall_mean=%.1f overall_stddev=%.1f timeouts=%lu\n",
                (unsigned long)all.n, first10.mean, last10.mean, last10.mean - first10.mean, all.mean, all.sd(),
                (unsigned long)timeouts);
}

// ---------------------------------------------------------------------------
// d — HX711 disconnect behaviour, 30 s at 10 Hz
// ---------------------------------------------------------------------------
void testHxDisconnect() {
  Stats phase[3];
  uint32_t notReady[3] = {0, 0, 0}, susp[3] = {0, 0, 0}, total[3] = {0, 0, 0}, maxWait[3] = {0, 0, 0};
  uint32_t settleSample = 0;
  bool settled = false;
  uint32_t start = millis();
  for (int i = 0; i < 300; i++) {
    uint32_t tSlot = start + (uint32_t)i * 100;
    while ((int32_t)(millis() - tSlot) < 0) delay(1);
    uint32_t t = millis() - start;
    int p = t < 10000 ? 0 : (t < 20000 ? 1 : 2);
    bool readyNow = scale.is_ready();
    int32_t raw = 0;
    uint32_t w = 0;
    uint32_t c0 = micros();
    bool ok = hxSample(raw, w, 90);
    uint32_t callUs = micros() - c0;
    total[p]++;
    if (w > maxWait[p]) maxWait[p] = w;
    if (!ok) {
      notReady[p]++;
      Serial.printf("HX t=%lu ready_now=%d timeout wait_ms=%lu call_us=%lu\n", (unsigned long)t, readyNow,
                    (unsigned long)w, (unsigned long)callUs);
      continue;
    }
    phase[p].add(raw);
    if (isSuspiciousRaw(raw)) susp[p]++;
    if (p == 2 && !settled && phase[0].n > 2) {
      settleSample++;
      double tol = 5.0 * (phase[0].sd() > 50 ? phase[0].sd() : 50);
      if (fabs(raw - phase[0].mean) <= tol) settled = true;
    }
    Serial.printf("HX t=%lu ready_now=%d raw=%ld wait_ms=%lu call_us=%lu\n", (unsigned long)t, readyNow, (long)raw,
                  (unsigned long)w, (unsigned long)callUs);
  }
  const char *names[3] = {"0-10s", "10-20s", "20-30s"};
  for (int p = 0; p < 3; p++) {
    Serial.printf("RESULT d phase=%s slots=%lu not_ready=%lu ok=%lu mean=%.1f stddev=%.1f min=%.0f max=%.0f suspicious=%lu max_wait_ms=%lu\n",
                  names[p], (unsigned long)total[p], (unsigned long)notReady[p], (unsigned long)phase[p].n, phase[p].mean,
                  phase[p].sd(), phase[p].n ? phase[p].mn : 0, phase[p].n ? phase[p].mx : 0, (unsigned long)susp[p],
                  (unsigned long)maxWait[p]);
  }
  Serial.printf("RESULT d settled=%d samples_to_settle_after_20s=%lu\n", settled, (unsigned long)settleSample);
}

// ---------------------------------------------------------------------------
// MAX30102 HR helpers
// ---------------------------------------------------------------------------
struct BeatTracker {
  long rate[4] = {0, 0, 0, 0};
  uint8_t spot = 0, collected = 0;
  uint32_t lastBeatMs = 0, lastBeatSample = 0;
  uint32_t beats = 0, rejected = 0;
  float lastBpm = 0, lastBpmBySamples = 0;
  int avg4 = 0;
  uint32_t firstAvgMs = 0;
  Stats accepted;

  // sampleIndex/effSps give a timestamp-free BPM, immune to FIFO batch jitter.
  void onBeat(uint32_t nowMs, uint32_t sampleIndex, float effSps, uint32_t startMs) {
    beats++;
    uint32_t delta = nowMs - lastBeatMs;
    uint32_t dSamples = sampleIndex - lastBeatSample;
    lastBeatMs = nowMs;
    lastBeatSample = sampleIndex;
    lastBpm = delta ? 60000.0f / delta : 0;
    lastBpmBySamples = dSamples ? 60.0f * effSps / dSamples : 0;
    Serial.printf("MAX beat t=%lu bpm_ms=%.1f bpm_samples=%.1f\n", (unsigned long)(nowMs - startMs), lastBpm,
                  lastBpmBySamples);
    if (lastBpm > 40 && lastBpm < 180) {
      rate[spot++] = (long)lastBpm;
      spot %= 4;
      if (collected < 4) collected++;
      long sum = 0;
      for (uint8_t i = 0; i < collected; i++) sum += rate[i];
      avg4 = sum / collected;
      accepted.add(lastBpm);
      if (collected == 4 && !firstAvgMs) firstAvgMs = nowMs - startMs;
    } else {
      rejected++;
    }
  }
};

bool maxBeginAndSetup(byte power, byte avg, byte mode, int rate, int pw, int range) {
  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("MAX begin=FAIL");
    return false;
  }
  particleSensor.setup(power, avg, mode, rate, pw, range);
  return true;
}

// a b c — per-sample method: every FIFO sample processed exactly once
void testMaxPerSample(char cmd, byte power, byte avg, byte mode, int rate, int pw, int range) {
  if (!maxBeginAndSetup(power, avg, mode, rate, pw, range)) {
    Serial.printf("RESULT %c error=begin_failed\n", cmd);
    return;
  }
  float effSps = (float)rate / avg;
  Serial.printf("MAX config=(0x%02X,%d,%d,%d,%d,%d) nominal_eff_sps=%.1f\n", power, avg, mode, rate, pw, range, effSps);
  BeatTracker bt;
  uint32_t start = millis(), lastPrint = start, sampleIndex = 0, secSamples = 0, fingerSamples = 0;
  uint32_t ir = 0;
  bt.lastBeatMs = start;
  while (millis() - start < 30000) {
    particleSensor.check();
    while (particleSensor.available()) {
      ir = particleSensor.getFIFOIR();
      (void)particleSensor.getFIFORed();
      sampleIndex++;
      secSamples++;
      if (ir >= FINGER_THRESHOLD) {
        fingerSamples++;
        if (checkForBeat(ir)) bt.onBeat(millis(), sampleIndex, effSps, start);
      }
      particleSensor.nextSample();
    }
    if (millis() - lastPrint >= 1000) {
      lastPrint += 1000;
      Serial.printf("MAX t=%lu sps=%lu ir=%lu finger=%d beats=%lu bpm=%.1f bpm_samples=%.1f avg4=%d rejected=%lu\n",
                    (unsigned long)(millis() - start), (unsigned long)secSamples, (unsigned long)ir,
                    ir >= FINGER_THRESHOLD, (unsigned long)bt.beats, bt.lastBpm, bt.lastBpmBySamples, bt.avg4,
                    (unsigned long)bt.rejected);
      secSamples = 0;
    }
    delay(1);
  }
  Serial.printf("RESULT %c sps_measured=%.1f samples=%lu finger_samples=%lu beats=%lu accepted=%lu avg_bpm=%.1f bpm_sd=%.1f rejected=%lu final_avg4=%d first_avg4_s=%.1f\n",
                cmd, sampleIndex / 30.0, (unsigned long)sampleIndex, (unsigned long)fingerSamples,
                (unsigned long)bt.beats, (unsigned long)bt.accepted.n, bt.accepted.mean, bt.accepted.sd(),
                (unsigned long)bt.rejected, bt.avg4, bt.firstAvgMs / 1000.0);
}

// o — old polled method, exactly like production's Core-0 loop
void testMaxPolled() {
  if (!maxBeginAndSetup(0x1F, 4, 2, 100, 411, 4096)) {
    Serial.println("RESULT o error=begin_failed");
    return;
  }
  BeatTracker bt;
  uint32_t start = millis(), lastPrint = start, iters = 0, secIters = 0, changes = 0, secChanges = 0, zeros = 0;
  uint32_t lastIr = 0, maxCallMs = 0;
  bt.lastBeatMs = start;
  while (millis() - start < 30000) {
    uint32_t c0 = millis();
    long ir = particleSensor.getIR();
    uint32_t callMs = millis() - c0;
    if (callMs > maxCallMs) maxCallMs = callMs;
    iters++;
    secIters++;
    if (ir == 0) zeros++;
    if ((uint32_t)ir != lastIr) {
      changes++;
      secChanges++;
      lastIr = ir;
    }
    if (ir >= FINGER_THRESHOLD && checkForBeat(ir)) bt.onBeat(millis(), changes, 25.0f, start);
    if (millis() - lastPrint >= 1000) {
      lastPrint += 1000;
      Serial.printf("MAX t=%lu loop_iters=%lu distinct_ir=%lu ir=%ld beats=%lu bpm=%.1f avg4=%d rejected=%lu\n",
                    (unsigned long)(millis() - start), (unsigned long)secIters, (unsigned long)secChanges, ir,
                    (unsigned long)bt.beats, bt.lastBpm, bt.avg4, (unsigned long)bt.rejected);
      secIters = 0;
      secChanges = 0;
    }
  }
  Serial.printf("RESULT o loop_iters_per_s=%.1f distinct_ir_per_s=%.1f getIR_zero=%lu max_getIR_ms=%lu beats=%lu accepted=%lu avg_bpm=%.1f bpm_sd=%.1f rejected=%lu final_avg4=%d first_avg4_s=%.1f\n",
                iters / 30.0, changes / 30.0, (unsigned long)zeros, (unsigned long)maxCallMs, (unsigned long)bt.beats,
                (unsigned long)bt.accepted.n, bt.accepted.mean, bt.accepted.sd(), (unsigned long)bt.rejected, bt.avg4,
                bt.firstAvgMs / 1000.0);
}

// x — per-sample HR, interrupted every 10 s by production's exact SpO2 burst
uint32_t irBuffer[100], redBuffer[100];

void productionSpo2Burst(int32_t &spo2, int8_t &spo2Valid, int32_t &hr, int8_t &hrValid) {
  for (int i = 0; i < 100; i++) {
    while (!particleSensor.available()) particleSensor.check();
    redBuffer[i] = particleSensor.getRed();
    irBuffer[i] = particleSensor.getIR();
    particleSensor.nextSample();
  }
  maxim_heart_rate_and_oxygen_saturation(irBuffer, 100, redBuffer, &spo2, &spo2Valid, &hr, &hrValid);
}

void testMaxCombined() {
  if (!maxBeginAndSetup(0x1F, 4, 2, 100, 411, 4096)) {
    Serial.println("RESULT x error=begin_failed");
    return;
  }
  BeatTracker bt;
  uint32_t start = millis(), lastBurst = start, lastPrint = start, sampleIndex = 0;
  uint32_t ir = 0;
  int bursts = 0;
  uint32_t burstMsTotal = 0, gapMax = 0;
  bt.lastBeatMs = start;
  while (millis() - start < 40000) {
    particleSensor.check();
    while (particleSensor.available()) {
      ir = particleSensor.getFIFOIR();
      (void)particleSensor.getFIFORed();
      sampleIndex++;
      if (ir >= FINGER_THRESHOLD) {
        uint32_t before = bt.lastBeatMs;
        if (checkForBeat(ir)) {
          uint32_t gap = millis() - before;
          if (gap > gapMax) gapMax = gap;
          bt.onBeat(millis(), sampleIndex, 25.0f, start);
        }
      }
      particleSensor.nextSample();
    }
    if (ir >= FINGER_THRESHOLD && millis() - lastBurst > 10000) {
      int32_t spo2 = 0, hr = 0;
      int8_t sv = 0, hv = 0;
      uint32_t b0 = millis();
      Serial.printf("MAX burst_start t=%lu beats_so_far=%lu\n", (unsigned long)(b0 - start), (unsigned long)bt.beats);
      productionSpo2Burst(spo2, sv, hr, hv);
      uint32_t bms = millis() - b0;
      bursts++;
      burstMsTotal += bms;
      lastBurst = millis();
      bt.lastBeatMs = millis();  // same as production: reset beat timing after a burst
      Serial.printf("MAX burst_end t=%lu burst_ms=%lu spo2=%ld spo2_valid=%d algo_hr=%ld algo_hr_valid=%d\n",
                    (unsigned long)(millis() - start), (unsigned long)bms, (long)spo2, sv, (long)hr, hv);
      Serial.printf("RESULT x burst=%d burst_ms=%lu spo2=%ld spo2_valid=%d algo_hr=%ld algo_hr_valid=%d\n", bursts,
                    (unsigned long)bms, (long)spo2, sv, (long)hr, hv);
    }
    if (millis() - lastPrint >= 1000) {
      lastPrint = millis();
      Serial.printf("MAX t=%lu ir=%lu beats=%lu bpm=%.1f avg4=%d rejected=%lu\n", (unsigned long)(millis() - start),
                    (unsigned long)ir, (unsigned long)bt.beats, bt.lastBpm, bt.avg4, (unsigned long)bt.rejected);
    }
    delay(1);
  }
  Serial.printf("RESULT x total bursts=%d avg_burst_ms=%lu beats=%lu accepted=%lu avg_bpm=%.1f rejected=%lu max_beat_gap_ms=%lu\n",
                bursts, bursts ? (unsigned long)(burstMsTotal / bursts) : 0UL, (unsigned long)bt.beats,
                (unsigned long)bt.accepted.n, bt.accepted.mean, (unsigned long)bt.rejected, (unsigned long)gapMax);
}

// p — MAX30102 disconnect behaviour, 30 s at 5 Hz
void testMaxDisconnect() {
  bool okStart = maxBeginAndSetup(0x1F, 4, 2, 100, 411, 4096);
  Serial.printf("MAX begin_at_start=%d\n", okStart);
  uint32_t badId[3] = {0, 0, 0}, irZero[3] = {0, 0, 0}, wireErr[3] = {0, 0, 0}, slots[3] = {0, 0, 0};
  uint32_t maxIdUs[3] = {0, 0, 0}, maxIrMs[3] = {0, 0, 0};
  int reBeginResult = -1;  // -1 not attempted
  uint32_t reBeginAtMs = 0;
  bool sawBad = false;
  uint32_t start = millis();
  for (int i = 0; i < 150; i++) {
    uint32_t tSlot = start + (uint32_t)i * 200;
    while ((int32_t)(millis() - tSlot) < 0) delay(1);
    uint32_t t = millis() - start;
    int p = t < 10000 ? 0 : (t < 20000 ? 1 : 2);
    slots[p]++;
    Wire.beginTransmission(0x57);
    uint8_t werr = Wire.endTransmission();
    uint32_t c0 = micros();
    uint8_t id = particleSensor.readPartID();
    uint32_t idUs = micros() - c0;
    uint32_t c1 = millis();
    uint32_t ir = particleSensor.getIR();
    uint32_t irMs = millis() - c1;
    if (id != 0x15) badId[p]++;
    if (ir == 0) irZero[p]++;
    if (werr) wireErr[p]++;
    if (idUs > maxIdUs[p]) maxIdUs[p] = idUs;
    if (irMs > maxIrMs[p]) maxIrMs[p] = irMs;
    if (id != 0x15) sawBad = true;
    // After the wire comes back, try begin()+setup() once without rebooting.
    if (sawBad && id == 0x15 && reBeginResult == -1) {
      reBeginResult = maxBeginAndSetup(0x1F, 4, 2, 100, 411, 4096) ? 1 : 0;
      reBeginAtMs = t;
      Serial.printf("MAX t=%lu rebegin=%d\n", (unsigned long)t, reBeginResult);
    }
    Serial.printf("MAX t=%lu wire_err=%u part_id=0x%02X id_us=%lu ir=%lu ir_ms=%lu\n", (unsigned long)t, werr, id,
                  (unsigned long)idUs, (unsigned long)ir, (unsigned long)irMs);
  }
  const char *names[3] = {"0-10s", "10-20s", "20-30s"};
  for (int p = 0; p < 3; p++) {
    Serial.printf("RESULT p phase=%s slots=%lu bad_part_id=%lu ir_zero=%lu wire_err=%lu max_partid_us=%lu max_getIR_ms=%lu\n",
                  names[p], (unsigned long)slots[p], (unsigned long)badId[p], (unsigned long)irZero[p],
                  (unsigned long)wireErr[p], (unsigned long)maxIdUs[p], (unsigned long)maxIrMs[p]);
  }
  Serial.printf("RESULT p rebegin_after_replug=%d at_ms=%lu\n", reBeginResult, (unsigned long)reBeginAtMs);
}

// ---------------------------------------------------------------------------
// s — speaker interference
// ---------------------------------------------------------------------------
volatile bool toneRunning = false;
bool i2sInstalled = false;

void setupSpeaker() {
  if (i2sInstalled) return;
  i2s_config_t cfg = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 8,
    .dma_buf_len = 256,
    .use_apll = false,
    .tx_desc_auto_clear = true,
    .fixed_mclk = 0
  };
  i2s_pin_config_t pins = {.bck_io_num = I2S_BCLK, .ws_io_num = I2S_LRC, .data_out_num = I2S_DOUT,
                           .data_in_num = I2S_PIN_NO_CHANGE};
  esp_err_t e1 = i2s_driver_install(I2S_NUM_0, &cfg, 0, NULL);
  esp_err_t e2 = i2s_set_pin(I2S_NUM_0, &pins);
  Serial.printf("SPK i2s_install=%d set_pin=%d\n", e1, e2);
  i2sInstalled = (e1 == ESP_OK);
}

void toneTask(void *) {
  static int16_t buf[256 * 2];
  float phase = 0;
  while (toneRunning) {
    for (int i = 0; i < 256; i++) {
      int16_t s = (sinf(phase) >= 0) ? BEEP_AMPLITUDE : -BEEP_AMPLITUDE;
      buf[i * 2] = s;
      buf[i * 2 + 1] = s;
      phase += 2.0f * PI * 1000 / SAMPLE_RATE;
      if (phase > 2.0f * PI) phase -= 2.0f * PI;
    }
    size_t w;
    i2s_write(I2S_NUM_0, buf, sizeof(buf), &w, portMAX_DELAY);
  }
  i2s_zero_dma_buffer(I2S_NUM_0);
  vTaskDelete(NULL);
}

void testSpeaker() {
  setupSpeaker();
  toneRunning = true;
  xTaskCreatePinnedToCore(toneTask, "tone", 4096, NULL, 1, NULL, 0);
  Stats s;
  uint32_t timeouts = 0;
  uint32_t start = millis();
  for (int i = 0; i < 100; i++) {
    uint32_t tSlot = start + (uint32_t)i * 100;
    while ((int32_t)(millis() - tSlot) < 0) delay(1);
    int32_t raw;
    uint32_t w;
    if (hxSample(raw, w)) {
      s.add(raw);
      Serial.printf("SPK t=%lu raw=%ld\n", (unsigned long)(millis() - start), (long)raw);
    } else {
      timeouts++;
    }
  }
  toneRunning = false;
  delay(100);
  Serial.printf("RESULT s n=%lu mean=%.1f stddev_tone=%.1f stddev_silent_z=%.1f ratio=%.2f timeouts=%lu\n",
                (unsigned long)s.n, s.mean, s.sd(), lastZeroSd,
                (lastZeroSd > 0) ? s.sd() / lastZeroSd : NAN, (unsigned long)timeouts);
}

// ---------------------------------------------------------------------------
// n — WiFi
// ---------------------------------------------------------------------------
void testWifi() {
  WiFi.mode(WIFI_STA);
  uint32_t t0 = millis();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) delay(100);
  uint32_t dt = millis() - t0;
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("NET connected ssid=%s rssi=%d channel=%d ip=%s ms=%lu\n", WIFI_SSID, WiFi.RSSI(), WiFi.channel(),
                  WiFi.localIP().toString().c_str(), (unsigned long)dt);
    Serial.printf("RESULT n connected=1 rssi=%d channel=%d ip=%s connect_ms=%lu\n", WiFi.RSSI(), WiFi.channel(),
                  WiFi.localIP().toString().c_str(), (unsigned long)dt);
  } else {
    Serial.printf("RESULT n connected=0 status=%d waited_ms=%lu\n", WiFi.status(), (unsigned long)dt);
  }
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
}

// ---------------------------------------------------------------------------
void printHelp() {
  Serial.println("INFO cmds: i z k f e w d a b c o x p s n");
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.printf("INFO boot reset_reason=%s core=%s\n", resetReasonStr(esp_reset_reason()), ESP_ARDUINO_VERSION_STR);

  SPI.begin(TFT_SCLK, -1, TFT_MOSI, TFT_CS);
  tft.initR(INITR_BLACKTAB);
  tft.setRotation(3);
  tft.fillScreen(ST77XX_BLACK);
  tft.setTextColor(ST77XX_CYAN);
  tft.setTextSize(2);
  tft.setCursor(8, 20);
  tft.print("DIAG MODE");
  tft.setTextSize(1);
  tft.setCursor(8, 50);
  tft.print("No Firebase writes");

  Wire.begin(I2C_SDA, I2C_SCL);
  // fastProcessor=false matches production's begin(DT,SCK) default;
  // doReset=false so a missing HX711 cannot block boot (reset() calls read()).
  scale.begin(HX711_DT, HX711_SCK, false, false);
  maxOk = particleSensor.begin(Wire, I2C_SPEED_FAST);
  Serial.printf("INFO hx711_ready_at_boot=%d max30102_begin=%d\n", scale.is_ready(), maxOk);
  printHelp();
}

void loop() {
  if (!Serial.available()) {
    delay(5);
    return;
  }
  char c = Serial.read();
  if (c == '\r' || c == '\n' || c == ' ') return;
  Serial.printf("INFO start cmd=%c t=%lu\n", c, (unsigned long)millis());
  switch (c) {
    case 'i': testInfo(); break;
    case 'z': case 'k': case 'f': case 'e': testHxStatic(c); break;
    case 'w': testHxDrift(); break;
    case 'd': testHxDisconnect(); break;
    case 'a': testMaxPerSample('a', 0x1F, 4, 2, 100, 411, 4096); break;
    case 'b': testMaxPerSample('b', 0x1F, 4, 3, 400, 411, 4096); break;
    case 'c': testMaxPerSample('c', 0x1F, 1, 2, 100, 411, 4096); break;
    case 'o': testMaxPolled(); break;
    case 'x': testMaxCombined(); break;
    case 'p': testMaxDisconnect(); break;
    case 's': testSpeaker(); break;
    case 'n': testWifi(); break;
    default: printHelp(); break;
  }
  Serial.printf("INFO done cmd=%c t=%lu\n", c, (unsigned long)millis());
  while (Serial.available()) Serial.read();  // drop keys typed during the test
}
