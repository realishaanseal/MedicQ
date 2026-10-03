// Copy to config.h (git-ignored) and fill in.
#pragma once
#define WIFI_SSID     "ward-iot"
#define WIFI_PASS     "change-me"
#define MQTT_HOST     "192.168.1.10"
#define MQTT_PORT     1883
#define BED_ID        "B01"
#define FW_VERSION    "bed-0.1.0"

// 32 FSRs (4 rows × 8 cols) read through two CD74HC4067 16:1 muxes.
// Each FSR forms a divider with a 10k resistor; mux outputs go to two ADC pins.
#define PIN_MUX_S0    25
#define PIN_MUX_S1    26
#define PIN_MUX_S2    27
#define PIN_MUX_S3    14
#define PIN_MUX_A     32   // cells 0..15  (rows 0–1)
#define PIN_MUX_B     33   // cells 16..31 (rows 2–3)

// Backrest angle: MPU6050 mounted on the backrest section (I2C).
#define PIN_SDA       21
#define PIN_SCL       22

// Nurse call button (to GND, internal pull-up) and indicator LED.
#define PIN_CALL_BTN  4
#define PIN_CALL_LED  2
