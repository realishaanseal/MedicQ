import { useEffect, useState } from 'react';
import { useLive, SEV_RANK } from '../live.js';
import { AlertRow } from '../components/widgets.jsx';

export default function Alerts() {
  const { alerts } = useLive();
  const [history, setHistory] = useState([]);
  const active = Object.values(alerts).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.raised_at - a.raised_at);

  useEffect(() => {
    fetch('/api/alerts?all=1&limit=100').then((r) => r.json()).then(setHistory).catch(() => {});
  }, [active.length]);

  return (
    <div className="alerts-page">
      <h2>Active ({active.length})</h2>
      {active.map((a) => <AlertRow key={a.id} a={a} showBed />)}
      <h2>History</h2>
      {history.map((a) => <AlertRow key={a.id} a={a} showBed />)}
    </div>
  );
}
