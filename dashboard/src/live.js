import { useEffect, useState, useSyncExternalStore } from 'react';
import { io } from 'socket.io-client';

// Single live store fed by Socket.IO. Components subscribe with useLive().
const state = { connected: false, beds: {}, alerts: {} };
const listeners = new Set();
let snapshot = { ...state };
const commit = () => {
  snapshot = { ...state };
  listeners.forEach((l) => l());
};

const socket = io();
socket.on('connect', () => { state.connected = true; commit(); });
socket.on('disconnect', () => { state.connected = false; commit(); });
socket.on('snapshot', ({ beds, alerts }) => {
  state.beds = Object.fromEntries(beds.map((b) => [b.bedId, b]));
  state.alerts = Object.fromEntries(alerts.map((a) => [a.id, a]));
  commit();
});
socket.on('bed:update', (b) => { state.beds = { ...state.beds, [b.bedId]: b }; commit(); });
const upsertAlert = (a) => {
  const alerts = { ...state.alerts, [a.id]: a };
  if (a.cleared_at && a.acked_at) delete alerts[a.id];
  state.alerts = alerts;
  commit();
};
socket.on('alert:new', upsertAlert);
socket.on('alert:update', upsertAlert);

export function useLive() {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => snapshot);
}

export const SEV_RANK = { crit: 0, warn: 1, tech: 2, info: 3 };
export const activeAlertsFor = (alerts, bedId) =>
  Object.values(alerts)
    .filter((a) => a.bed_id === bedId)
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.raised_at - a.raised_at);

export const api = {
  ack: (id) => fetch(`/api/alerts/${id}/ack`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ by: 'station' }) }),
  cmd: (bedId, node, cmd) => fetch(`/api/beds/${bedId}/cmd`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ node, cmd }) }),
  setPatient: (bedId, patient) => fetch(`/api/beds/${bedId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient }) }),
};

// Fetch trend history for one bed, refreshed periodically.
export function useHistory(bedId, minutes = 60) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/beds/${bedId}/vitals?since=${Date.now() - minutes * 60_000}`)
        .then((r) => r.json())
        .then((d) => alive && setRows(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 5_000);
    return () => { alive = false; clearInterval(t); };
  }, [bedId, minutes]);
  return rows;
}
