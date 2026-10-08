# DripTrace hardware + website facts

Measured 2026-10-08 on the real board. Plain facts, no recommendations.
Raw logs: `tools/diag/logs/*.txt` (git-ignored). Diagnostic sketch: `tools/diag/driptrace_diag/driptrace_diag.ino`.
The database secret is deliberately not reproduced anywhere in this file.

---

## 0. Answers from Hrishi (verbatim)

| # | Question | Answer |
|---|---|---|
| 1 | Known mass for calibration | "i will use the IV bottle 100ml" |
| 2 | Hook permanent? Boot with bottle hanging? | "Hook fixed; always boots empty" |
| 3 | Empty 100 mL bottle available? | "yes i have 1 full and 1 empty of the same kind" |
| 4 | Load cell rating + wire colours | "10 kg load cell. Load cell -> HX711: Red = E+, Black = E-, White = A+, Green = A- (B+/B- unused). Shield/bare wire (if any) -> GND. HX711 -> ESP32-S3: VCC = 3V3, GND = GND, DT = GPIO40, SCK = GPIO41. If you actually wired green to A+ instead, readings will just come out with the opposite sign, and the calibration step accounts for that." |
| 5 | Tare button on spare GPIO? | "None; won't add" |
| 6 | Reference HR device | "Smartwatch" (model not given). Readings: test a "69", test b "67 bpm", test c "73", test o "63bpm 98%spo2" |
| 7 | Power (demo / this test) | "Laptop USB (both)" |
| 8 | Android app path | "lets do website for now app will take time , i will send the app files later then you do the corrections on it" |

Also said during the HR block: "these tests for heart rate sensors are enough" — tests `x` and `p` were therefore not run.

---

## 1. Toolchain and libraries

| Item | Value |
|---|---|
| arduino-cli on PATH | not installed |
| arduino-cli bundled with IDE | 1.5.1 (commit 01f3d4f2b, 2026-06-05) at `C:\Users\G M HRISHI\AppData\Local\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe` |
| Arduino IDE | 2.3.10.0 at `C:\Users\G M HRISHI\AppData\Local\Programs\Arduino IDE\` |
| IDE CLI config | `C:\Users\G M HRISHI\.arduinoIDE\arduino-cli.yaml` → user dir `c:\Users\G M HRISHI\Documents\Arduino`, data `c:\Users\G M HRISHI\AppData\Local\Arduino15` |
| ESP32 Arduino core | **3.3.12** (`%LOCALAPPDATA%\Arduino15\packages\esp32\hardware\esp32\3.3.12`), ESP-IDF v5.5.5 |
| Active sketchbook libraries | `C:\Users\G M HRISHI\Documents\Arduino\libraries` |
| HX711 | **Rob Tillaart HX711 0.6.5** (`https://github.com/RobTillaart/HX711`) — **not bogde**. Production's header comment says "HX711 by bogde"; the installed library is Rob Tillaart's. |
| SparkFun MAX3010x | 1.1.2 |
| Adafruit ST7735 and ST7789 | 1.11.0 |
| Adafruit GFX | 1.12.6 (Adafruit BusIO 1.17.4) |
| Also in active folder | TFT_eSPI 2.5.43, ArduinoJson 7.4.3, Firebase Arduino Client 4.4.17 (none used by DripTrace) |
| Second (inactive) library folder | `C:\Users\G M HRISHI\OneDrive\Documents\Arduino\libraries` — HX711 (Rob Tillaart) **0.6.3**, **Adafruit HX711 1.0.2**, Adafruit GFX 1.12.6; no MAX3010x, no ST7735 |
| Duplicate trap | The bundled arduino-cli **without** `--config-file` resolves the OneDrive folder (HX711 0.6.3; `MAX30105.h` missing → compile fails). With `--config-file C:\Users\G M HRISHI\.arduinoIDE\arduino-cli.yaml` it resolves `Documents\Arduino` (HX711 0.6.5, SparkFun 1.1.2) — same as the IDE. |
| FQBN (compiles + uploads) | `esp32:esp32:esp32s3:PSRAM=opi,FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,CDCOnBoot=default,UploadMode=default` — core 3.3.12 has no `default_16MB`; `CDCOnBoot=default` = Disabled; `USBMode` default = hwcdc |
| Production firmware | `C:\Users\G M HRISHI\Downloads\driptrace_esp32s3_firmware_final\driptrace_esp32s3_firmware_final.ino`, 36,165 bytes, modified 2026-10-08 18:18:42 +0530. Contains the RTDB secret in plain text (line 154). |
| Python | 3.11.1; **pyserial not installed**. Serial driven with .NET `System.IO.Ports.SerialPort` (DTR=false, RTS=false). |
| Serial ports | `USB-Enhanced-SERIAL CH343 (COM3)` — `USB\VID_1A86&PID_55D3&REV_0445` (only port present) |
| Firebase CLI | 15.20.0, logged in as the project owner; projects visible: air-write, driptrace-hackathon, vitalflow-86eab. Rules and hosting can be deployed from this PC. |

