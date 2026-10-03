# MQTT Protocol (v1)

All devices talk to the broker embedded in the server (`mqtt://<server-ip>:1883`).
Payloads are UTF-8 JSON. `ts` is milliseconds since epoch (devices without RTC
may send `0` — the server stamps receive time).

Topic root: `smartbed/{bedId}/...` where `bedId` is e.g. `B01`.

## Uplink (device → server)

| Topic | QoS | Rate | Payload |
|---|---|---|---|
| `smartbed/{bedId}/ankle/vitals` | 0 | 1 Hz | `{ "ts", "hr", "spo2", "temp", "pi", "sqi", "motion" }` |
| `smartbed/{bedId}/ankle/bp` | 1 | on demand | `{ "ts", "sys", "dia" }` |
| `smartbed/{bedId}/ankle/event` | 1 | on event | `{ "ts", "type": "impact", "g": 3.4 }` |
| `smartbed/{bedId}/bed/state` | 0 | 1 Hz | `{ "ts", "angle", "grid": [[...8], ...4 rows] }` |
| `smartbed/{bedId}/bed/event` | 1 | on event | `{ "ts", "type": "nurse_call" }` |
| `smartbed/{bedId}/{node}/status` | 1, retained | on connect + LWT | `{ "online", "fw", "rssi", "battery" }` |

Field notes:

- `hr` bpm, `spo2` %, `temp` °C, `pi` perfusion index (%), `sqi` signal quality 0–100
  computed on-device (finger/skin contact, ratio stability, motion), `motion` 0–1
  normalised accelerometer activity over the last second.
- `grid` is a 4×8 matrix (rows head→foot, cols left→right) of raw 0–1023 FSR readings.
  `angle` is backrest angle in degrees.
- `node` is `ankle` or `bed`. Devices set an MQTT Last Will on this topic with
  `{ "online": false }` so the server sees disconnects immediately.

## Downlink (server → device)

| Topic | Payload |
|---|---|
| `smartbed/{bedId}/ankle/cmd` | `{ "cmd": "bp_measure" }` / `{ "cmd": "identify" }` |
| `smartbed/{bedId}/bed/cmd` | `{ "cmd": "call_reset" }` |

## Validation

Every uplink is validated with zod in `server/src/schemas.js`. Invalid messages are
dropped and counted per device (visible on the Devices screen).
