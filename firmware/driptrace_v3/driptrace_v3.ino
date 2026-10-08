/*
 * DripTrace — ESP32-S3-WROOM-1 N16R8 firmware v2
 * KERNEL PRIME'26 — Team Soldering Boys
 *
 * Rewritten from measured facts (docs/hardware/DRIPTRACE_FACTS.md, 2026-10-08):
 *
 *   LOAD CELL (HX711, Rob Tillaart library 0.6.5)
 *   - Calibrated on the real cell: -255.85 raw counts per gram (load makes the
 *     raw value MORE negative). The old 287836.24 factor was counts per KG with
 *     the wrong sign, which is why the dashboard saw ~0 / negative "grams".
 *   - Empty 100 mL bottle = 16.0 g, so fluid = gross - 16.0 g, 1.005 g/mL.
 *   - The HX711 runs at ~10.9 samples/s. A sample is read ONLY after
 *     is_ready() says so, so read() can never block (the library's read()
 *     spins forever if DT or SCK is unplugged).
 *   - Disconnect detection, as measured:
 *       DT or SCK unplugged -> is_ready() stays false  -> offline after 600 ms
 *       VCC unplugged       -> is_ready() true, raw = 0 -> offline after 3 zeros
 *     The old firmware flagged "offline" on a single not-ready poll, which
 *     flapped 4 times in 45 s with nothing touched.
 *   - Tare once at boot (the hook is always empty at power-on). Keep the hook
 *     empty until the screen says "Tare OK".
 *   - Flow rate = least-squares slope of fluid weight over the last 60 s.
 *
 *   PULSE OXIMETER (MAX30102, SparkFun 1.1.2)
 *   - Config (0x1F,4,2,100,411,4096) = 25 samples/s, which is exactly the rate
 *     the SpO2 algorithm assumes (FreqS = 25).
 *   - Every FIFO sample is processed exactly once. Beat intervals are counted
 *     in samples (immune to FIFO batching jitter); HR = median of the last 5
 *     accepted beats.
 *   - SpO2 runs every second on a rolling 4 s window of the SAME samples, so
 *     there is no blocking 8 s burst and no lost beats. (The old burst read
 *     red and IR from different samples.)
 *   - Unplug detection: part ID is checked every second.
 *
 *   FIREBASE
 *   - PUT beds/<BED_ID> every second from its own task, over one reused TLS
 *     connection, so the screen and the scale never freeze during a push.
 *   - sensorOnline now means "load cell connected and reading" (it used to be
 *     "finger on the sensor", which made the dashboard show Offline whenever
 *     nobody was touching the clip).
 *   - lastUpdated is real epoch milliseconds (was whole seconds).
 *   - dropsPerMin and severity are NOT sent: the dashboard derives both.
 *
 * Not in this build: SG90 clamp servo, battery monitoring, SoftAP hotspot.
 *
 * Board settings (Arduino IDE / arduino-cli):
 *   ESP32S3 Dev Module, PSRAM: OPI, Flash: 16MB, Partition: 16M Flash (3MB APP/9.9MB FATFS),
 *   USB CDC On Boot: Disabled, Upload Mode: UART0. Port COM3 (CH343).
 *   FQBN esp32:esp32:esp32s3:PSRAM=opi,FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,CDCOnBoot=default,UploadMode=default
 *
 * Libraries: HX711 by Rob Tillaart (0.6.5), SparkFun MAX3010x (1.1.2),
 * Adafruit GFX (1.12.6), Adafruit ST7735 and ST7789 (1.11.0), ESP32 core 3.3.12.
 */

#include <Wire.h>
#include <SPI.h>
#include <HX711.h>
#include "MAX30105.h"
#include "heartRate.h"
#include "spo2_algorithm.h"
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <driver/i2s.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>
#include <sys/time.h>

// ================= Pins (locked, all tested) =================
#define TFT_CS    10
#define TFT_DC    7
#define TFT_RST   6
#define TFT_SCLK  12
#define TFT_MOSI  11
#define I2C_SDA   38
#define I2C_SCL   39
#define HX711_DT  40
#define HX711_SCK 41
#define I2S_BCLK  20
#define I2S_LRC   21
#define I2S_DOUT  47

// ================= WiFi / Firebase =================
#include "secrets.h"  // WIFI_SSID, WIFI_PASSWORD, DATABASE_SECRET, AP_PASSWORD (git-ignored)
const char *DATABASE_URL = "https://driptrace-hackathon-default-rtdb.asia-southeast1.firebasedatabase.app";
const char *BED_ID = "bed-01";

// Pushes go back-to-back over one kept-alive TLS connection, at most this often.
const uint32_t PUSH_INTERVAL_MS = 300;

