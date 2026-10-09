#pragma once
/*
 * Offline logbook: one 16-byte record per second in a ring file on the 9.9 MB
 * FAT partition (about 4.6 days), uploaded to history/<bed> once WiFi and NTP
 * are back, with real timestamps.
 *
 * Time without an RTC: each record carries millis() and a boot id. When NTP
 * syncs, the boot is anchored (epochAtBoot = now - millis()), which makes
 * every record of that boot exact, including the ones logged before WiFi
 * came back. A boot that ended before it ever synced is estimated backwards
 * from the next anchored boot (assumes no power-off gap) and uploaded with
 * approxTime:true.
 *
 * Records are buffered in RAM and written every LOG_FLUSH_MS to spare the
 * flash; a power cut loses at most that much.
 */
#include <FFat.h>
#include <Preferences.h>
#include <stdio.h>

struct __attribute__((packed)) LogRec {
  uint32_t upMs;       // millis() when taken
  uint16_t boot;       // boot id
  uint16_t flowX10;    // mL/hr x10
  uint16_t weightX10;  // gross g x10
  uint8_t pct;         // bottle %
  uint8_t hr;          // bpm, 0 = none
  uint8_t spo2;        // %, 0 = none
  uint8_t flags;       // LF_*
  uint8_t prob;        // irregular probability x200, 255 = not evaluated
  uint8_t rsv;
};
static_assert(sizeof(LogRec) == 16, "LogRec must stay 16 bytes");

enum : uint8_t {
  LF_EMPTY = 1, LF_ONLINE = 2, LF_FINGER = 4, LF_MOTION = 8,
  LF_IRREGULAR = 16, LF_UNRESP = 32, LF_OUT_OF_RANGE = 64,
};

const uint32_t LOG_CAPACITY = 400000;        // records (6.4 MB)
const uint32_t LOG_FLUSH_MS = 15000;
const uint8_t LOG_PENDING_MAX = 64;
const uint8_t LOG_MAX_BOOTS = 24;
const uint32_t LOG_MIN_FREE_BYTES = 256 * 1024;  // below this at boot, the log is wiped
const char *LOG_PATH = "/ffat/dt_log.bin";

struct BootInfo {
  uint16_t boot;
  uint32_t lastUpMs;      // last record of that boot
  int64_t epochAtBootMs;  // 0 = never synced
};

struct OfflineLog {
  SemaphoreHandle_t mtx = nullptr;
  bool ok = false;
  uint16_t boot = 0;
  uint32_t written = 0, uploaded = 0;  // sequence numbers; slot = seq % capacity
  LogRec pending[LOG_PENDING_MAX];
  uint8_t pendingN = 0;
  uint32_t lastFlushMs = 0;
  BootInfo boots[LOG_MAX_BOOTS];
  uint8_t bootsN = 0;

  void lock() { xSemaphoreTake(mtx, portMAX_DELAY); }
  void unlock() { xSemaphoreGive(mtx); }

  void begin() {
    mtx = xSemaphoreCreateMutex();
    ok = FFat.begin(true);  // formats the partition on first use (takes a few s)
    bool wiped = false;
    if (ok && FFat.freeBytes() < LOG_MIN_FREE_BYTES) {
      // A full partition makes every write fail, which silently stalls the
      // history upload. Say what filled it, then start the log afresh.
      Serial.printf("Offline log: only %u KB free, wiping the log partition\n",
                    (unsigned)(FFat.freeBytes() / 1024));
      File root = FFat.open("/");
      for (File f = root.openNextFile(); f; f = root.openNextFile())
        Serial.printf("  %s %u KB\n", f.name(), (unsigned)(f.size() / 1024));
      root.close();
      FFat.end();
      ok = FFat.format() && FFat.begin(true);
      wiped = true;
    }
    Preferences p;
    p.begin("dtlog", false);
    boot = p.getUShort("boot", 0) + 1;
    p.putUShort("boot", boot);
    written = wiped ? 0 : p.getULong("w", 0);
    uploaded = wiped ? 0 : p.getULong("u", 0);
    bootsN = p.getBytes("boots", boots, sizeof(boots)) / sizeof(BootInfo);
    p.end();
    if (bootsN == LOG_MAX_BOOTS) {
      memmove(boots, boots + 1, sizeof(BootInfo) * (LOG_MAX_BOOTS - 1));
      bootsN--;
    }
    boots[bootsN++] = {boot, 0, 0};
    if (!ok) Serial.println("Offline log: FFat mount FAILED - logging disabled.");
    else Serial.printf("Offline log: boot %u, %lu records, %lu waiting to upload, %u KB free\n", boot,
                       (unsigned long)written, (unsigned long)backlogLocked(),
                       (unsigned)(FFat.freeBytes() / 1024));
  }

