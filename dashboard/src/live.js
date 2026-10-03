import { useEffect, useState, useSyncExternalStore } from 'react';
import { io } from 'socket.io-client';
import { createDemoBackend } from './demo.js';

// Which backend to use, in priority order:
//   ?server=https://host  -> live server at that URL
//   ?demo=1               -> in-browser demo
//   VITE_SERVER_URL       -> live server at that URL (build-time env)
//   VITE_DEMO=1           -> in-browser demo (set for the Vercel build)
//   otherwise             -> live server on the same origin (dev proxy / served by server/)
const params = new URLSearchParams(location.search);
const env = import.meta.env;
const serverUrl = params.get('server') ?? (params.has('demo') ? null : env.VITE_SERVER_URL || null);
export const MODE = serverUrl || (!params.has('demo') && env.VITE_DEMO !== '1') ? 'live' : 'demo';
export const SERVER_URL = serverUrl ?? '';

// ---------- live store, fed by whichever backend ----------
const state = { connected: false, mode: MODE, beds: {}, alerts: {} };
const listeners = new Set();
let snapshot = { ...state };
const commit = () => {
  snapshot = { ...state };
  listeners.forEach((l) => l());
};
const upsertAlert = (a) => {
  const alerts = { ...state.alerts, [a.id]: a };
  if (a.cleared_at && a.acked_at) delete alerts[a.id];
  state.alerts = alerts;
  commit();
};
const handlers = {
  connect: () => { state.connected = true; commit(); },
  disconnect: () => { state.connected = false; commit(); },
  snapshot: ({ beds, alerts }) => {
    state.beds = Object.fromEntries(beds.map((b) => [b.bedId, b]));
    state.alerts = Object.fromEntries(alerts.map((a) => [a.id, a]));
    commit();
  },
  'bed:update': (b) => { state.beds = { ...state.beds, [b.bedId]: b }; commit(); },
  'alert:new': upsertAlert,
  'alert:update': upsertAlert,
};

function createSocketBackend(base) {
  const socket = io(base || undefined);
  for (const [ev, fn] of Object.entries(handlers)) socket.on(ev, fn);
  const json = { 'content-type': 'application/json' };
  const post = (path, body, method = 'POST') => fetch(`${base}/api${path}`, { method, headers: json, body: JSON.stringify(body) });
  return {
    mode: 'live',
    ack: (id, by) => post(`/alerts/${id}/ack`, { by }),
    cmd: (bedId, node, cmd) => post(`/beds/${bedId}/cmd`, { node, cmd }),
    setPatient: (bedId, patient) => post(`/beds/${bedId}`, { patient }, 'PATCH'),
    history: (bedId, since) => fetch(`${base}/api/beds/${bedId}/vitals?since=${since}`).then((r) => r.json()),
    recentAlerts: (limit) => fetch(`${base}/api/alerts?all=1&limit=${limit}`).then((r) => r.json()),
  };
}

const backend = MODE === 'demo' ? createDemoBackend(handlers) : createSocketBackend(SERVER_URL);

export function useLive() {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => snapshot);
}

export const SEV_RANK = { crit: 0, warn: 1, tech: 2, info: 3 };
export const activeAlertsFor = (alerts, bedId) =>
  Object.values(alerts)
    .filter((a) => a.bed_id === bedId)
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.raised_at - a.raised_at);

export const api = {
  ack: (id) => backend.ack(id, 'station'),
  cmd: (bedId, node, cmd) => backend.cmd(bedId, node, cmd),
  setPatient: (bedId, patient) => backend.setPatient(bedId, patient),
  recentAlerts: (limit = 100) => backend.recentAlerts(limit),
};

// Trend history for one bed, refreshed periodically.
export function useHistory(bedId, minutes = 60) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.resolve(backend.history(bedId, Date.now() - minutes * 60_000))
        .then((d) => alive && setRows(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 5_000);
    return () => { alive = false; clearInterval(t); };
  }, [bedId, minutes]);
  return rows;
}