// ================= Load cell (measured 2026-10-08) =================
const float HX_COUNTS_PER_GRAM = -255.85f;   // (full - empty bottle) / 100.5 g
const float EMPTY_BOTTLE_G = 16.0f;          // empty 100 mL bottle on the hook
const float FLUID_DENSITY_G_PER_ML = 1.005f; // saline
const float BOTTLE_VOLUME_ML = 100.0f;
const float NO_BOTTLE_BELOW_G = 5.5f;        // empty hook drifted to 3.4 g, empty bottle down to 7.3 g
const float EMPTY_AT_ML = 5.0f;              // 5% of the bottle = empty
const float BOTTLE_SWAP_JUMP_G = 15.0f;      // weight jumping up this much = new bottle

const uint32_t HX_NOT_READY_LIMIT_MS = 600;  // normal gap is ~93 ms at 10.9 sps
const uint8_t HX_ZERO_LIMIT = 3;             // raw == 0 three times = power lost
const uint8_t HX_TARE_SAMPLES = 20;          // ~2 s at 10.9 sps
const uint8_t HX_MEDIAN_N = 5;
const uint8_t HX_DISCARD_AFTER_RECONNECT = 3;

const uint16_t FLOW_WINDOW_S = 120;          // regression window
const uint16_t FLOW_MIN_POINTS = 30;         // need 30 s of data before reporting flow
// Weight change over the window smaller than this is drift, not flow.
// Drift test: a still, empty (rigid) bottle wandered 7.3..17.5 g in 90 s.
// With a 120 s window this hides flows below ~240 mL/hr on the current rig.
const float FLOW_NOISE_G = 8.0f;
// Measured: right after hanging, the reading settles/creeps by several grams,
// which the regression saw as ~400 mL/hr. Ignore that period.
const uint32_t BOTTLE_SETTLE_MS = 30000;

// ================= Pulse oximeter =================
const uint32_t FINGER_THRESHOLD = 30000;     // no finger ~500, finger ~100000
const float MAX_SPS = 25.0f;                 // (0x1F,4,2,100,411,4096): 100 sps / avg 4
const uint8_t MAX_PART_ID = 0x15;
const uint8_t HR_KEEP = 5;
const uint32_t HR_STALE_MS = 3000;
const uint32_t SPO2_STALE_MS = 6000;
const int HR_LOW = 50, HR_HIGH = 120, SPO2_LOW = 92;

// ================= Audio =================
#define SAMPLE_RATE 16000
#define BEEP_AMPLITUDE 1800
const uint32_t EMPTY_ALARM_REPEAT_MS = 20000;

// ================= Shared state =================
struct State {
  // load cell
  bool hxConnected;
  bool tared;
  bool bottlePresent;
  float grossG;          // bottle + fluid on the hook
  float fluidMl;
  float percent;
  bool bottleEmpty;
  float flowMlPerHr;
  // pulse oximeter
  bool maxConnected;
  bool finger;
  int hr;
  bool hrValid;
  int spo2;
  bool spo2Valid;
  // network
  bool wifi;
  bool timeSynced;
  int lastHttp;
};
State g = {};
SemaphoreHandle_t stateMutex;

#define LOCK() xSemaphoreTake(stateMutex, portMAX_DELAY)
#define UNLOCK() xSemaphoreGive(stateMutex)

HX711 scale;
MAX30105 particleSensor;
Adafruit_ST7735 tft = Adafruit_ST7735(TFT_CS, TFT_DC, TFT_RST);

// Declared up front: Arduino's auto-prototypes skip functions with default arguments.
void showBootStatus(const char *title, const String &subtitle, uint16_t color = ST77XX_WHITE);

// =====================================================================
// Audio
// =====================================================================
void setupSpeaker() {
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
  i2s_pin_config_t pins = {
    .bck_io_num = I2S_BCLK,
    .ws_io_num = I2S_LRC,
    .data_out_num = I2S_DOUT,
    .data_in_num = I2S_PIN_NO_CHANGE
  };
  i2s_driver_install(I2S_NUM_0, &cfg, 0, NULL);
  i2s_set_pin(I2S_NUM_0, &pins);
}

void playTone(int freqHz, int durationMs) {
  int total = (SAMPLE_RATE * durationMs) / 1000;
  int16_t buf[256 * 2];
  float phase = 0;
  int sent = 0;
  while (sent < total) {
    int chunk = min(256, total - sent);
    for (int i = 0; i < chunk; i++) {
      int16_t s = (sinf(phase) >= 0) ? BEEP_AMPLITUDE : -BEEP_AMPLITUDE;
      buf[i * 2] = s;
      buf[i * 2 + 1] = s;
      phase += 2.0f * PI * freqHz / SAMPLE_RATE;
      if (phase > 2.0f * PI) phase -= 2.0f * PI;
    }
    size_t w;
    i2s_write(I2S_NUM_0, buf, chunk * 2 * sizeof(int16_t), &w, portMAX_DELAY);
    sent += chunk;
  }
}

