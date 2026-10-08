/*
 * DripTrace backflow clamp node: ESP32 DOIT DevKit V1 + SG90.
 * The ESP32-S3 bedside unit decides; this board only moves the servo.
 *
 * Link (UART2, 115200 8N1): DOIT GPIO16 (RX) <- S3 GPIO17 (TX)
 *                           DOIT GPIO4  (TX) -> S3 GPIO18 (RX), GND shared.
 * Commands from the S3, one per line: "C" = clamp (squeeze line), "O" = open.
 * The S3 repeats its command every second; each one is answered "A,<angle>".
 * No command for 5 s: the clamp keeps its last position (never flaps).
 * Servo: signal GPIO17, power 5 V (VIN). 180 deg = open, 145 deg = squeezed (bench).
 */
#define SERVO_PIN 17
#define LINK_RX 16
#define LINK_TX 4
const int OPEN_DEG = 180, CLAMP_DEG = 145;
const int MIN_US = 500, MAX_US = 2400;

int angle = -1;

void moveTo(int deg) {
  if (deg == angle) return;
  angle = deg;
  uint32_t us = MIN_US + (uint32_t)(MAX_US - MIN_US) * deg / 180;
  ledcWrite(SERVO_PIN, us * ((1 << 14) - 1) / 20000);
  Serial.printf("servo %d deg\n", deg);
}

void setup() {
  Serial.begin(115200);
  Serial2.begin(115200, SERIAL_8N1, LINK_RX, LINK_TX);
  ledcAttach(SERVO_PIN, 50, 14);
  moveTo(OPEN_DEG);  // power-up: line open
  Serial.println("DripTrace clamp node ready");
}

void loop() {
  static String line;
  while (Serial2.available()) {
    char c = Serial2.read();
    if (c != '\n') { if (line.length() < 16) line += c; continue; }
    line.trim();
    if (line == "C") moveTo(CLAMP_DEG);
    else if (line == "O") moveTo(OPEN_DEG);
    if (line == "C" || line == "O") Serial2.printf("A,%d\n", angle);
    line = "";
  }
  // Bench: type C or O in the USB serial monitor too.
  if (Serial.available()) {
    char c = Serial.read();
    if (c == 'C') moveTo(CLAMP_DEG);
    if (c == 'O') moveTo(OPEN_DEG);
  }
}