  uint32_t backlogLocked() {
    if (written - uploaded > LOG_CAPACITY) uploaded = written - LOG_CAPACITY;  // oldest overwritten
    return written - uploaded;
  }
  uint32_t backlog() {
    lock();
    uint32_t b = backlogLocked() + pendingN;
    unlock();
    return b;
  }

  void saveIndex() {
    Preferences p;
    p.begin("dtlog", false);
    p.putULong("w", written);
    p.putULong("u", uploaded);
    p.putBytes("boots", boots, sizeof(BootInfo) * bootsN);
    p.end();
  }

  // Exact time base for this boot, from the first NTP sync.
  void anchor(int64_t epochNowMs) {
    lock();
    BootInfo &b = boots[bootsN - 1];
    if (!b.epochAtBootMs) {
      b.epochAtBootMs = epochNowMs - (int64_t)millis();
      saveIndex();
      Serial.println("Offline log: boot anchored to NTP time.");
    }
    unlock();
  }

  void append(const LogRec &r) {
    if (!ok) return;
    lock();
    if (pendingN < LOG_PENDING_MAX) pending[pendingN++] = r;
    bool flushNow = pendingN == LOG_PENDING_MAX || millis() - lastFlushMs >= LOG_FLUSH_MS;
    unlock();
    if (flushNow) flush();
  }

  void flush() {
    lock();
    lastFlushMs = millis();
    if (!pendingN) { unlock(); return; }
    FILE *f = fopen(LOG_PATH, "r+b");
    if (!f) f = fopen(LOG_PATH, "w+b");
    if (f) {
      for (uint8_t i = 0; i < pendingN; i++) {
        uint32_t slot = written % LOG_CAPACITY;
        if (i == 0 || slot == 0) fseek(f, (long)slot * sizeof(LogRec), SEEK_SET);
        // Count only records that reached the flash, so a failed write is never
        // "uploaded" as an empty batch.
        if (fwrite(&pending[i], sizeof(LogRec), 1, f) != 1) {
          static bool warned = false;
          if (!warned) Serial.println("Offline log: flash write FAILED (partition full?)");
          warned = true;
          break;
        }
        written++;
      }
      fclose(f);
      boots[bootsN - 1].lastUpMs = pending[pendingN - 1].upMs;
      pendingN = 0;
      saveIndex();
    }
    unlock();
  }

  // Epoch ms for a record of boot `b`; 0 = unknown. Estimates backwards from
  // the next anchored boot when b never synced.
  int64_t bootEpoch(uint16_t b, bool &approx) {
    approx = false;
    int8_t i = -1;
    for (uint8_t k = 0; k < bootsN; k++) if (boots[k].boot == b) i = k;
    if (i < 0) return 0;
    if (boots[i].epochAtBootMs) return boots[i].epochAtBootMs;
    approx = true;
    for (uint8_t k = i + 1; k < bootsN; k++) {
      if (!boots[k].epochAtBootMs) continue;
      int64_t e = boots[k].epochAtBootMs;
      for (int8_t j = k - 1; j >= i; j--) e -= (int64_t)boots[j].lastUpMs + 1000;
      return e;
    }
    return 0;
  }

