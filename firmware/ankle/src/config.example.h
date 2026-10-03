// Copy to config.h (git-ignored) and fill in.
#pragma once
#define WIFI_SSID     "ward-iot"
#define WIFI_PASS     "change-me"
#define MQTT_HOST     "192.168.1.10"   // laptop running server/
#define MQTT_PORT     1883
#define BED_ID        "B01"
#define FW_VERSION    "ankle-0.1.0"

// Pins (ESP32 DevKit). MAX30102, MAX30205 and MPU6050 share the I2C bus.
#define PIN_SDA       21
#define PIN_SCL       22
#define PIN_LED       2
// Optional BP cuff module on UART2 (see readBpCuff()).
#define PIN_BP_RX     16
#define PIN_BP_TX     17
#define PIN_BATT_ADC  34              // via 100k/100k divider
