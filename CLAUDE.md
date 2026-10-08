# DripTrace

## DripTrace hardware facts

Full measured facts (library bodies, raw results, website audit): `docs/hardware/DRIPTRACE_FACTS.md`. Measured 2026-10-08.

- Board: ESP32-S3-WROOM-1 N16R8 (rev 2, 16 MB flash, 8 MB PSRAM) on **COM3**, CH343 UART0 (`VID_1A86&PID_55D3`), 115200 baud.
- FQBN: `esp32:esp32:esp32s3:PSRAM=opi,FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,CDCOnBoot=default,UploadMode=default`
- arduino-cli: bundled with IDE 2.3.10 at `%LOCALAPPDATA%\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe` (1.5.1). Always pass `--config-file "C:\Users\G M HRISHI\.arduinoIDE\arduino-cli.yaml"`, or it picks the stale OneDrive library folder.
- Core 3.3.12 (IDF v5.5.5). Libraries: HX711 **Rob Tillaart 0.6.5** (not bogde), SparkFun MAX3010x 1.1.2, Adafruit ST7735/ST7789 1.11.0, Adafruit GFX 1.12.6.
- HX711: **−255.85 counts/g** (full − empty bottle = 100.5 g; second loading gave −226.25), 10.9 sps, noise 0.6–1.3 g, zero repeatability 4.3 g, 60 s wander up to 11 g peak-to-peak. Load makes raw more negative.
- Empty 100 mL bottle ≈ **16.0 g**; full bottle gross ≈ **116.5 g** (109.2 g on another loading).
- HX711 VCC loss → `is_ready()` true with raw exactly 0; DT or SCK loss → `is_ready()` false (library `read()` then blocks forever).
- MAX30102 at I2C 0x57. Closest to smartwatch: SparkFun default `(0x1F,4,3,400,411,4096)` per-sample (measured 50 sps). Config `(0x1F,4,2,100,411,4096)` = 25 sps.
- Firmware v2 (uses the constants above): `C:\Users\G M HRISHI\Downloads\driptrace_esp32s3_firmware_v2\driptrace_esp32s3_firmware_v2.ino`. Previous: `...\Downloads\driptrace_esp32s3_firmware_final\`. Both hold the RTDB secret — never print it, never copy into the repo.
- v2 contract: `sensorOnline` = load cell connected (not finger); `weightGrams` = gross bottle weight; `lastUpdated` in ms; dashboard derives `dropsPerMin` (20 gtt/mL) in `src/lib/reading.js`.
- Diagnostic sketch: `tools/diag/driptrace_diag/` (no Firebase writes); logs in `tools/diag/logs/` (git-ignored).
