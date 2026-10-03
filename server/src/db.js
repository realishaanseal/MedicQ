import Database from 'better-sqlite3';

export function openDb(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS beds (
      bed_id TEXT PRIMARY KEY, label TEXT, patient TEXT, ward TEXT DEFAULT 'A'
    );
    CREATE TABLE IF NOT EXISTS vitals (
      bed_id TEXT, ts INTEGER, hr REAL, spo2 REAL, temp REAL, sys REAL, dia REAL,
      sqi REAL, news2 INTEGER
    );
    CREATE INDEX IF NOT EXISTS vitals_bed_ts ON vitals(bed_id, ts);
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bed_id TEXT, code TEXT, severity TEXT, message TEXT,
      raised_at INTEGER, cleared_at INTEGER, acked_at INTEGER, acked_by TEXT
    );
    CREATE INDEX IF NOT EXISTS alerts_active ON alerts(cleared_at, acked_at);
  `);

  const q = {
    upsertBed: db.prepare(`INSERT INTO beds (bed_id, label) VALUES (?, ?) ON CONFLICT DO NOTHING`),
    setPatient: db.prepare(`UPDATE beds SET patient = ? WHERE bed_id = ?`),
    beds: db.prepare(`SELECT * FROM beds ORDER BY bed_id`),
    insertVitals: db.prepare(`INSERT INTO vitals VALUES (@bed_id, @ts, @hr, @spo2, @temp, @sys, @dia, @sqi, @news2)`),
    vitalsSince: db.prepare(`SELECT * FROM vitals WHERE bed_id = ? AND ts >= ? ORDER BY ts`),
    insertAlert: db.prepare(`INSERT INTO alerts (bed_id, code, severity, message, raised_at) VALUES (?, ?, ?, ?, ?)`),
    clearAlert: db.prepare(`UPDATE alerts SET cleared_at = ? WHERE id = ?`),
    ackAlert: db.prepare(`UPDATE alerts SET acked_at = ?, acked_by = ? WHERE id = ? AND acked_at IS NULL`),
    alert: db.prepare(`SELECT * FROM alerts WHERE id = ?`),
    activeAlerts: db.prepare(`SELECT * FROM alerts WHERE cleared_at IS NULL OR acked_at IS NULL ORDER BY raised_at DESC`),
    recentAlerts: db.prepare(`SELECT * FROM alerts ORDER BY raised_at DESC LIMIT ?`),
  };
  return { db, q };
}
