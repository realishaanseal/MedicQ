# MedicQ: Smart Bed Monitoring

An ESP32 ankle band (SpO₂, heart rate, temperature, motion, optional BP cuff) and an
ESP32 bed unit (pressure grid, backrest angle, nurse call) send data over MQTT to a
Node.js server. The server runs the clinical rules and pushes live data to a React
dashboard for the nurse station and bedside monitors.

> Prototype for demo and education only. **Not a medical device.**

```
 ankle band ─┐                  ┌──────────── server/ ─────────────┐
 (ESP32)     │  MQTT :1883      │ Aedes broker → zod validation    │  Socket.IO  ┌ dashboard/ ┐
             ├─────────────────▶│ → BedStore (live state)          │────────────▶│ station    │
 bed unit  ──┘                  │ → rules engine → AlertManager    │  REST /api  │ bedside    │
 (ESP32)    ◀── cmd topics ─────│ → SQLite history                 │◀────────────│ detail ... │
                                └──────────────────────────────────┘             └────────────┘
 simulator/ speaks the same protocol, so software work doesn't wait on hardware.
```

## Layout

| Path | Owner | What |
|---|---|---|
| `firmware/ankle/` | Ankle firmware | PlatformIO project: MAX30102, MAX30205, MPU6050, UART BP cuff |
| `firmware/bed/` | Bed unit | PlatformIO project: 32 FSRs via 2× CD74HC4067, MPU6050 angle, call button |
| `server/` | Backend | Embedded MQTT broker, validation, rules, alerts, REST + Socket.IO, SQLite |
| `dashboard/` | Frontend | React (Vite): Station, Bedside monitor, Bed detail, Alerts, Devices |
| `simulator/` | Everyone | Fake beds with clinical scenarios |
| `docs/PROTOCOL.md` | Everyone | MQTT topics and payloads (the contract between hardware and software) |

## Quick start (no hardware)

```bash
cd server    && npm i && TIME_SCALE=60 npm start        # MQTT :1883, HTTP :4000
cd dashboard && npm i && npm run dev                    # http://localhost:5173
cd simulator && npm i && node sim.js --beds 8 \
  --scenario B02:desat,B03:exit,B04:fall,B05:fever,B06:badsignal,B07:call,B08:still
```

For a demo laptop, run `npm run build` in `dashboard/` once. The server then
serves the UI at `http://<laptop-ip>:4000`. Bedside monitor URL: `#/monitor/B01`.

Simulator scenarios: `normal desat fever tachy hypotension exit fall badsignal still call offline`.
`TIME_SCALE=60` makes one real minute count as one hour, so the 2-hour pressure-injury rule fires in about 2 minutes.

## Hardware

1. Copy `firmware/<node>/src/config.example.h` to `config.h`. Set Wi-Fi, the server IP and `BED_ID`.
2. Run `pio run -t upload -d firmware/ankle` (and the same for `firmware/bed`).
3. The device appears on the **Devices** screen when it connects.

## Rules engine (`server/src/rules/`)

| Rule | Logic | Alert |
|---|---|---|
| Signal quality | `sqi < 50`: vitals greyed out and excluded from alarms and NEWS2; alert after 30 s | `POOR_SIGNAL` (tech) |
| Vital thresholds | SpO₂ <92 / <88, HR <50 >110 / <40 >130, Temp ≥38 / ≥39 or ≤35, must persist 10 s | `SPO2_*`, `HR_*`, `TEMP_*` |
| BP | Spot reading, SBP ≤100 / ≥180 warn, ≤90 / ≥220 crit | `BP_*` |
| NEWS2 (partial) | SpO₂ scale 1 + temp + SBP + HR; ≥5 medium, ≥7 high. RR, ACVPU and O₂ are not measured | `NEWS2_*` |
| Bed-exit prediction | Lateral centre of pressure near an edge + backrest up + load toward the foot gives a risk ≥ 0.6 | `EXIT_RISK` |
| Bed exit | Occupied ≥30 s, then load drops below threshold | `BED_EXIT` |
| Pressure injury | Per-cell continuous load ≥120 min with no offload | `REPOSITION` |
| Fall | Ankle impact >2.5 g while the bed is empty (±15 s); stays until acknowledged | `FALL` |
| Device health | LWT offline, no data for 10 s, battery <15 % | `OFFLINE_*`, `STALE_*`, `BATT_*` |

All thresholds are in `server/src/config.js`.

## API

`GET /api/beds` · `GET /api/beds/:id` · `PATCH /api/beds/:id {patient}` ·
`GET /api/beds/:id/vitals?since=ms` · `POST /api/beds/:id/cmd {node, cmd}` ·
`GET /api/alerts[?all=1]` · `POST /api/alerts/:id/ack` · `GET /api/config`

Socket.IO events: `snapshot`, `bed:update`, `alert:new`, `alert:update`.
