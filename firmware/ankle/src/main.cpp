// Ankle band: MAX30102 (HR/SpO2), MAX30205 (skin temp), MPU6050 (motion / impact),
// optional UART BP cuff. Publishes per docs/PROTOCOL.md.
#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <MAX30105.h>
#include <spo2_algorithm.h>
#include <Adafruit_MPU6050.h>
#include "config.h"

static const char *T_VITALS = "smartbed/" BED_ID "/ankle/vitals";
static const char *T_BP     = "smartbed/" BED_ID "/ankle/bp";
static const char *T_EVENT  = "smartbed/" BED_ID "/ankle/event";
static const char *T_STATUS = "smartbed/" BED_ID "/ankle/status";
static const char *T_CMD    = "smartbed/" BED_ID "/ankle/cmd";

WiFiClient net;
PubSubClient mqtt(net);
MAX30105 ppg;
Adafruit_MPU6050 imu;
bool haveImu = false;

// ---------- MAX30102: 100-sample window @ 25 Hz effective, slid by 25 samples (1 s) ----------
const int BUF = 100;
uint32_t irBuf[BUF], redBuf[BUF];
int32_t spo2 = -1, hr = -1;
int8_t spo2Valid = 0, hrValid = 0;

// ---------- motion ----------
float motionAcc = 0;   // accumulated |a - 1g| over the last second
int motionN = 0;
const float IMPACT_G = 2.5;
uint32_t lastImpactMs = 0;

// ---------- MAX30205 (I2C 0x48) — read the temperature register directly ----------
float readSkinTemp() {
  Wire.beginTransmission(0x48);
  Wire.write(0x00);
  if (Wire.endTransmission(false) != 0) return NAN;
  if (Wire.requestFrom(0x48, 2) != 2) return NAN;
  int16_t raw = (Wire.read() << 8) | Wire.read();
  return raw * 0.00390625f;
}

int batteryPct() {
  float v = analogReadMilliVolts(PIN_BATT_ADC) * 2 / 1000.0f;   // divider halves it
  return constrain((int)((v - 3.3f) / (4.2f - 3.3f) * 100), 0, 100);
}

// Signal quality 0..100 from what we know on-device:
// finger/skin contact (DC IR level), algorithm validity flags and motion.
int signalQuality(uint32_t irMean, float motion) {
  if (irMean < 50000) return 0;                  // not on skin
  int q = 100;
  if (!hrValid) q -= 35;
  if (!spo2Valid) q -= 35;
  q -= (int)(min(motion, 1.0f) * 60);
  return constrain(q, 0, 100);
}

void publishStatus(bool online) {
  JsonDocument d;
  d["online"] = online;
  d["fw"] = FW_VERSION;
  d["rssi"] = WiFi.RSSI();
  d["battery"] = batteryPct();
  char out[128];
  serializeJson(d, out);
  mqtt.publish(T_STATUS, out, true);
}

// Optional BP cuff. Many cheap wrist/arm cuff modules print a line like
// "SYS:120,DIA:80,PUL:72" on UART after a measurement. Adapt to your module.
void startBpMeasurement() { Serial2.println("START"); }
void readBpCuff() {
  if (!Serial2.available()) return;
  String line = Serial2.readStringUntil('\n');
  int sys, dia, pul;
  if (sscanf(line.c_str(), "SYS:%d,DIA:%d,PUL:%d", &sys, &dia, &pul) == 3) {
    JsonDocument d;
    d["ts"] = 0; d["sys"] = sys; d["dia"] = dia;
    char out[96];
    serializeJson(d, out);
    mqtt.publish(T_BP, out);
  }
}

void onCmd(char *topic, byte *payload, unsigned int len) {
  JsonDocument d;
  if (deserializeJson(d, payload, len)) return;
  const char *cmd = d["cmd"] | "";
  if (!strcmp(cmd, "bp_measure")) startBpMeasurement();
  else if (!strcmp(cmd, "identify")) for (int i = 0; i < 10; i++) { digitalWrite(PIN_LED, i & 1); delay(150); }
}

void connect() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
  }
  if (WiFi.status() == WL_CONNECTED && !mqtt.connected()) {
    String id = String("ankle-") + BED_ID;
    // Last Will: broker announces offline if we drop.
    if (mqtt.connect(id.c_str(), T_STATUS, 1, true, "{\"online\":false}")) {
      mqtt.subscribe(T_CMD);
      publishStatus(true);
    }
  }
}