### HX711 (Rob Tillaart 0.6.5) — exact bodies

Header defaults: `begin(dataPin, clockPin, bool fastProcessor = false, bool doReset = true)`, `wait_ready(ms = 0)`, `wait_ready_retry(retries = 3, ms = 0)`, `wait_ready_timeout(timeout = 1000, ms = 0)`, `read_average(times = 10)`, `get_units(times = 1)`, `tare(times = 10)`. Constructor sets `_offset=0, _scale=1, _gain=128, _mode=AVERAGE, _fastProcessor=false`.

```cpp
void HX711::begin(uint8_t dataPin, uint8_t clockPin, bool fastProcessor, bool doReset)
{
  _dataPin  = dataPin;
  _clockPin = clockPin;
  _fastProcessor = fastProcessor;

  pinMode(_dataPin, INPUT_PULLUP);
  pinMode(_clockPin, OUTPUT);
  digitalWrite(_clockPin, LOW);

  if (doReset)
  {
    reset();
  }
}

void HX711::reset()
{
  power_down();
  power_up();
  _offset   = 0;
  _scale    = 1;
  _gain     = HX711_CHANNEL_A_GAIN_128;
  _lastTimeRead = 0;
  _mode     = HX711_AVERAGE_MODE;
  _price    = 0;
  read();  //  force settings.
}

bool HX711::is_ready()
{
  return digitalRead(_dataPin) == LOW;
}

void HX711::wait_ready(uint32_t ms)
{
  while (!is_ready())
  {
    delay(ms);
  }
}

bool HX711::wait_ready_retry(uint8_t retries, uint32_t ms)
{
  while (retries--)
  {
    if (is_ready()) return true;
    delay(ms);
  }
  return false;
}

bool HX711::wait_ready_timeout(uint32_t timeout, uint32_t ms)
{
  uint32_t start = millis();
  while (millis() - start < timeout)
  {
    if (is_ready()) return true;
    delay(ms);
  }
  return false;
}

float HX711::read()
{
  //  this BLOCKING wait takes most time...
  while (digitalRead(_dataPin) == HIGH)
  {
    yield();
  }

  union
  {
    int32_t value = 0;
    uint8_t data[4];
  } v;

  //  blocking part ...
  noInterrupts();

  v.data[2] = _shiftIn();
  v.data[1] = _shiftIn();
  v.data[0] = _shiftIn();

  uint8_t m = 1;
  if      (_gain == HX711_CHANNEL_A_GAIN_128) m = 1;
  else if (_gain == HX711_CHANNEL_A_GAIN_64)  m = 3;
  else if (_gain == HX711_CHANNEL_B_GAIN_32)  m = 2;

  while (m > 0)
  {
    digitalWrite(_clockPin, HIGH);
    if (_fastProcessor) delayMicroseconds(1);
    digitalWrite(_clockPin, LOW);
    if (_fastProcessor) delayMicroseconds(1);
    m--;
  }

  interrupts();

  //  SIGN extend
  if (v.data[2] & 0x80) v.data[3] = 0xFF;

  _lastTimeRead = millis();
  return 1.0 * v.value;
}

float HX711::read_average(uint8_t times)
{
  if (times < 1) times = 1;
  float sum = 0;
  for (uint8_t i = 0; i < times; i++)
  {
    sum += read();
    yield();
  }
  return sum / times;
}

float HX711::get_value(uint8_t times)
{
  float raw;
  switch(_mode)
  {
    case HX711_RAW_MODE:    raw = read(); break;
    case HX711_RUNAVG_MODE: raw = read_runavg(times); break;
    case HX711_MEDAVG_MODE: raw = read_medavg(times); break;
    case HX711_MEDIAN_MODE: raw = read_median(times); break;
    case HX711_AVERAGE_MODE:
    default:                raw = read_average(times); break;
  }
  return raw - _offset;
}

float HX711::get_units(uint8_t times)
{
  float units = get_value(times) * _scale;
  return units;
}

void HX711::tare(uint8_t times)
{
  _offset = read_average(times);
}

bool HX711::set_scale(float scale)
{
  if (scale == 0) return false;
  _scale = 1.0 / scale;
  return true;
}

void HX711::calibrate_scale(float weight, uint8_t times)
{
  _scale = weight / (read_average(times) - _offset);
}
```