  // JSON object of up to maxN not-yet-uploaded records, keyed by epoch ms, for
  // a PATCH to history/<bed>.json. Returns the sequence to commit on success,
  // or 0 when nothing is ready.
  uint32_t nextBatch(String &json, uint16_t maxN) {
    if (!ok) return 0;
    lock();
    backlogLocked();  // skips records already overwritten by the ring
    uint32_t start = uploaded;
    uint32_t end = written;
    if (end - start > maxN) end = start + maxN;
    if (end == start) { unlock(); return 0; }
    FILE *f = fopen(LOG_PATH, "rb");
    if (!f) { unlock(); return 0; }
    json = "{";
    bool first = true;
    char buf[300];
    for (uint32_t seq = start; seq < end; seq++) {
      LogRec r;
      uint32_t slot = seq % LOG_CAPACITY;
      if (seq == start || slot == 0) fseek(f, (long)slot * sizeof(LogRec), SEEK_SET);
      if (fread(&r, sizeof(r), 1, f) != 1) {
        // Unreadable record: commit only what was actually read, never skip it silently.
        end = seq;
        break;
      }
      bool approx;
      int64_t base = bootEpoch(r.boot, approx);
      if (!base) continue;  // boot evicted from the table: no way to date it
      unsigned long long t = (unsigned long long)(base + r.upMs);
      int n = snprintf(buf, sizeof(buf),
        "%s\"%llu\":{\"t\":%llu,\"flowRateMlPerHr\":%.1f,\"bottlePercentRemaining\":%u,\"weightGrams\":%.1f,"
        "\"sensorOnline\":%s,\"bottleEmpty\":%s",
        first ? "" : ",", t, t, r.flowX10 / 10.0f, r.pct, r.weightX10 / 10.0f,
        (r.flags & LF_ONLINE) ? "true" : "false", (r.flags & LF_EMPTY) ? "true" : "false");
      if (r.hr) n += snprintf(buf + n, sizeof(buf) - n, ",\"heartRate\":%u", r.hr);
      if (r.spo2) n += snprintf(buf + n, sizeof(buf) - n, ",\"spo2\":%u", r.spo2);
      if (r.prob != 255) n += snprintf(buf + n, sizeof(buf) - n, ",\"irregularProb\":%.2f", r.prob / 200.0f);
      if (r.flags & LF_IRREGULAR) n += snprintf(buf + n, sizeof(buf) - n, ",\"rhythm\":\"irregular\"");
      if (r.flags & LF_UNRESP) n += snprintf(buf + n, sizeof(buf) - n, ",\"unresponsive\":true");
      if (r.flags & LF_MOTION) n += snprintf(buf + n, sizeof(buf) - n, ",\"motion\":true");
      if (approx) n += snprintf(buf + n, sizeof(buf) - n, ",\"approxTime\":true");
      snprintf(buf + n, sizeof(buf) - n, "}");
      json += buf;
      first = false;
    }
    fclose(f);
    json += "}";
    unlock();
    return end == start ? 0 : end;
  }

  void commit(uint32_t seq) {
    lock();
    if ((int32_t)(seq - uploaded) > 0) uploaded = seq;
    saveIndex();
    unlock();
  }

  // The last n records of THIS boot (flushed + pending), oldest first.
  uint16_t readRecent(LogRec *out, uint16_t n) {
    if (!ok) return 0;
    lock();
    uint16_t fromRam = pendingN < n ? pendingN : n;
    uint32_t fromFile = n - fromRam;
    uint32_t avail = written < LOG_CAPACITY ? written : LOG_CAPACITY;
    if (fromFile > avail) fromFile = avail;
    uint16_t got = 0;
    if (fromFile) {
      FILE *f = fopen(LOG_PATH, "rb");
      if (f) {
        for (uint32_t seq = written - fromFile; seq < written; seq++) {
          uint32_t slot = seq % LOG_CAPACITY;
          if (seq == written - fromFile || slot == 0) fseek(f, (long)slot * sizeof(LogRec), SEEK_SET);
          if (fread(&out[got], sizeof(LogRec), 1, f) != 1) break;
          if (out[got].boot == boot) got++;
        }
        fclose(f);
      }
    }
    for (uint8_t i = pendingN - fromRam; i < pendingN; i++) out[got++] = pending[i];
    unlock();
    return got;
  }
};
