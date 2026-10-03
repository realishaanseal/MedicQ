// Central configuration. Override any value with environment variables.
// Also imported by the dashboard's in-browser demo mode, where there is no process.env.
const ENV = globalThis.process?.env ?? {};
const env = (k, d) => (ENV[k] !== undefined ? Number(ENV[k]) || ENV[k] : d);

export const config = {
  httpPort: env('HTTP_PORT', 4000),
  mqttPort: env('MQTT_PORT', 1883),
  dbFile: env('DB_FILE', './smartbed.db'),

  // Speeds up time-based rules (pressure injury, stale data) for demos.
  // 60 => one real minute counts as one hour.
  timeScale: env('TIME_SCALE', 1),

  // A device is "stale" if no data arrives within this many ms.
  staleMs: 10_000,

  // Readings with sqi below this are shown greyed out and never raise vital alarms.
  minSqi: 50,
  // How long poor signal may persist before raising a technical alert.
  poorSignalAlertMs: 30_000,

  // Vital thresholds. A condition must persist for `persistMs` before alarming.
  persistMs: 10_000,
  thresholds: {
    spo2: { critLow: 88, warnLow: 92 },
    hr: { critLow: 40, warnLow: 50, warnHigh: 110, critHigh: 130 },
    temp: { critLow: 35.0, warnHigh: 38.0, critHigh: 39.0 },
    sys: { critLow: 90, warnLow: 100, warnHigh: 180, critHigh: 220 },
  },

  // Bed occupancy / exit
  occupiedLoad: 2000,          // sum of grid above this = patient in bed
  exitEdgeRatio: 0.35,         // lateral centre of pressure beyond ±this (of half-width) = at edge
  exitRiskAngle: 30,           // backrest angle that makes sitting-up-to-exit likely

  // Pressure injury
  cellLoadedThreshold: 300,    // raw FSR value above which a cell is "under load"
  repositionAfterMin: 120,     // minutes of continuous load before a turn is due

  // Fall: impact event + bed empty within this window
  fallWindowMs: 15_000,
};
