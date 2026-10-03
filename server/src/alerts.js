// AlertManager: turns rule conditions into persisted alerts.
//  - persistence: a non-immediate condition must hold for cfg.persistMs
//  - dedupe: one open alert per (bed, code)
//  - clearing: alert clears when its condition goes away (unless sticky)
//  - an alert leaves the active list once it is both cleared and acknowledged
export class AlertManager {
  constructor({ q, cfg, emit }) {
    this.q = q;
    this.cfg = cfg;
    this.emit = emit;
    this.pending = new Map(); // `${bed}:${code}` -> first seen ms
    this.open = new Map();    // `${bed}:${code}` -> { id, sticky }
    // Resume alerts that were still open when the server stopped.
    for (const a of q.activeAlerts.all()) {
      if (a.cleared_at == null) this.open.set(`${a.bed_id}:${a.code}`, { id: a.id, sticky: false });
    }
  }

  process(bedId, conditions, now = Date.now()) {
    const seen = new Set();
    for (const c of conditions) {
      const key = `${bedId}:${c.code}`;
      seen.add(key);
      if (this.open.has(key)) continue;
      if (!c.immediate) {
        if (!this.pending.has(key)) this.pending.set(key, now);
        if (now - this.pending.get(key) < this.cfg.persistMs) continue;
      }
      this.pending.delete(key);
      const { lastInsertRowid } = this.q.insertAlert.run(bedId, c.code, c.severity, c.message, now);
      this.open.set(key, { id: Number(lastInsertRowid), sticky: !!c.sticky });
      this.emit('alert:new', this.q.alert.get(lastInsertRowid));
    }

    const prefix = `${bedId}:`;
    for (const key of [...this.pending.keys()]) {
      if (key.startsWith(prefix) && !seen.has(key)) this.pending.delete(key);
    }
    for (const [key, a] of [...this.open]) {
      if (!key.startsWith(prefix) || seen.has(key) || a.sticky) continue;
      this.clear(key, a.id, now);
    }
  }

  clear(key, id, now = Date.now()) {
    this.q.clearAlert.run(now, id);
    this.open.delete(key);
    this.emit('alert:update', this.q.alert.get(id));
  }

  ack(id, by = 'nurse', now = Date.now()) {
    const res = this.q.ackAlert.run(now, by, id);
    const alert = this.q.alert.get(id);
    if (!alert) return null;
    // Sticky alerts (fall, nurse call) clear on acknowledgement.
    const key = `${alert.bed_id}:${alert.code}`;
    const o = this.open.get(key);
    if (o?.sticky && o.id === id) this.clear(key, id, now);
    else if (res.changes) this.emit('alert:update', this.q.alert.get(id));
    return this.q.alert.get(id);
  }
}