Facts from these bodies: DOUT gets `INPUT_PULLUP`; `read()` spins with `yield()` while DOUT is HIGH, with no timeout; `wait_ready_timeout()` exists; `get_units() = (read_average(times) − offset) × (1/scale)`; `tare()` defaults to 10 reads; `begin()` with the default `doReset=true` calls the blocking `read()` inside `begin()`.

### SparkFun MAX3010x 1.1.2 — constants and bodies

- `heartRate.cpp`: no comment or constant states an expected sample rate. Comments: "Given a series of IR samples from the MAX30105 we discern when a heart beat is occurring", "A running average of four samples is recommended for display on the screen." Internal: `IR_AC_Max = 20`; beat accepted when `(IR_AC_Max - IR_AC_Min) > 20 & < 1000`.
- `spo2_algorithm.h`: `#define FreqS 25`, `#define BUFFER_SIZE (FreqS * 4)` (= 100), `#define MA4_SIZE 4`.
- `MAX30105.h`: `STORAGE_SIZE 4` (4-sample ring buffer on ESP32); `I2C_BUFFER_LENGTH` from Wire.

```cpp
boolean MAX30105::begin(TwoWire &wirePort, uint32_t i2cSpeed, uint8_t i2caddr) {
  _i2cPort = &wirePort;
  _i2cPort->begin();
  _i2cPort->setClock(i2cSpeed);
  _i2caddr = i2caddr;
  // Step 1: Initial Communication and Verification
  if (readPartID() != MAX_30105_EXPECTEDPARTID) {
    return false;
  }
  readRevisionID();
  return true;
}

uint8_t MAX30105::readPartID() {
  return readRegister8(_i2caddr, MAX30105_PARTID);
}

uint8_t MAX30105::readRegister8(uint8_t address, uint8_t reg) {
  _i2cPort->beginTransmission(address);
  _i2cPort->write(reg);
  _i2cPort->endTransmission(false);
  _i2cPort->requestFrom((uint8_t)address, (uint8_t)1);
  if (_i2cPort->available())
  {
    return(_i2cPort->read());
  }
  return (0); //Fail
}

uint32_t MAX30105::getIR(void)
{
  //Check the sensor for new data for 250ms
  if(safeCheck(250))
    return (sense.IR[sense.head]);
  else
    return(0); //Sensor failed to find new data
}

uint32_t MAX30105::getRed(void)
{
  //Check the sensor for new data for 250ms
  if(safeCheck(250))
    return (sense.red[sense.head]);
  else
    return(0);
}

uint16_t MAX30105::check(void)
{
  byte readPointer = getReadPointer();
  byte writePointer = getWritePointer();
  int numberOfSamples = 0;
  if (readPointer != writePointer)
  {
    numberOfSamples = writePointer - readPointer;
    if (numberOfSamples < 0) numberOfSamples += 32; //Wrap condition
    int bytesLeftToRead = numberOfSamples * activeLEDs * 3;
    _i2cPort->beginTransmission(MAX30105_ADDRESS);
    _i2cPort->write(MAX30105_FIFODATA);
    _i2cPort->endTransmission();
    while (bytesLeftToRead > 0)
    {
      int toGet = bytesLeftToRead;
      if (toGet > I2C_BUFFER_LENGTH)
      {
        toGet = I2C_BUFFER_LENGTH - (I2C_BUFFER_LENGTH % (activeLEDs * 3));
      }
      bytesLeftToRead -= toGet;
      _i2cPort->requestFrom(MAX30105_ADDRESS, toGet);
      while (toGet > 0)
      {
        sense.head++;
        sense.head %= STORAGE_SIZE;
        // 3 bytes RED -> sense.red[head] (&= 0x3FFFF)
        // if activeLEDs > 1: 3 bytes IR -> sense.IR[head]
        // if activeLEDs > 2: 3 bytes GREEN -> sense.green[head]
        toGet -= activeLEDs * 3;
      }
    }
  }
  return (numberOfSamples);
}

bool MAX30105::safeCheck(uint8_t maxTimeToCheck)
{
  uint32_t markTime = millis();
  while(1)
  {
    if(millis() - markTime > maxTimeToCheck) return(false);
    if(check() == true) //We found new data!
      return(true);
    delay(1);
  }
}
```

