import { createServer as createTcpServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Aedes } from 'aedes';
import express from 'express';
import { Server as IoServer } from 'socket.io';

import { config as cfg } from './config.js';
import { openDb } from './db.js';
import { schemas, parseTopic } from './schemas.js';
import { BedStore } from './state.js';
import { AlertManager } from './alerts.js';
import { evaluate } from './rules/index.js';

const { q } = openDb(cfg.dbFile);
const store = new BedStore(cfg);
const knownBeds = new Set(q.beds.all().map((b) => b.bed_id));
for (const b of q.beds.all()) Object.assign(store.get(b.bed_id), { label: b.label, patient: b.patient });

// ---------- HTTP + Socket.IO ----------
const app = express();
app.use(express.json());
const http = createHttpServer(app);
const io = new IoServer(http, { cors: { origin: '*' } });
const emit = (ev, data) => io.emit(ev, data);
const alerts = new AlertManager({ q, cfg, emit });

// ---------- MQTT broker ----------
const broker = await Aedes.createBroker();
createTcpServer(broker.handle).listen(cfg.mqttPort, () => console.log(`MQTT  on :${cfg.mqttPort}`));

const publish = (topic, payload) =>
  broker.publish({ topic, payload: Buffer.from(JSON.stringify(payload)), qos: 1, retain: false }, () => {});

broker.on('publish', (packet, client) => {
  if (!client) return; // our own downlinks / $SYS
  const t = parseTopic(packet.topic);
  if (!t) return;
  const s = store.get(t.bedId);
  let raw;
  try {
    raw = JSON.parse(packet.payload.toString());
  } catch {
    raw = undefined;
  }
  const parsed = schemas[t.kind].safeParse(raw);
  if (!parsed.success) {
    store.device(s, t.node, Date.now()).invalid++;
    console.warn(`invalid ${packet.topic}:`, parsed.error?.issues?.[0]?.message ?? 'bad JSON');
    return;
  }
  if (!knownBeds.has(t.bedId)) { q.upsertBed.run(t.bedId, t.bedId); knownBeds.add(t.bedId); }
  store.apply(t.bedId, t.node, t.kind, parsed.data);
  if (t.kind === 'ankle/bp') saveVitals(s); // spot BP always stored
  runRules(s);
});

// ---------- rules + persistence loop ----------
function runRules(s) {
  alerts.process(s.bedId, evaluate(s, cfg));
  dirty.add(s.bedId);
}

function saveVitals(s) {
  const v = s.vitalsReliable ? s.vitals : {};
  q.insertVitals.run({
    bed_id: s.bedId, ts: Date.now(), hr: v?.hr ?? null, spo2: v?.spo2 ?? null, temp: v?.temp ?? null,
    sys: s.bp?.sys ?? null, dia: s.bp?.dia ?? null, sqi: s.vitals?.sqi ?? null, news2: s.news2?.score ?? null,
  });
}

// Push updates to dashboards at most 2x/s per bed.
const dirty = new Set();
setInterval(() => {
  for (const id of dirty) emit('bed:update', store.view(store.get(id)));
  dirty.clear();
}, 500);

// Every second: re-run rules (catches stale devices / time-based conditions).
setInterval(() => { for (const s of store.beds.values()) runRules(s); }, 1_000);

// Every 5 s: store a vitals sample per bed for trends.
setInterval(() => {
  for (const s of store.beds.values()) if (s.vitals) saveVitals(s);
}, 5_000);

// ---------- REST API ----------
const api = express.Router();
api.get('/beds', (_req, res) => res.json([...store.beds.values()].map((s) => store.view(s))));
api.get('/beds/:id', (req, res) => {
  const s = store.beds.get(req.params.id);
  s ? res.json(store.view(s)) : res.status(404).json({ error: 'unknown bed' });
});
api.patch('/beds/:id', (req, res) => {
  const s = store.get(req.params.id);
  q.upsertBed.run(s.bedId, s.bedId);
  if ('patient' in req.body) { s.patient = req.body.patient; q.setPatient.run(s.patient, s.bedId); }
  dirty.add(s.bedId);
  res.json(store.view(s));
});
api.get('/beds/:id/vitals', (req, res) => {
  const since = Number(req.query.since) || Date.now() - 3_600_000;
  res.json(q.vitalsSince.all(req.params.id, since));
});
api.post('/beds/:id/cmd', (req, res) => {
  const { node = 'ankle', cmd } = req.body ?? {};
  if (!['ankle', 'bed'].includes(node) || typeof cmd !== 'string') return res.status(400).json({ error: 'node/cmd' });
  publish(`smartbed/${req.params.id}/${node}/cmd`, { cmd });
  res.json({ ok: true });
});
api.get('/alerts', (req, res) =>
  res.json(req.query.all ? q.recentAlerts.all(Number(req.query.limit) || 200) : q.activeAlerts.all()));
api.post('/alerts/:id/ack', (req, res) => {
  const a = alerts.ack(Number(req.params.id), req.body?.by);
  if (!a) return res.status(404).json({ error: 'unknown alert' });
  store.onAck(a);
  res.json(a);
});
api.get('/config', (_req, res) => res.json(cfg));
app.use('/api', api);

// Serve the built dashboard if present (production / demo laptop).
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dashboard/dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

io.on('connection', (sock) => {
  sock.emit('snapshot', {
    beds: [...store.beds.values()].map((s) => store.view(s)),
    alerts: q.activeAlerts.all(),
  });
});

http.listen(cfg.httpPort, () => console.log(`HTTP  on :${cfg.httpPort}`));
