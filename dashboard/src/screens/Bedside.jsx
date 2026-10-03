import { useLive, useHistory, activeAlertsFor, api } from '../live.js';
import { Vital, Sparkline, fmt, AlertRow } from '../components/widgets.jsx';

// Full-screen bedside monitor for one bed (open on a tablet / monitor at the bed).
export default function Bedside({ bedId }) {
  const { beds, alerts } = useLive();
  const hist = useHistory(bedId, 15);
  const b = beds[bedId];
  if (!b) return <div className="empty">Bed {bedId} not seen yet.</div>;
  const v = b.vitals ?? {};
  const dim = !b.vitalsReliable;
  const al = activeAlertsFor(alerts, bedId);
  return (
    <div className="bedside">
      <div className="bedside-head">
        <h1>{b.label}</h1>
        <span>{b.patient ?? 'unassigned'}</span>
        {b.poorSignal && <span className="tag warn">POOR SIGNAL</span>}
        <a href={`#/bed/${bedId}`}>details →</a>
      </div>
      <div className="bedside-grid">
        <div className="row"><Sparkline data={hist.map((h) => h.hr)} color="var(--hr)" /><Vital big label="HR" unit="bpm" value={fmt(v.hr)} color="var(--hr)" dim={dim} /></div>
        <div className="row"><Sparkline data={hist.map((h) => h.spo2)} color="var(--spo2)" min={80} max={100} /><Vital big label="SpO₂" unit="%" value={fmt(v.spo2)} color="var(--spo2)" dim={dim} sub={`PI ${fmt(v.pi, 1)} · SQI ${fmt(v.sqi)}`} /></div>
        <div className="row"><Sparkline data={hist.map((h) => h.temp)} color="var(--temp)" /><Vital big label="Temp" unit="°C" value={fmt(v.temp, 1)} color="var(--temp)" dim={dim} /></div>
        <div className="row">
          <button onClick={() => api.cmd(bedId, 'ankle', 'bp_measure')}>Measure NBP</button>
          <Vital big label="NBP" unit="mmHg" value={b.bp ? `${b.bp.sys}/${b.bp.dia}` : '--/--'} color="var(--bp)"
            sub={b.bp ? `${Math.round((Date.now() - b.bp.ts) / 60000)} min ago` : 'no reading'} />
        </div>
      </div>
      <div className="alerts-list">{al.map((a) => <AlertRow key={a.id} a={a} />)}</div>
    </div>
  );
}