Facts from these bodies: `getIR()`/`getRed()` each wait up to 250 ms for new FIFO data and return the newest sample (`sense.head`), not the FIFO tail; `check() == true` is only true when exactly 1 new sample was read; on I2C failure `readRegister8` returns 0, and `getIR()` returns 0 after 250 ms.

---

## 2. Production firmware — code facts (read, not edited)

- `sensorOnline` is written as `v.fingerPresent` (line 842): `false` whenever no finger is on the MAX30102, independent of sensor health.
- `scale.begin(HX711_DT, HX711_SCK)` → `fastProcessor=false`, `doReset=true` (reset() calls a blocking `read()` inside `begin()`).
- `scale.set_scale(287836.24f)`; `tare()` (10 reads) at boot when ready; `get_units(3)` every 200 ms → value = (raw − offset) / 287836.24, labelled grams.
- `bottleEmptyAlertActive = (g_weightG <= 5.0)`; `bottlePercent = g_weightG / 100 × 100`, clamped 0–100.
- `updateWeight()`: a single `is_ready() == false` sets `hx711Connected=false` and prints "HX711 went offline (was ready, now isn't)"; reconnect retried every 2 s.
- `lastUpdated = time(nullptr) × 1000` (1 s resolution).
- `FIREBASE_PUSH_INTERVAL_MS = 1000`; each push creates a new `WiFiClientSecure` (setInsecure) + `HTTPClient`.
- Core-0 `vitalsTask`: `getIR()` in a loop with no delay while a finger is present; `runSpo2Burst()` every 10 s calls `getRed()` then `getIR()` per buffer slot (each waits for a new sample), 100 slots.
- No `history/`, `dropsPerMin` or `severity` writes.

### Current-firmware serial captures

**Capture A** (`current_fw_running.txt`, 60 s, no reset; the board had just been plugged in):
`rst:0x1 (POWERON),boot:0x8 (SPI_FAST_FLASH_BOOT)`, `mode:DIO, clock div:1`, `Connecting to WiFi...........`, `WiFi connected, IP: 10.199.21.118`, `Syncing time.........`, `Time synced.`, `DripTrace final firmware up.`, then `Firebase PUT -> HTTP 200` × 42. No `task_wdt`, `Guru Meditation`, `Brownout`, HTTP errors, or HX711/MAX30102 "NOT detected" lines.

**Capture B** (`current_fw_boot.txt`, 60 s, RTS reset pulse, DTR low; finger placed in the second half):
`rst:0x1 (POWERON)` (how an EN-pin reset reports on this board), same boot lines (`Syncing time................`), `Firebase PUT -> HTTP 200` × 43, and 4 cycles of
`HX711 went offline (was ready, now isn't) — showing Not connected and retrying.` / `HX711 reconnected.` with nothing touched. No `task_wdt`, `Guru Meditation`, `Brownout`. Production does not log HR/SpO2 to serial.

Push cadence: 42–43 PUTs per ~50 s after boot ≈ 1 per 1.2 s.

---

## 3. RTDB snapshot (anonymous auth, read at now_ms = 1791465014000)

```json
beds/bed-01: {"bottleEmpty":true,"bottlePercentRemaining":0.0,"flowRateMlPerHr":0.01,"lastUpdated":1791464138000,"sensorOnline":false,"weightGrams":-1.16}
history/bed-01 (shallow): null
history (shallow): null
beds (shallow): {"bed-01":true}
```
`lastUpdated` was 876 s old (board unplugged at the time). Earlier in the session the same node held `weightGrams` −83968.66 and −1.0 and `flowRateMlPerHr` 618.93 / 359.29, all with `sensorOnline:false`, `bottleEmpty:true`.

---

## 5. Diagnostic results

Board (`i`): ESP32-S3 rev 2, 2 cores, 240 MHz, flash 16,777,216 B @ 80 MHz, PSRAM 8,388,608 B, free heap 307,128 B, core 3.3.12, IDF v5.5.5. I2C scan on SDA 38 / SCL 39: `0x57` only. At diag boot: `hx711_ready_at_boot=0` (single instantaneous check), `max30102_begin=1`.

