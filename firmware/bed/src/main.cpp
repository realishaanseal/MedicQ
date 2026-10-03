// Bed unit: 4×8 FSR pressure grid, backrest angle (MPU6050), nurse-call button.
// Publishes per docs/PROTOCOL.md.
#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Adafruit_MPU6050.h>
#include "config.h"

static const char *T_STATE  = "smartbed/" BED_ID "/bed/state";
static const char *T_EVENT  = "smartbed/" BED_ID "/bed/event";
static const char *T_STATUS = "smartbed/" BED_ID "/bed/status";
static const char *T_CMD    = "smartbed/" BED_ID "/bed/cmd";

WiFiClient net;
PubSubClient mqtt(net);
Adafruit_MPU6050 imu;
bool haveImu = false;
uint16_t grid[4][8];
float angleFilt = 0;
volatile bool callPressed = false;

void IRAM_ATTR onCallButton() { callPressed = true; }

uint16_t readMux(uint8_t ch, int pin) {
  digitalWrite(PIN_MUX_S0, ch & 1);
  digitalWrite(PIN_MUX_S1, (ch >> 1) & 1);
  digitalWrite(PIN_MUX_S2, (ch >> 2) & 1);
  digitalWrite(PIN_MUX_S3, (ch >> 3) & 1);
  delayMicroseconds(50);                       // let the mux + divider settle
  uint32_t s = 0;
  for (int i = 0; i < 4; i++) s += analogRead(pin);
  return (s / 4) >> 2;                         // 12-bit ADC -> 0..1023
}

void readGrid() {
  for (int cell = 0; cell < 32; cell++) {
    uint16_t v = cell < 16 ? readMux(cell, PIN_MUX_A) : readMux(cell - 16, PIN_MUX_B);
    grid[cell / 8][cell % 8] = v;
  }
}

float readAngle() {
  if (!haveImu) return 0;
  sensors_event_t a, g, t;
  imu.getEvent(&a, &g, &t);
  // Sensor's X axis along the backrest: angle from horizontal.
  float ang = atan2f(a.acceleration.x, a.acceleration.z) * 180.0f / PI;
  angleFilt = 0.8f * angleFilt + 0.2f * ang;
  return angleFilt;
}

void publishStatus(bool online) {
  char out[128];
  snprintf(out, sizeof out, "{\"online\":%s,\"fw\":\"%s\",\"rssi\":%d}", online ? "true" : "false", FW_VERSION, WiFi.RSSI());
  mqtt.publish(T_STATUS, out, true);
}

void onCmd(char *topic, byte *payload, unsigned int len) {
  JsonDocument d;
  if (deserializeJson(d, payload, len)) return;
  const char *cmd = d["cmd"] | "";
  if (!strcmp(cmd, "call_reset")) digitalWrite(PIN_CALL_LED, LOW);
  else if (!strcmp(cmd, "identify")) for (int i = 0; i < 10; i++) { digitalWrite(PIN_CALL_LED, i & 1); delay(150); }
}

void connect() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
  }
  if (WiFi.status() == WL_CONNECTED && !mqtt.connected()) {
    String id = String("bed-") + BED_ID;
    if (mqtt.connect(id.c_str(), T_STATUS, 1, true, "{\"online\":false}")) {
      mqtt.subscribe(T_CMD);
      publishStatus(true);
    }
  }
}

void setup() {
  Serial.begin(115200);
  for (int p : {PIN_MUX_S0, PIN_MUX_S1, PIN_MUX_S2, PIN_MUX_S3, PIN_CALL_LED}) pinMode(p, OUTPUT);
  pinMode(PIN_CALL_BTN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_CALL_BTN), onCallButton, FALLING);
  analogSetAttenuation(ADC_11db);

  Wire.begin(PIN_SDA, PIN_SCL);
  haveImu = imu.begin();

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onCmd);
  mqtt.setBufferSize(1024);
  connect();
}

void loop() {
  if (!mqtt.connected()) connect();
  mqtt.loop();

  static uint32_t lastCall = 0;
  if (callPressed) {
    callPressed = false;
    if (millis() - lastCall > 2000) {          // debounce
      lastCall = millis();
      digitalWrite(PIN_CALL_LED, HIGH);
      mqtt.publish(T_EVENT, "{\"ts\":0,\"type\":\"nurse_call\"}");
    }
  }

  static uint32_t lastState = 0;
  if (millis() - lastState >= 1000) {
    lastState = millis();
    readGrid();
    JsonDocument d;
    d["ts"] = 0;
    d["angle"] = roundf(readAngle() * 10) / 10;
    JsonArray rows = d["grid"].to<JsonArray>();
    for (int r = 0; r < 4; r++) {
      JsonArray row = rows.add<JsonArray>();
      for (int c = 0; c < 8; c++) row.add(grid[r][c]);
    }
    char out[512];
    serializeJson(d, out);
    mqtt.publish(T_STATE, out);
  }

  static uint32_t lastStatus = 0;
  if (millis() - lastStatus > 60000) { lastStatus = millis(); publishStatus(true); }
}
