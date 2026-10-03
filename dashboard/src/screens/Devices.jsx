import { useEffect, useState } from 'react';
import { useLive, api } from '../live.js';

export default function Devices() {
  const { beds } = useLive();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  const rows = Object.values(beds).flatMap((b) => Object.entries(b.devices).map(([node, d]) => ({ bedId: b.bedId, node, ...d })));
  return (
    <table className="devices">
      <thead><tr><th>Bed</th><th>Node</th><th>Status</th><th>Last seen</th><th>RSSI</th><th>Battery</th><th>FW</th><th>Invalid msgs</th><th /></tr></thead>
      <tbody>
        {rows.map((r) => {
          const age = r.lastSeen ? Math.round((Date.now() - r.lastSeen) / 1000) : null;
          const status = r.online === false ? 'offline' : age > 10 ? 'stale' : 'online';
          return (
            <tr key={`${r.bedId}-${r.node}`}>
              <td>{r.bedId}</td><td>{r.node}</td>
              <td><span className={`dot ${status}`} /> {status}</td>
              <td>{age == null ? '—' : `${age}s ago`}</td>
              <td>{r.rssi ?? '—'}</td><td>{r.battery != null ? `${r.battery}%` : '—'}</td>
              <td>{r.fw ?? '—'}</td><td>{r.invalid}</td>
              <td><button onClick={() => api.cmd(r.bedId, r.node, 'identify')}>Identify</button></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