### All RESULT lines (verbatim)

```
[i_1] RESULT i chip=ESP32-S3 rev=2 cpu=240 flash=16777216 psram=8388608 heap=307128 reset=POWERON core=3.3.12 i2c_devices=1
[z_1] RESULT z n=109 mean=-68408.1 stddev=336.6 min=-69013 max=-67693 timeouts=0 suspicious=0 max_wait_ms=94 sps=10.9
[k_1] RESULT k n=110 mean=-96337.9 stddev=201.6 min=-96785 max=-95913 timeouts=0 suspicious=0 max_wait_ms=94 sps=11.0
[z_2] RESULT z n=109 mean=-69510.4 stddev=161.7 min=-69857 max=-69173 timeouts=0 suspicious=0 max_wait_ms=94 sps=10.9
[f_1] RESULT f n=109 mean=-99312.7 stddev=135.0 min=-99583 max=-99068 timeouts=0 suspicious=0 max_wait_ms=94 sps=10.9
[e_1] RESULT e n=109 mean=-73599.9 stddev=261.4 min=-74041 max=-73085 timeouts=0 suspicious=0 max_wait_ms=94 sps=10.9
[w_1] RESULT w n=645 first10_mean=-97171.0 last10_mean=-95560.3 drift=1610.7 overall_mean=-96826.2 overall_stddev=788.0 timeouts=0
[d_1_DT] RESULT d phase=0-10s slots=100 not_ready=21 ok=79 mean=-104073.0 stddev=263.3 min=-104540 max=-103588 suspicious=0 max_wait_ms=90
[d_1_DT] RESULT d phase=10-20s slots=100 not_ready=92 ok=8 mean=-102681.8 stddev=109.9 min=-102798 max=-102521 suspicious=0 max_wait_ms=90
[d_1_DT] RESULT d phase=20-30s slots=100 not_ready=0 ok=100 mean=-102994.3 stddev=180.1 min=-103349 max=-102690 suspicious=0 max_wait_ms=0
[d_1_DT] RESULT d settled=1 samples_to_settle_after_20s=1
[d_2_SCK] RESULT d phase=0-10s slots=100 not_ready=12 ok=88 mean=-98933.8 stddev=144.1 min=-99198 max=-98592 suspicious=0 max_wait_ms=90
[d_2_SCK] RESULT d phase=10-20s slots=100 not_ready=100 ok=0 mean=0.0 stddev=0.0 min=0 max=0 suspicious=0 max_wait_ms=90
[d_2_SCK] RESULT d phase=20-30s slots=100 not_ready=0 ok=100 mean=-98943.2 stddev=135.8 min=-99230 max=-98583 suspicious=0 max_wait_ms=73
[d_2_SCK] RESULT d settled=1 samples_to_settle_after_20s=1
[d_3_VCC] RESULT d phase=0-10s slots=100 not_ready=0 ok=100 mean=-94734.1 stddev=16745.3 min=-97998 max=0 suspicious=3 max_wait_ms=0
[d_3_VCC] RESULT d phase=10-20s slots=100 not_ready=3 ok=97 mean=-4055.7 stddev=19657.5 min=-98407 max=0 suspicious=93 max_wait_ms=90
[d_3_VCC] RESULT d phase=20-30s slots=100 not_ready=0 ok=100 mean=-98922.9 stddev=865.9 min=-102514 max=-97036 suspicious=0 max_wait_ms=25
[d_3_VCC] RESULT d settled=1 samples_to_settle_after_20s=1
[a_1] RESULT a sps_measured=25.1 samples=753 finger_samples=741 beats=20 accepted=13 avg_bpm=77.9 bpm_sd=15.9 rejected=7 final_avg4=84 first_avg4_s=12.2
[b_1] RESULT b sps_measured=50.1 samples=1504 finger_samples=1448 beats=25 accepted=21 avg_bpm=74.9 bpm_sd=12.0 rejected=4 final_avg4=71 first_avg4_s=14.3
[c_1] RESULT c sps_measured=100.4 samples=3012 finger_samples=3012 beats=36 accepted=32 avg_bpm=79.5 bpm_sd=18.3 rejected=4 final_avg4=97 first_avg4_s=3.4
[o_1] RESULT o loop_iters_per_s=25.1 distinct_ir_per_s=24.8 getIR_zero=0 max_getIR_ms=40 beats=12 accepted=6 avg_bpm=78.2 bpm_sd=8.9 rejected=6 final_avg4=74 first_avg4_s=7.3
[s_1] RESULT s n=100 mean=-97035.0 stddev_tone=318.6 stddev_silent_z=161.7 ratio=1.97 timeouts=0
[n_1] RESULT n connected=1 rssi=-48 channel=6 ip=10.199.21.118 connect_ms=1703
```
Not run (stopped by user): `x` (HR + SpO2 burst), `p` (MAX30102 disconnect).

