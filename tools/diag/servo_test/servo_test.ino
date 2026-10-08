// SG90 bench test on GPIO 15 (no Firebase, no other peripherals).
// Sweeps 0 -> 45 -> 90 -> 135 -> 180 deg, 2 s each, repeating.
// Serial 115200: type an angle (0-180) to stop the sweep and hold it; "s" resumes the sweep.
#ifndef SERVO_PIN
#define SERVO_PIN 15  // build with -DSERVO_PIN=17 for the DOIT devkit
#endif
const uint32_t FREQ = 50, RES = 14;           // 20 ms period, 16384 steps
const int MIN_US = 500, MAX_US = 2400;        // SG90 pulse range

void writeAngle(int deg) {
  deg = constrain(deg, 0, 180);
  uint32_t us = MIN_US + (uint32_t)(MAX_US - MIN_US) * deg / 180;
  ledcWrite(SERVO_PIN, us * ((1 << RES) - 1) / 20000);
  Serial.printf("angle %d deg (%lu us)\n", deg, (unsigned long)us);
}

void setup() {
  Serial.begin(115200);
  ledcAttach(SERVO_PIN, FREQ, RES);
  Serial.println("SG90 test on GPIO15. Type 0-180 to hold an angle, s to sweep.");
}

void loop() {
  static bool sweep = true;
  static int step = 0;
  static uint32_t last = 0;
  if (Serial.available()) {
    String s = Serial.readStringUntil('\n');
    s.trim();
    if (s == "s") sweep = true;
    else if (s.length()) { sweep = false; writeAngle(s.toInt()); }
  }
  if (sweep && millis() - last >= 2000) {
    last = millis();
    writeAngle(step * 45);
    step = (step + 1) % 5;
  }
}