void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, PIN_BP_RX, PIN_BP_TX);
  pinMode(PIN_LED, OUTPUT);
  Wire.begin(PIN_SDA, PIN_SCL, 400000);

  if (!ppg.begin(Wire, I2C_SPEED_FAST)) Serial.println("MAX30102 not found");
  // ledBrightness, sampleAverage, ledMode(2=red+IR), sampleRate, pulseWidth, adcRange
  ppg.setup(60, 4, 2, 100, 411, 4096);   // 100 Hz / avg 4 => 25 samples/s

  haveImu = imu.begin();
  if (haveImu) { imu.setAccelerometerRange(MPU6050_RANGE_8_G); imu.setFilterBandwidth(MPU6050_BAND_21_HZ); }

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onCmd);
  mqtt.setBufferSize(512);
  connect();

  // Prime the PPG buffer.
  for (int i = 0; i < BUF; i++) {
    while (!ppg.available()) ppg.check();
    redBuf[i] = ppg.getRed(); irBuf[i] = ppg.getIR(); ppg.nextSample();
  }
}

void sampleImu() {
  if (!haveImu) return;
  sensors_event_t a, g, t;
  imu.getEvent(&a, &g, &t);
  float mag = sqrtf(a.acceleration.x * a.acceleration.x + a.acceleration.y * a.acceleration.y + a.acceleration.z * a.acceleration.z) / 9.81f;
  motionAcc += fabsf(mag - 1.0f);
  motionN++;
  if (mag > IMPACT_G && millis() - lastImpactMs > 5000) {
    lastImpactMs = millis();
    char out[80];
    snprintf(out, sizeof out, "{\"ts\":0,\"type\":\"impact\",\"g\":%.2f}", mag);
    mqtt.publish(T_EVENT, out);
  }
}

void loop() {
  if (!mqtt.connected()) connect();
  mqtt.loop();
  readBpCuff();

  // Slide window: drop oldest 25, read 25 new samples (~1 s), sampling IMU in between.
  memmove(redBuf, redBuf + 25, (BUF - 25) * sizeof(uint32_t));
  memmove(irBuf, irBuf + 25, (BUF - 25) * sizeof(uint32_t));
  for (int i = BUF - 25; i < BUF; i++) {
    while (!ppg.available()) ppg.check();
    redBuf[i] = ppg.getRed(); irBuf[i] = ppg.getIR(); ppg.nextSample();
    sampleImu();
    mqtt.loop();
  }
  maxim_heart_rate_and_oxygen_saturation(irBuf, BUF, redBuf, &spo2, &spo2Valid, &hr, &hrValid);

  uint64_t irSum = 0;
  uint32_t irMin = UINT32_MAX, irMax = 0;
  for (int i = 0; i < BUF; i++) { irSum += irBuf[i]; irMin = min(irMin, irBuf[i]); irMax = max(irMax, irBuf[i]); }
  uint32_t irMean = irSum / BUF;
  float pi = irMean ? 100.0f * (irMax - irMin) / irMean : 0;    // rough perfusion index
  float motion = motionN ? min(1.0f, motionAcc / motionN / 0.3f) : 0;
  motionAcc = 0; motionN = 0;

  JsonDocument d;
  d["ts"] = 0;
  if (hrValid && hr > 20 && hr < 250) d["hr"] = hr; else d["hr"] = nullptr;
  if (spo2Valid && spo2 > 50) d["spo2"] = spo2; else d["spo2"] = nullptr;
  float temp = readSkinTemp();
  // Ankle skin temp reads below core temp; the offset needs calibration against a reference thermometer.
  if (!isnan(temp)) d["temp"] = temp + 2.0f; else d["temp"] = nullptr;
  d["pi"] = constrain(pi, 0, 30);
  d["sqi"] = signalQuality(irMean, motion);
  d["motion"] = motion;
  char out[200];
  serializeJson(d, out);
  mqtt.publish(T_VITALS, out);

  static uint32_t lastStatus = 0;
  if (millis() - lastStatus > 60000) { lastStatus = millis(); publishStatus(true); }
}