void playSilence(int durationMs) {
  int total = (SAMPLE_RATE * durationMs) / 1000;
  int16_t buf[256 * 2] = {0};
  int sent = 0;
  while (sent < total) {
    int chunk = min(256, total - sent);
    size_t w;
    i2s_write(I2S_NUM_0, buf, chunk * 2 * sizeof(int16_t), &w, portMAX_DELAY);
    sent += chunk;
  }
}

void playAlertEmptyBottle() {
  playTone(1000, 150);
  playSilence(100);
  playTone(1500, 150);
  playSilence(50);
}

void playAlertVitals() {
  for (int i = 0; i < 3; i++) {
    playTone(1200, 90);
    playSilence(70);
  }
}

// =====================================================================
// Load cell (Core 1, called from loop)
// =====================================================================
int32_t hxOffset = 0;
int64_t tareSum = 0;
uint8_t tareCount = 0;
int32_t medBuf[HX_MEDIAN_N];
uint8_t medCount = 0, medPos = 0;
uint8_t zeroRun = 0;
uint8_t discardLeft = 0;
uint32_t lastReadyMs = 0;

float flowT[FLOW_WINDOW_S];   // seconds since flowT0
float flowW[FLOW_WINDOW_S];   // fluid grams
uint16_t flowCount = 0, flowPos = 0;
uint32_t flowT0 = 0, lastFlowSampleMs = 0;
float lastFlowGross = NAN;
uint32_t settleUntilMs = 0;

void resetFlow() {
  flowCount = 0;
  flowPos = 0;
  flowT0 = millis();
  lastFlowGross = NAN;
  settleUntilMs = millis() + BOTTLE_SETTLE_MS;
}

int32_t medianRaw() {
  int32_t tmp[HX_MEDIAN_N];
  for (uint8_t i = 0; i < medCount; i++) tmp[i] = medBuf[i];
  for (uint8_t i = 1; i < medCount; i++) {
    int32_t v = tmp[i];
    int8_t j = i - 1;
    while (j >= 0 && tmp[j] > v) { tmp[j + 1] = tmp[j]; j--; }
    tmp[j + 1] = v;
  }
  return tmp[medCount / 2];
}

void markHxOffline(const char *why) {
  bool was;
  LOCK();
  was = g.hxConnected;
  g.hxConnected = false;
  UNLOCK();
  if (was) Serial.printf("HX711 offline: %s\n", why);
  medCount = 0;
  medPos = 0;
  zeroRun = 0;
  resetFlow();
}

// Least-squares slope of fluid grams vs time over the window, in g/s.
float flowSlope() {
  float n = flowCount, st = 0, sw = 0, stt = 0, stw = 0;
  for (uint16_t i = 0; i < flowCount; i++) {
    st += flowT[i];
    sw += flowW[i];
    stt += flowT[i] * flowT[i];
    stw += flowT[i] * flowW[i];
  }
  float den = n * stt - st * st;
  if (den <= 0) return 0;
  return (n * stw - st * sw) / den;
}