### HX711 calibration arithmetic

Load makes raw **more negative** (sign is negative).

Known mass = fluid in the 100 mL bottle = 100 mL × 1.005 g/mL = **100.5 g** (assumes nominal fill; not independently weighed).

- counts/g from `f` − `e`: (−99312.7 − (−73599.9)) / 100.5 = −25712.8 / 100.5 = **−255.85 counts/g**
- counts/g from `k` − `e`: (−96337.9 − (−73599.9)) / 100.5 = −22738.0 / 100.5 = **−226.25 counts/g**
- difference between the two full-bottle loadings `k` and `f`: −96337.9 − (−99312.7) = 2974.8 counts

Gross readings (relative to the nearest preceding zero), at −255.85 counts/g:
- empty bottle: `e` − `z#2` = −73599.9 − (−69510.4) = −4089.5 counts → **15.98 g** (18.08 g at −226.25)
- full bottle: `f` − `z#2` = −29802.3 counts → **116.48 g**; `k` − `z#1` = −27929.8 → **109.16 g**; `k` − `z#2` = −26827.5 → 104.86 g
- empty-bottle cross-check: 116.48 − 100.5 = 15.98 g (identical by construction)

Noise (stddev ÷ 255.85): `z#1` 336.6 → **1.32 g**; `z#2` 161.7 → **0.63 g**; `f` 135.0 → 0.53 g; `k` 201.6 → 0.79 g; `e` 261.4 → 1.02 g.

Zero repeatability: `z#2` − `z#1` = −69510.4 − (−68408.1) = −1102.3 counts → **4.31 g**.

Drift (`w`, full bottle, 60 s): last10 − first10 = −95560.3 − (−97171.0) = +1610.7 counts → **6.30 g lighter**. Per-second means were not monotonic: −97320.5 (s0) → −98067.6 (s18, minimum) → −95265.4 (s58, maximum); peak-to-peak 2802.2 counts → **10.95 g**. Per-second stddev 40–150 counts.

HX711 output rate: **10.9 sps** (109–110 samples per 10 s; `wait_ms` ≈ 93 between samples).

Production factor comparison: 287836.24 counts per unit = 287.84 counts/g if the unit is kg; measured |−255.85| counts/g; ratio 287.84 / 255.85 = 1.125. Production's factor is positive, the measured sign is negative. With production's math a 116.48 g full bottle = 29802 counts → 29802 / 287836.24 = 0.1035, reported as "g", negative after tare because raw decreases with load.

Speaker (`s`, full bottle, continuous 1 kHz square at amplitude 1800): stddev 318.6 counts (1.25 g) vs 161.7 (`z#2`, ratio 1.97) and 135.0 (`f`, ratio 2.36). The 10 s window includes the slow wander seen in `w`. I2S install/set_pin returned 0/0; no reset, no brownout, uptime counter continuous.

### HX711 disconnect behaviour (`d`, 10 Hz slots, ≤ 90 ms ready-wait per slot)

| Wire pulled | `is_ready()` while unplugged | Raw while unplugged | Blocking | After replug |
|---|---|---|---|---|
| DT (GPIO40) | false every slot (DOUT held HIGH by INPUT_PULLUP), 7.9 s → 19.2 s | none (every slot timed out) | each slot waited the full 90 ms; library `read()` would spin forever | first slot after replug valid (−102521); settled after 1 sample |
| SCK (GPIO41) | false every slot, 8.8 s → 20.0 s | none (100/100 timed out in the 10–20 s phase) | full 90 ms per slot; library `read()` would spin forever | valid immediately (−98610); settled after 1 sample |
| VCC (3V3) | **true** every slot from 9.7 s (instant, call 47 µs) | **exactly 0** on 96 of 96 data samples | none | 19.3–19.5 s: 3 timeouts (~300 ms), then valid (−98304) with wait shrinking 52 → 5 ms; settled after 1 sample |

Nothing in any `d` run blocked longer than the 90 ms slot timeout (the sketch never calls `read()` without `is_ready()` first).

