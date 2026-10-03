import { useLive, activeAlertsFor } from '../live.js';
import { Vital, fmt, worstSeverity } from '../components/widgets.jsx';

// Nurse-station wall view: one tile per bed, worst alert drives the tile colour.
export default function Station() {
  const { beds, alerts } = useLive();
  const list = Object.values(beds).sort((a, b) => a.bedId.localeCompare(b.bedId));
  if (!list.length) return <div className="empty">Waiting for beds… start the simulator or power on a device.</div>;
  return (
    <div className="station">
      {list.map((b) => {
        const al = activeAlertsFor(alerts, b.bedId);
        const sev = worstSeverity(al);
        const v = b.vitals ?? {};
        const dim = !b.vitalsReliable;
        return (
          <a key={b.bedId} href={`#/bed/${b.bedId}`} className={`tile ${sev ? `sev-${sev}` : ''}`}>
            <div className="tile-head">
              <strong>{b.label}</strong>
              <span className="muted">{b.patient ?? 'unassigned'}</span>
              <span className={`occ ${b.bed?.occupied ? 'in' : 'out'}`}>{b.bed ? (b.bed.occupied ? 'In bed' : 'Out of bed') : '—'}</span>
            </div>
            <div className="tile-vitals">
              <Vital label="HR" value={fmt(v.hr)} color="var(--hr)" dim={dim} />
              <Vital label="SpO₂" value={fmt(v.spo2)} unit="%" color="var(--spo2)" dim={dim} />
              <Vital label="Temp" value={fmt(v.temp, 1)} color="var(--temp)" dim={dim} />
              <Vital label="NBP" value={b.bp ? `${b.bp.sys}/${b.bp.dia}` : '--'} color="var(--bp)" />
              <Vital label="NEWS2*" value={b.news2?.score ?? '--'} color={`var(--risk-${b.news2?.risk ?? 'low'})`} />
            </div>
            <div className="tile-alert">{al.filter((a) => !a.cleared_at)[0]?.message ?? ''}</div>
          </a>
        );
      })}
    </div>
  );
}