void serviceLoadCell() {
  uint32_t now = millis();

  if (!scale.is_ready()) {
    if (now - lastReadyMs > HX_NOT_READY_LIMIT_MS) markHxOffline("no data (DT/SCK?)");
    return;
  }
  // DOUT is low, so read() returns right after the 25 clock pulses.
  int32_t raw = (int32_t)scale.read();
  lastReadyMs = now;

  if (raw == 0) {
    if (++zeroRun >= HX_ZERO_LIMIT) markHxOffline("raw=0 (VCC?)");
    return;
  }
  zeroRun = 0;

  bool connected;
  LOCK();
  connected = g.hxConnected;
  UNLOCK();
  if (!connected) {
    LOCK();
    g.hxConnected = true;
    UNLOCK();
    discardLeft = HX_DISCARD_AFTER_RECONNECT;
    Serial.println("HX711 online.");
  }
  if (discardLeft) {
    discardLeft--;
    return;
  }

  // Tare once, on the first good samples after power-on (hook empty).
  bool tared;
  LOCK();
  tared = g.tared;
  UNLOCK();
  if (!tared) {
    tareSum += raw;
    if (++tareCount >= HX_TARE_SAMPLES) {
      hxOffset = (int32_t)(tareSum / tareCount);
      LOCK();
      g.tared = true;
      UNLOCK();
      Serial.printf("Tare OK, offset=%ld\n", (long)hxOffset);
      resetFlow();
    }
    return;
  }

  medBuf[medPos] = raw;
  medPos = (medPos + 1) % HX_MEDIAN_N;
  if (medCount < HX_MEDIAN_N) medCount++;
  if (medCount < 3) return;

  float gross = (medianRaw() - hxOffset) / HX_COUNTS_PER_GRAM;
  bool present = gross >= NO_BOTTLE_BELOW_G;
  float fluidG = gross - EMPTY_BOTTLE_G;
  float fluidMl = max(0.0f, fluidG / FLUID_DENSITY_G_PER_ML);
  float pct = constrain(fluidMl / BOTTLE_VOLUME_ML * 100.0f, 0.0f, 100.0f);

  // One flow point per second.
  float flow;
  LOCK();
  flow = g.flowMlPerHr;
  UNLOCK();
  if (now - lastFlowSampleMs >= 1000) {
    lastFlowSampleMs = now;
    if (!present || (!isnan(lastFlowGross) && gross - lastFlowGross > BOTTLE_SWAP_JUMP_G)) {
      resetFlow();  // bottle removed or replaced: old slope is meaningless
    }
    lastFlowGross = gross;
    if (present && (int32_t)(now - settleUntilMs) >= 0) {
      flowT[flowPos] = (now - flowT0) / 1000.0f;
      flowW[flowPos] = fluidG;
      flowPos = (flowPos + 1) % FLOW_WINDOW_S;
      if (flowCount < FLOW_WINDOW_S) flowCount++;
    }
    if (flowCount >= FLOW_MIN_POINTS) {
      float slope = flowSlope();  // g/s, negative while draining
      float spanS = (flowCount - 1);
      // Below the drift floor the bottle is, as far as this scale can tell, not draining.
      if (-slope * spanS < FLOW_NOISE_G) {
        flow = 0;
      } else {
        flow = constrain(-slope * 3600.0f / FLUID_DENSITY_G_PER_ML, 0.0f, 1000.0f);
      }
    } else {
      flow = 0;
    }
  }

  LOCK();
  g.grossG = max(0.0f, gross);
  g.bottlePresent = present;
  g.fluidMl = present ? fluidMl : 0;
  g.percent = present ? pct : 0;
  g.bottleEmpty = !present || fluidMl <= EMPTY_AT_ML;
  g.flowMlPerHr = flow;
  UNLOCK();
}

void setupLoadCell() {
  // doReset=false: reset() would call the blocking read() before we know the
  // chip is there. fastProcessor=false matches the tested timing.
  scale.begin(HX711_DT, HX711_SCK, false, false);
  lastReadyMs = millis();
  showBootStatus("HX711", "Taring - keep hook EMPTY", ST77XX_YELLOW);
  uint32_t t0 = millis();
  bool tared = false;
  while (millis() - t0 < 6000 && !tared) {
    serviceLoadCell();
    LOCK();
    tared = g.tared;
    UNLOCK();
    delay(5);
  }
  if (tared) {
    showBootStatus("HX711", "Tare OK - hang bottle", ST77XX_GREEN);
  } else {
    Serial.println("HX711 not ready at boot; will tare when it appears.");
    showBootStatus("HX711", "NOT DETECTED - retrying", ST77XX_RED);
  }
  delay(700);
}

// =====================================================================
// Pulse oximeter (Core 0 task)
// =====================================================================
uint32_t irRing[BUFFER_SIZE], redRing[BUFFER_SIZE];
uint32_t irLin[BUFFER_SIZE], redLin[BUFFER_SIZE];

void clearVitals() {
  LOCK();
  g.finger = false;
  g.hrValid = false;
  g.spo2Valid = false;
  UNLOCK();
}

bool maxStart() {
  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) return false;
  particleSensor.setup(0x1F, 4, 2, 100, 411, 4096);
  return true;
}