### MAX30102 HR (`a b c o`, 30 s each, finger on, smartwatch reference)

| Test | Config / method | Measured sps | Watch | mean accepted bpm (sd) | final 4-beat avg | first 4-beat avg at | beats / rejected |
|---|---|---|---|---|---|---|---|
| a | `(0x1F,4,2,100,411,4096)` per-sample | 25.1 | 69 | 77.9 (15.9) | 84 | 12.2 s | 20 / 7 |
| b | `(0x1F,4,3,400,411,4096)` per-sample | **50.1** (nominal 100) | 67 | 74.9 (12.0) | 71 | 14.3 s | 25 / 4 |
| c | `(0x1F,1,2,100,411,4096)` per-sample | 100.4 | 73 | 79.5 (18.3) | 97 | 3.4 s | 36 / 4 |
| o | config A, production polled `getIR()` loop | 25.1 loop iter/s, 24.8 distinct IR/s | 63 (SpO2 98 %) | 78.2 (8.9) | 74 | 7.3 s | 12 / 6 |

- Closest final 4-beat average to the watch: **b** (71 vs 67, +4). Closest mean of accepted beats: **c** (79.5 vs 73, +6.5). Every run's mean over-read the watch (+6.5 to +15.2 bpm).
- `o`: the polled loop does **not** feed duplicate samples — `getIR()` blocks until a new sample arrives (max call 40 ms), so loop rate = sample rate (25.1/s, 24.8 distinct values/s). `getIR()` returned 0 zero times with the sensor connected.
- `b`: the `bpm_samples` column in its log uses the nominal 100 sps and reads 2× high; `bpm_ms` is correct. Finger IR ≈ 108,000–114,000 in all runs.
- `checkForBeat()` keeps static filter state across tests (the library has no reset function).

SpO2 burst timing (`x`) was not measured. From code only: production's burst consumes 2 new samples per slot (`getRed()` then `getIR()`, each `safeCheck`) → 200 samples ≈ 8 s at 25 sps; red and IR in each slot come from different samples.

### WiFi (`n`)
RMK joined in 1703 ms, RSSI −48 dBm, channel 6, IP 10.199.21.118.

---

## 6. Website exception audit (read-only)

Paths are under `src/`. "Card" = `components/BedCard.jsx`, "Detail" = `pages/BedDetail.jsx`. `lib/telemetry.jsx:166-171` copies each device node as-is (no validation, no coercion); `:193-200` spreads it into the bed and then overwrites `severity`.

