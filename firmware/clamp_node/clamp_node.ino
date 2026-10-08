/*
 * DripTrace backflow clamp node: ESP32 DOIT DevKit V1 + SG90, wireless.
 * The ESP32-S3 bedside unit decides; this board only moves the servo.
 *
 * Link: ESP-NOW. The S3 broadcasts {"DTCL", bed, cmd, seq} every second on
 * whatever channel its WiFi uses (the router's). This node does not know that
 * channel, so it hops channels 1-13 until it hears its bed, then stays there,
 * and answers each command {"DTAK", bed, angle, seq} straight to the S3.
 * Silence for 4 s: back to hopping. The clamp keeps its last position meanwhile.
 *
 * Servo: signal GPIO17, power 5 V (VIN). 180 deg = open, 145 deg = squeezed (bench).
 * USB serial 115200: type C or O to test without the S3.
 */
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

#define SERVO_PIN 17
const char *BED_ID = "bed-01";             // must match the S3's BED_ID
const int OPEN_DEG = 180, CLAMP_DEG = 145;
const int MIN_US = 500, MAX_US = 2400;
const uint32_t LOST_MS = 4000, HOP_MS = 250;

struct __attribute__((packed)) ClampMsg { char magic[4]; char bed[12]; uint8_t value; uint32_t seq; };

volatile int wantDeg = OPEN_DEG;
volatile uint32_t lastHeardMs = 0;
int angle = -1;
uint8_t channel = 1;

void moveTo(int deg) {
  if (deg == angle) return;
  angle = deg;
  uint32_t us = MIN_US + (uint32_t)(MAX_US - MIN_US) * deg / 180;
  ledcWrite(SERVO_PIN, us * ((1 << 14) - 1) / 20000);
  Serial.printf("servo %d deg\n", deg);
}

void onRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  if (len != sizeof(ClampMsg)) return;
  ClampMsg m;
  memcpy(&m, data, sizeof(m));
  if (memcmp(m.magic, "DTCL", 4) != 0 || strncmp(m.bed, BED_ID, sizeof(m.bed)) != 0) return;
  wantDeg = m.value ? CLAMP_DEG : OPEN_DEG;
  lastHeardMs = millis();
  if (!esp_now_is_peer_exist(info->src_addr)) {
    esp_now_peer_info_t p = {};
    memcpy(p.peer_addr, info->src_addr, 6);
    p.channel = 0;  // current channel
    p.ifidx = WIFI_IF_STA;
    esp_now_add_peer(&p);
  }
  ClampMsg ack = {};
  memcpy(ack.magic, "DTAK", 4);
  strncpy(ack.bed, BED_ID, sizeof(ack.bed));
  ack.value = (uint8_t)wantDeg;
  ack.seq = m.seq;
  esp_now_send(info->src_addr, (uint8_t *)&ack, sizeof(ack));
}

void setChannel(uint8_t ch) {
  channel = ch;
  esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE);
}

void setup() {
  Serial.begin(115200);
  ledcAttach(SERVO_PIN, 50, 14);
  moveTo(OPEN_DEG);  // power-up: line open
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  setChannel(1);
  if (esp_now_init() != ESP_OK) Serial.println("ESP-NOW init FAILED");
  esp_now_register_recv_cb(onRecv);
  Serial.printf("DripTrace clamp node ready for %s, MAC %s\n", BED_ID, WiFi.macAddress().c_str());
}

void loop() {
  static uint32_t lastHop = 0;
  static bool linked = false;
  bool heard = lastHeardMs && millis() - lastHeardMs < LOST_MS;
  if (heard != linked) {
    linked = heard;
    Serial.printf(linked ? "Linked to bedside unit on channel %u\n" : "Link lost; scanning (channel %u)\n", channel);
  }
  if (!heard && millis() - lastHop >= HOP_MS) {
    lastHop = millis();
    setChannel(channel % 13 + 1);
  }
  moveTo(wantDeg);
  if (Serial.available()) {
    char c = Serial.read();
    if (c == 'C') wantDeg = CLAMP_DEG;
    if (c == 'O') wantDeg = OPEN_DEG;
  }
  delay(5);
}
