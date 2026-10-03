// In-browser demo backend: runs the simulator AND the server's real rules engine
// (imported from server/src) entirely client-side, so the dashboard works as a
// static site (e.g. on Vercel) with no MQTT broker or Node server.
import { config } from '../../server/src/config.js';
import { schemas, parseTopic } from '../../server/src/schemas.js';
import { BedStore } from '../../server/src/state.js';
import { AlertManager } from '../../server/src/alerts.js';
import { evaluate } from '../../server/src/rules/index.js';
import { createBedSim } from '../../simulator/scenarios.js';

// Same demo set the README uses: one bed per interesting scenario.
const DEMO_BEDS = ['normal', 'desat', 'exit', 'fall', 'fever', 'badsignal', 'call', 'still'];
const RESTART_AFTER_MS = 3 * 60_000; // replay scenarios so a long-open demo stays interesting

// Minimal in-memory stand-in for the prepared SQLite statements AlertManager uses.
function memoryAlertStore() {
  const rows = new Map();
  let nextId = 1;
  const copy = (a) => (a ? { ...a } : undefined);
  return {
    insertAlert: { run: (bed_id, code, severity, message, raised_at) => {
      const id = nextId++;
      rows.set(id, { id, bed_id, code, severity, message, raised_at, cleared_at: null, acked_at: null, acked_by: null });
      return { lastInsertRowid: id };
    } },
    clearAlert: { run: (now, id) => { const a = rows.get(id); if (a) a.cleared_at = now; } },
    ackAlert: { run: (now, by, id) => {
      const a = rows.get(id);
      if (!a || a.acked_at != null) return { changes: 0 };
      a.acked_at = now; a.acked_by = by;
      return { changes: 1 };
    } },
    alert: { get: (id) => copy(rows.get(Number(id))) },
    activeAlerts: { all: () => [...rows.values()].filter((a) => a.cleared_at == null || a.acked_at == null).sort((a, b) => b.raised_at - a.raised_at).map(copy) },
    recentAlerts: { all: (limit) => [...rows.values()].sort((a, b) => b.raised_at - a.raised_at).slice(0, limit).map(copy) },
  };
}

export function createDemoBackend(handlers) {
  const cfg = { ...config, timeScale: 60 }; // 1 real minute = 1 hour, so reposition alerts show up
  const q = memoryAlertStore();
  const store = new BedStore(cfg);
  const alerts = new AlertManager({ q, cfg, emit: (ev, data) => handlers[ev]?.(data) });
  const history = new Map(); // bedId -> [{ts, hr, spo2, temp, sys, dia, sqi, news2}]
  let sims = [];

  const ingest = (bedId, node, leaf, payload) => {
    const t = parseTopic(`smartbed/${bedId}/${node}/${leaf}`);
    const parsed = t && schemas[t.kind].safeParse(payload);
    if (!parsed?.success) return;
    const s = store.apply(t.bedId, t.node, t.kind, parsed.data);
    alerts.process(s.bedId, evaluate(s, cfg));
    handlers['bed:update']?.(store.view(s));
  };

  const start = () => {
    sims = DEMO_BEDS.map((scenario, i) => {
      const bedId = `B${String(i + 1).padStart(2, '0')}`;
      const s = store.get(bedId);
      s.patient ??= scenario === 'normal' ? 'Demo patient' : `Demo: ${scenario}`;
      return createBedSim(bedId, scenario, (node, leaf, payload) => ingest(bedId, node, leaf, payload));
    });
  };

  const sample = () => {
    for (const s of store.beds.values()) {
      if (!s.vitals) continue;
      const v = s.vitalsReliable ? s.vitals : {};
      const rows = history.get(s.bedId) ?? [];
      rows.push({ bed_id: s.bedId, ts: Date.now(), hr: v.hr ?? null, spo2: v.spo2 ?? null, temp: v.temp ?? null,
        sys: s.bp?.sys ?? null, dia: s.bp?.dia ?? null, sqi: s.vitals.sqi, news2: s.news2?.score ?? null });
      if (rows.length > 720) rows.shift(); // 1 h at 5 s
      history.set(s.bedId, rows);
    }
  };

  start();
  let startedAt = Date.now();
  setTimeout(() => {
    handlers.connect?.();
    handlers.snapshot?.({ beds: [...store.beds.values()].map((s) => store.view(s)), alerts: q.activeAlerts.all() });
  }, 0);

  setInterval(() => {
    if (Date.now() - startedAt > RESTART_AFTER_MS) {
      // Reset bed state (keeps alert history) and replay every scenario.
      for (const s of store.beds.values()) Object.assign(s, { bed: null, pressure: null, lastImpact: null, nurseCall: false, wasOccupiedFor: 0, occupiedSince: null, poorSignalSince: null });
      startedAt = Date.now();
      start();
    }
    for (const sim of sims) sim.tick();
    // Re-run rules for stale / time-based conditions, like the server's 1 s loop.
    for (const s of store.beds.values()) alerts.process(s.bedId, evaluate(s, cfg));
  }, 1000);
  setInterval(sample, 5000);

  return {
    mode: 'demo',
    ack: async (id, by) => {
      const a = alerts.ack(Number(id), by);
      if (a) store.onAck(a);
    },
    cmd: async (bedId, node, cmd) => sims.find((s) => s.bedId === bedId)?.command(node, cmd),
    setPatient: async (bedId, patient) => {
      const s = store.get(bedId);
      s.patient = patient;
      handlers['bed:update']?.(store.view(s));
    },
    history: async (bedId, since) => (history.get(bedId) ?? []).filter((r) => r.ts >= since),
    recentAlerts: async (limit) => q.recentAlerts.all(limit),
  };
}