void vitalsTask(void *) {
  bool connected = false;
  uint32_t lastRetry = 0, lastIdCheck = 0;
  uint32_t sampleIdx = 0, lastBeatIdx = 0;
  int hrHist[HR_KEEP];
  uint8_t hrCount = 0, hrPos = 0;
  uint32_t lastAcceptedMs = 0, lastSpo2Ms = 0, lastAlgoHrMs = 0;
  uint16_t ringPos = 0, ringCount = 0, sinceSpo2 = 0;
  bool fingerPrev = false, haveBeat = false;
  uint8_t rejectRun = 0;
  int algoHr = 0;

  auto medianOf = [&](uint8_t n) {
    int tmp[HR_KEEP];
    for (uint8_t i = 0; i < n; i++) tmp[i] = hrHist[i];
    for (uint8_t i = 1; i < n; i++) {
      int v = tmp[i];
      int8_t j = i - 1;
      while (j >= 0 && tmp[j] > v) { tmp[j + 1] = tmp[j]; j--; }
      tmp[j + 1] = v;
    }
    return tmp[n / 2];
  };
  auto resetHr = [&]() {
    hrCount = hrPos = 0;
    haveBeat = false;
    rejectRun = 0;
  };

  for (;;) {
    uint32_t now = millis();

    if (!connected) {
      clearVitals();
      if (now - lastRetry >= 2000) {
        lastRetry = now;
        if (maxStart()) {
          connected = true;
          lastIdCheck = now;
          Serial.println("MAX30102 online.");
        }
      }
      LOCK();
      g.maxConnected = connected;
      UNLOCK();
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }

    // An unplugged sensor reads part ID 0 (I2C failure) instead of 0x15.
    if (now - lastIdCheck >= 1000) {
      lastIdCheck = now;
      if (particleSensor.readPartID() != MAX_PART_ID) {
        connected = false;
        fingerPrev = false;
        resetHr();
        ringCount = ringPos = sinceSpo2 = 0;
        LOCK();
        g.maxConnected = false;
        UNLOCK();
        Serial.println("MAX30102 offline.");
        continue;
      }
    }

    particleSensor.check();
    while (particleSensor.available()) {
      uint32_t ir = particleSensor.getFIFOIR();
      uint32_t red = particleSensor.getFIFORed();
      particleSensor.nextSample();
      sampleIdx++;
      bool finger = ir >= FINGER_THRESHOLD;

      if (!finger) {
        if (fingerPrev) {
          resetHr();
          ringCount = ringPos = sinceSpo2 = 0;
          lastAlgoHrMs = 0;
        }
        fingerPrev = false;
        continue;
      }
      fingerPrev = true;

      // Heart rate: beat interval counted in samples. The detector sometimes
      // fires twice per heartbeat (measured: +7..15 bpm over the watch), so
      // once 3 beats are known, an early detection is treated as a second
      // bump inside the same beat and ignored.
      if (checkForBeat((int32_t)ir)) {
        if (!haveBeat) {
          haveBeat = true;  // first beat only starts the clock
          lastBeatIdx = sampleIdx;
        } else {
          uint32_t interval = sampleIdx - lastBeatIdx;
          float bpm = interval ? 60.0f * MAX_SPS / interval : 0;
          int med = hrCount >= 3 ? medianOf(hrCount) : 0;
          if (bpm > 200 || (med && bpm > med * 1.25f)) {
            // Too early: same heartbeat. Keep measuring from the previous beat.
            if (med && ++rejectRun >= 4) resetHr();
          } else if (bpm < 35 || (med && bpm < med * 0.75f)) {
            // Too late: a beat was missed. Restart the interval here.
            lastBeatIdx = sampleIdx;
            if (med && ++rejectRun >= 4) resetHr();
          } else {
            lastBeatIdx = sampleIdx;
            rejectRun = 0;
            hrHist[hrPos] = (int)(bpm + 0.5f);
            hrPos = (hrPos + 1) % HR_KEEP;
            if (hrCount < HR_KEEP) hrCount++;
            lastAcceptedMs = millis();
          }
        }
      }

      // SpO2: rolling 4 s window of the same samples, evaluated every second.
      irRing[ringPos] = ir;
      redRing[ringPos] = red;
      ringPos = (ringPos + 1) % BUFFER_SIZE;
      if (ringCount < BUFFER_SIZE) ringCount++;
      if (ringCount == BUFFER_SIZE && ++sinceSpo2 >= (uint16_t)MAX_SPS) {
        sinceSpo2 = 0;
        for (uint16_t i = 0; i < BUFFER_SIZE; i++) {
          uint16_t k = (ringPos + i) % BUFFER_SIZE;
          irLin[i] = irRing[k];
          redLin[i] = redRing[k];
        }
        int32_t spo2 = 0, aHr = 0;
        int8_t spo2Ok = 0, hrOk = 0;
        maxim_heart_rate_and_oxygen_saturation(irLin, BUFFER_SIZE, redLin, &spo2, &spo2Ok, &aHr, &hrOk);
        if (spo2Ok == 1 && spo2 >= 70 && spo2 <= 100) {
          LOCK();
          g.spo2 = spo2;
          UNLOCK();
          lastSpo2Ms = millis();
        }
        // The algorithm's own HR over the 4 s window: used only until the
        // beat detector has 3 clean beats, so a number shows up in ~5 s.
        if (hrOk == 1 && aHr >= 40 && aHr <= 180) {
          algoHr = aHr;
          lastAlgoHrMs = millis();
        }
      }
    }

    // Publish the vitals snapshot.
    now = millis();
    int hr = 0;
    bool hrOkNow = false;
    if (hrCount >= 3 && now - lastAcceptedMs < HR_STALE_MS) {
      hr = medianOf(hrCount);
      hrOkNow = true;
    } else if (lastAlgoHrMs && now - lastAlgoHrMs < HR_STALE_MS) {
      hr = algoHr;
      hrOkNow = true;
    }
    LOCK();
    g.maxConnected = true;
    g.finger = fingerPrev;
    g.hr = hr;
    g.hrValid = fingerPrev && hrOkNow;
    g.spo2Valid = fingerPrev && lastSpo2Ms && now - lastSpo2Ms < SPO2_STALE_MS;
    UNLOCK();

    // FIFO holds 32 samples (1.3 s at 25 sps); 20 ms between checks is plenty.
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

// =====================================================================
// Firebase (own task, Core 1)
// =====================================================================
uint64_t epochMs() {
  struct timeval tv;
  gettimeofday(&tv, NULL);
  return (uint64_t)tv.tv_sec * 1000ULL + tv.tv_usec / 1000;
}

void netTask(void *) {
  WiFiClientSecure client;
  client.setInsecure();  // no certificate pinning (hackathon build)
  HTTPClient https;
  https.setReuse(true);
  https.setTimeout(5000);
  String url = String(DATABASE_URL) + "/beds/" + BED_ID + ".json?auth=" + DATABASE_SECRET;

  uint32_t lastPush = 0, lastReconnect = 0;
  int lastLoggedCode = 0;

  for (;;) {
    uint32_t now = millis();
    bool wifi = WiFi.status() == WL_CONNECTED;
    bool synced = time(nullptr) > 1700000000;
    LOCK();
    g.wifi = wifi;
    g.timeSynced = synced;
    UNLOCK();

    if (!wifi) {
      if (now - lastReconnect > 10000) {
        lastReconnect = now;
        Serial.println("WiFi down, reconnecting...");
        WiFi.disconnect();
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      }
      vTaskDelay(pdMS_TO_TICKS(250));
      continue;
    }
    if (!synced || now - lastPush < PUSH_INTERVAL_MS) {
      vTaskDelay(pdMS_TO_TICKS(50));
      continue;
    }
    lastPush = now;

    State s;
    LOCK();
    s = g;
    UNLOCK();

    char body[320];
    int len = snprintf(body, sizeof(body),
      "{\"weightGrams\":%.1f,\"flowRateMlPerHr\":%.1f,\"bottlePercentRemaining\":%.1f,"
      "\"bottleEmpty\":%s,\"lastUpdated\":%llu,\"sensorOnline\":%s",
      constrain(s.grossG, 0.0f, 5000.0f), s.flowMlPerHr, s.percent,
      s.bottleEmpty ? "true" : "false", (unsigned long long)epochMs(),
      (s.hxConnected && s.tared) ? "true" : "false");
    if (s.maxConnected && s.hrValid) len += snprintf(body + len, sizeof(body) - len, ",\"heartRate\":%d", s.hr);
    if (s.maxConnected && s.spo2Valid) len += snprintf(body + len, sizeof(body) - len, ",\"spo2\":%d", s.spo2);
    len += snprintf(body + len, sizeof(body) - len, "}");

    int code = -1;
    if (https.begin(client, url)) {
      https.addHeader("Content-Type", "application/json");
      code = https.PUT((uint8_t *)body, len);
      https.end();
    }
    LOCK();
    g.lastHttp = code;
    UNLOCK();

    if (code != lastLoggedCode) {
      lastLoggedCode = code;
      if (code > 0) Serial.printf("Firebase PUT -> HTTP %d\n", code);
      else Serial.printf("Firebase PUT failed: %s\n", https.errorToString(code).c_str());
      if (code == 401) Serial.println("401: DATABASE_SECRET is wrong or missing.");
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

// =====================================================================
// TFT (Core 1, from loop)
// =====================================================================
#define ROW_FLUID_Y 26
#define ROW_FLOW_Y  40
#define ROW_HR_Y    54
#define ROW_SPO2_Y  68
#define BANNER_Y    92
#define BANNER_H    34
#define VALUE_X     52

String shown[4];
String shownBanner;
uint16_t shownBannerColor = 0;

void showBootStatus(const char *title, const String &subtitle, uint16_t color) {
  tft.fillScreen(ST77XX_BLACK);
  tft.setTextSize(2);
  tft.setTextColor(ST77XX_CYAN);
  tft.setCursor(8, 20);
  tft.print(title);
  tft.setTextSize(1);
  tft.setTextColor(color);
  tft.setCursor(8, 50);
  tft.print(subtitle);
}

void setupDisplayLayout() {
  tft.fillScreen(ST77XX_BLACK);
  tft.setTextSize(2);
  tft.setTextColor(ST77XX_CYAN);
  tft.setCursor(4, 2);
  tft.print("DripTrace");
  tft.drawFastHLine(0, 20, 160, ST77XX_WHITE);
  tft.setTextSize(1);
  tft.setTextColor(ST77XX_WHITE);
  tft.setCursor(4, ROW_FLUID_Y); tft.print("Fluid:");
  tft.setCursor(4, ROW_FLOW_Y);  tft.print("Flow:");
  tft.setCursor(4, ROW_HR_Y);    tft.print("HR:");
  tft.setCursor(4, ROW_SPO2_Y);  tft.print("SpO2:");
  tft.drawFastHLine(0, BANNER_Y - 6, 160, ST77XX_WHITE);
  for (auto &s : shown) s = "";
  shownBanner = "";
}

void drawRow(uint8_t i, int y, const String &text, uint16_t color) {
  String key = text + "|" + String(color);
  if (shown[i] == key) return;  // redraw only on change: no flicker
  shown[i] = key;
  tft.fillRect(VALUE_X, y, 160 - VALUE_X, 10, ST77XX_BLACK);
  tft.setTextSize(1);
  tft.setTextColor(color);
  tft.setCursor(VALUE_X, y);
  tft.print(text);
}

void drawBanner(const String &text, uint16_t color) {
  if (text == shownBanner && color == shownBannerColor) return;
  shownBanner = text;
  shownBannerColor = color;
  tft.fillRect(0, BANNER_Y, 160, BANNER_H, color);
  tft.setTextColor(ST77XX_BLACK);
  tft.setTextSize(1);
  int16_t x1, y1;
  uint16_t w, h;
  tft.getTextBounds(text.c_str(), 0, 0, &x1, &y1, &w, &h);
  tft.setCursor((160 - w) / 2, BANNER_Y + (BANNER_H - h) / 2);
  tft.print(text);
}

bool emptyAlarmActive = false, vitalsAlarmActive = false;
uint32_t lastEmptyBeepMs = 0;

void updateDisplayAndAlarms() {
  static uint32_t last = 0;
  if (millis() - last < 150) return;
  last = millis();

  State s;
  LOCK();
  s = g;
  UNLOCK();

  bool hxOk = s.hxConnected && s.tared;

  // Fluid + flow rows
  if (!s.hxConnected) {
    drawRow(0, ROW_FLUID_Y, "Not connected", ST77XX_RED);
    drawRow(1, ROW_FLOW_Y, "--", ST77XX_RED);
  } else if (!s.tared) {
    drawRow(0, ROW_FLUID_Y, "Taring...", ST77XX_YELLOW);
    drawRow(1, ROW_FLOW_Y, "--", ST77XX_YELLOW);
  } else if (!s.bottlePresent) {
    drawRow(0, ROW_FLUID_Y, "No bottle", ST77XX_YELLOW);
    drawRow(1, ROW_FLOW_Y, "--", ST77XX_YELLOW);
  } else {
    char buf[24];
    snprintf(buf, sizeof(buf), "%.0f mL (%.0f%%)", s.fluidMl, s.percent);
    drawRow(0, ROW_FLUID_Y, buf, s.bottleEmpty ? ST77XX_RED : (s.percent < 10 ? ST77XX_ORANGE : ST77XX_WHITE));
    snprintf(buf, sizeof(buf), "%.1f mL/hr", s.flowMlPerHr);
    drawRow(1, ROW_FLOW_Y, buf, ST77XX_WHITE);
  }

  // Vitals rows
  bool hrBad = s.hrValid && (s.hr < HR_LOW || s.hr > HR_HIGH);
  bool spo2Bad = s.spo2Valid && s.spo2 < SPO2_LOW;
  if (!s.maxConnected) {
    drawRow(2, ROW_HR_Y, "Not connected", ST77XX_RED);
    drawRow(3, ROW_SPO2_Y, "Not connected", ST77XX_RED);
  } else if (!s.finger) {
    drawRow(2, ROW_HR_Y, "Place finger", ST77XX_YELLOW);
    drawRow(3, ROW_SPO2_Y, "Place finger", ST77XX_YELLOW);
  } else {
    drawRow(2, ROW_HR_Y, s.hrValid ? String(s.hr) + " bpm" : String("reading..."),
            s.hrValid ? (hrBad ? ST77XX_RED : ST77XX_GREEN) : ST77XX_YELLOW);
    drawRow(3, ROW_SPO2_Y, s.spo2Valid ? String(s.spo2) + " %" : String("reading..."),
            s.spo2Valid ? (spo2Bad ? ST77XX_RED : ST77XX_GREEN) : ST77XX_YELLOW);
  }

  // Alarms: empty bottle repeats while it lasts; vitals beeps once per episode.
  bool emptyNow = hxOk && s.bottlePresent && s.bottleEmpty;
  if (emptyNow && (!emptyAlarmActive || millis() - lastEmptyBeepMs > EMPTY_ALARM_REPEAT_MS)) {
    lastEmptyBeepMs = millis();
    playAlertEmptyBottle();
  }
  emptyAlarmActive = emptyNow;

  bool vitalsNow = hrBad || spo2Bad;
  if (vitalsNow && !vitalsAlarmActive && !emptyNow) playAlertVitals();
  vitalsAlarmActive = vitalsNow;

  // Banner: most important first.
  if (!s.hxConnected) drawBanner("LOAD CELL OFFLINE", ST77XX_RED);
  else if (!s.tared) drawBanner("TARING - HOOK EMPTY", ST77XX_YELLOW);
  else if (!s.bottlePresent) drawBanner("HANG IV BOTTLE", ST77XX_YELLOW);
  else if (s.bottleEmpty) drawBanner("BOTTLE EMPTY", ST77XX_RED);
  else if (vitalsNow) drawBanner("VITALS ALERT", ST77XX_RED);
  else if (s.percent < 10) drawBanner("LOW VOLUME", ST77XX_ORANGE);
  else if (!s.maxConnected) drawBanner("PULSE-OX OFFLINE", ST77XX_ORANGE);
  else if (!s.wifi) drawBanner("OK - NO WIFI", ST77XX_ORANGE);
  else drawBanner("STATUS: OK", ST77XX_GREEN);
}

// =====================================================================
// Setup / loop
// =====================================================================
void setupWiFiAndTime() {
  showBootStatus("WiFi", String("Connecting to ") + WIFI_SSID + "...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) delay(250);
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("WiFi connected, IP %s, RSSI %d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    showBootStatus("WiFi", "Connected", ST77XX_GREEN);
  } else {
    Serial.println("WiFi not connected; will keep retrying. Bedside unit works offline.");
    showBootStatus("WiFi", "Not connected - retrying", ST77XX_RED);
  }
  // UTC epoch for lastUpdated. SNTP keeps retrying in the background.
  configTime(0, 0, "pool.ntp.org", "time.google.com", "time.nist.gov");
  if (WiFi.status() == WL_CONNECTED) {
    showBootStatus("Time sync", "Syncing via NTP...");
    t0 = millis();
    while (time(nullptr) < 1700000000 && millis() - t0 < 8000) delay(200);
    Serial.println(time(nullptr) >= 1700000000 ? "Time synced." : "NTP not synced yet; pushes wait for it.");
  }
  delay(300);
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\nDripTrace firmware v2 starting");
  if (strcmp(DATABASE_SECRET, "PASTE_DATABASE_SECRET_HERE") == 0) {
    Serial.println("WARNING: DATABASE_SECRET not set - every push will fail with 401.");
  }

  stateMutex = xSemaphoreCreateMutex();

  SPI.begin(TFT_SCLK, -1, TFT_MOSI, TFT_CS);
  tft.initR(INITR_BLACKTAB);
  tft.setRotation(3);
  showBootStatus("DripTrace", "Starting up...");

  Wire.begin(I2C_SDA, I2C_SCL);
  setupSpeaker();
  setupLoadCell();
  setupWiFiAndTime();

  setupDisplayLayout();
  xTaskCreatePinnedToCore(vitalsTask, "vitals", 8192, NULL, 1, NULL, 0);
  xTaskCreatePinnedToCore(netTask, "net", 8192, NULL, 1, NULL, 1);
  Serial.println("DripTrace v2 up.");
}

void loop() {
  serviceLoadCell();
  updateDisplayAndAlarms();

  static uint32_t lastStat = 0;
  if (millis() - lastStat >= 5000) {
    lastStat = millis();
    State s;
    LOCK();
    s = g;
    UNLOCK();
    Serial.printf("STAT hx=%d tared=%d bottle=%d gross=%.1fg fluid=%.1fmL pct=%.0f empty=%d flow=%.1f | max=%d finger=%d hr=%d(%d) spo2=%d(%d) | wifi=%d time=%d http=%d\n",
                  s.hxConnected, s.tared, s.bottlePresent, s.grossG, s.fluidMl, s.percent, s.bottleEmpty,
                  s.flowMlPerHr, s.maxConnected, s.finger, s.hr, s.hrValid, s.spo2, s.spo2Valid, s.wifi,
                  s.timeSynced, s.lastHttp);
  }
  delay(5);
}