| Field | missing / `null` | negative | NaN / string | above rule max | frozen value, fresh `lastUpdated` |
|---|---|---|---|---|---|
| `weightGrams` | Detail KPI "—" (`BedDetail.jsx:280`; `Kpi` uses `Number.isFinite`, `:55`). Not shown on Card. Not used by alarms. | shown as-is, e.g. "−1.2 g" (`BedDetail.jsx:280`) | "—" | shown as-is | shown as live |
| `flowRateMlPerHr` | Card renders `<NumberFlow value={undefined}>` (`BedCard.jsx:91`); severity uses 0 → **critical "Flow stopped"** (`severity.js:48,62`); Detail KPI "—"; trend chart `Math.max` over `undefined` → `yMax` NaN (`FlowTrendChart.jsx:73-74`) | Card shows the negative number; severity ≤ 1 → critical "Flow stopped" (`severity.js:62`) | numeric strings coerce in comparisons; non-numeric: neither stopped nor flowing → no flow alert; Card `NumberFlow` gets a string; Detail "—" | shown as-is; deviation alert vs Rx (`severity.js:73`) | shown as live |
| `bottlePercentRemaining` | severity uses 0 → **critical "Bottle empty"** (`severity.js:47,58`); Card text "NaN% left" (`BedCard.jsx:111`); IVBottle fill 0 (`IVBottle.jsx:60`) | critical "Bottle empty"; Card "−5% left"; IVBottle clamps to 0 (`IVBottle.jsx:60`); Detail `remainingMl` negative → "Empty in" `formatDuration` returns "—" (`BedDetail.jsx:182,185`) | IVBottle non-finite → 0; Card "NaN% left" | Card "120% left"; IVBottle clamps to 1; no low-volume alert | shown as live |
| `bottleEmpty` | falls through to the percent check (`severity.js:58`) | n/a | any truthy value, including the string `"false"` → critical "Bottle empty" (`severity.js:58`) | n/a | n/a |
| `heartRate` | Card "HR — bpm", Detail "—" (`config/vitals.js:41`, `Number.isFinite`) | shown as-is (no range check) | "—" | shown as-is | shown as live |
| `spo2` | same as heartRate (`config/vitals.js:51`) | shown as-is | "—" | shown as-is | shown as live |
| `sensorOnline` | treated as online if `lastUpdated` is fresh (`severity.js:121` only checks `=== false`) | n/a | string `"false"` → online | n/a | `false` → whole-bed channel "offline"; Card "Sensor offline. Readings below are stale." (`BedCard.jsx:38-39`); clinical alarms are replaced by the offline channel (`severity.js:135`) |
| `lastUpdated` | falsy → offline (`severity.js:120`) | n/a | non-numeric → `now − "x"` = NaN → offline | **future**: `now − lastUpdated` negative ≤ 15000 → online indefinitely; `formatAgo` clamps to "just now" (`components/ui.jsx:119`). **Far past**: > 15 s → offline (`SENSOR_STALE_AFTER_MS = 15_000`, `lib/constants.js:50`) | same value twice → no new trend point (`telemetry.jsx:80`); 15 s without change → offline |
| `dropsPerMin` | IVBottle `?? 0` → no drip animation, aria "no flow" (`BedCard.jsx:81`, `BedDetail.jsx:243`, `IVBottle.jsx:70,78`); Detail KPI "—" (`BedDetail.jsx:279`) | `> 0` checks → no flow | IVBottle `> 0` false → no flow; KPI "—" | drop interval clamped to ≥ 0.28 s (`IVBottle.jsx:70`) | n/a |
| `severity` | ignored for registered beds: `telemetry.jsx:200` sets `bed.severity` from derived alerts after spreading the reading, and `resolveChannel` reads `bed.severity` (`severity.js:136`) | n/a | n/a | n/a | n/a |

Other facts:
- Per-sensor health: **none**. Only whole-bed `sensorOnline` + 15 s staleness (`severity.js:116-123`). `lib/constants.js:10-34` `PIN_MAP` lists per-sensor `feeds`, but nothing reads it for health.
- HR/SpO2 absent (no finger) and pulse-ox dead render identically ("—"). The dashboard raises no HR/SpO2 alarms (`config/vitals.js` header).
- `history/<bedId>`: `HISTORY_PATH` is exported (`lib/firebase.js:68`) and imported nowhere. The trend chart uses an in-browser buffer of the last 180 live readings (`telemetry.jsx:23,72-92`), empty after every page load; with < 2 points it shows "Collecting trend data. The chart starts after two readings." (`FlowTrendChart.jsx:60-68`).
- `dropsPerMin` derivation from flow rate: **not implemented** anywhere. The only trace is the Detail KPI subtitle text "20 gtt/mL set" (`BedDetail.jsx:279`).
- Audio alarm in the dashboard: none (no `Audio`/`AudioContext` usage in `src/`).
- `lib/constants.js` `PIN_MAP` holds outdated pins (HX711 DT 16 / SCK 17, MAX30102 SDA 21 / SCL 22, ST7735 SCLK 18 / MOSI 23 / CS 5 / DC 27 / RST 26); Admin's calibration panel renders "HX711 DT 16, SCK 17".
- `lib/constants.js:36-42` documents 287836.24 as an inherited placeholder.

### Rules, git, build, hosting

- Deployed RTDB rules (read over REST with the Firebase CLI's OAuth token) are **identical** to `firebase/database.rules.json` (normalized JSON, 1928 chars each).
- `git status`: modified `src/components/ui.jsx`, `src/pages/Admin.jsx`, `src/pages/BedDetail.jsx` (delete-bed UI, uncommitted; +62 / −44); untracked `tools/`, `docs/`, `CLAUDE.md`. `tools/diag/logs/` is ignored by `.gitignore` (`logs/`). HEAD `45b0c45`.
- `npm run build`: passes (Vite, built in 433 ms).
- Hosting: `firebase.json` has a `hosting` block (`public: dist`, SPA rewrite, security headers). No `.firebaserc` and no `.firebase/` cache in the repo. Site `driptrace-hackathon`, live channel last release 2026-10-07 13:32:26; `https://driptrace-hackathon.web.app` returns Firebase's **"Site Not Found"** page — the app has never been deployed there.
- Android app: not audited (not on this PC yet, per answer 8).
