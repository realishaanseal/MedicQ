import { useLive, useHistory, activeAlertsFor, api } from '../live.js';
import { Sparkline, PressureMap, AlertRow, fmt } from '../components/widgets.jsx';

const PARTS = { spo2: 'SpO₂', temp: 'Temp', sys: 'Systolic BP', hr: 'Heart rate' };

export default function BedDetail({ bedId }) {
  const { beds, alerts } = useLive();
  const hist = useHistory(bedId, 60);
  const b = beds[bedId];
  if (!b) return <div className="empty">Bed {bedId} not seen yet.</div>;
  const al = activeAlertsFor(alerts, bedId);
  const n = b.news2;

  const assign = () => {
    const p = prompt('Patient name / MRN', b.patient ?? '');
    if (p !== null) api.setPatient(bedId, p || null);
  };

  return (
    <div className="detail">
      <div className="detail-head">
        <h1>{b.label}</h1>
        <button onClick={assign}>{b.patient ?? 'Assign patient'}</button>
        <a href={`#/monitor/${bedId}`}>bedside monitor →</a>
      </div>

      <section className="card">
        <h2>Trends (60 min)</h2>
        {[['hr', 'HR', 'var(--hr)'], ['spo2', 'SpO₂', 'var(--spo2)'], ['temp', 'Temp', 'var(--temp)'], ['news2', 'NEWS2*', 'var(--risk-medium)']].map(([k, l, c]) => (
          <div key={k} className="trend"><span>{l}</span><Sparkline data={hist.map((h) => h[k])} color={c} height={50} /><span>{fmt(hist.at(-1)?.[k], k === 'temp' ? 1 : 0)}</span></div>
        ))}
      </section>

      <section className="card">
        <h2>NEWS2 (partial)</h2>
        {n ? (
          <>
            <div className={`news2 risk-${n.risk}`}>{n.score} <small>{n.risk}</small></div>
            <table><tbody>{Object.entries(PARTS).map(([k, l]) => <tr key={k}><td>{l}</td><td>{n.parts[k] ?? 'n/a'}</td></tr>)}</tbody></table>
            <p className="muted">Not measured: respiratory rate, consciousness (ACVPU), supplemental O₂. Clinical NEWS2 needs these.</p>
          </>
        ) : <p className="muted">No reliable vitals yet.</p>}
      </section>

      <section className="card">
        <h2>Bed</h2>
        <div className="bedinfo">
          <PressureMap bed={b.bed} pressure={b.pressure} />
          <div>
            <p>{b.bed?.occupied ? 'Occupied' : 'Empty'} · backrest {fmt(b.bed?.angle)}°</p>
            <p>Exit risk <strong>{Math.round((b.exitRisk ?? 0) * 100)}%</strong></p>
            <p>Longest continuous load <strong>{fmt(b.pressure?.maxMinutes)} min</strong></p>
            <p className="muted">● = centre of pressure. Outlined cells are near the reposition limit.</p>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Alerts</h2>
        {al.length ? al.map((a) => <AlertRow key={a.id} a={a} />) : <p className="muted">None</p>}
      </section>
    </div>
  );
}
