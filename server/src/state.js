import { news2 } from './rules/news2.js';
import { analyseGrid, exitRisk, updatePressure } from './rules/bed.js';

// In-memory live state for every bed. The DB keeps history; this keeps "now".
export class BedStore {
  constructor(cfg) {
    this.cfg = cfg;
    this.beds = new Map();
  }

  get(bedId) {
    let s = this.beds.get(bedId);
    if (!s) {
      s = {
        bedId,
        label: bedId,
        patient: null,
        vitals: null,
        vitalsReliable: false,
        bp: null,
        news2: null,
        bed: null,
        exitRisk: 0,
        pressure: null,
        wasOccupiedFor: 0,
        occupiedSince: null,
        lastImpact: null,
        nurseCall: false,
        poorSignalSince: null,
        devices: {},
      };
      this.beds.set(bedId, s);
    }
    return s;
  }

  device(s, node, now) {
    s.devices[node] ??= { online: true, lastSeen: now, invalid: 0 };
    return s.devices[node];
  }

  // Apply one validated message. Returns the bed state.
  apply(bedId, node, kind, msg, now = Date.now()) {
    const s = this.get(bedId);
    const dev = this.device(s, node, now);
    if (kind !== 'status') {
      dev.lastSeen = now;
      dev.online = true;
    }

    switch (kind) {
      case 'ankle/vitals': {
        s.vitals = { ...msg, ts: now };
        s.vitalsReliable = msg.sqi >= this.cfg.minSqi;
        if (s.vitalsReliable) s.poorSignalSince = null;
        else s.poorSignalSince ??= now;
        this.rescore(s);
        break;
      }
      case 'ankle/bp':
        s.bp = { ...msg, ts: now };
        this.rescore(s);
        break;
      case 'ankle/event':
        if (msg.type === 'impact') s.lastImpact = { at: now, g: msg.g };
        break;
      case 'bed/state': {
        const dt = s.bed ? now - s.bed.ts : 0;
        const g = analyseGrid(msg.grid, this.cfg);
        if (g.occupied && !s.bed?.occupied) {
          s.occupiedSince = now;
          s.wasOccupiedFor = 0;
        } else if (!g.occupied && s.bed?.occupied) {
          s.wasOccupiedFor = now - (s.occupiedSince ?? now);
          s.occupiedSince = null;
        }
        s.bed = { ts: now, angle: msg.angle, grid: msg.grid, ...g };
        s.exitRisk = exitRisk(s.bed, this.cfg);
        s.pressure = updatePressure(s.pressure, msg.grid, Math.min(dt, 5_000), this.cfg);
        break;
      }
      case 'bed/event':
        if (msg.type === 'nurse_call') s.nurseCall = true;
        break;
      case 'status':
        Object.assign(dev, msg);
        break;
    }
    return s;
  }

  rescore(s) {
    const ok = s.vitalsReliable ? s.vitals : {};
    // BP older than 1 h is not used in the score.
    const bp = s.bp && Date.now() - s.bp.ts < 3_600_000 ? s.bp : null;
    s.news2 = news2({ spo2: ok?.spo2 ?? null, temp: ok?.temp ?? null, hr: ok?.hr ?? null, sys: bp?.sys ?? null });
  }

  // Called when a nurse acknowledges an alert that represents a one-off event.
  onAck(alert) {
    const s = this.beds.get(alert.bed_id);
    if (!s) return;
    if (alert.code === 'NURSE_CALL') s.nurseCall = false;
    if (alert.code === 'FALL') s.lastImpact = null;
    if (alert.code === 'BED_EXIT') s.wasOccupiedFor = 0;
  }

  // Compact public view sent to dashboards (grid included, history excluded).
  view(s) {
    const { poorSignalSince, occupiedSince, ...rest } = s;
    return { ...rest, poorSignal: poorSignalSince != null };
  }
}
